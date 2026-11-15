import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] })
}

async function patchOpenDialog(
  app: Awaited<ReturnType<typeof launch>>,
  target: string
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, target)
}

async function selectWorkspace(page: Page, app: Awaited<ReturnType<typeof launch>>, dir: string) {
  await patchOpenDialog(app, dir)
  await page.getByTestId('workspace-switch').click()
  await expect(page.getByTestId('workspace-root')).toHaveText(await realpath(dir))
}

test('file tree defaults collapsed and supports create/rename/copy/paste/delete to recycle bin', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-fs-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-fs-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello')
  await mkdir(join(workspaceDir, 'src'), { recursive: true })
  await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export const ok = true\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    // 默认全折叠：只显示根级直接子项，目录子项懒加载
    await expect(page.getByTestId('tree-node-src')).toBeVisible()
    await expect(page.getByTestId('tree-node-hello.txt')).toBeVisible()
    await expect(page.getByTestId('tree-node-src/index.ts')).not.toBeVisible()
    await page.getByTestId('tree-node-src').click()
    await expect(page.getByTestId('tree-node-src/index.ts')).toBeVisible()
    await page.getByTestId('tree-toolbar-collapse').click()
    await expect(page.getByTestId('tree-node-src/index.ts')).not.toBeVisible()

    // 新建文件 / 文件夹（内联输入）
    await page.getByTestId('tree-toolbar-new-file').click()
    await page.getByTestId('tree-create-input').fill('created.ts')
    await page.getByTestId('tree-create-input').press('Enter')
    await expect(page.getByTestId('tree-node-created.ts')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'created.ts'), 'utf8')).toBe('')

    await page.getByTestId('tree-toolbar-new-folder').click()
    await page.getByTestId('tree-create-input').fill('docs')
    await page.getByTestId('tree-create-input').press('Enter')
    await expect(page.getByTestId('tree-node-docs')).toBeVisible()

    // 重命名（保留扩展名选中）
    await page.getByTestId('tree-node-created.ts').click({ button: 'right' })
    await page.getByTestId('menu-rename').click()
    await page.getByTestId('tree-rename-input').fill('renamed.ts')
    await page.getByTestId('tree-rename-input').press('Enter')
    await expect(page.getByTestId('tree-node-renamed.ts')).toBeVisible()
    await expect(page.getByTestId('tree-node-created.ts')).not.toBeVisible()

    // 复制 + 粘贴到目录
    await page.getByTestId('tree-node-renamed.ts').click({ button: 'right' })
    await page.getByTestId('menu-copy').click()
    await page.getByTestId('tree-node-docs').click({ button: 'right' })
    await page.getByTestId('menu-paste').click()
    await expect(page.getByTestId('tree-node-docs/renamed.ts')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'docs', 'renamed.ts'), 'utf8')).toBe('')

    // 粘贴重名 → 冲突对话框 → 保留两者
    await page.getByTestId('tree-node-hello.txt').click({ button: 'right' })
    await page.getByTestId('menu-copy').click()
    await page.getByTestId('tree-node-hello.txt').click({ button: 'right' })
    await page.getByTestId('menu-paste').click()
    await expect(page.getByTestId('conflict-dialog')).toBeVisible()
    await page.getByTestId('conflict-keep-both').click()
    await expect(page.getByTestId('tree-node-hello (2).txt')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'hello (2).txt'), 'utf8')).toBe('hello')

    // 删除 → 二次确认 → 系统回收站
    await app.evaluate(({ shell }) => {
      const scope = globalThis as unknown as { __trashed?: string[] }
      scope.__trashed = []
      const original = shell.trashItem.bind(shell)
      shell.trashItem = async (target: string) => {
        scope.__trashed!.push(target)
        await original(target)
      }
    })
    await page.getByTestId('tree-node-renamed.ts').click({ button: 'right' })
    await page.getByTestId('menu-delete').click()
    await expect(page.getByTestId('delete-dialog')).toBeVisible()
    await page.getByTestId('confirm-ok').click()
    await expect(page.getByTestId('tree-node-renamed.ts')).not.toBeVisible()
    await expect(readFile(join(workspaceDir, 'renamed.ts'), 'utf8')).rejects.toThrow()
    const trashed = await app.evaluate(
      () => (globalThis as unknown as { __trashed: string[] }).__trashed
    )
    expect(trashed.some((p) => p.endsWith('renamed.ts'))).toBe(true)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('outline jumps to the editor, timeline diffs/restores, and attachments feed the composer', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-outline-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-outline-ws-'))
  await mkdir(join(workspaceDir, 'src'), { recursive: true })
  await writeFile(
    join(workspaceDir, 'src', 'app.ts'),
    [
      'export class App {',
      '  greet(): string {',
      "    return 'hi'",
      '  }',
      '}',
      '',
      'export function main(): void {',
      '  console.log(App)',
      '}'
    ].join('\n')
  )

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    // 打开文件 → 编辑器附件按钮 → chips
    await page.getByTestId('tree-node-src').click()
    await page.getByTestId('tree-node-src/app.ts').click()
    await expect(page.getByTestId('editor-pane')).toBeVisible()
    await page.getByTestId('editor-attach').click()
    await expect(page.getByTestId('attachment-chips')).toBeVisible()
    await expect(page.getByTestId('attachment-chips')).toContainText('app.ts')
    await page.locator('[data-testid^="attachment-remove-"]').first().click()
    await expect(page.getByTestId('attachment-chips')).not.toBeVisible()

    // 文件树右键「添加到对话」共用附件模型
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-src/app.ts').click({ button: 'right' })
    await page.getByTestId('menu-attach').click()
    await expect(page.getByTestId('attachment-chips')).toContainText('app.ts')
    await page.getByTestId('attachment-clear').click()
    await expect(page.getByTestId('attachment-chips')).not.toBeVisible()

    // 大纲：展开区块，点击条目跳转编辑器
    await page.getByTestId('outline-section-header').click()
    await expect(page.locator('[data-testid^="outline-item-"]').first()).toBeVisible()
    await expect(page.getByTestId('outline-section')).toContainText('App')
    await page.locator('[data-testid^="outline-item-"]').first().click()
    await expect(page.getByTestId('workspace-tab-editor')).toHaveAttribute('aria-selected', 'true')

    // 时间线：Agent 写入生成快照，外部修改后可 Diff 与恢复
    await page.getByTestId('new-session').click()
    await page.getByTestId('chat-input').fill('/tool write notes/t.txt')
    await page.getByTestId('chat-send').click()
    await page.getByTestId('approval-approve').last().click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'notes', 't.txt'), 'utf8')).toBe('mock tool demo\n')

    await writeFile(join(workspaceDir, 'notes', 't.txt'), 'external change\n')
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-toolbar-refresh').click()
    await page.getByTestId('tree-node-notes').click()
    await page.getByTestId('tree-node-notes/t.txt').click()
    await expect(page.locator('.view-lines')).toContainText('external change')

    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('timeline-section-header').click()
    const entry = page.locator('[data-testid^="timeline-entry-"]').first()
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(page.getByTestId('diff-overlay')).toBeVisible()
    await page.getByTestId('diff-close').click()
    await expect(page.getByTestId('diff-overlay')).not.toBeVisible()

    // Diff 在编辑器视图展示，关闭后回到文件视图操作时间线
    await page.getByTestId('workspace-tab-files').click()
    await page.locator('[data-testid^="timeline-restore-"]').first().click()
    await expect(page.getByTestId('restore-dialog')).toBeVisible()
    await page.getByTestId('confirm-ok').click()
    await expect
      .poll(async () => readFile(join(workspaceDir, 'notes', 't.txt'), 'utf8'))
      .toBe('mock tool demo\n')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
