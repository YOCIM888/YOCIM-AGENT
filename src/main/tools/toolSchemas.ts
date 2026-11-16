import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { WEB_SEARCH_LIMITS } from '../../shared/settings'

export const READ_FILE_DEFAULT_LIMIT = 400
export const READ_FILE_MAX_LIMIT = 2000

export const listDirArgsSchema = z.object({
  relativePath: z.string().max(1024).optional().default(''),
  depth: z.number().int().min(1).max(3).optional().default(2),
  glob: z.string().max(200).optional().default('')
})

export const readFileArgsSchema = z.object({
  relativePath: z.string().min(1).max(1024),
  offset: z.number().int().min(1).optional().default(1),
  limit: z
    .number()
    .int()
    .min(1)
    .max(READ_FILE_MAX_LIMIT)
    .optional()
    .default(READ_FILE_DEFAULT_LIMIT)
})

export const searchFilesArgsSchema = z.object({
  query: z.string().min(1).max(200),
  relativePath: z.string().max(1024).optional().default(''),
  regex: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(false),
  wholeWord: z.boolean().optional().default(false),
  include: z.string().max(512).optional().default(''),
  exclude: z.string().max(512).optional().default(''),
  contextLines: z.number().int().min(0).max(5).optional().default(0),
  maxResults: z.number().int().min(1).max(200).optional().default(50)
})

export const writeFileArgsSchema = z.object({
  relativePath: z.string().min(1).max(1024),
  content: z.string().max(1_000_000)
})

export const editFileArgsSchema = z.object({
  relativePath: z.string().min(1).max(1024),
  edits: z
    .array(
      z.object({
        oldText: z.string().min(1).max(100_000),
        newText: z.string().max(1_000_000)
      })
    )
    .min(1)
    .max(20)
})

export const runCommandArgsSchema = z.object({
  command: z.string().min(1).max(2000),
  cwd: z.string().max(1024).optional().default(''),
  timeoutMs: z.number().int().min(1000).max(300_000).optional().default(60_000)
})

export const runTestsArgsSchema = z.object({
  pattern: z.string().max(500).optional(),
  runner: z.enum(['vitest', 'jest', 'pytest', 'go']).optional(),
  cwd: z.string().max(1024).optional().default(''),
  timeoutMs: z.number().int().min(1000).max(600_000).optional().default(120_000)
})

export const runTypecheckArgsSchema = z.object({
  cwd: z.string().max(1024).optional().default(''),
  timeoutMs: z.number().int().min(1000).max(600_000).optional().default(180_000)
})

export const runLintArgsSchema = z.object({
  relativePath: z.string().max(1024).optional(),
  cwd: z.string().max(1024).optional().default(''),
  timeoutMs: z.number().int().min(1000).max(600_000).optional().default(180_000)
})

export const getGitDiffArgsSchema = z.object({
  relativePath: z.string().max(1024).optional().default(''),
  staged: z.boolean().optional().default(false)
})

export const updatePlanArgsSchema = z.object({
  plan: z
    .array(
      z.object({
        step: z.string().min(1).max(200),
        status: z.enum(['pending', 'doing', 'done'])
      })
    )
    .min(1)
    .max(20)
})

export const webSearchArgsSchema = z.object({
  query: z.string().min(1).max(WEB_SEARCH_LIMITS.maxQueryLength),
  maxResults: z.number().int().min(1).max(WEB_SEARCH_LIMITS.maxResults).optional()
})

export type ListDirArgs = z.output<typeof listDirArgsSchema>
export type ReadFileArgs = z.output<typeof readFileArgsSchema>
export type SearchFilesArgs = z.output<typeof searchFilesArgsSchema>
export type WriteFileArgs = z.output<typeof writeFileArgsSchema>
export type EditFileArgs = z.output<typeof editFileArgsSchema>
export type RunCommandArgs = z.output<typeof runCommandArgsSchema>
export type RunTestsArgs = z.output<typeof runTestsArgsSchema>
export type RunTypecheckArgs = z.output<typeof runTypecheckArgsSchema>
export type RunLintArgs = z.output<typeof runLintArgsSchema>
export type GetGitDiffArgs = z.output<typeof getGitDiffArgsSchema>
export type UpdatePlanArgs = z.output<typeof updatePlanArgsSchema>
export type WebSearchArgs = z.output<typeof webSearchArgsSchema>

export type ParsedToolArguments =
  | { tool: 'list_dir'; args: ListDirArgs }
  | { tool: 'read_file'; args: ReadFileArgs }
  | { tool: 'search_files'; args: SearchFilesArgs }
  | { tool: 'write_file'; args: WriteFileArgs }
  | { tool: 'edit_file'; args: EditFileArgs }
  | { tool: 'run_command'; args: RunCommandArgs }
  | { tool: 'run_tests'; args: RunTestsArgs }
  | { tool: 'run_typecheck'; args: RunTypecheckArgs }
  | { tool: 'run_lint'; args: RunLintArgs }
  | { tool: 'get_git_diff'; args: GetGitDiffArgs }
  | { tool: 'update_plan'; args: UpdatePlanArgs }
  | { tool: 'web_search'; args: WebSearchArgs }

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
    case 'edit_file':
      return { tool: 'edit_file', args: editFileArgsSchema.parse(json) }
    case 'run_command':
      return { tool: 'run_command', args: runCommandArgsSchema.parse(json) }
    case 'run_tests':
      return { tool: 'run_tests', args: runTestsArgsSchema.parse(json) }
    case 'run_typecheck':
      return { tool: 'run_typecheck', args: runTypecheckArgsSchema.parse(json) }
    case 'run_lint':
      return { tool: 'run_lint', args: runLintArgsSchema.parse(json) }
    case 'get_git_diff':
      return { tool: 'get_git_diff', args: getGitDiffArgsSchema.parse(json) }
    case 'update_plan':
      return { tool: 'update_plan', args: updatePlanArgsSchema.parse(json) }
    case 'web_search':
      return { tool: 'web_search', args: webSearchArgsSchema.parse(json) }
    default:
      throw new AppError('E_TOOL_DENIED', `未知工具：${name}`)
  }
}
