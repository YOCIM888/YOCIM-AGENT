import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const mainEntry = join(__dirname, '../../out/main/index.js')

test('project conventions are isolated, persisted, generated and deletable', async () => {
  const userDataDir = await mkdtemp(join(os.tmpdir(), 'yocim-e2e-conventions-'))
  const workspaceA = await mkdtemp(join(os.tmpdir(), 'yocim-conventions-a-'))
  const workspaceB = await mkdtemp(join(os.tmpdir(), 'yocim-conventions-b-'))
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`, '--disable-update-check']
  })

  const patchDialog = async (path: string): Promise<void> => {
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, path)
  }
  const openFolder = async (page: Awaited<ReturnType<typeof app.firstWindow>>): Promise<void> => {
    await page.getByTestId('menu-edit').click()
    await page.getByTestId('menu-open-folder').click()
    await expect(page.getByTestId('file-tree')).toBeVisible()
  }

  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('sidebar-tool-conventions')).toBeDisabled()

    await patchDialog(workspaceA)
    await openFolder(page)
    await expect(page.getByTestId('sidebar-tool-conventions')).toBeEnabled()
    await page.getByTestId('sidebar-tool-conventions').click()
    await expect(page.getByTestId('conventions-panel')).toBeVisible()
    await expect(page.getByTestId('conventions-empty')).toBeVisible()

    // 手动创建并保存
    await page.getByTestId('conventions-edit-empty').click()
    await page.getByTestId('conventions-editor').fill('项目 A 约定内容')
    await page.getByTestId('conventions-save').click()
    await expect(page.getByTestId('conventions-notice')).toContainText('已保存')
    await expect(page.getByTestId('conventions-panel')).toContainText('项目 A 约定内容')
    await page.getByTestId('conventions-close').click()

    // 刷新后仍在
    await page.reload()
    await expect(page.getByTestId('sidebar-tool-conventions')).toBeEnabled()
    await page.getByTestId('sidebar-tool-conventions').click()
    await expect(page.getByTestId('conventions-panel')).toContainText('项目 A 约定内容')

    // 已有内容时 AI 更新必须先确认覆盖，取消不改动原内容
    await page.getByTestId('conventions-generate').click()
    await expect(page.getByTestId('conventions-overwrite-confirm')).toBeVisible()
    await page.getByTestId('conventions-overwrite-confirm').getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('conventions-panel')).toContainText('项目 A 约定内容')
    await page.getByTestId('conventions-close').click()

    // 切到项目 B：空状态，AI 生成草稿后保存
    await patchDialog(workspaceB)
    await openFolder(page)
    await page.getByTestId('sidebar-tool-conventions').click()
    await expect(page.getByTestId('conventions-empty')).toBeVisible()
    await page.getByTestId('conventions-generate-empty').click()
    await expect(page.getByTestId('conventions-editor')).toBeVisible()
    await expect(page.getByTestId('conventions-editor')).toHaveValue(/## 项目概览/)
    await page.getByTestId('conventions-save').click()
    await expect(page.getByTestId('conventions-notice')).toContainText('已保存')
    await page.getByTestId('conventions-close').click()

    // 回到项目 A：内容独立且未受 B 影响
    await patchDialog(workspaceA)
    await openFolder(page)
    await page.getByTestId('sidebar-tool-conventions').click()
    await expect(page.getByTestId('conventions-panel')).toContainText('项目 A 约定内容')
    await expect(page.getByTestId('conventions-panel')).not.toContainText(
      '当前为离线演示用的项目约定草稿'
    )

    // 覆盖确认后进入可编辑草稿，取消编辑不落库
    await page.getByTestId('conventions-generate').click()
    await page.getByTestId('conventions-overwrite-confirm').getByTestId('confirm-ok').click()
    await expect(page.getByTestId('conventions-editor')).toHaveValue(/## 项目概览/)
    await page.getByTestId('conventions-cancel').click()
    await expect(page.getByTestId('conventions-panel')).toContainText('项目 A 约定内容')

    // 删除当前项目，二次确认后进入空状态
    await page.getByTestId('conventions-delete').click()
    await expect(page.getByTestId('conventions-delete-confirm')).toBeVisible()
    await page.getByTestId('conventions-delete-confirm').getByTestId('confirm-ok').click()
    await expect(page.getByTestId('conventions-empty')).toBeVisible()
    await page.getByTestId('conventions-close').click()

    // 项目 B 的内容没有因为删除 A 而丢失
    await patchDialog(workspaceB)
    await openFolder(page)
    await page.getByTestId('sidebar-tool-conventions').click()
    await expect(page.getByTestId('conventions-panel')).toContainText(
      '当前为离线演示用的项目约定草稿'
    )
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(workspaceA, { recursive: true, force: true })
    await rm(workspaceB, { recursive: true, force: true })
  }
})
