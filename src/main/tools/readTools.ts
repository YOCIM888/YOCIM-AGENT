import type { ToolExecutionOutcome } from '../../shared/agent'
import type { ReadFileArgs } from './toolSchemas'
import type { ToolFileIo } from './toolFileIo'

function maxLineWidth(total: number): number {
  return Math.max(3, String(total).length)
}

function numberLines(lines: string[], startLine: number, width: number): string[] {
  return lines.map((line, index) => {
    const no = String(startLine + index).padStart(width, ' ')
    return `${no}| ${line}`
  })
}

/** 去掉末尾换行产生的空行，让行号与编辑器保持一致。 */
function splitLines(content: string): string[] {
  if (!content) return []
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content
  return trimmed.split('\n')
}

export async function runReadFile(
  io: ToolFileIo,
  args: ReadFileArgs
): Promise<ToolExecutionOutcome> {
  const file = await io.read(args.relativePath)
  const lines = splitLines(file.content)
  const total = lines.length

  if (!total) {
    return {
      ok: true,
      content: `${file.relativePath}（空文件）`,
      summary: `${file.relativePath}：空文件`
    }
  }

  const offset = Math.min(args.offset, total)
  const end = Math.min(offset + args.limit - 1, total)
  const width = maxLineWidth(total)
  const body = numberLines(lines.slice(offset - 1, end), offset, width)

  const header = `${file.relativePath}（共 ${total} 行，显示 ${offset}-${end}）`
  const hints: string[] = []
  if (args.offset > total) {
    hints.push(`[起始行 ${args.offset} 超出文件范围，已从第 ${total} 行开始返回]`)
  }
  if (end < total) {
    hints.push(`[还有 ${total - end} 行未显示，用 offset=${end + 1} 继续读取]`)
  }
  if (file.truncated) {
    hints.push(`[文件过大，仅读取前 ${Math.round(file.size / 1024)} KB]`)
  }

  return {
    ok: true,
    content: [header, ...body, ...hints].join('\n'),
    summary: `${file.relativePath}：第 ${offset}-${end} 行 / 共 ${total} 行`
  }
}
