import packageJson from '../../package.json'

export const APP_NAME = 'YOCIM AGENT'
export const APP_ID = 'com.yocim.agent'
/** 单一来源：始终跟随 package.json，避免发版时漏改导致界面显示旧版本 */
export const APP_VERSION = packageJson.version
