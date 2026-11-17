import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check', '--skip-language-onboarding']
  })
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
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

async function initRepo(dir: string): Promise<void> {
  git(dir, 'init')
  git(dir, 'config', 'user.email', 'e2e@yocim.test')
  git(dir, 'config', 'user.name', 'YOCIM E2E')
  await writeFile(join(dir, 'app.ts'), 'export const version = 1\n')
  git(dir, 'add', 'app.ts')
  git(dir, 'commit', '-m', 'init')
}

test('source control stages, commits, switches branches and diffs against a temp repo', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-scm-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-scm-ws-'))
  await initRepo(workspaceDir)
  const branch = git(workspaceDir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-scm').click()
    await expect(page.getByTestId('scm-panel')).toBeVisible()
    await expect(page.getByTestId('scm-branch')).toContainText(branch)
    await expect(page.getByTestId('scm-empty')).toBeVisible()

    // 修改文件 → 刷新后进入「更改」分组，活动栏出现变更数 badge
    await writeFile(join(workspaceDir, 'app.ts'), 'export const version = 2\n')
    await page.getByTestId('scm-refresh').click()
    await expect(page.getByTestId('scm-file-unstaged-app.ts')).toBeVisible()
    await expect(page.getByTestId('scm-group-unstaged')).toContainText('1')
    await expect(page.getByTestId('workspace-tab-scm-badge')).toHaveText('1')

    // 点击文件打开只读 Diff（在编辑器视图展示）
    await page.getByTestId('scm-file-unstaged-app.ts').click()
    await expect(page.getByTestId('workspace-tab-editor')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('diff-overlay')).toBeVisible()
    await page.getByTestId('diff-close').click()
    await page.getByTestId('workspace-tab-scm').click()

    // 暂存 → 提交
    await page.getByTestId('scm-stage-app.ts').click()
    await expect(page.getByTestId('scm-file-staged-app.ts')).toBeVisible()
    expect(git(workspaceDir, 'status', '--porcelain')).toContain('M  app.ts')

    await page.getByTestId('scm-message').fill('feat: bump version')
    await page.getByTestId('scm-commit').click()
    await expect(page.getByTestId('scm-empty')).toBeVisible()
    expect(git(workspaceDir, 'log', '-1', '--pretty=%s').trim()).toBe('feat: bump version')
    expect(git(workspaceDir, 'status', '--porcelain').trim()).toBe('')

    // 新建并切换分支
    await page.getByTestId('scm-branch').click()
    await expect(page.getByTestId('scm-branch-menu')).toBeVisible()
    await page.getByTestId('scm-branch-new').click()
    await page.getByTestId('scm-branch-input').fill('feature/p3')
    await page.getByTestId('scm-branch-create').click()
    await expect(page.getByTestId('scm-branch')).toContainText('feature/p3')
    expect(git(workspaceDir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/p3')

    // 放弃更改需要二次确认
    await writeFile(join(workspaceDir, 'app.ts'), 'broken\n')
    await page.getByTestId('scm-refresh').click()
    await page.getByTestId('scm-discard-app.ts').click()
    await expect(page.getByTestId('scm-discard-dialog')).toBeVisible()
    await page.getByTestId('confirm-ok').click()
    await expect
      .poll(() => readFile(join(workspaceDir, 'app.ts'), 'utf8'))
      .toContain('export const version = 2')

    // 未跟踪文件可以暂存，但放弃更改被拒绝并给出可读提示
    await writeFile(join(workspaceDir, 'notes.txt'), 'scratch\n')
    await page.getByTestId('scm-refresh').click()
    await expect(page.getByTestId('scm-file-untracked-notes.txt')).toBeVisible()
    await page.getByTestId('scm-stage-notes.txt').click()
    await expect(page.getByTestId('scm-file-staged-notes.txt')).toBeVisible()
    expect(git(workspaceDir, 'status', '--porcelain')).toContain('A  notes.txt')

    // Git 输出面板记录最近命令，且不刷入只读的 status
    await page.getByTestId('scm-toggle-output').click()
    await expect(page.getByTestId('scm-output')).toContainText('git add')
    await expect(page.getByTestId('scm-output')).not.toContainText('git status')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('source control reports a missing repository and offers initialization', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-scm-init-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-scm-init-ws-'))
  await writeFile(join(workspaceDir, 'plain.txt'), 'no repo yet\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)
    await page.getByTestId('workspace-tab-scm').click()
    await expect(page.getByTestId('scm-not-repo')).toBeVisible()

    await page.getByTestId('scm-init').click()
    await expect(page.getByTestId('scm-file-untracked-plain.txt')).toBeVisible()
    expect(git(workspaceDir, 'rev-parse', '--is-inside-work-tree').trim()).toBe('true')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('audit filters, shows details, streams live entries and exports JSON/CSV', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-audit-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-audit-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello audit\n')
  const jsonPath = join(userDataDir, 'audit.json')
  const csvPath = join(userDataDir, 'audit.csv')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)
    await page.getByTestId('new-session').click()
    // 默认档位为自动：显式切到手动档以验证审批与审计记录
    await page.getByTestId('approval-mode').click()
    await page.getByTestId('approval-mode-manual').click()

    // 一次只读工具 + 一次需审批的写入
    await page.getByTestId('chat-input').fill('/tool read hello.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await page.getByTestId('chat-input').fill('/tool write notes/a.txt')
    await page.getByTestId('chat-send').click()
    await page.getByTestId('approval-approve').last().click()
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await page.getByTestId('audit-toggle').click()
    await expect(page.getByTestId('audit-stat-total')).toHaveText('2')
    await expect(page.getByTestId('audit-stat-approved')).toHaveText('1')
    await expect(page.getByTestId('audit-panel')).toContainText('read_file')
    await expect(page.getByTestId('audit-panel')).toContainText('已批准')

    // 详情抽屉：runId / callId / 参数摘要
    await page.locator('[data-testid^="audit-row-"]').first().click()
    await expect(page.getByTestId('audit-detail')).toBeVisible()
    await expect(page.getByTestId('audit-detail')).toContainText('callId')
    await expect(page.getByTestId('audit-detail-args')).toContainText('write_file')
    await page.getByTestId('audit-detail-close').click()
    await expect(page.getByTestId('audit-detail')).not.toBeVisible()

    // 关键字筛选
    await page.getByTestId('audit-keyword').fill('write_file')
    await expect(page.getByTestId('audit-stat-total')).toHaveText('1')
    await page.getByTestId('audit-keyword').fill('')
    await expect(page.getByTestId('audit-stat-total')).toHaveText('2')

    // 工具下拉只列出当前筛选结果里出现过的工具
    await page.getByTestId('audit-filters-toggle').click()
    await page.getByTestId('audit-filter-tool').selectOption('read_file')
    await expect(page.getByTestId('audit-stat-total')).toHaveText('1')
    await page.getByTestId('audit-clear-filters').click()
    await expect(page.getByTestId('audit-stat-total')).toHaveText('2')

    // 实时模式：不点刷新也能带出新审计条目
    await page.getByTestId('audit-live').click()
    await page.getByTestId('chat-input').fill('/tool read hello.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('audit-stat-total')).toHaveText('3', { timeout: 15_000 })
    await page.getByTestId('audit-live').click()

    // 导出 JSON / CSV，写入主进程返回的保存路径
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, jsonPath)
    await page.getByTestId('audit-export-json').click()
    await expect(page.getByTestId('audit-notice')).toContainText('已导出 3 条')
    const exported = JSON.parse(await readFile(jsonPath, 'utf8')) as {
      count: number
      entries: Array<{ tool: string; approvalLabel: string }>
    }
    expect(exported.count).toBe(3)
    expect(exported.entries.map((entry) => entry.tool)).toContain('write_file')
    expect(exported.entries.some((entry) => entry.approvalLabel === '已批准')).toBe(true)

    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, csvPath)
    await page.getByTestId('audit-export-csv').click()
    const csv = await readFile(csvPath, 'utf8')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"write_file"')
    expect(csv.split('\r\n')[0]).toContain('耗时(ms)')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
