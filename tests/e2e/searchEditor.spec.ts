import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] })
}

async function selectWorkspace(
  page: Page,
  app: Awaited<ReturnType<typeof launch>>,
  dir: string
): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, dir)
  await page.getByTestId('menu-edit').click()
  await page.getByTestId('menu-open-folder').click()
  await expect(page.getByTestId('status-bar')).toContainText(basename(await realpath(dir)))
}

async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.locator('.view-lines').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
}

test('search groups results, jumps to editor, replaces with preview and rolls back via timeline', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-search-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-search-ws-'))
  await mkdir(join(workspaceDir, 'src'), { recursive: true })
  await mkdir(join(workspaceDir, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(workspaceDir, 'src', 'app.ts'), 'const foo = 1\nconsole.log(foo)\n')
  await writeFile(join(workspaceDir, 'README.md'), 'foo in readme\n')
  await writeFile(join(workspaceDir, '.gitignore'), '*.md\n')
  await writeFile(join(workspaceDir, 'node_modules', 'pkg', 'x.js'), 'foo dep\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-search').click()
    await page.getByTestId('search-input').fill('foo')
    await expect(page.getByTestId('search-status')).toContainText('2 处命中')
    await expect(page.getByTestId('search-file-src/app.ts')).toBeVisible()
    await expect(page.getByTestId('search-panel')).not.toContainText('README.md')
    await expect(page.getByTestId('search-panel')).not.toContainText('x.js')

    // 点击命中跳转编辑器并选中命中位置
    await page.locator('[data-testid^="search-result-"]').first().click()
    await expect(page.getByTestId('workspace-tab-editor')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.view-lines')).toContainText('const foo = 1')

    // 全局替换：先预览再应用
    await page.getByTestId('workspace-tab-search').click()
    await page.getByTestId('search-toggle-replace').click()
    await page.getByTestId('search-replace-input').fill('bar')
    await expect(page.getByTestId('search-status')).toContainText('2 处命中')
    await page.getByTestId('search-replace-all').click()
    await expect(page.getByTestId('replace-preview-dialog')).toBeVisible()
    await expect(page.getByTestId('replace-preview-summary')).toContainText('2')
    await page.getByTestId('replace-preview-confirm').click()
    await expect
      .poll(() => readFile(join(workspaceDir, 'src', 'app.ts'), 'utf8'))
      .toBe('const bar = 1\nconsole.log(bar)\n')

    // 时间线中恢复替换前快照（最旧一条）
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('timeline-section-header').click()
    const restoreButtons = page.locator('[data-testid^="timeline-restore-"]')
    await expect(restoreButtons.first()).toBeVisible()
    await restoreButtons.last().click()
    await expect(page.getByTestId('restore-dialog')).toBeVisible()
    await page.getByTestId('confirm-ok').click()
    await expect
      .poll(() => readFile(join(workspaceDir, 'src', 'app.ts'), 'utf8'))
      .toBe('const foo = 1\nconsole.log(foo)\n')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('editor supports multiple tabs, saving and external-modification conflicts', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-editor-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-editor-ws-'))
  await writeFile(join(workspaceDir, 'a.ts'), 'alpha\n')
  await writeFile(join(workspaceDir, 'b.ts'), 'beta\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    // 打开 a.ts 并在标签条上双击固定，再单击预览 b.ts → 两个标签
    await page.getByTestId('tree-node-a.ts').click()
    await expect(page.getByTestId('editor-tab-a.ts')).toBeVisible()
    await page.getByTestId('editor-tab-a.ts').dblclick()
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-b.ts').click()
    await expect(page.getByTestId('editor-tab-a.ts')).toBeVisible()
    await expect(page.getByTestId('editor-tab-b.ts')).toBeVisible()
    await expect(page.getByTestId('editor-status')).toHaveText('可编辑')

    // 编辑 + Ctrl+S 保存
    await typeIntoEditor(page, 'added by user')
    await expect(page.getByTestId('editor-dirty')).toBeVisible()
    await page.keyboard.press('Control+s')
    await expect.poll(() => readFile(join(workspaceDir, 'b.ts'), 'utf8')).toContain('added by user')
    await expect(page.getByTestId('editor-dirty')).not.toBeVisible()

    // 外部修改后保存 → 冲突对话框 → 重新加载
    await writeFile(join(workspaceDir, 'b.ts'), 'external change\n')
    await typeIntoEditor(page, 'local edit')
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('save-conflict-dialog')).toBeVisible()
    await page.getByTestId('save-conflict-reload').click()
    await expect(page.locator('.view-lines')).toContainText('external change')
    expect(await readFile(join(workspaceDir, 'b.ts'), 'utf8')).toBe('external change\n')

    // 再次外部修改 → 覆盖
    await writeFile(join(workspaceDir, 'b.ts'), 'external again\n')
    await typeIntoEditor(page, 'force save')
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('save-conflict-dialog')).toBeVisible()
    await page.getByTestId('save-conflict-overwrite').click()
    await expect.poll(() => readFile(join(workspaceDir, 'b.ts'), 'utf8')).toContain('force save')

    // 再次外部修改 → 另存为新文件
    await writeFile(join(workspaceDir, 'b.ts'), 'external third\n')
    await typeIntoEditor(page, 'save as copy')
    await page.getByTestId('editor-save').click()
    await expect(page.getByTestId('save-conflict-dialog')).toBeVisible()
    await page.getByTestId('save-conflict-saveas').click()
    await page.getByTestId('save-as-input').fill('copies/copy.ts')
    await page.getByTestId('save-as-confirm').click()
    await expect
      .poll(() => readFile(join(workspaceDir, 'copies', 'copy.ts'), 'utf8'))
      .toContain('save as copy')
    expect(await readFile(join(workspaceDir, 'b.ts'), 'utf8')).toBe('external third\n')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('editor selection is attached to the chat message with its range', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-selection-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-selection-ws-'))
  await writeFile(join(workspaceDir, 'sel.ts'), 'const selected = 42\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)
    await page.getByTestId('new-session').click()
    await page.getByTestId('tree-node-sel.ts').click()
    await expect(page.locator('.view-lines')).toContainText('const selected = 42')

    await page.locator('.view-line').first().click()
    await page.keyboard.press('Control+a')
    await page.getByTestId('editor-attach').click()
    await expect(page.getByTestId('attachment-chips')).toContainText('sel.ts:1-')

    await page.getByTestId('chat-input').fill('请解释这行代码')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('attachment-chips')).not.toBeVisible()
    // Mock Provider 会回显拼入上下文的选区内容
    await expect(page.getByTestId('chat-panel')).toContainText('const selected = 42')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
