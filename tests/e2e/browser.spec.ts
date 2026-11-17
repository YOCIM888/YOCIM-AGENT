import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

test('lower tool deck switches terminal/browser with keep-alive and a shared height', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-browser-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-browser-ws-'))
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })

  try {
    const page = await app.firstWindow()

    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, workspaceDir)
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await expect(page.getByTestId('file-tree')).toBeVisible()

    // 浏览器按钮需要当前会话：新建会话后再打开
    await expect(page.getByTestId('sidebar-tool-browser')).toBeDisabled()
    await page.getByTestId('new-session').click()
    await expect(page.getByTestId('sidebar-tool-browser')).toBeEnabled()

    // 终端 tab：运行一条命令，产生可验证的滚动缓冲
    await page.getByTestId('sidebar-tool-terminal').click()
    await expect(page.getByTestId('terminal-panel')).toBeVisible()
    await page.getByTestId('terminal-host').click()
    await page.keyboard.type('echo browser-keepalive > keepalive-probe.txt')
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => {
        try {
          return await readFile(join(workspaceDir, 'keepalive-probe.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('browser-keepalive')

    // 切到浏览器 tab：终端实例仍挂载（v-show），浏览器视图可见
    await page.getByTestId('sidebar-tool-browser').click()
    await expect(page.getByTestId('browser-panel')).toBeVisible()
    await expect(page.getByTestId('browser-observability')).toBeVisible()
    await expect(page.getByTestId('browser-log-console')).toBeVisible()
    await expect(page.getByTestId('browser-log-network')).toBeVisible()
    await expect(page.getByTestId('browser-log-audit')).toBeVisible()
    await expect(page.getByTestId('browser-status')).toBeVisible()
    await expect(page.getByTestId('browser-controls')).toBeVisible()
    // 切到浏览器时 tab 高亮，终端面板被隐藏但仍在 DOM 中（keep-alive）
    await expect(page.getByTestId('deck-tab-browser')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('terminal-panel')).toBeHidden()

    // 高度拖拽条共享：拖动后浏览器视图与终端都随之改变
    const before = await page.getByTestId('browser-panel').boundingBox()
    const handle = await page.getByTestId('tool-deck-resize').boundingBox()
    expect(before && handle).toBeTruthy()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y - 90, { steps: 8 })
    await page.mouse.up()
    const after = await page.getByTestId('browser-panel').boundingBox()
    expect(after && after.height).toBeGreaterThan(before!.height + 30)

    // 切回终端：滚动缓冲与运行状态保留（cwd 仍是同一个工作区）
    await page.getByTestId('sidebar-tool-terminal').click()
    await expect(page.getByTestId('terminal-panel')).toBeVisible()
    await expect(page.getByTestId('terminal-cwd')).toContainText(basename(workspaceDir))
    await expect(page.getByTestId('browser-panel')).toBeHidden()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('human navigation drives CDP console/network/audit streams', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-browser-cdp-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-browser-cdp-ws-'))
  const html = `<!doctype html><html><head><title>CDP Probe Page</title></head>
<body><h1>probe</h1><script>
console.warn('browser-cdp-console-probe');
fetch('/api-probe').then(r => r.text());
</script></body></html>`

  const server: Server = createServer((request, response) => {
    if (request.url === '/api-probe') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('ok')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })

  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, workspaceDir)
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await expect(page.getByTestId('file-tree')).toBeVisible()
    await page.getByTestId('new-session').click()

    await page.getByTestId('sidebar-tool-browser').click()
    await expect(page.getByTestId('browser-panel')).toBeVisible()

    await page.getByTestId('browser-url').fill(`http://127.0.0.1:${port}/`)
    await page.getByTestId('browser-go').click()

    // 标题由 CDP 的 document.title 回读
    await expect
      .poll(() => page.getByTestId('browser-status').innerText(), { timeout: 15_000 })
      .toContain('已连接')

    // Console / Network / 审计三路事件都来自同一个 CDP 通道
    await page.getByTestId('browser-log-console').click()
    await expect(page.getByTestId('browser-log-body')).toContainText('browser-cdp-console-probe', {
      timeout: 15_000
    })
    await page.getByTestId('browser-log-network').click()
    await expect(page.getByTestId('browser-log-body')).toContainText('/api-probe', {
      timeout: 15_000
    })
    await page.getByTestId('browser-log-audit').click()
    await expect(page.getByTestId('browser-log-body')).toContainText('Page.navigate')

    // 审计查询入口返回持久化日志
    await page.getByTestId('browser-log-body').getByRole('button', { name: '查询审计日志' }).click()
    await expect(page.getByTestId('browser-log-body')).toContainText('Page.navigate')
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
