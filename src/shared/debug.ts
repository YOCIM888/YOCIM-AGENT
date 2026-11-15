/**
 * 运行和调试（§3.7 调试部分）。
 * 第一阶段只支持 Node.js：主进程用 CDP（Chrome DevTools Protocol）直连
 * `node --inspect-brk`，不依赖 js-debug 适配器分发；接口按适配器抽象，
 * 后续接入 DAP（debugpy / dlv）时只需替换 DebugAdapter 实现。
 */

export type DebugConfigSource = 'launch.json' | 'package.json'

export interface DebugConfig {
  id: string
  name: string
  type: 'node'
  /** 相对工作区根，或已展开的绝对路径 */
  program: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  runtimeArgs?: string[]
  /** 启动后立即在入口处暂停 */
  stopOnEntry: boolean
  source: DebugConfigSource
  detail?: string
}

export interface DebugConfigFile {
  /** `.yocim/launch.json` 是否存在 */
  path: string | null
  configs: DebugConfig[]
  error?: string
}

export interface DebugBreakpoint {
  /** 前端生成的稳定 id，便于回写命中状态 */
  id: string
  relativePath: string
  line: number
  enabled: boolean
  condition?: string
  /** 调试器确认断点已解析到脚本 */
  verified?: boolean
}

export type DebugSessionStatus = 'starting' | 'running' | 'paused' | 'stopped' | 'error'

export interface DebugSession {
  id: string
  configId: string
  configName: string
  status: DebugSessionStatus
  startedAt: number
  /** 展示用命令行（启动前已确认） */
  commandLine: string
  program: string
  message?: string
}

export interface DebugStackFrame {
  /** CDP callFrameId，用于求值/取作用域 */
  id: string
  index: number
  name: string
  /** 相对工作区路径；工作区外为 null */
  relativePath: string | null
  /** 1 基行号，便于直接高亮编辑器 */
  line: number | null
  column: number | null
  url: string
}

export interface DebugScope {
  name: string
  type: string
  variablesReference: string
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  /** 非空表示可展开（懒加载子节点） */
  variablesReference: string | null
  /** 子节点是否已内联返回（当前实现仅顶层懒加载，恒为 false 或省略） */
  children?: DebugVariable[]
}

export interface DebugPausedInfo {
  reason: string
  description?: string
  frames: DebugStackFrame[]
  /** 命中的断点 id（前端 id） */
  hitBreakpointIds: string[]
}

export type DebugEvent =
  | { type: 'session'; session: DebugSession }
  | { type: 'output'; sessionId: string; category: 'stdout' | 'stderr' | 'console'; text: string }
  | { type: 'paused'; sessionId: string; info: DebugPausedInfo }
  | { type: 'resumed'; sessionId: string }
  | { type: 'breakpoints'; breakpoints: DebugBreakpoint[] }
  | { type: 'exited'; sessionId: string; code: number | null; message?: string }

export type DebugCommand = 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut' | 'restart'

export interface DebugEvaluation {
  /** 展示值 */
  value: string
  type?: string
  variablesReference: string | null
  /** 求值出错时的可读信息 */
  error?: string
}
