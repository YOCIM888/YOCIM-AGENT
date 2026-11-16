import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')
const fakeInfo = {
  version: '9.9.9',
  tag: 'v9.9.9',
  name: '测试版本',
  notes: '这是一条测试更新说明',
  publishedAt: '2026-11-16T10:00:00Z',
  url: 'https://github.com/YOCIM888/YOCIM-AGENT/releases/tag/v9.9.9',
  downloadUrl: 'https://github.com/YOCIM888/YOCIM-AGENT/releases/download/v9.9.9/setup.exe',
  assetName: 'setup.exe'
}

async function openAppMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-app').click()
  await page.getByTestId('menu-check-update').click()
}

test('checks for updates from the app menu and respects cancel/update', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-update-e2e-'))
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })

  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('menu-app')).toBeVisible()

    // 用假结果替代真实 GitHub 请求，避免网络影响用例
    await app.evaluate(({ ipcMain }, info) => {
      ipcMain.removeHandler('update:check')
      ipcMain.handle('update:check', async () => ({
        ok: true,
        data: { status: 'available', info }
      }))
    }, fakeInfo)
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        process.env['YOCIM_E2E_OPENED_URL'] = url
      }
    })

    await openAppMenu(page)
    await expect(page.getByTestId('update-notice')).toBeVisible()
    await expect(page.getByTestId('update-version')).toContainText('9.9.9')
    await expect(page.getByTestId('update-notes')).toContainText('这是一条测试更新说明')

    await page.getByTestId('update-cancel').click()
    await expect(page.getByTestId('update-notice')).toBeHidden()

    // 启动推送的同一版本已被忽略，不再打扰
    await app.evaluate(({ BrowserWindow }, info) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('update:available', info)
    }, fakeInfo)
    await expect(page.getByTestId('update-notice')).toBeHidden()

    // 用户主动检查时即使忽略过也要展示
    await openAppMenu(page)
    await expect(page.getByTestId('update-notice')).toBeVisible()
    await page.getByTestId('update-confirm').click()
    await expect(page.getByTestId('update-notice')).toBeHidden()

    const opened = await app.evaluate(() => process.env['YOCIM_E2E_OPENED_URL'])
    expect(opened).toBe(fakeInfo.downloadUrl)
  } finally {
    await app.close()
  }
})

test('checks once on startup when online and shows the notice', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-update-startup-e2e-'))
  // 不传 --disable-update-check，走真实启动检查路径
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] })

  try {
    // 必须在窗口加载完成前打桩：启动检查在 did-finish-load 后 1.5s 触发。
    // 未打包的 e2e 进程里 app.getVersion() 会返回 Electron 版本，这里固定为应用版本。
    await app.evaluate(({ app }) => {
      app.getVersion = () => '0.1.1'
    })
    await app.evaluate(({ net }) => {
      net.isOnline = () => true
    })
    await app.evaluate(() => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v9.9.9',
          html_url: 'https://github.com/YOCIM888/YOCIM-AGENT/releases/tag/v9.9.9',
          name: '',
          body: '',
          published_at: '',
          assets: []
        })
      })) as unknown as typeof fetch
    })
    const page = await app.firstWindow()

    await expect(page.getByTestId('update-notice')).toBeVisible()
    await expect(page.getByTestId('update-version')).toContainText('9.9.9')
  } finally {
    await app.close()
  }
})
