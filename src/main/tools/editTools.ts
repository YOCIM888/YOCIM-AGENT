import type { ToolExecutionOutcome } from '../../shared/agent'
import type { DiffPreviewHunk, DiffPreviewLine } from '../../shared/approval'
import { AppError } from '../../shared/errors'
import { IGNORED_DIRECTORIES, type FileEol } from '../../shared/ipc'
import { hashContent } from '../workspace/searchCore'
import type { EditFileArgs, WriteFileArgs } from './toolSchemas'
import type { ToolFileContent, ToolFileIo } from './toolFileIo'

const CONTEXT_LINES = 2
const MAX_RESULT_CHARS = 8 * 1024
/** diff 预览的展示上限：单 hunk 行数与总行数 */
const PREVIEW_MAX_LINES_PER_HUNK = 40
const PREVIEW_MAX_LINES = 120
const WRITE_PREVIEW_HEAD_LINES = 60
const WRITE_OLD_PREVIEW_LINES = 6

type MatchMode = 'exact' | 'fuzzy'

interface ResolvedEdit {
  index: number
  start: number
  end: number
  mode: MatchMode
  line: number
  oldText: string
  newText: string
}

interface AppliedEdit extends ResolvedEdit {
  newStart: number
  newEnd: number
  newLine: number
  newLineCount: number
}

export function assertWritableRelativePath(relativePath: string): void {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean)
  for (const segment of segments) {
    if (IGNORED_DIRECTORIES.has(segment)) {
      throw new AppError('E_TOOL_DENIED', `禁止写入忽略目录：${segment}`)
    }
  }
}

function splitLines(content: string): string[] {
  if (!content) return []
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content
  return trimmed.split('\n')
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function lineStartOffset(lines: string[], lineIndex: number): number {
  let offset = 0
  for (let cursor = 0; cursor < lineIndex; cursor += 1) {
    offset += lines[cursor].length + 1
  }
  return offset
}

function countOccurrences(haystack: string, needle: string): number[] {
  const spans: number[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, from)
    if (found < 0) break
    spans.push(found)
    from = found + 1
  }
  return spans
}

/** 空白/缩进不一致时的容错匹配：按整行归一化比较，返回命中窗口的行号。 */
function fuzzyWindows(content: string, oldText: string): number[] {
  const fileLines = content.split('\n')
  const targetLines = splitLines(oldText)
  if (!targetLines.length) return []
  const target = targetLines.map(normalizeLine)
  // 全空白的原文没有定位意义
  if (target.every((line) => line === '')) return []

  const windows: number[] = []
  const last = fileLines.length - target.length
  for (let start = 0; start <= last; start += 1) {
    let matched = true
    for (let offset = 0; offset < target.length; offset += 1) {
      if (normalizeLine(fileLines[start + offset]) !== target[offset]) {
        matched = false
        break
      }
    }
    if (matched) windows.push(start)
  }
  return windows
}

function resolveOne(
  content: string,
  index: number,
  oldText: string,
  newText: string
): ResolvedEdit {
  const label = `第 ${index + 1} 处修改`
  const occurrences = countOccurrences(content, oldText)
  if (occurrences.length === 1) {
    const start = occurrences[0]
    return {
      index,
      start,
      end: start + oldText.length,
      mode: 'exact',
      line: lineNumberAt(content, start),
      oldText,
      newText
    }
  }
  if (occurrences.length > 1) {
    const lines = occurrences.slice(0, 5).map((at) => lineNumberAt(content, at))
    throw new AppError(
      'E_INVALID_INPUT',
      `${label}的 oldText 匹配了 ${occurrences.length} 次（第 ${lines.join(', ')} 行），必须唯一。请补充更多前后文，或改用更长的原文。`
    )
  }

  const windows = fuzzyWindows(content, oldText)
  if (windows.length === 1) {
    const fileLines = content.split('\n')
    const lineIndex = windows[0]
    const spanLines = fileLines.slice(lineIndex, lineIndex + splitLines(oldText).length)
    const start = lineStartOffset(fileLines, lineIndex)
    const end = start + spanLines.join('\n').length
    return {
      index,
      start,
      end,
      mode: 'fuzzy',
      line: lineIndex + 1,
      oldText: content.slice(start, end),
      newText
    }
  }
  if (windows.length > 1) {
    const lines = windows.slice(0, 5).map((line) => line + 1)
    throw new AppError(
      'E_INVALID_INPUT',
      `${label}的 oldText 去掉缩进差异后仍匹配 ${windows.length} 次（第 ${lines.join(', ')} 行），必须唯一。请补充更多上下文。`
    )
  }
  const totalLines = splitLines(content).length
  throw new AppError(
    'E_INVALID_INPUT',
    `${label}的 oldText 在文件中找不到（文件共 ${totalLines} 行）。请先用 read_file 核对原文；缩进与行尾空白差异已自动容错，但字符内容必须一致。`
  )
}

