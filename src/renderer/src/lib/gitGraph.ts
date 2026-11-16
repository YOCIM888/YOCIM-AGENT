import type { GitCommitNode } from '@shared/git'

/** 每个提交节点行的高度（px） */
export const GRAPH_ROW_HEIGHT = 26
/** 每条泳道的宽度（px） */
export const GRAPH_LANE_WIDTH = 15
/** 节点圆心在行内的纵向偏移 */
export const GRAPH_NODE_CY = 13
/** 合并连线横向分叉的纵向偏移 */
export const GRAPH_MERGE_CY = 20

export interface GraphSegment {
  lane: number
  /** 起始行（含） */
  from: number
  /** 结束行（含） */
  to: number
  /** 起点是合并连线：该行没有节点，竖线从分叉高度开始 */
  fromMerge: boolean
}

export interface GraphMerge {
  fromLane: number
  toLane: number
  /** 合并提交所在的行 */
  row: number
}

export interface GraphLayout {
  /** 每个提交占用的泳道 */
  laneOf: number[]
  segments: GraphSegment[]
  merges: GraphMerge[]
  laneCount: number
}

/**
 * 计算提交图的泳道布局。
 *
 * 提交按拓扑序排列（父提交在子提交之后）：每个泳道「等待」某个 sha，
 * 遇到该提交就占用这个泳道并继续等待它的第一个父提交；
 * 合并提交额外的父提交各开一条新泳道，并画一条分叉连线。
 *
 * 纯函数，便于单测。
 */
export function computeGraphLayout(commits: GitCommitNode[]): GraphLayout {
  const laneOf: number[] = []
  const segments: GraphSegment[] = []
  const merges: GraphMerge[] = []

  /** 每条泳道正在等待的 sha；null 表示空闲 */
  const expected: (string | null)[] = []
  /** 泳道当前竖线段的起始行 */
  const runFrom: number[] = []
  /** 泳道当前竖线段是否由合并连线发起 */
  const runFromMerge: boolean[] = []
  /** 泳道是否有一段尚未收尾的竖线 */
  const runOpen: boolean[] = []

  const allocLane = (row: number): number => {
    const free = expected.indexOf(null)
    if (free !== -1) return free
    expected.push(null)
    runFrom.push(row)
    runFromMerge.push(false)
    runOpen.push(false)
    return expected.length - 1
  }

  const openRun = (lane: number, row: number, isMerge: boolean): void => {
    if (runOpen[lane]) return
    runOpen[lane] = true
    runFrom[lane] = row
    runFromMerge[lane] = isMerge
  }

  const closeRun = (lane: number, row: number): void => {
    if (!runOpen[lane]) return
    segments.push({
      lane,
      from: runFrom[lane],
      to: row,
      fromMerge: runFromMerge[lane]
    })
    runOpen[lane] = false
  }

  for (let row = 0; row < commits.length; row += 1) {
    const commit = commits[row]
    let lane = expected.indexOf(commit.sha)
    if (lane === -1) {
      // 还没出现过的提交（例如另一条分支的尖端）：占一条空闲泳道
      lane = allocLane(row)
      expected[lane] = commit.sha
      openRun(lane, row, false)
    }
    laneOf[row] = lane
    openRun(lane, row, false)

    const [first, ...rest] = commit.parents
    if (first) {
      // 主线继续往下等第一个父提交
      expected[lane] = first
    } else {
      expected[lane] = null
      closeRun(lane, row)
    }

    // 合并提交：其余父提交各开一条泳道
    for (const extra of rest) {
      let extraLane = expected.indexOf(extra)
      if (extraLane === -1) {
        extraLane = allocLane(row)
        expected[extraLane] = extra
        openRun(extraLane, row, true)
      }
      merges.push({ fromLane: lane, toLane: extraLane, row })
    }
  }

  // 收尾：仍在等待父提交的泳道画到最后一行
  const lastRow = Math.max(0, commits.length - 1)
  for (let lane = 0; lane < expected.length; lane += 1) {
    closeRun(lane, lastRow)
  }

  return {
    laneOf,
    segments,
    merges,
    laneCount: Math.max(1, expected.length)
  }
}

/** 泳道中心点的横坐标 */
export function laneX(lane: number): number {
  return lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2
}

/**
 * 计算某一行里需要绘制的竖线段（行内局部坐标）。
 *
 * 行高会因为展开详情而变高，所以底边用行高算，顶边用固定偏移算。
 */
export function segmentPieces(
  segment: GraphSegment,
  row: number,
  rowHeight: number
): { top: number; bottom: number } | null {
  if (row < segment.from || row > segment.to) return null
  const top = segment.from === row ? (segment.fromMerge ? GRAPH_MERGE_CY : GRAPH_NODE_CY) : 0
  const bottom = segment.to === row ? GRAPH_NODE_CY : rowHeight
  return bottom > top ? { top, bottom } : null
}

/** 相对时间（刚刚 / 3 分钟前 / 昨天 / 2026-11-16） */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return ''
  const diff = now - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 把提交信息里的类型前缀（feat / docs / fix …）拆出来，便于着色 */
export function splitConventionalPrefix(subject: string): { prefix: string; rest: string } {
  const match = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s*(.+)$/.exec(subject)
  if (!match) return { prefix: '', rest: subject }
  return { prefix: match[1].toLowerCase(), rest: match[4] }
}
