import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

function launch(userDataDir: string): ReturnType<typeof electron.launch> {
  return electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] })
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
  await expect(page.getByTestId('status-bar')).toContainText(basename(dir))
}

test('probes the remote environment and manages SSH targets across validation', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-remote-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-remote-ws-'))
  await writeFile(join(workspaceDir, 'app.js'), 'const value = 1\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)

    await page.getByTestId('workspace-tab-remote').click()
    await expect(page.getByTestId('remote-panel')).toBeVisible()
    // 环境探测：WSL 行总要有结论（可用或不可用原因），SSH 客户端内置
    await expect(page.getByTestId('remote-env')).toContainText('WSL')
    await expect(page.getByTestId('remote-env')).toContainText('SSH')
    await expect(page.getByTestId('remote-empty')).toBeVisible()

    // 空表单直接保存 → 校验错误
    await page.getByTestId('remote-add-ssh').click()
    await expect(page.getByTestId('remote-form')).toBeVisible()
    await page.getByTestId('remote-form-root').fill('/srv/app')
    await page.getByTestId('remote-save').click()
    await expect(page.getByTestId('remote-error')).toContainText('主机')

    // 填完整信息后保存成功
    await page.getByTestId('remote-form-name').fill('演示主机')
    await page.getByTestId('remote-form-host').fill('example.invalid')
    await page.getByTestId('remote-form-username').fill('me')
    await page.getByTestId('remote-form-key').fill('C:\\Users\\me\\.ssh\\id_ed25519')
    await page.getByTestId('remote-save').click()
    await expect(page.getByTestId('remote-list')).toContainText('演示主机')
    await expect(page.getByTestId('remote-notice')).toContainText('已保存远程目标')

    // 编辑：改名字后保存，列表同步
    const target = page.locator('[data-testid^="remote-target-"]').first()
    const targetId = (await target.getAttribute('data-testid'))?.replace('remote-target-', '') ?? ''
    expect(targetId).not.toBe('')
    await page.getByTestId(`remote-edit-${targetId}`).click()
    await page.getByTestId('remote-form-name').fill('重命名主机')
    await page.getByTestId('remote-save').click()
    await expect(page.getByTestId(`remote-target-${targetId}`)).toContainText('重命名主机')

    // 删除后回到空态
    await page.getByTestId(`remote-delete-${targetId}`).click()
    await expect(page.getByTestId('remote-empty')).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('wsl target validation and unreachable ssh host produce readable errors', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-remote2-'))
  const workspaceDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-remote2-ws-'))
  await writeFile(join(workspaceDir, 'app.js'), 'const value = 1\n')

  const app = await launch(userDataDir)
  try {
    const page = await app.firstWindow()
    await selectWorkspace(page, app, workspaceDir)
    await page.getByTestId('workspace-tab-remote').click()

    // WSL：没有发行版时保存应提示缺少发行版
    await page.getByTestId('remote-add-wsl').click()
    await page.getByTestId('remote-form-root').fill('/home/me/app')
    await page.getByTestId('remote-save').click()
    await expect(page.getByTestId('remote-error')).toContainText('发行版')
    await page.getByTestId('remote-cancel').click()

    // SSH：连一个必然拒绝的端口，错误要可读且不崩
    await page.getByTestId('remote-add-ssh').click()
    await page.getByTestId('remote-form-name').fill('不可达')
    await page.getByTestId('remote-form-host').fill('127.0.0.1')
    await page.getByTestId('remote-form-port').fill('1')
    await page.getByTestId('remote-form-username').fill('me')
    await page.getByTestId('remote-form-auth').selectOption('password')
    await page.getByTestId('remote-form-secret').fill('secret')
    await page.getByTestId('remote-form-root').fill('/srv/app')
    await page.getByTestId('remote-save').click()

    const target = page.locator('[data-testid^="remote-target-"]').first()
    const targetId = (await target.getAttribute('data-testid'))?.replace('remote-target-', '') ?? ''
    await page.getByTestId(`remote-connect-${targetId}`).click()

    // 失败原因同时体现在顶部错误条与目标行状态
    const error = page.getByTestId('remote-error')
    await expect(error).toBeVisible({ timeout: 30_000 })
    await expect(error).toContainText(/连接|拒绝|超时|私钥/)
    await expect(page.getByTestId(`remote-target-status-${targetId}`)).toHaveText('连接失败')
    // 连接失败不应改变当前（本地）工作区
    await expect(page.getByTestId('status-bar')).toContainText(basename(workspaceDir))
    await expect(page.getByTestId('status-remote-badge')).toHaveCount(0)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
