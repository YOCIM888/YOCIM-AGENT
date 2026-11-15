import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, shell } from 'electron'
import { APP_NAME } from '../shared/app'
import { openDatabase } from './db/database'
import { registerIpcHandlers } from './ipc'
import { initLogger, logError, logInfo } from './logger'
import { workspaceService } from './workspace/workspaceService'

let database: DatabaseSync | null = null
let rendererReloads = 0

const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']

app.setName(APP_NAME)

try {
  initLogger(join(app.getPath('userData'), 'logs'))
  logInfo(`main process starting (electron ${process.versions.electron})`)
} catch (error) {
  console.error('failed to init logger', error)
}

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error)
  app.quit()
})

process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason)
})

app.on('render-process-gone', (_event, contents, details) => {
  logError(`renderer process gone: ${details.reason} (exitCode=${details.exitCode})`)
  if (details.reason === 'clean-exit' || contents.isDestroyed()) return
  if (rendererReloads >= 3) {
    logError('renderer crashed repeatedly, skip auto reload')
    return
  }
  rendererReloads += 1
  setTimeout(() => {
    if (!contents.isDestroyed()) {
      logInfo('reloading renderer after crash')
      contents.reload()
    }
  }, 1000)
})

app.on('child-process-gone', (_event, details) => {
  logError(`child process gone: ${details.type} ${details.reason}`)
})

function createMainWindow(): BrowserWindow {
  const iconPath = join(app.getAppPath(), 'public/image/yocim.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    show: false,
    frame: false,
    title: APP_NAME,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    logError(`renderer failed to load: ${code} ${description} (${url})`)
  })

  window.webContents.on('unresponsive', () => {
    logError('main window unresponsive')
  })

  window.webContents.on('responsive', () => {
    logInfo('main window responsive again')
  })

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  logInfo('main window created')
  return window
}

void app.whenReady().then(async () => {
  logInfo(`app ready v${app.getVersion()}`)
  database = openDatabase(join(app.getPath('userData'), 'yocim.db'))
  await workspaceService.restore()
  registerIpcHandlers(database)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  logInfo('app quitting')
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
