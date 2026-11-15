import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { AppError } from '../../shared/errors'
import { EXTENSION_LIMITS } from '../../shared/ipcChannels'
import type {
  ExtensionContributionBundle,
  ExtensionInfo,
  ExtensionInstallResult,
  ExtensionSnippet,
  VscodeExtensionCandidate,
  VscodeScanResult
} from '../../shared/extensions'
import type { ExtensionRecord, ExtensionRepository } from '../db/repositories'
import { normalizeManifest, sanitizeId, type NormalizedManifest } from './manifest'
import { parseSnippetFile } from './snippets'
import { readZipEntries } from './zip'

const YOCIM_MANIFEST = 'yocim-extension.json'
const VSCODE_MANIFEST = 'package.json'
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.github', 'out', 'dist'])

export interface ExtensionServiceOptions {
  repo: ExtensionRepository
  /** userData 目录；扩展资源放在 `<userData>/extensions` */
  userData: string
  /** VS Code 扩展目录；默认 %USERPROFILE%/.vscode/extensions */
  vscodeDir?: string
}

interface StoredManifest {
  manifest: NormalizedManifest
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function safeJoin(base: string, relativePath: string): string {
  const root = resolve(base)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new AppError('E_PATH_ESCAPE', `扩展包含非法路径：${relativePath}`)
  }
  return target
}

async function readManifestFromDir(
  dir: string
): Promise<{ manifest: NormalizedManifest; file: string } | null> {
  for (const file of [YOCIM_MANIFEST, VSCODE_MANIFEST]) {
    const path = join(dir, file)
    try {
      const info = await stat(path)
      if (info.size > EXTENSION_LIMITS.maxManifestBytes) continue
      const text = await readFile(path, 'utf8')
      const manifest = normalizeManifest(JSON.parse(text), basename(dir))
      if (manifest) return { manifest, file }
    } catch {
      // 继续尝试下一个清单文件
    }
  }
  return null
}

function parseManifestText(text: string, hintName?: string): NormalizedManifest | null {
  try {
    return normalizeManifest(JSON.parse(text), hintName)
  } catch {
    return null
  }
}

/** 递归复制目录（跳过 node_modules/.git 等，限制文件数与体积） */
async function copyTree(source: string, target: string): Promise<void> {
  let files = 0
  let bytes = 0

  const walk = async (from: string, to: string): Promise<void> => {
    await mkdir(to, { recursive: true })
    const entries = await readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      const fromPath = join(from, entry.name)
      const toPath = join(to, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(fromPath, toPath)
        continue
      }
      if (!entry.isFile()) continue
      files += 1
      if (files > EXTENSION_LIMITS.maxVsixEntries) {
        throw new AppError('E_TOO_LARGE', '扩展文件数量超过上限')
      }
      const info = await stat(fromPath)
      bytes += info.size
      if (bytes > EXTENSION_LIMITS.maxVsixBytes) {
        throw new AppError('E_TOO_LARGE', '扩展体积超过上限')
      }
      await copyFile(fromPath, toPath)
    }
  }

  await walk(source, target)
}

export class ExtensionService {
  private readonly options: ExtensionServiceOptions
  private contributionVersion = 0

  constructor(options: ExtensionServiceOptions) {
    this.options = options
  }

  private get extensionsDir(): string {
    return join(this.options.userData, 'extensions')
  }

  private get vscodeDir(): string {
    return this.options.vscodeDir ?? join(homedir(), '.vscode', 'extensions')
  }

  dirOf(id: string): string {
    return join(this.extensionsDir, sanitizeId(id))
  }

  list(): ExtensionInfo[] {
    return this.options.repo
      .list()
      .map((record) => this.toInfo(record))
      .filter((item): item is ExtensionInfo => Boolean(item))
  }

  private toInfo(record: ExtensionRecord): ExtensionInfo | null {
    let stored: StoredManifest
    try {
      stored = JSON.parse(record.manifestJson) as StoredManifest
    } catch {
      return null
    }
    const manifest = stored.manifest
    if (!manifest) return null
    return {
      id: record.id,
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
      ...(manifest.description ? { description: manifest.description } : {}),
      source: record.source as ExtensionInfo['source'],
      enabled: record.enabled,
      compatibility: manifest.compatibility,
      compatibilityReason: manifest.compatibilityReason,
      contributions: manifest.contributions,
      installedAt: record.installedAt,
      dir: this.dirOf(record.id),
      runtimeEntry: manifest.runtimeEntry
    }
  }

