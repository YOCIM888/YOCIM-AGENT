import { app, net, type BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { logError, logInfo } from '../logger'
import { currentAppVersion } from './appVersion'
import { checkForUpdate } from './updateService'

/**
 * 启动时联网检查一次更新。e2e 通过 --disable-update-check 关闭，
 * 避免真实 GitHub Release 弹窗干扰用例。
 */
export function scheduleStartupUpdateCheck(window: BrowserWindow): void {
  if (app.commandLine.hasSwitch('disable-update-check')) return
  if (!net.isOnline()) {
    logInfo('skip startup update check: offline')
    return
  }

  // 渲染层在 did-finish-load 时已完成挂载，这里再留一点余量确保订阅生效
  setTimeout(() => {
    void checkForUpdate({
      currentVersion: currentAppVersion(),
      platform: process.platform,
      arch: process.arch,
      isOnline: () => net.isOnline()
    })
      .then((result) => {
        if (result.status === 'available' && !window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.updateAvailable, result.info)
          logInfo(`update available: ${result.info.version}`)
        }
      })
      .catch((error) => logError('startup update check failed', error))
  }, 1500)
}