function assertNoOverlap(edits: ResolvedEdit[]): void {
  const ordered = [...edits].sort((a, b) => a.start - b.start)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (current.start < previous.end) {
      throw new AppError(
        'E_INVALID_INPUT',
        `第 ${previous.index + 1} 处与第 ${current.index + 1} 处修改的范围重叠（第 ${previous.line} 行附近），请合并为一次修改。`
      )
    }
  }
}

function applyEdits(
  content: string,
  edits: ResolvedEdit[]
): { next: string; applied: AppliedEdit[] } {
  const ordered = [...edits].sort((a, b) => a.start - b.start)
  const applied: AppliedEdit[] = []
  let cursor = 0
  let next = ''

  for (const edit of ordered) {
    next += content.slice(cursor, edit.start) + edit.newText
    const newStart = next.length - edit.newText.length
    applied.push({
      ...edit,
      newStart,
      newEnd: next.length,
      newLine: lineNumberAt(next, newStart),
      newLineCount: splitLines(edit.newText.replace(/\n$/, '')).length
    })
    cursor = edit.end
  }
  next += content.slice(cursor)
  return { next, applied }
}

function renderSnippet(content: string, edit: AppliedEdit): string[] {
  const lines = content.split('\n')
  const startLine = Math.max(1, edit.newLine - CONTEXT_LINES)
  const changed = Math.max(1, edit.newLineCount)
  const endLine = Math.min(lines.length, edit.newLine + changed - 1 + CONTEXT_LINES)
  const width = Math.max(3, String(endLine).length)
  const out: string[] = []
  for (let line = startLine; line <= endLine; line += 1) {
    const inChange = line >= edit.newLine && line < edit.newLine + changed
    const prefix = inChange ? '>' : ' '
    out.push(`${prefix}${String(line).padStart(width, ' ')}| ${lines[line - 1] ?? ''}`)
  }
  return out
}

export interface ToolPreview {
  relativePath: string
  isNew: boolean
  hunks: DiffPreviewHunk[]
  truncated?: boolean
  /** 请求审批时的内容 hash：执行前再校验（T4.4 写前预检） */
  contentHash: string
}

function clipLines(
  lines: DiffPreviewLine[],
  perHunk: number,
  state: { budget: number }
): DiffPreviewLine[] | null {
  if (state.budget <= 0) return null
  const take = lines.slice(0, Math.min(perHunk, state.budget))
  state.budget -= take.length
  if (lines.length > take.length) {
    take.push({ type: 'ctx', text: `⋯（其余 ${lines.length - take.length} 行省略）` })
  }
  return take
}