  private save(
    manifest: NormalizedManifest,
    source: string,
    options: { enabled?: boolean } = {}
  ): ExtensionInfo {
    const enabled = options.enabled ?? manifest.compatibility !== 'incompatible'
    const record: ExtensionRecord = {
      id: manifest.id,
      source,
      manifestJson: JSON.stringify({ manifest } satisfies StoredManifest),
      enabled,
      compatible: manifest.compatibility !== 'incompatible',
      installedAt: Date.now()
    }
    this.options.repo.upsert(record)
    this.contributionVersion += 1
    const info = this.toInfo(record)
    if (!info) throw new AppError('E_UNKNOWN', '扩展清单写入失败')
    return info
  }

  async installLocal(directory: string): Promise<ExtensionInstallResult> {
    const source = resolve(directory)
    if (!(await pathExists(source))) throw new AppError('E_NOT_FOUND', '扩展目录不存在')
    const found = await readManifestFromDir(source)
    if (!found) {
      throw new AppError(
        'E_INVALID_INPUT',
        `目录中未找到 ${YOCIM_MANIFEST} 或 ${VSCODE_MANIFEST}，无法识别扩展`
      )
    }
    const target = this.dirOf(found.manifest.id)
    await rm(target, { recursive: true, force: true })
    await copyTree(source, target)
    const info = this.save(found.manifest, 'local')
    return {
      extension: info,
      ...(info.compatibility === 'incompatible'
        ? { notice: '该扩展包含运行时代码，已安装但保持禁用：第一层扩展不执行扩展代码' }
        : {})
    }
  }

