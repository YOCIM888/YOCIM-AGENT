import { app } from 'electron'
import { APP_VERSION } from '../../shared/app'
import { resolveAppVersion } from '../../shared/update'

/** 打包后读 package.json 版本；未打包时排除 Electron 自身版本 */
export function currentAppVersion(): string {
  return resolveAppVersion(app.getVersion(), process.versions.electron, APP_VERSION)
}
