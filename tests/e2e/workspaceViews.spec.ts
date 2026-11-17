import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check', '--skip-language-onboarding']
  })
}

const VIEWS = [
  { testid: 'workspace-tab-files', label: '文件', panel: 'file-tree' },
  { testid: 'workspace-tab-search', label: '搜索', panel: 'search-panel' },
  { testid: 'workspace-tab-editor', label: '编辑器', panel: 'editor-pane' },
  { testid: 'audit-toggle', label: '审计', panel: 'audit-panel' },
  { testid: 'workspace-tab-scm', label: '源代码管理', panel: 'scm-panel' },
  { testid: 'workspace-tab-extensions', label: '扩展安装', panel: 'extensions-panel' },
  { testid: 'workspace-tab-debug', label: '运行和调试', panel: 'run-panel' },
  { testid: 'workspace-tab-remote', label: '远程管理器', panel: 'remote-panel' }
] as const

test('switches all 8 activity bar views and persists the active view', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-views-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-views-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello from views e2e')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspaceDir)
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await expect(page.getByTestId('tree-node-hello.txt')).toBeVisible()

    const bar = page.getByTestId('workspace-activity-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('tab')).toHaveCount(8)
    await expect(bar.locator('.separator')).toHaveCount(1)

    // 默认文件视图，图标 tooltip 与选中态
    await expect(page.getByTestId('workspace-tab-files')).toHaveAttribute('aria-selected', 'true')
    for (const view of VIEWS) {
      await expect(page.getByTestId(view.testid)).toHaveAttribute('title', view.label)
    }

    // 8 个视图逐一可切换，骨架视图标注交付阶段
    for (const view of VIEWS) {
      await page.getByTestId(view.testid).click()
      await expect(page.getByTestId(view.testid)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId(view.panel)).toBeVisible()
      if ('phase' in view) {
        await expect(page.getByTestId(view.panel)).toContainText(`${view.phase} 阶段交付`)
      }
    }

    // 打开文件自动切到编辑器
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-hello.txt').click()
    await expect(page.getByTestId('workspace-tab-editor')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('editor-pane')).toBeVisible()
    await expect(page.locator('.view-lines')).toContainText('hello from views e2e')

    // 手动切走后不再强制跳回编辑器
    await page.getByTestId('audit-toggle').click()
    await expect(page.getByTestId('audit-panel')).toBeVisible()
    await expect(page.getByTestId('editor-pane')).not.toBeVisible()
    await page.waitForTimeout(400)
    await expect(page.getByTestId('audit-panel')).toBeVisible()

    // 再次从文件树打开文件仍会切到编辑器
    await page.getByTestId('workspace-tab-files').click()
    await page.getByTestId('tree-node-hello.txt').click()
    await expect(page.getByTestId('editor-pane')).toBeVisible()

    // 活动视图持久化：刷新后恢复
    await page.getByTestId('workspace-tab-search').click()
    await page.reload()
    await expect(page.getByTestId('workspace-tab-search')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('search-panel')).toBeVisible()

    // 旧 localStorage key 迁移
    await page.evaluate(() => {
      localStorage.removeItem('yocim.ui.workspaceView')
      localStorage.setItem('yocim.ui.workspaceTab', 'audit')
    })
    await page.reload()
    await expect(page.getByTestId('audit-toggle')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('audit-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('activity bar fits 1024/1280/1440 and scrolls when the panel is narrow', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-views-fit-'))
  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    const bar = page.getByTestId('workspace-activity-bar')
    await expect(bar).toBeVisible()

    for (const width of [1024, 1280, 1440]) {
      await app.evaluate(({ BrowserWindow }, w) => {
        BrowserWindow.getAllWindows()[0]?.setSize(w, 800)
      }, width)
      await expect(page.getByTestId('workspace-panel')).toBeVisible()

      const overflow = await page.evaluate(() => {
        const g = globalThis as unknown as {
          innerWidth: number
          document: {
            documentElement: { scrollWidth: number }
            querySelector(selector: string): { scrollHeight: number; clientHeight: number } | null
          }
        }
        const el = g.document.querySelector('[data-testid="workspace-activity-bar"]')
        return {
          page: g.document.documentElement.scrollWidth - g.innerWidth,
          barVertical: el ? el.scrollHeight - el.clientHeight : 0
        }
      })
      expect(overflow.page).toBeLessThanOrEqual(0)
      expect(overflow.barVertical).toBeLessThanOrEqual(0)

      const buttonWidths = await bar
        .getByRole('tab')
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width))
      expect(buttonWidths).toHaveLength(8)
      for (const w of buttonWidths) expect(w).toBe(26)
    }

    // 面板最窄 220px 时活动栏横向滚动，图标不压缩
    await page.evaluate(() => localStorage.setItem('yocim.ui.workspaceWidth', '220'))
    await page.reload()
    await expect(page.getByTestId('workspace-panel')).toBeVisible()
    const scrollable = await bar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(scrollable).toBe(true)
    await bar.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await page.getByTestId('workspace-tab-remote').click()
    await expect(page.getByTestId('remote-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
