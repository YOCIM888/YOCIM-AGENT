import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string) {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })
}

test('first run picks a language, opens model settings, and never asks again', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-language-'))
  let app = await launch(userDataDir)

  try {
    let page = await app.firstWindow()

    await expect(page.getByTestId('language-onboarding')).toBeVisible()
    await page.getByTestId('language-option-en').click()

    await expect(page.getByTestId('language-onboarding')).toHaveCount(0)
    await expect(page.getByTestId('settings-dialog')).toBeVisible()
    await expect(page.locator('[data-testid="settings-dialog"] h2')).toHaveText('Settings')
    await expect(page.getByTestId('settings-tab-models')).toHaveClass(/active/)
    await expect(page.getByTestId('settings-api-key')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('yocim.locale'))).toBe('en')

    await page.getByTestId('settings-close').click()
    await app.close()

    // 同一数据目录重启：语言偏好保留，首启引导不再出现
    app = await launch(userDataDir)
    page = await app.firstWindow()
    await expect(page.getByTestId('titlebar')).toBeVisible()
    await expect(page.getByTestId('language-onboarding')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('yocim.locale'))).toBe('en')

    // 设置里可随时改回中文，界面立即切换
    await page.getByTestId('menu-app').click()
    await page.getByTestId('settings-open').click()
    await page.getByTestId('settings-tab-appearance').click()
    await page.getByTestId('appearance-language').selectOption('zh-CN')
    await expect(page.locator('[data-testid="settings-dialog"] h2')).toHaveText('设置')
    expect(await page.evaluate(() => localStorage.getItem('yocim.locale'))).toBe('zh-CN')

    await page.getByTestId('settings-close').click()
    await app.close()

    app = await launch(userDataDir)
    page = await app.firstWindow()
    await expect(page.getByTestId('titlebar')).toBeVisible()
    await expect(page.getByTestId('language-onboarding')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-dialog"] h2')).toHaveCount(0)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