/** edit_file 的审批预览：所有修改块合并为一次 diff（T4.3 批量审批） */
export async function buildEditPreview(io: ToolFileIo, args: EditFileArgs): Promise<ToolPreview> {
  const snapshot: ToolFileContent = await io.read(args.relativePath)
  if (snapshot.truncated) {
    throw new AppError(
      'E_TOO_LARGE',
      `文件超过读取上限（${Math.round(snapshot.size / 1024)} KB），不支持整文件补丁。请改用 run_command 或分段处理。`
    )
  }
  const resolved = args.edits.map((edit, index) =>
    resolveOne(snapshot.content, index, edit.oldText, edit.newText)
  )
  assertNoOverlap(resolved)
  const { next, applied } = applyEdits(snapshot.content, resolved)

  const budget = { budget: PREVIEW_MAX_LINES }
  const hunks: DiffPreviewHunk[] = []
  for (const edit of applied) {
    const oldLines = splitLines(edit.oldText.replace(/\n$/, ''))
    const newLines = splitLines(edit.newText.replace(/\n$/, ''))
    const before = snapshot.content
      .split('\n')
      .slice(Math.max(0, edit.line - 1 - CONTEXT_LINES), Math.max(0, edit.line - 1))
    const newEnd = edit.newLine + Math.max(1, newLines.length) - 1
    const nextLines = next.split('\n')
    const after = nextLines.slice(newEnd, newEnd + CONTEXT_LINES)

    const lines: DiffPreviewLine[] = []
    for (const text of before) lines.push({ type: 'ctx', text })
    for (const text of oldLines) lines.push({ type: 'del', text })
    for (const text of newLines) lines.push({ type: 'add', text })
    for (const text of after) lines.push({ type: 'ctx', text })

    const clipped = clipLines(lines, PREVIEW_MAX_LINES_PER_HUNK, budget)
    if (clipped === null) break
    const mode = edit.mode === 'fuzzy' ? '，模糊匹配' : ''
    hunks.push({ header: `第 ${edit.newLine} 行${mode}`, lines: clipped })
  }

  return {
    relativePath: snapshot.relativePath,
    isNew: false,
    hunks,
    truncated: budget.budget <= 0 || hunks.length < applied.length,
    contentHash: snapshot.contentHash
  }
}

/** write_file 的审批预览：新建显示全部内容，覆盖显示旧文件头部 + 新内容头部 */
export async function buildWritePreview(io: ToolFileIo, args: WriteFileArgs): Promise<ToolPreview> {
  const newLines = splitLines(args.content.replace(/\n$/, ''))
  const existing = await io.read(args.relativePath).catch(() => null)
  const isNew = existing === null

  const budget = { budget: PREVIEW_MAX_LINES }
  const lines: DiffPreviewLine[] = []
  let header: string
  if (existing) {
    const old = splitLines(existing.content.replace(/\n$/, ''))
    const head = clipLines(
      old.slice(0, WRITE_OLD_PREVIEW_LINES).map((text): DiffPreviewLine => ({ type: 'del', text })),
      WRITE_OLD_PREVIEW_LINES,
      budget
    )
    if (head) lines.push(...head)
    if (old.length > WRITE_OLD_PREVIEW_LINES) {
      lines.push({ type: 'ctx', text: `⋯（旧文件共 ${old.length} 行，整文件重写）` })
    }
    const eolNote = existing.eol === 'crlf' ? '（保留 CRLF）' : ''
    header = `整文件重写（${old.length} 行 → ${newLines.length} 行）${eolNote}`
  } else {
    header = '新建文件'
  }
  const clippedNew = clipLines(
    newLines.map((text): DiffPreviewLine => ({ type: 'add', text })),
    WRITE_PREVIEW_HEAD_LINES,
    budget
  )
  if (clippedNew) lines.push(...clippedNew)

  const hunks: DiffPreviewHunk[] = [{ header, lines }]

  return {
    relativePath: args.relativePath,
    isNew,
    hunks,
    truncated: budget.budget <= 0 || newLines.length > WRITE_PREVIEW_HEAD_LINES,
    contentHash: existing ? hashContent(existing.content) : ''
  }
}

