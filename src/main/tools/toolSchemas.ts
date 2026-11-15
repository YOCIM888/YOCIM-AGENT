import { z } from 'zod'
import { AppError } from '../../shared/errors'

export const listDirArgsSchema = z.object({
  relativePath: z.string().max(1024).optional().default(''),
  depth: z.number().int().min(1).max(3).optional().default(2)
})

export const readFileArgsSchema = z.object({
  relativePath: z.string().min(1).max(1024)
})

export const searchFilesArgsSchema = z.object({
  query: z.string().min(1).max(200),
  relativePath: z.string().max(1024).optional().default(''),
  maxResults: z.number().int().min(1).max(200).optional().default(50)
})

export const writeFileArgsSchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    content: z.string().max(1_000_000).optional(),
    oldText: z.string().min(1).max(100_000).optional(),
    newText: z.string().max(1_000_000).optional()
  })
  .refine(
    (value) =>
      typeof value.content === 'string' ||
      (typeof value.oldText === 'string' && typeof value.newText === 'string'),
    { message: '必须提供 content，或同时提供 oldText 与 newText' }
  )

export const runCommandArgsSchema = z.object({
  command: z.string().min(1).max(2000),
  cwd: z.string().max(1024).optional().default(''),
  timeoutMs: z.number().int().min(1000).max(300_000).optional().default(60_000)
})

export type ListDirArgs = z.output<typeof listDirArgsSchema>
export type ReadFileArgs = z.output<typeof readFileArgsSchema>
export type SearchFilesArgs = z.output<typeof searchFilesArgsSchema>
export type WriteFileArgs = z.output<typeof writeFileArgsSchema>
export type RunCommandArgs = z.output<typeof runCommandArgsSchema>

export type ParsedToolArguments =
  | { tool: 'list_dir'; args: ListDirArgs }
  | { tool: 'read_file'; args: ReadFileArgs }
  | { tool: 'search_files'; args: SearchFilesArgs }
  | { tool: 'write_file'; args: WriteFileArgs }
  | { tool: 'run_command'; args: RunCommandArgs }

export function parseToolArguments(name: string, raw: string): ParsedToolArguments {
  let json: unknown
  try {
    json = JSON.parse(raw || '{}')
  } catch {
    throw new AppError('E_INVALID_INPUT', '工具参数不是合法 JSON')
  }

  switch (name) {
    case 'list_dir':
      return { tool: 'list_dir', args: listDirArgsSchema.parse(json) }
    case 'read_file':
      return { tool: 'read_file', args: readFileArgsSchema.parse(json) }
    case 'search_files':
      return { tool: 'search_files', args: searchFilesArgsSchema.parse(json) }
    case 'write_file':
      return { tool: 'write_file', args: writeFileArgsSchema.parse(json) }
    case 'run_command':
      return { tool: 'run_command', args: runCommandArgsSchema.parse(json) }
    default:
      throw new AppError('E_TOOL_DENIED', `未知工具：${name}`)
  }
}
