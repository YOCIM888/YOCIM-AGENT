import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function initRepo(dir: string): Promise<void> {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@yocim.test')
  git(dir, 'config', 'user.name', 'YOCIM E2E')
  await writeFile(join(dir, 'app.ts'), 'export const version = 1\n')
  git(dir, 'add', 'app.ts')
  git(dir, 'commit', '-m', 'chore: 初始化项目')
  await writeFile(join(dir, 'app.ts'), 'export const version = 2\n')
  git(dir, 'commit', '-am', 'feat: 新增版本号')
  git(dir, 'branch', 'feature/x')
}

test('the commit graph renders history, expands a commit and collapses it again', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-graph-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-graph-ws-'))
  await initRepo(workspaceDir)

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspaceDir)
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await page.getByTestId('chat-input').waitFor()

    await page.getByTestId('workspace-tab-scm').click()
    await expect(page.getByTestId('scm-panel')).toBeVisible()

    // 切到「提交图」
    await page.getByTestId('scm-view-graph').click()
    await expect(page.getByTestId('git-graph')).toBeVisible()
    await expect(page.getByTestId('git-graph-count')).toContainText('2 个提交')

    // 分支标签挂在对应的提交上
    await expect(page.locator('[data-testid^="git-commit-"]').first()).toContainText('feat:')

    // 点击提交 → 展开详情（哪些文件、插入多少行、删除多少行）
    const first = page.locator('[data-testid^="git-commit-"]').first()
    await first.click()
    const detail = page.getByTestId('git-commit-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('app.ts')
    await expect(detail).toContainText('+1')
    await expect(detail).toContainText('−1')

    // 再点一次 → 收起
    await first.click()
    await expect(detail).toHaveCount(0)

    // 刷新提交图仍然正常
    await page.getByTestId('git-graph-refresh').click()
    await expect(page.getByTestId('git-graph-count')).toContainText('2 个提交')
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