  async installVsix(filePath: string): Promise<ExtensionInstallResult> {
    const absolute = resolve(filePath)
    const info = await stat(absolute).catch(() => null)
    if (!info) throw new AppError('E_NOT_FOUND', 'VSIX 文件不存在')
    if (info.size > EXTENSION_LIMITS.maxVsixBytes) {
      throw new AppError('E_TOO_LARGE', 'VSIX 文件体积超过上限')
    }
    const entries = readZipEntries(await readFile(absolute))

    const manifestEntry =
      entries.find((entry) => entry.name === `extension/${YOCIM_MANIFEST}`) ??
      entries.find((entry) => entry.name === YOCIM_MANIFEST) ??
      entries.find((entry) => entry.name === `extension/${VSCODE_MANIFEST}`) ??
      entries.find((entry) => entry.name === VSCODE_MANIFEST)
    if (!manifestEntry) {
      throw new AppError('E_INVALID_INPUT', 'VSIX 中没有找到扩展清单（package.json）')
    }

    const manifest = parseManifestText(
      manifestEntry.data.toString('utf8'),
      basename(absolute, '.vsix')
    )
    if (!manifest) throw new AppError('E_INVALID_INPUT', 'VSIX 扩展清单无法解析')

    const prefix = manifestEntry.name.includes('/')
      ? manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1)
      : ''
    const target = this.dirOf(manifest.id)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })

    for (const entry of entries) {
      if (prefix && !entry.name.startsWith(prefix)) continue
      if (!prefix && entry.name.includes('/')) continue
      const relativePath = prefix ? entry.name.slice(prefix.length) : entry.name
      if (!relativePath) continue
      if (relativePath.split('/').some((part) => SKIP_DIRECTORIES.has(part))) continue
      const destination = safeJoin(target, relativePath)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, entry.data)
    }

    const saved = this.save(manifest, 'vsix')
    return {
      extension: saved,
      ...(saved.compatibility === 'incompatible'
        ? { notice: '该扩展包含运行时代码，已安装但保持禁用：第一层扩展不执行扩展代码' }
        : {})
    }
  }

  async scanVscode(directory?: string): Promise<VscodeScanResult> {
    const dir = directory ? resolve(directory) : this.vscodeDir
    if (!(await pathExists(dir))) {
      return {
        directory: dir,
        exists: false,
        candidates: [],
        error: '未找到 VS Code 扩展目录，可先安装 VS Code 扩展或手动指定目录'
      }
    }

    const installed = new Set(this.options.repo.list().map((record) => record.id))
    const entries = await readdir(dir, { withFileTypes: true })
    const candidates: VscodeExtensionCandidate[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'extensions.json') {
        continue
      }
      const found = await readManifestFromDir(join(dir, entry.name))
      if (!found) continue
      const manifest = found.manifest
      candidates.push({
        id: manifest.id,
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        dir: join(dir, entry.name),
        compatibility: manifest.compatibility,
        compatibilityReason: manifest.compatibilityReason,
        contributions: manifest.contributions,
        installed: installed.has(manifest.id)
      })
      if (candidates.length >= 300) break
    }

    candidates.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
    return { directory: dir, exists: true, candidates }
  }

  async importVscode(id: string, directory?: string): Promise<ExtensionInstallResult> {
    const scan = await this.scanVscode(directory)
    const candidate = scan.candidates.find((item) => item.id === id)
    if (!candidate) throw new AppError('E_NOT_FOUND', 'VS Code 扩展不存在或已被移除')

    const target = this.dirOf(candidate.id)
    await rm(target, { recursive: true, force: true })
    await copyTree(candidate.dir, target)

    const found = await readManifestFromDir(target)
    if (!found) throw new AppError('E_IO', '导入后未找到扩展清单')
    const info = this.save(found.manifest, 'vscode')
    return {
      extension: info,
      ...(info.compatibility === 'incompatible'
        ? { notice: '该扩展依赖运行时代码，已导入但保持禁用：第一层扩展不执行扩展代码' }
        : {})
    }
  }

  setEnabled(id: string, enabled: boolean): ExtensionInfo[] {
    const record = this.options.repo.get(id)
    if (!record) throw new AppError('E_NOT_FOUND', '扩展不存在')
    if (enabled) {
      const parsed = JSON.parse(record.manifestJson) as StoredManifest
      if (parsed.manifest?.compatibility === 'incompatible') {
        throw new AppError('E_UNSUPPORTED', '不兼容的扩展无法启用：第一层扩展不执行扩展代码')
      }
    }
    this.options.repo.setEnabled(id, enabled)
    this.contributionVersion += 1
    return this.list()
  }

  async uninstall(id: string): Promise<ExtensionInfo[]> {
    const record = this.options.repo.get(id)
    if (!record) throw new AppError('E_NOT_FOUND', '扩展不存在')
    const dir = this.dirOf(id)
    // 只删除应用管理的 userData/extensions 下的目录
    if (dir.startsWith(resolve(this.extensionsDir) + sep) && (await pathExists(dir))) {
      await rm(dir, { recursive: true, force: true })
    }
    this.options.repo.delete(id)
    this.contributionVersion += 1
    return this.list()
  }

  async contributions(): Promise<ExtensionContributionBundle> {
    const commands: ExtensionContributionBundle['commands'] = []
    const snippets: ExtensionSnippet[] = []
    const grammars: ExtensionContributionBundle['grammars'] = []

    for (const record of this.options.repo.list()) {
      if (!record.enabled) continue
      let stored: StoredManifest
      try {
        stored = JSON.parse(record.manifestJson) as StoredManifest
      } catch {
        continue
      }
      const manifest = stored.manifest
      if (!manifest) continue
      for (const command of manifest.commands) {
        commands.push({ id: command.id, title: command.title, extensionId: record.id })
      }
      for (const grammar of manifest.grammars) {
        grammars.push({
          extensionId: record.id,
          language: grammar.language,
          scopeName: grammar.scopeName,
          path: join(this.dirOf(record.id), grammar.path)
        })
      }
      for (const snippet of manifest.snippets) {
        const path = safeJoin(this.dirOf(record.id), snippet.path)
        const info = await stat(path).catch(() => null)
        if (!info || info.size > EXTENSION_LIMITS.maxSnippetBytes) continue
        const text = await readFile(path, 'utf8').catch(() => null)
        if (!text) continue
        snippets.push(
          ...parseSnippetFile(text, {
            extensionId: record.id,
            extensionName: manifest.displayName,
            language: snippet.language
          })
        )
      }
    }

    const limited = <T>(items: T[]): T[] => items.slice(0, EXTENSION_LIMITS.maxContributionItems)
    return {
      commands: limited(commands),
      snippets: limited(snippets),
      grammars: limited(grammars),
      version: this.contributionVersion
    }
  }

  /** 供 IPC 从相对路径计算绝对路径（用于「在资源管理器中显示」） */
  resolveEntryPath(id: string, relativePath = ''): string {
    const base = this.dirOf(id)
    return relativePath ? safeJoin(base, relativePath) : base
  }
}
