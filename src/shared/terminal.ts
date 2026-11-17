/**
 * 集成终端的跨进程契约。
 * 终端命令由主进程在当前工作区内执行，输出以事件流推送到渲染层。
 */

export interface TerminalState {
  /** 当前命令的工作目录 */
  cwd: string
  /** 当前工作区根目录 */
  root: string | null
}

export interface TerminalRunResult extends TerminalState {
  runId: string
}

export type TerminalEvent =
  | { type: 'output'; runId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'exit'; runId: string; code: number | null; state: TerminalState }
  | { type: 'message'; runId: string; text: string }
