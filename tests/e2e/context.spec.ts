import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check', '--skip-language-onboarding']
  })
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
  // 运行结束后发送按钮重新出现
  await expect(page.getByTestId('chat-send')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('chat-panel')).toContainText(`Mock Provider 已收到：${text}`)
}

test.describe('上下文用量与压缩', () => {
  let userDataDir: string
  let app: Awaited<ReturnType<typeof launch>>

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-ctx-'))
    app = await launch(userDataDir)
  })

  test.afterEach(async () => {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  })

  test('ring shows usage, manual compaction works and the window is adjustable', async () => {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('YOCIM AGENT')

    await send(page, '第一句话')
    await send(page, '第二句话')

    // 圆环出现并展示用量提示
    const ring = page.getByTestId('context-ring')
    await expect(ring).toBeVisible()
    await expect(ring).toHaveAttribute('title', /上下文 \d+%/)
    await expect(ring).toHaveAttribute('title', /200K/)

    // 点击圆环 → 手动压缩 → 会话里出现压缩提示
    await ring.click()
    await expect(page.getByTestId('chat-panel')).toContainText('已手动压缩上下文')
    await expect(ring).toHaveAttribute('title', /点击手动压缩/)

    // 模型菜单底部可调整上下文窗口（200K–1000K）
    await page.getByTestId('model-picker').click()
    const select = page.getByTestId('context-window-select')
    await expect(select).toBeVisible()
    const options = await select.locator('option').allTextContents()
    expect(options).toEqual(['200K', '300K', '400K', '600K', '800K', '1000K'])
    await select.selectOption('300000')
    await page.keyboard.press('Escape')
    await expect(ring).toHaveAttribute('title', /300K/)
  })

  test('reasoning effort is adjustable in the model menu and persists', async () => {
    const page = await app.firstWindow()
    await page.getByTestId('model-picker').click()
    const effortSelect = page.getByTestId('reasoning-effort-select')
    await expect(effortSelect).toBeVisible()
    const labels = await effortSelect.locator('option').allTextContents()
    expect(labels).toEqual(['默认', '低', '中', '高'])
    await effortSelect.selectOption('medium')
    await page.keyboard.press('Escape')

    // 重新打开菜单：选择被持久化
    await page.getByTestId('model-picker').click()
    await expect(page.getByTestId('reasoning-effort-select')).toHaveValue('medium')
    await page.keyboard.press('Escape')

    // 设置后对话仍可正常工作
    await send(page, '思考强度调整后的消息')
  })

  test('plan card renders and updates from the update_plan tool', async () => {
    const page = await app.firstWindow()
    // /tool 命令走工具循环，Mock 回显的是「工具执行完成」而非「已收到」，
    // 不能用 send() 的通用断言，改为直接等待计划卡
    await page.getByTestId('chat-input').fill('/tool plan 重构导出,更新引用,跑测试')
    await page.getByTestId('chat-send').click()

    const card = page.getByTestId('plan-card')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('重构导出')
    await expect(card).toContainText('更新引用')
    await expect(card).toContainText('跑测试')
    await expect(page.getByTestId('plan-item-doing')).toContainText('重构导出')
    await expect(page.getByTestId('plan-item-pending')).toHaveCount(2)
    await expect(card).toContainText('0/3')

    // 工具步骤也出现在时间线里（时间线默认折叠，先展开）
    await page.getByTestId('timeline-toggle').click()
    await expect(page.getByTestId('timeline-step').last()).toContainText('update_plan')
    await expect(page.getByTestId('chat-send')).toBeVisible()
  })
})
