import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { IGNORED_DIRECTORIES } from '../../shared/ipcChannels'

export const REPO_MAP_MAX_CHARS = 4000
const REPO_MAP_MAX_DEPTH = 2
const REPO_MAP_FILES_PER_DIR = 8
const CACHE_TTL_MS = 60_000

interface DirSummary {
  name: string
  files: string[]
  fileCount: number
  dirCount: number
}

const cache = new Map<string, { map: string; at: number }>()

export function clearRepoMapCache(root?: string): void {
  if (root) cache.delete(root)
  else cache.clear()
}

interface WalkResult {
  dirs: DirSummary[]
  rootFiles: string[]
}

async function walkDir(
  absoluteDir: string,
  depth: number
): Promise<{ files: string[]; dirCount: number }> {
  let entries
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return { files: [], dirCount: 0 }
  }
  const files: string[] = []
  let dirCount = 0
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    if (entry.isDirectory()) {
      dirCount += 1
      if (depth < REPO_MAP_MAX_DEPTH) {
        const nested = await walkDir(path.join(absoluteDir, entry.name), depth + 1)
        files.push(...nested.files)
        dirCount += nested.dirCount
      }
      continue
    }
    if (entry.isFile()) files.push(entry.name)
  }
  return { files, dirCount }
}

/**
 * 轻量 repo map：只描述目录结构与文件密度，不做符号提取。
 * 目的是让模型在第一轮就知道"这是个什么形状的项目"，而不是靠 list_dir 层层摸。
 */
export async function buildRepoMap(root: string): Promise<string> {
  const cached = cache.get(root)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.map

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return ''
  }

  const result: WalkResult = { dirs: [], rootFiles: [] }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    if (entry.isDirectory()) {
      const nested = await walkDir(path.join(root, entry.name), 1)
      result.dirs.push({
        name: entry.name,
        files: nested.files.slice(0, REPO_MAP_FILES_PER_DIR),
        fileCount: nested.files.length,
        dirCount: nested.dirCount
      })
      continue
    }
    if (entry.isFile()) result.rootFiles.push(entry.name)
  }

  const lines: string[] = []
  const rootFiles = result.rootFiles.slice(0, 12)
  if (rootFiles.length)
    lines.push(`根目录文件：${rootFiles.join('、')}${result.rootFiles.length > 12 ? ' 等' : ''}`)
  for (const dir of result.dirs.slice(0, 16)) {
    const detail = dir.files.length
      ? `（如 ${dir.files.join('、')}${dir.fileCount > dir.files.length ? ` 等 ${dir.fileCount} 个文件` : ''}）`
      : ''
    const sub = dir.dirCount ? `，含 ${dir.dirCount} 个子目录` : ''
    lines.push(`${dir.name}/${detail}${sub}`)
  }

  let map = lines.join('\n').slice(0, REPO_MAP_MAX_CHARS)
  if (!map) map = '（空目录或全部被忽略）'
  cache.set(root, { map, at: Date.now() })
  return map
}
