import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import type { YocimApi } from '../../src/shared/api'
import type { IpcResult, WorkspaceInfo } from '../../src/shared/ipc'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`]
  })
}

async function openAppMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-app').click()
}

async function toggleTheme(page: Page): Promise<void> {
  await openAppMenu(page)
  await page.getByTestId('theme-toggle').click()
}

async function openSettings(page: Page): Promise<void> {
  await openAppMenu(page)
  await page.getByTestId('settings-open').click()
}

async function openSessionMenu(page: Page): Promise<void> {
  await page.getByTestId('session-row-active').click({ button: 'right' })
}

async function patchOpenDialog(
  app: Awaited<ReturnType<typeof launch>>,
  target: string
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, target)
}

test('launches the shell, streams a reply and cancels generation', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-'))
  const app = await launch(userDataDir)

  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('YOCIM AGENT')
    await expect(page.getByTestId('app-title')).toHaveText('YOCIM AGENT')

    const bridge = await page.evaluate(() => {
      const api = (globalThis as unknown as { yocim?: YocimApi }).yocim
      return { platform: api?.platform, electron: api?.versions?.electron }
    })
    expect(typeof bridge.platform).toBe('string')
    expect(bridge.electron).toMatch(/^\d+\./)

    const nodeLeak = await page.evaluate(() => {
      const scope = globalThis as unknown as Record<string, unknown>
      return 'require' in scope || 'process' in scope
    })
    expect(nodeLeak).toBe(false)

    await expect(page.getByTestId('workspace-switch')).toBeVisible()
    await expect(page.getByTestId('workspace-empty')).toBeVisible()
    await expect(page.getByTestId('titlebar')).toBeVisible()
    await expect(page.getByTestId('window-minimize')).toBeVisible()
    await expect(page.getByTestId('window-maximize')).toBeVisible()
    await expect(page.getByTestId('window-close')).toBeVisible()
    await expect(page.getByTestId('session-sidebar')).toBeVisible()
    await expect(page.getByTestId('workspace-panel')).toBeVisible()
    await expect(page.getByTestId('file-tree')).toBeVisible()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expect(page.getByTestId('status-bar')).toBeVisible()
    await expect(page.getByTestId('welcome-state')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const initialMaximized = await app.evaluate(({ BrowserWindow }) =>
      Boolean(BrowserWindow.getAllWindows()[0]?.isMaximized())
    )
    await page.getByTestId('window-maximize').click()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          Boolean(BrowserWindow.getAllWindows()[0]?.isMaximized())
        )
      )
      .toBe(!initialMaximized)
    await page.getByTestId('window-maximize').click()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          Boolean(BrowserWindow.getAllWindows()[0]?.isMaximized())
        )
      )
      .toBe(initialMaximized)

    await page.getByTestId('session-collapse').click()
    await expect(page.getByTestId('session-sidebar')).not.toBeVisible()
    await expect(page.getByTestId('session-expand')).toBeVisible()

    // 折叠左栏后，会话区应占满剩余宽度，右栏贴住窗口右侧
    const layout = await page.evaluate(() => {
      interface Rect {
        left: number
        right: number
        width: number
      }
      const scope = globalThis as unknown as {
        innerWidth: number
        document: {
          querySelector(selector: string): { getBoundingClientRect(): Rect } | null
        }
      }
      const chat = scope.document
        .querySelector('[data-testid="chat-panel"]')
        ?.getBoundingClientRect()
      const workspace = scope.document
        .querySelector('[data-testid="workspace-panel"]')
        ?.getBoundingClientRect()
      return {
        chatLeft: chat?.left ?? -1,
        chatWidth: chat?.width ?? 0,
        workspaceRight: workspace?.right ?? -1,
        innerWidth: scope.innerWidth
      }
    })
    expect(layout.chatLeft).toBeLessThan(2)
    expect(layout.chatWidth).toBeGreaterThan(layout.innerWidth * 0.5)
    expect(Math.abs(layout.workspaceRight - layout.innerWidth)).toBeLessThan(2)

    await page.getByTestId('session-expand').click()
    await expect(page.getByTestId('session-sidebar')).toBeVisible()

    await page.getByTestId('workspace-collapse').click()
    await expect(page.getByTestId('workspace-panel')).not.toBeVisible()
    await expect(page.getByTestId('workspace-expand')).toBeVisible()
    await page.getByTestId('workspace-expand').click()
    await expect(page.getByTestId('workspace-panel')).toBeVisible()

    await expect(page.getByTestId('status-toggle')).toHaveText('展开')
    await page.getByTestId('status-toggle').click()
    await expect(page.getByTestId('status-bar')).toContainText('Electron')
    await page.getByTestId('status-toggle').click()

    // 快捷键：Ctrl+B / Ctrl+Shift+B / Ctrl+K / Ctrl+J
    await page.keyboard.press('Control+b')
    await expect(page.getByTestId('session-sidebar')).not.toBeVisible()
    await page.keyboard.press('Control+b')
    await expect(page.getByTestId('session-sidebar')).toBeVisible()

    await page.keyboard.press('Control+Shift+b')
    await expect(page.getByTestId('workspace-panel')).not.toBeVisible()
    await page.keyboard.press('Control+Shift+b')
    await expect(page.getByTestId('workspace-panel')).toBeVisible()

    await page.getByTestId('session-collapse').click()
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('session-sidebar')).toBeVisible()
    await expect(page.getByTestId('session-search')).toBeFocused()

    await page.keyboard.press('Control+j')
    await expect(page.getByTestId('status-bar')).toContainText('Electron')
    await page.keyboard.press('Control+j')

    await toggleTheme(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // 窄窗口自动折叠工作区
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(900, 800)
    })
    await expect(page.getByTestId('workspace-panel')).not.toBeVisible()
    await expect(page.getByTestId('workspace-expand')).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 900)
    })
    await page.keyboard.press('Control+Shift+b')
    await expect(page.getByTestId('workspace-panel')).toBeVisible()

    await page.getByTestId('new-session').click()
    await page.getByTestId('chat-input').fill('你好 YOCIM')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-panel')).toContainText('你好 YOCIM')
    await expect(page.getByTestId('chat-panel')).toContainText('Mock Provider 已收到：你好 YOCIM')
    await expect(page.getByTestId('chat-send')).toBeVisible()

    const longText = Array.from({ length: 60 }, (_, index) => `cancel-${index}`).join(' ')
    await page.getByTestId('chat-input').fill(longText)
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-cancel')).toBeVisible()
    await page.getByTestId('chat-cancel').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(page.getByTestId('chat-cancel')).not.toBeVisible()

    await page.getByTestId('chat-input').fill('取消后恢复')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-panel')).toContainText('Mock Provider 已收到：取消后恢复')
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(page.getByTestId('chat-status')).toHaveText('就绪')

    await page.getByTestId('chat-input').fill('**加粗** 和 `代码`')
    await page.getByTestId('chat-send').click()
    await expect(page.locator('.markdown-body strong')).toContainText('加粗')
    await expect(page.locator('.markdown-body code')).toContainText('代码')
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await page.getByTestId('chat-input').fill('<img src=x onerror="window.__xss=1">')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(page.locator('.markdown-body img[onerror]')).toHaveCount(0)
    const xss = await page.evaluate(() => (globalThis as unknown as { __xss?: number }).__xss)
    expect(xss).toBeUndefined()

    // Ctrl+N 新建会话后回到欢迎态
    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('welcome-state')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toHaveValue('')

    const current = await page.evaluate(async () => {
      const api = (globalThis as unknown as { yocim: YocimApi }).yocim
      return api.workspace.current()
    })
    const typed = current as IpcResult<WorkspaceInfo | null>
    expect(typed.ok).toBe(true)
    if (typed.ok) {
      expect(typed.data).toBeNull()
    }
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('selects a workspace, runs tools with approvals and persists across restart', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-data-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello from e2e')
  await mkdir(join(workspaceDir, 'src'), { recursive: true })
  await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export const ok = true\n')
  const expectedRoot = await realpath(workspaceDir)

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('workspace-root')).toHaveText('未选择工作区')

    // 用 Playwright 替换主进程的文件选择对话框，真实走 renderer → preload → IPC → 工作区服务
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspaceDir)

    await page.getByTestId('workspace-switch').click()
    await expect(page.getByTestId('workspace-root')).toHaveText(expectedRoot)
    await expect(page.getByTestId('tree-node-hello.txt')).toBeVisible()
    await expect(page.getByTestId('tree-node-src')).toBeVisible()

    await page.getByTestId('tree-node-hello.txt').click()
    await expect(page.getByTestId('editor-pane')).toContainText('hello.txt')
    await expect(page.locator('.monaco-editor')).toBeVisible()
    await expect(page.locator('.view-lines')).toContainText('hello from e2e')

    await expect(page.getByTestId('workspace-switch')).toBeVisible()
    await page.getByTestId('workspace-tab-files').click()
    await expect(page.getByTestId('file-tree')).toBeVisible()
    await expect(page.locator('.monaco-editor')).not.toBeVisible()
    // P1：目录默认折叠，点击按需懒加载展开，再次点击折叠
    await expect(page.getByTestId('tree-node-src/index.ts')).not.toBeVisible()
    await page.getByTestId('tree-node-src').click()
    await expect(page.getByTestId('tree-node-src/index.ts')).toBeVisible()
    await page.getByTestId('tree-node-src').click()
    await expect(page.getByTestId('tree-node-src/index.ts')).not.toBeVisible()
    await page.getByTestId('workspace-tab-editor').click()
    await expect(page.locator('.monaco-editor')).toBeVisible()
    await expect(page.locator('.view-lines')).toContainText('hello from e2e')

    await page.getByTestId('status-toggle').click()
    await expect(page.getByTestId('status-bar')).toContainText('hello.txt')

    await page.getByTestId('chat-input').fill('/tool read hello.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('timeline').last()).toContainText('已执行 1 个步骤')
    await page.getByTestId('timeline-toggle').last().click()
    await expect(page.getByTestId('timeline-step').last()).toContainText('read_file')
    await expect(page.getByTestId('timeline-step').last()).toContainText('hello.txt')
    await expect(page.getByTestId('chat-panel')).toContainText('工具执行完成：hello from e2e')
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await page.getByTestId('chat-input').fill('/tool write notes/demo.txt')
    await page.getByTestId('chat-send').click()
    const approveTimeline = page.getByTestId('timeline').last()
    await expect(approveTimeline.getByTestId('approval-card')).toBeVisible()
    await expect(approveTimeline.getByTestId('approval-card')).toContainText('write_file')
    await page.getByTestId('approval-approve').last().click()
    await expect(approveTimeline.getByTestId('approval-card')).toContainText('已批准')
    await expect(page.getByTestId('chat-panel')).toContainText(
      '工具执行完成：已写入 notes/demo.txt'
    )
    await expect(page.getByTestId('chat-send')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'notes', 'demo.txt'), 'utf8')).toBe('mock tool demo\n')

    await page.getByTestId('chat-input').fill('/tool write notes/denied.txt')
    await page.getByTestId('chat-send').click()
    const denyTimeline = page.getByTestId('timeline').last()
    await expect(denyTimeline.getByTestId('approval-card')).toBeVisible()
    await page.getByTestId('approval-deny').last().click()
    await expect(denyTimeline.getByTestId('approval-card')).toContainText('已拒绝')
    await expect(page.getByTestId('chat-panel')).toContainText(
      '工具执行完成：用户拒绝了该操作，未执行。'
    )
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(readFile(join(workspaceDir, 'notes', 'denied.txt'), 'utf8')).rejects.toThrow()

    // 审批挂起时取消生成：审批自动按拒绝处理，文件不落盘
    await page.getByTestId('chat-input').fill('/tool write notes/cancelled.txt')
    await page.getByTestId('chat-send').click()
    const cancelTimeline = page.getByTestId('timeline').last()
    await expect(cancelTimeline.getByTestId('approval-card')).toBeVisible()
    await page.getByTestId('chat-cancel').click()
    await expect(cancelTimeline.getByTestId('approval-card')).not.toBeVisible()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(readFile(join(workspaceDir, 'notes', 'cancelled.txt'), 'utf8')).rejects.toThrow()

    await page.getByTestId('audit-toggle').click()
    await expect(page.getByTestId('audit-panel')).toContainText('write_file')
    await expect(page.getByTestId('audit-panel')).toContainText('已批准')
    await expect(page.getByTestId('audit-panel')).toContainText('read_file')
    await expect(page.getByTestId('audit-panel')).toContainText('已拒绝')
    await page.getByTestId('audit-scope-all').click()
    await expect(page.getByTestId('audit-panel')).toContainText('write_file')
    await page.getByTestId('audit-scope-session').click()

    await openSessionMenu(page)
    await page.getByTestId('session-rename').click()
    const renameInput = page.getByTestId('session-rename-input')
    await renameInput.fill('E2E 会话')
    await renameInput.press('Enter')
    await expect(page.getByTestId('session-sidebar')).toContainText('E2E 会话')

    await toggleTheme(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByTestId('session-collapse').click()
    await expect(page.getByTestId('session-expand')).toBeVisible()
  } finally {
    await app.close()
  }

  const restarted = await launch(userDataDir)
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByTestId('workspace-root')).toHaveText(expectedRoot)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('status-toggle')).toHaveText('收起')
    await expect(page.getByTestId('session-expand')).toBeVisible()
    await page.getByTestId('session-expand').click()
    await expect(page.getByTestId('session-sidebar')).toContainText('E2E 会话')
    await expect(page.getByTestId('chat-panel')).toContainText('/tool read hello.txt')
    await expect(page.getByTestId('chat-panel')).toContainText('工具执行完成：hello from e2e')
    await page.getByTestId('audit-toggle').click()
    await expect(page.getByTestId('audit-panel')).toContainText('write_file')
    await expect(page.getByTestId('audit-panel')).toContainText('已批准')
  } finally {
    await restarted.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('groups sessions by project and supports pin/archive/search/move', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-projects-'))
  const workspaceA = await mkdtemp(join(os.tmpdir(), 'yocim-proj-a-'))
  const workspaceB = await mkdtemp(join(os.tmpdir(), 'yocim-proj-b-'))
  const projectAName = basename(workspaceA)
  const projectBName = basename(workspaceB)

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await patchOpenDialog(app, workspaceA)
    await page.getByTestId('workspace-switch').click()
    await expect(page.getByTestId('workspace-root')).toHaveText(await realpath(workspaceA))

    const groupA = page.getByTestId('project-group').filter({ hasText: projectAName })
    await expect(groupA).toBeVisible()

    await page.getByTestId('new-session').click()
    await expect(groupA.getByTestId('session-item')).toHaveCount(1)
    await groupA.getByTestId('project-header').click({ button: 'right' })
    await page.getByTestId('project-new-session').click()
    await expect(groupA.getByTestId('session-item')).toHaveCount(2)

    await openSessionMenu(page)
    await page.getByTestId('session-pin').click()
    await expect(page.getByTestId('pinned-section')).toContainText('会话 2')
    await expect(groupA.getByTestId('session-item')).toHaveCount(1)

    await page.getByTestId('session-search').fill('会话 2')
    await expect(page.getByTestId('session-item')).toHaveCount(1)
    await expect(page.getByTestId('pinned-section')).toContainText('会话 2')
    await page.getByTestId('session-search').fill('')

    await openSessionMenu(page)
    await page.getByTestId('session-archive').click()
    await expect(page.getByTestId('pinned-section')).not.toBeVisible()
    await page.getByTestId('archive-toggle').click()
    const archivedRow = page.getByTestId('session-item').filter({ hasText: '会话 2' })
    await expect(archivedRow).toContainText('已归档')
    await archivedRow.click()
    await openSessionMenu(page)
    await page.getByTestId('session-archive').click()
    await expect(page.getByTestId('pinned-section')).toContainText('会话 2')
    await openSessionMenu(page)
    await page.getByTestId('session-pin').click()
    await expect(page.getByTestId('pinned-section')).not.toBeVisible()

    await patchOpenDialog(app, workspaceB)
    await page.getByTestId('workspace-switch').click()
    await expect(page.getByTestId('project-group')).toHaveCount(2)
    const groupB = page.getByTestId('project-group').filter({ hasText: projectBName })
    await expect(groupB).toBeVisible()

    await page.getByTestId('session-item').filter({ hasText: '会话 2' }).click()
    await openSessionMenu(page)
    await page.getByTestId('session-move').click()
    await expect(page.getByTestId('move-dialog')).toBeVisible()
    await page.getByTestId('move-project-option').filter({ hasText: projectBName }).click()
    await expect(page.getByTestId('move-dialog')).not.toBeVisible()
    await expect(groupB).toContainText('会话 2')
    await expect(groupA.getByTestId('session-item').filter({ hasText: '会话 2' })).toHaveCount(0)

    await openSessionMenu(page)
    await page.getByTestId('session-pin').click()
    await expect(page.getByTestId('pinned-section')).toContainText('会话 2')

    await groupA.getByTestId('project-header').click({ button: 'right' })
    await page.getByTestId('project-rename').click()
    await page.getByTestId('project-rename-input').fill('项目 A 改名')
    await page.getByTestId('project-rename-input').press('Enter')
    await expect(page.getByTestId('project-group').filter({ hasText: '项目 A 改名' })).toBeVisible()
  } finally {
    await app.close()
  }

  const restarted = await launch(userDataDir)
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByTestId('project-group')).toHaveCount(2)
    await expect(page.getByTestId('pinned-section')).toContainText('会话 2')
    await expect(page.getByTestId('session-sidebar')).toContainText('项目 A 改名')
    await expect(page.getByTestId('session-sidebar')).toContainText(projectBName)
  } finally {
    await restarted.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceA, { recursive: true, force: true })
    await rm(workspaceB, { recursive: true, force: true })
  }
})

test('resizes both sidebars and persists widths', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-resize-'))
  const app = await launch(userDataDir)

  try {
    const page = await app.firstWindow()
    const sessionPanel = page.getByTestId('session-sidebar')
    const workspacePanel = page.getByTestId('workspace-panel')
    await expect(sessionPanel).toBeVisible()
    await expect(workspacePanel).toBeVisible()

    const initialSessionWidth = (await sessionPanel.boundingBox())?.width ?? 0
    const leftHandle = await page.getByTestId('resize-left').boundingBox()
    expect(leftHandle).not.toBeNull()
    if (leftHandle) {
      await page.mouse.move(
        leftHandle.x + leftHandle.width / 2,
        leftHandle.y + leftHandle.height / 2
      )
      await page.mouse.down()
      await page.mouse.move(
        leftHandle.x + leftHandle.width / 2 + 70,
        leftHandle.y + leftHandle.height / 2,
        { steps: 5 }
      )
      await page.mouse.up()
    }
    await expect
      .poll(async () => (await sessionPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialSessionWidth + 40)

    const initialWorkspaceWidth = (await workspacePanel.boundingBox())?.width ?? 0
    const rightHandle = await page.getByTestId('resize-right').boundingBox()
    expect(rightHandle).not.toBeNull()
    if (rightHandle) {
      await page.mouse.move(
        rightHandle.x + rightHandle.width / 2,
        rightHandle.y + rightHandle.height / 2
      )
      await page.mouse.down()
      await page.mouse.move(
        rightHandle.x + rightHandle.width / 2 - 60,
        rightHandle.y + rightHandle.height / 2,
        { steps: 5 }
      )
      await page.mouse.up()
    }
    await expect
      .poll(async () => (await workspacePanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialWorkspaceWidth + 30)

    const persistedSessionWidth = (await sessionPanel.boundingBox())?.width ?? 0
    const persistedWorkspaceWidth = (await workspacePanel.boundingBox())?.width ?? 0
    await page.reload()
    await expect(sessionPanel).toBeVisible()
    await expect(workspacePanel).toBeVisible()
    await expect
      .poll(async () => (await sessionPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(persistedSessionWidth - 2)
    await expect
      .poll(async () => (await workspacePanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(persistedWorkspaceWidth - 2)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('adds a provider, switches models and recovers from misconfiguration', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-provider-'))
  const app = await launch(userDataDir)

  try {
    const page = await app.firstWindow()

    await openSettings(page)
    await expect(page.getByTestId('settings-dialog')).toBeVisible()
    // 设置弹窗必须位于标题栏拖动区之外，否则真实鼠标点击会被窗口拖动吞掉
    await expect(page.getByTestId('titlebar').getByTestId('settings-dialog')).toHaveCount(0)
    await expect(page.getByTestId('settings-provider-mock')).toBeVisible()
    await page.getByTestId('settings-add-provider').click()
    await page.getByTestId('settings-preset').selectOption('deepseek')
    await expect(page.getByTestId('settings-base-url')).toHaveValue('https://api.deepseek.com/v1')
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()

    await expect(page.getByTestId('model-picker')).toContainText('deepseek-chat')
    await page.getByTestId('model-picker').click()
    await expect(page.getByTestId('model-option-deepseek-deepseek-chat')).toBeVisible()
    await expect(page.getByTestId('model-option-mock-mock')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('new-session').click()
    await page.getByTestId('chat-input').fill('错误配置测试')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('error-card')).toContainText(
      '请先在设置中为「DeepSeek」配置 API Key'
    )
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await page.getByTestId('model-picker').click()
    await page.getByTestId('model-option-mock-mock').click()
    await expect(page.getByTestId('model-picker')).toContainText('mock')

    await page.getByTestId('error-retry').click()
    await expect(page.getByTestId('chat-panel')).toContainText('Mock Provider 已收到：错误配置测试')
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await openSettings(page)
    await page.getByTestId('settings-provider-deepseek').click()
    await page.getByTestId('settings-delete-provider').click()
    await expect(page.getByTestId('settings-provider-deepseek')).toHaveCount(0)
    await page.getByTestId('settings-dialog').getByText('关闭').click()
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('switches approval modes for agent tools', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-approval-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-approval-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello approval')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await patchOpenDialog(app, workspaceDir)
    await page.getByTestId('workspace-switch').click()
    await page.getByTestId('new-session').click()

    await expect(page.getByTestId('approval-mode')).toContainText('手动模式')

    await page.getByTestId('chat-input').fill('/tool write notes/manual.txt')
    await page.getByTestId('chat-send').click()
    const manualTimeline = page.getByTestId('timeline').last()
    await expect(manualTimeline.getByTestId('approval-card')).toBeVisible()
    await page.getByTestId('approval-deny').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(readFile(join(workspaceDir, 'notes', 'manual.txt'), 'utf8')).rejects.toThrow()

    await page.getByTestId('approval-mode').click()
    await page.getByTestId('approval-mode-auto').click()
    await expect(page.getByTestId('approval-mode')).toContainText('自动模式')

    await page.getByTestId('chat-input').fill('/tool write notes/auto.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(page.getByTestId('timeline').last().getByTestId('approval-card')).toHaveCount(0)
    expect(await readFile(join(workspaceDir, 'notes', 'auto.txt'), 'utf8')).toBe('mock tool demo\n')

    await page.getByTestId('approval-mode').click()
    await page.getByTestId('approval-mode-open').click()
    await expect(page.getByTestId('approval-mode')).toContainText('开放模式')

    await page.getByTestId('chat-input').fill('/tool command node -v')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    await expect(page.getByTestId('timeline').last().getByTestId('approval-card')).toHaveCount(0)

    await page.getByTestId('approval-mode').click()
    await page.getByTestId('approval-mode-manual').click()
    await expect(page.getByTestId('approval-mode')).toContainText('手动模式')

    await page.getByTestId('chat-input').fill('/tool command node -v')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('timeline').last().getByTestId('approval-card')).toBeVisible()
    await page.getByTestId('approval-approve').last().click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
  } finally {
    await app.close()
  }

  const restarted = await launch(userDataDir)
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByTestId('approval-mode')).toContainText('手动模式')
  } finally {
    await restarted.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('covers the project workflow end to end', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-flow-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-flow-ws-'))
  await writeFile(join(workspaceDir, 'hello.txt'), 'hello e2e flow')
  const expectedRoot = await realpath(workspaceDir)
  const projectName = basename(workspaceDir)

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await patchOpenDialog(app, workspaceDir)
    await page.getByTestId('workspace-switch').click()
    await expect(page.getByTestId('workspace-root')).toHaveText(expectedRoot)
    await expect(page.getByTestId('project-group').filter({ hasText: projectName })).toBeVisible()

    await page.getByTestId('new-session').click()
    await page.getByTestId('chat-input').fill('/tool read hello.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('timeline').last()).toContainText('已执行 1 个步骤')
    await page.getByTestId('timeline-toggle').last().click()
    await expect(page.getByTestId('timeline-step').last()).toContainText('read_file')
    await expect(page.getByTestId('chat-send')).toBeVisible()

    await page.getByTestId('chat-input').fill('/tool write notes/flow.txt')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('approval-card')).toBeVisible()
    await page.getByTestId('approval-approve').click()
    await expect(page.getByTestId('chat-send')).toBeVisible()
    expect(await readFile(join(workspaceDir, 'notes', 'flow.txt'), 'utf8')).toBe('mock tool demo\n')

    await openSessionMenu(page)
    await page.getByTestId('session-rename').click()
    await page.getByTestId('session-rename-input').fill('流程会话')
    await page.getByTestId('session-rename-input').press('Enter')
    await expect(page.getByTestId('session-sidebar')).toContainText('流程会话')

    await openSessionMenu(page)
    await page.getByTestId('session-pin').click()
    await expect(page.getByTestId('pinned-section')).toContainText('流程会话')
    await page.getByTestId('session-search').fill('流程')
    await expect(page.getByTestId('pinned-section')).toContainText('流程会话')
    await page.getByTestId('session-search').fill('')

    await openSessionMenu(page)
    await page.getByTestId('session-archive').click()
    await expect(page.getByTestId('pinned-section')).not.toBeVisible()
    await page.getByTestId('archive-toggle').click()
    const archivedRow = page.getByTestId('session-item').filter({ hasText: '流程会话' })
    await expect(archivedRow).toContainText('已归档')
    await archivedRow.click()
    await openSessionMenu(page)
    await page.getByTestId('session-archive').click()
    await expect(page.getByTestId('pinned-section')).toContainText('流程会话')
    await page.getByTestId('archive-toggle').click()

    await page.getByTestId('workspace-collapse').click()
    await expect(page.getByTestId('workspace-expand')).toBeVisible()
  } finally {
    await app.close()
  }

  const restarted = await launch(userDataDir)
  try {
    const page = await restarted.firstWindow()
    await expect(page.getByTestId('workspace-expand')).toBeVisible()
    await page.getByTestId('workspace-expand').click()
    await expect(page.getByTestId('workspace-panel')).toBeVisible()
    await expect(page.getByTestId('workspace-root')).toHaveText(expectedRoot)
    await expect(page.getByTestId('project-group').filter({ hasText: projectName })).toBeVisible()
    await expect(page.getByTestId('pinned-section')).toContainText('流程会话')
    await expect(page.getByTestId('chat-panel')).toContainText('工具执行完成：hello e2e flow')
  } finally {
    await restarted.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