export async function runWriteFile(
  io: ToolFileIo,
  args: WriteFileArgs,
  options: { approvalHash?: string } = {}
): Promise<ToolExecutionOutcome> {
  assertWritableRelativePath(args.relativePath)
  const content = args.content ?? ''
  // 已存在的文件沿用原换行符，避免整文件 EOL 变化
  let eol: FileEol | undefined
  let existing: ToolFileContent | null = null
  try {
    existing = await io.read(args.relativePath)
    eol = existing.eol
  } catch {
    eol = undefined
  }
  // T4.4 写前预检：审批期间文件被外部修改则拒绝写入
  if (existing && options.approvalHash && existing.contentHash !== options.approvalHash) {
    throw new AppError(
      'E_CONFLICT',
      '文件在审批期间被外部修改过，本次写入已取消。请让模型重新读取后再提交。'
    )
  }
  await io.write(args.relativePath, content, { eol })
  return {
    ok: true,
    content: `已写入 ${args.relativePath}（${Buffer.byteLength(content, 'utf8')} 字节）`,
    summary: `写入 ${args.relativePath}（${Buffer.byteLength(content, 'utf8')} 字节）`
  }
}

export async function runEditFile(
  io: ToolFileIo,
  args: EditFileArgs,
  options: { approvalHash?: string } = {}
): Promise<ToolExecutionOutcome> {
  assertWritableRelativePath(args.relativePath)

  const snapshot: ToolFileContent = await io.read(args.relativePath)
  // T4.4 写前预检：diff 预览生成于审批之前，若审批期间文件被外部改动则拒绝
  if (options.approvalHash && snapshot.contentHash !== options.approvalHash) {
    throw new AppError(
      'E_CONFLICT',
      '文件在审批期间被外部修改过，本次补丁已取消（预览的 diff 已过期）。请让模型重新读取后再提交。'
    )
  }
  if (snapshot.truncated) {
    throw new AppError(
      'E_TOO_LARGE',
      `文件超过读取上限（${Math.round(snapshot.size / 1024)} KB），不支持整文件补丁。请改用 run_command 或分段处理。`
    )
  }
  const resolved = args.edits.map((edit, index) =>
    resolveOne(snapshot.content, index, edit.oldText, edit.newText)
  )
  assertNoOverlap(resolved)

  const { next, applied } = applyEdits(snapshot.content, resolved)
  if (next === snapshot.content) {
    return {
      ok: true,
      content: `${snapshot.relativePath}：${applied.length} 处修改的内容与原文件一致，未写入。`,
      summary: `${snapshot.relativePath}：内容无变化`
    }
  }

  await io.write(snapshot.relativePath, next, {
    expectedHash: snapshot.contentHash,
    eol: snapshot.eol
  })

  const removed = applied.reduce(
    (sum, edit) => sum + splitLines(edit.oldText.replace(/\n$/, '')).length,
    0
  )
  const added = applied.reduce((sum, edit) => sum + edit.newLineCount, 0)
  const fuzzy = applied.filter((edit) => edit.mode === 'fuzzy')

  const blocks: string[] = [
    `${snapshot.relativePath}：已应用 ${applied.length} 处修改（+${added}/-${removed} 行）`
  ]
  for (const edit of applied) {
    const mode = edit.mode === 'fuzzy' ? '，模糊匹配（忽略缩进/空白差异）' : ''
    blocks.push('', `${edit.index + 1}) 第 ${edit.newLine} 行${mode}`)
    blocks.push(...renderSnippet(next, edit))
  }
  if (fuzzy.length) {
    blocks.push(
      '',
      `[注意：第 ${fuzzy.map((edit) => edit.index + 1).join('、')} 处使用了模糊匹配，请核对上面的改动位置是否正确]`
    )
  }

  let content = blocks.join('\n')
  if (content.length > MAX_RESULT_CHARS) {
    content = `${content.slice(0, MAX_RESULT_CHARS)}\n[改动详情已截断]`
  }

  return {
    ok: true,
    content,
    summary: `${snapshot.relativePath}：${applied.length} 处修改（+${added}/-${removed} 行）`
  }
}
