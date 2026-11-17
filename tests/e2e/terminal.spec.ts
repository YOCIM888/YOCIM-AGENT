import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

test('sidebar toolbar opens a themed workspace terminal and the settings dialog', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-terminal-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-terminal-ws-'))
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })

  try {
    const page = await app.firstWindow()

    await expect(page.getByTestId('sidebar-toolbar')).toBeVisible()
    for (const id of [
      'sidebar-tool-terminal',
      'sidebar-tool-conventions',
      'sidebar-tool-commands',
      'sidebar-tool-browser',
      'sidebar-tool-settings'
    ]) {
      await expect(page.getByTestId(id)).toBeVisible()
    }

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, workspaceDir)
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await expect(page.getByTestId('file-tree')).toBeVisible()

    await page.getByTestId('sidebar-tool-terminal').click()
    await expect(page.getByTestId('terminal-panel')).toBeVisible()
    await expect(page.getByTestId('terminal-host').locator('.xterm')).toBeVisible()
    await expect(page.getByTestId('chat-panel')).toBeVisible()
    await expect(page.getByTestId('terminal-cwd')).toContainText(basename(workspaceDir))

    const chat = await page.getByTestId('chat-panel').boundingBox()
    const terminal = await page.getByTestId('terminal-panel').boundingBox()
    expect(chat && terminal && chat.y + chat.height <= terminal.y + 2).toBeTruthy()

    // 用文件而不是 DOM 文本验证命令：xterm 用 canvas 渲染，文本不进入辅助树
    await page.getByTestId('terminal-host').click()
    await page.keyboard.type('echo hello-terminal > terminal-probe.txt')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => {
        try {
          return await readFile(join(workspaceDir, 'terminal-probe.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('hello-terminal')

    // cd 是主进程内建命令，验证工作目录状态与事件/返回值竞态下的提示恢复
    await mkdir(join(workspaceDir, 'nested'))
    await page.keyboard.type('cd nested')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('terminal-cwd')).toContainText('nested')
    await page.keyboard.type('echo nested-ok > nested-probe.txt')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => {
        try {
          return await readFile(join(workspaceDir, 'nested', 'nested-probe.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('nested-ok')

    const lightBackground = await page
      .getByTestId('terminal-host')
      .locator('.xterm-scrollable-element')
      .evaluate(
        (element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? ''
      )

    await page.getByTestId('menu-app').click()
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByTestId('terminal-panel')).toBeVisible()
    const darkBackground = await page
      .getByTestId('terminal-host')
      .locator('.xterm-scrollable-element')
      .evaluate(
        (element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element).backgroundColor ?? ''
      )
    expect(darkBackground).not.toBe(lightBackground)

    await page.getByTestId('sidebar-tool-settings').click()
    await expect(page.getByTestId('settings-dialog')).toBeVisible()
    await page.getByTestId('settings-dialog').getByText('关闭').click()
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0)

    await page.getByTestId('sidebar-tool-terminal').click()
    await expect(page.getByTestId('terminal-panel')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
