import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets } from './util/redact'

const MAX_LOG_BYTES = 2 * 1024 * 1024

let logFilePath: string | null = null

function rotateIfNeeded(): void {
  if (!logFilePath) return
  try {
    if (!existsSync(logFilePath)) return
    if (statSync(logFilePath).size <= MAX_LOG_BYTES) return
    const oldPath = join(logFilePath, '..', 'main.old.log')
    if (existsSync(oldPath)) rmSync(oldPath, { force: true })
    renameSync(logFilePath, oldPath)
  } catch {
    // 日志轮转失败不影响主流程
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  }
  return String(error)
}

function write(level: 'INFO' | 'ERROR', message: string): void {
  // 日志可能落到磁盘也可能被用户分享出去，密钥类内容统一遮蔽。
  const line = `[${new Date().toISOString()}] [${level}] ${redactSecrets(message)}\n`
  if (level === 'ERROR') {
    console.error(line.trimEnd())
  } else {
    console.log(line.trimEnd())
  }
  if (!logFilePath) return
  try {
    appendFileSync(logFilePath, line, 'utf8')
    rotateIfNeeded()
  } catch {
    // 磁盘不可写时忽略文件日志
  }
}

export function initLogger(directory: string): void {
  mkdirSync(directory, { recursive: true })
  logFilePath = join(directory, 'main.log')
  rotateIfNeeded()
}

export function logInfo(message: string): void {
  write('INFO', message)
}

export function logError(message: string, error?: unknown): void {
  write('ERROR', error === undefined ? message : `${message}: ${formatError(error)}`)
}
