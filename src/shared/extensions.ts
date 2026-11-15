/**
 * 扩展管理器（§3.6 第一层）：只做声明式贡献，**不执行扩展代码**。
 * 原生清单 `yocim-extension.json`；同时兼容 VS Code 的 `package.json` 贡献，
 * 用于 .vsix 与 VS Code 扩展目录导入。
 */

export type ExtensionSource = 'local' | 'vsix' | 'vscode'

/** 声明式 = 只有语言/语法/片段/主题；部分兼容 = 还带命令/菜单/快捷键；不兼容 = 需要运行时代码 */
export type ExtensionCompatibility = 'declarative' | 'partial' | 'incompatible'

export interface ExtensionContributions {
  commands: number
  menus: number
  keybindings: number
  languages: number
  grammars: number
  snippets: number
  themes: number
}

export interface ExtensionInfo {
  id: string
  name: string
  displayName: string
  version: string
  publisher?: string
  description?: string
  source: ExtensionSource
  enabled: boolean
  compatibility: ExtensionCompatibility
  /** 分级原因（中文，直接展示给用户） */
  compatibilityReason: string
  contributions: ExtensionContributions
  installedAt: number
  /** 扩展资源目录（userData/extensions/<id>），用于「在资源管理器中显示」 */
  dir: string
  /** VS Code 扩展声明的运行时代码入口（存在即不兼容） */
  runtimeEntry: string | null
}

export interface ExtensionCommand {
  id: string
  title: string
  extensionId: string
}

export interface ExtensionSnippet {
  extensionId: string
  extensionName: string
  /** 片段适用的 Monaco 语言 id；`*` 表示全部 */
  language: string
  label: string
  prefix: string
  body: string
  description?: string
}

export interface ExtensionGrammar {
  extensionId: string
  language: string
  scopeName: string
  /** 语法文件在工作区/扩展目录内的绝对路径 */
  path: string
}

export interface ExtensionContributionBundle {
  commands: ExtensionCommand[]
  snippets: ExtensionSnippet[]
  grammars: ExtensionGrammar[]
  /** 有贡献变更时递增，renderer 据此重建补全提供者 */
  version: number
}

export interface VscodeExtensionCandidate {
  id: string
  name: string
  displayName: string
  version: string
  publisher?: string
  description?: string
  dir: string
  compatibility: ExtensionCompatibility
  compatibilityReason: string
  contributions: ExtensionContributions
  /** 与已安装扩展同名（同 id）时为 true */
  installed: boolean
}

export interface ExtensionInstallResult {
  extension: ExtensionInfo
  /** 不兼容扩展仍会安装但保持禁用，并给出提示 */
  notice?: string
}

export interface VscodeScanResult {
  directory: string
  exists: boolean
  candidates: VscodeExtensionCandidate[]
  error?: string
}
