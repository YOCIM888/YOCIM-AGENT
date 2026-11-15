import { z } from 'zod'
import { ATTACHMENT_LIMITS, contextAttachmentSchema } from './attachment'
import type { IpcErrorCode } from './errors'
import { AUDIT_LIMITS, DEBUG_LIMITS, FS_LIMITS, GIT_LIMITS, SEARCH_LIMITS } from './ipcChannels'
import type { AuditEntry, AuditExportResult, AuditPage, AuditStats } from './audit'
import type {
  DebugBreakpoint,
  DebugEvaluation,
  DebugScope,
  DebugSession,
  DebugVariable
} from './debug'
import type {
  ExtensionContributionBundle,
  ExtensionInfo,
  ExtensionInstallResult,
  VscodeScanResult
} from './extensions'
import type { TaskDiscovery, TaskRun } from './tasks'
import { PROVIDER_PRESET_IDS } from './providers'
import type { PublicSettings, ProjectSummary, SessionSummary, StoredMessage } from './session'

export type { IpcErrorCode } from './errors'
export {
  AUDIT_LIMITS,
  DEBUG_LIMITS,
  EXTENSION_LIMITS,
  FS_LIMITS,
  GIT_LIMITS,
  IGNORED_DIRECTORIES,
  IPC_CHANNELS,
  SEARCH_LIMITS,
  TASK_LIMITS
} from './ipcChannels'
export {
  ATTACHMENT_LIMITS,
  contextAttachmentSchema,
  summarizeAttachments,
  type AttachmentSummary,
  type ContextAttachment,
  type ContextAttachmentRange
} from './attachment'

export interface IpcError {
  code: IpcErrorCode
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export const workspaceInfoSchema = z.object({
  root: z.string().min(1),
  name: z.string().min(1)
})

export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>

export interface FsTreeNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  children?: FsTreeNode[]
}

export const fsTreeNodeSchema: z.ZodType<FsTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    relativePath: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(fsTreeNodeSchema).optional()
  })
)

export const fsTreeInputSchema = z.object({
  relativePath: z.string().max(FS_LIMITS.maxRelativePathLength).optional().default(''),
  depth: z.number().int().min(1).max(FS_LIMITS.maxDepth).optional().default(2)
})

export type FsTreeInput = z.input<typeof fsTreeInputSchema>
export type FsTreeRequest = z.output<typeof fsTreeInputSchema>

export const fsReadFileInputSchema = z.object({
  relativePath: z.string().min(1).max(FS_LIMITS.maxRelativePathLength),
  /** 提供时若磁盘内容与期望 hash 不同，主进程生成一条 external 快照 */
  expectedHash: z.string().max(128).optional()
})

export type FsReadFileInput = z.input<typeof fsReadFileInputSchema>
export type FsReadFileRequest = z.output<typeof fsReadFileInputSchema>

export const fsReadFileResultSchema = z.object({
  relativePath: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  size: z.number().int().nonnegative(),
  /** 归一化（LF）后内容的 sha256，用于保存/替换前的外部修改冲突校验 */
  contentHash: z.string().max(128).optional(),
  eol: z.enum(['lf', 'crlf']).optional(),
  kind: z.enum(['text', 'image', 'binary']).optional(),
  imageDataUrl: z
    .string()
    .max(4 * 1024 * 1024)
    .optional()
})

export type FsReadFileResult = z.infer<typeof fsReadFileResultSchema>

const relativePathSchema = z.string().min(1).max(FS_LIMITS.maxRelativePathLength)
const dirPathSchema = z.string().max(FS_LIMITS.maxRelativePathLength).optional().default('')
const entryNameSchema = z.string().min(1).max(255)

export const fsCreateEntryInputSchema = z.object({
  parentPath: dirPathSchema,
  name: entryNameSchema
})

export type FsCreateEntryInput = z.input<typeof fsCreateEntryInputSchema>
export type FsCreateEntryRequest = z.output<typeof fsCreateEntryInputSchema>

export const fsRenameInputSchema = z.object({
  relativePath: relativePathSchema,
  newName: entryNameSchema
})

export type FsRenameInput = z.input<typeof fsRenameInputSchema>
export type FsRenameRequest = z.output<typeof fsRenameInputSchema>

export const fsConflictSchema = z.enum(['error', 'keep-both', 'replace', 'skip'])
export type FsConflictResolution = z.infer<typeof fsConflictSchema>

export const fsTransferInputSchema = z.object({
  sourcePath: relativePathSchema,
  targetDir: dirPathSchema,
  conflict: fsConflictSchema.optional().default('error')
})

export type FsTransferInput = z.input<typeof fsTransferInputSchema>
export type FsTransferRequest = z.output<typeof fsTransferInputSchema>

export interface FsTransferResult {
  relativePath: string
  skipped: boolean
}

export const fsPathInputSchema = z.object({
  relativePath: relativePathSchema
})

export type FsPathInput = z.input<typeof fsPathInputSchema>
export type FsPathRequest = z.output<typeof fsPathInputSchema>

export interface FsDeleteResult {
  deleted: boolean
}

export const fsClipboardStateSchema = z.object({
  mode: z.enum(['cut', 'copy']),
  relativePath: z.string(),
  name: z.string()
})

export type FsClipboardState = z.infer<typeof fsClipboardStateSchema>
export type FsClipboardResult = FsClipboardState | null

export const fsClipboardInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }),
  z.object({ action: z.literal('clear') }),
  z.object({
    action: z.literal('set'),
    mode: z.enum(['cut', 'copy']),
    relativePath: relativePathSchema
  })
])

export type FsClipboardInput = z.input<typeof fsClipboardInputSchema>
export type FsClipboardRequest = z.output<typeof fsClipboardInputSchema>

export const clipboardWriteTextInputSchema = z.object({
  text: z.string().max(4096)
})

export type ClipboardWriteTextInput = z.input<typeof clipboardWriteTextInputSchema>
export type ClipboardWriteTextRequest = z.output<typeof clipboardWriteTextInputSchema>

export const timelineSourceSchema = z.enum(['user', 'agent', 'external'])
export type TimelineSource = z.infer<typeof timelineSourceSchema>

export const timelineEntrySchema = z.object({
  id: z.string(),
  relativePath: z.string(),
  source: timelineSourceSchema,
  size: z.number().int().nonnegative(),
  contentHash: z.string(),
  createdAt: z.number().int()
})

export type TimelineEntry = z.infer<typeof timelineEntrySchema>
export type TimelineListResult = TimelineEntry[]

export const timelineReadInputSchema = z.object({
  id: z.string().min(1).max(64)
})

export type TimelineReadInput = z.input<typeof timelineReadInputSchema>
export type TimelineReadRequest = z.output<typeof timelineReadInputSchema>

export interface TimelineReadResult {
  entry: TimelineEntry
  content: string
}

export interface TimelineRestoreResult {
  relativePath: string
  content: string
  size: number
}

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000)
})

export const chatSendInputSchema = z
  .object({
    sessionId: z.string().min(1).max(64),
    text: z.string().min(1).max(20_000),
    history: z.array(chatHistoryMessageSchema).max(50).optional().default([]),
    attachments: z
      .array(contextAttachmentSchema)
      .max(ATTACHMENT_LIMITS.maxCount)
      .optional()
      .default([])
  })
  .superRefine((value, ctx) => {
    const total = value.attachments.reduce((sum, item) => sum + item.content.length, 0)
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
      ctx.addIssue({
        code: 'custom',
        message: '附件总大小超出 200KB 限制',
        path: ['attachments']
      })
    }
  })

export type ChatSendInput = z.input<typeof chatSendInputSchema>
export type ChatSendRequest = z.output<typeof chatSendInputSchema>

export interface ChatSendResult {
  runId: string
}

export const chatCancelInputSchema = z.object({
  runId: z.string().min(1).max(64)
})

export type ChatCancelInput = z.input<typeof chatCancelInputSchema>
export type ChatCancelRequest = z.output<typeof chatCancelInputSchema>

export interface ChatCancelResult {
  cancelled: boolean
}

export const approvalRespondInputSchema = z.object({
  approvalId: z.string().min(1).max(64),
  decision: z.enum(['approve', 'deny'])
})

export type ApprovalRespondInput = z.input<typeof approvalRespondInputSchema>
export type ApprovalRespondRequest = z.output<typeof approvalRespondInputSchema>

export interface ApprovalRespondResult {
  accepted: boolean
}

export const auditListInputSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50)
})

export type AuditListInput = z.input<typeof auditListInputSchema>
export type AuditListRequest = z.output<typeof auditListInputSchema>
export type AuditListResult = AuditEntry[]

export const sessionIdInputSchema = z.object({
  sessionId: z.string().min(1).max(64)
})

export type SessionIdInput = z.input<typeof sessionIdInputSchema>
export type SessionIdRequest = z.output<typeof sessionIdInputSchema>

export const sessionCreateInputSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  projectId: z.string().min(1).max(64).optional()
})

export type SessionCreateInput = z.input<typeof sessionCreateInputSchema>
export type SessionCreateRequest = z.output<typeof sessionCreateInputSchema>

export const sessionListInputSchema = z.object({
  projectId: z.string().min(1).max(64).optional(),
  includeArchived: z.boolean().optional().default(false)
})

export type SessionListInput = z.input<typeof sessionListInputSchema>
export type SessionListRequest = z.output<typeof sessionListInputSchema>

export const sessionPinInputSchema = z.object({
  sessionId: z.string().min(1).max(64),
  pinned: z.boolean()
})

export type SessionPinInput = z.input<typeof sessionPinInputSchema>
export type SessionPinRequest = z.output<typeof sessionPinInputSchema>

export const sessionArchiveInputSchema = z.object({
  sessionId: z.string().min(1).max(64),
  archived: z.boolean()
})

export type SessionArchiveInput = z.input<typeof sessionArchiveInputSchema>
export type SessionArchiveRequest = z.output<typeof sessionArchiveInputSchema>

export const sessionMoveInputSchema = z.object({
  sessionId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64)
})

export type SessionMoveInput = z.input<typeof sessionMoveInputSchema>
export type SessionMoveRequest = z.output<typeof sessionMoveInputSchema>

export const projectRenameInputSchema = z.object({
  projectId: z.string().min(1).max(64),
  name: z.string().min(1).max(100)
})

export type ProjectRenameInput = z.input<typeof projectRenameInputSchema>
export type ProjectRenameRequest = z.output<typeof projectRenameInputSchema>

export const workspaceOpenProjectInputSchema = z.object({
  projectId: z.string().min(1).max(64)
})

export type WorkspaceOpenProjectInput = z.input<typeof workspaceOpenProjectInputSchema>
export type WorkspaceOpenProjectRequest = z.output<typeof workspaceOpenProjectInputSchema>

export const sessionRenameInputSchema = z.object({
  sessionId: z.string().min(1).max(64),
  title: z.string().min(1).max(100)
})

export type SessionRenameInput = z.input<typeof sessionRenameInputSchema>
export type SessionRenameRequest = z.output<typeof sessionRenameInputSchema>

export type SessionListResult = SessionSummary[]
export type SessionMessagesResult = StoredMessage[]
export type ProjectListResult = ProjectSummary[]

export interface SessionDeleteResult {
  deleted: boolean
}

export interface SessionExportResult {
  path: string | null
}

const providerProtocolSchema = z.enum(['openai', 'anthropic', 'gemini'])

export const providerSaveInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  presetId: z.enum(PROVIDER_PRESET_IDS),
  name: z.string().min(1).max(100),
  protocol: providerProtocolSchema,
  baseUrl: z.string().max(500),
  model: z.string().max(200).optional().default(''),
  models: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
  apiKey: z.string().max(500).optional()
})

export type ProviderSaveInput = z.input<typeof providerSaveInputSchema>
export type ProviderSaveRequest = z.output<typeof providerSaveInputSchema>

export const providerDeleteInputSchema = z.object({
  providerId: z.string().min(1).max(64)
})

export type ProviderDeleteInput = z.input<typeof providerDeleteInputSchema>
export type ProviderDeleteRequest = z.output<typeof providerDeleteInputSchema>

export const settingsSetActiveInputSchema = z.object({
  providerId: z.string().min(1).max(64),
  model: z.string().min(1).max(200)
})

export type SettingsSetActiveInput = z.input<typeof settingsSetActiveInputSchema>
export type SettingsSetActiveRequest = z.output<typeof settingsSetActiveInputSchema>

export const settingsSetApprovalModeInputSchema = z.object({
  mode: z.enum(['manual', 'auto', 'open'])
})

export type SettingsSetApprovalModeInput = z.input<typeof settingsSetApprovalModeInputSchema>
export type SettingsSetApprovalModeRequest = z.output<typeof settingsSetApprovalModeInputSchema>

export type SettingsResult = PublicSettings

export const windowControlInputSchema = z.object({
  action: z.enum(['minimize', 'maximize', 'close'])
})

export type WindowControlInput = z.input<typeof windowControlInputSchema>
export type WindowControlRequest = z.output<typeof windowControlInputSchema>

/* -------------------------------------------------------------------------- */
/* P2：编辑器保存与搜索替换                                                    */
/* -------------------------------------------------------------------------- */

export type FileEol = 'lf' | 'crlf'

export interface FsFileVersion {
  /** LF 归一化后的文本，便于直接写入 Monaco 缓冲区 */
  content: string
  contentHash: string
  eol: FileEol
  size: number
}

export const fsWriteFileInputSchema = z.object({
  relativePath: relativePathSchema,
  content: z.string().max(FS_LIMITS.maxFileBytes * 2),
  expectedHash: z.string().max(128).optional(),
  force: z.boolean().optional().default(false),
  eol: z.enum(['lf', 'crlf']).optional(),
  /** 「另存」目标路径；提供时写入新文件，不修改原文件 */
  targetPath: relativePathSchema.optional(),
  createIfMissing: z.boolean().optional().default(false)
})

export type FsWriteFileInput = z.input<typeof fsWriteFileInputSchema>
export type FsWriteFileRequest = z.output<typeof fsWriteFileInputSchema>

export type FsWriteFileResult =
  | { status: 'saved'; relativePath: string; version: FsFileVersion }
  | { status: 'conflict'; relativePath: string; disk: FsFileVersion }

export const searchQuerySchema = z.object({
  query: z.string().min(1).max(SEARCH_LIMITS.maxQueryLength),
  replaceText: z.string().max(SEARCH_LIMITS.maxReplacementLength).optional().default(''),
  caseSensitive: z.boolean().optional().default(false),
  wholeWord: z.boolean().optional().default(false),
  useRegex: z.boolean().optional().default(false),
  preserveCase: z.boolean().optional().default(false),
  include: z.string().max(SEARCH_LIMITS.maxPatternLength).optional().default(''),
  exclude: z.string().max(SEARCH_LIMITS.maxPatternLength).optional().default(''),
  includeIgnored: z.boolean().optional().default(false),
  onlyOpenEditors: z.boolean().optional().default(false),
  openFiles: z.array(relativePathSchema).max(100).optional().default([]),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMITS.maxResults)
    .optional()
    .default(SEARCH_LIMITS.maxResults)
})

export type SearchStartInput = z.input<typeof searchQuerySchema>
export type SearchQuery = z.output<typeof searchQuerySchema>

export const searchMatchSchema = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
  endColumn: z.number().int().min(1),
  lineText: z.string(),
  matchText: z.string(),
  replaceText: z.string()
})

export type SearchMatch = z.infer<typeof searchMatchSchema>

export const searchFileResultSchema = z.object({
  relativePath: z.string(),
  contentHash: z.string(),
  matches: z.array(searchMatchSchema)
})

export type SearchFileResult = z.infer<typeof searchFileResultSchema>

export type SearchEngine = 'ripgrep' | 'builtin'

export const searchEventSchema = z.object({
  searchId: z.string(),
  seq: z.number().int().nonnegative(),
  kind: z.enum(['file', 'done', 'error', 'cancelled']),
  engine: z.enum(['ripgrep', 'builtin']),
  file: searchFileResultSchema.optional(),
  totalMatches: z.number().int().nonnegative().optional(),
  totalFiles: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  message: z.string().optional()
})

export type SearchEvent = z.infer<typeof searchEventSchema>

export interface SearchStartResult {
  searchId: string
  engine: SearchEngine
}

export const searchCancelInputSchema = z.object({
  searchId: z.string().min(1).max(64)
})

export type SearchCancelInput = z.input<typeof searchCancelInputSchema>
export type SearchCancelRequest = z.output<typeof searchCancelInputSchema>
export type SearchCancelResult = { cancelled: boolean }

export const searchReplaceTargetSchema = z.object({
  relativePath: relativePathSchema,
  hash: z.string().max(128),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional()
})

export type SearchReplaceTarget = z.infer<typeof searchReplaceTargetSchema>

export const searchReplaceInputSchema = z.object({
  query: searchQuerySchema,
  scope: z.enum(['single', 'file', 'all']),
  apply: z.boolean().optional().default(false),
  target: searchReplaceTargetSchema.optional(),
  files: z
    .array(searchReplaceTargetSchema)
    .max(SEARCH_LIMITS.maxReplaceFiles)
    .optional()
    .default([])
})

export type SearchReplaceInput = z.input<typeof searchReplaceInputSchema>
export type SearchReplaceRequest = z.output<typeof searchReplaceInputSchema>

export interface ReplacePreviewLine {
  line: number
  before: string
  after: string
}

export interface ReplaceFileResult {
  relativePath: string
  status: 'ok' | 'conflict' | 'skipped'
  replaced: number
  previews: ReplacePreviewLine[]
  contentHash?: string
}

export interface SearchReplaceResult {
  files: ReplaceFileResult[]
  totalReplaced: number
  conflicts: string[]
  applied: boolean
}

/* -------------------------------------------------------------------------- */
/* P3：审计查询与源代码管理                                                    */
/* -------------------------------------------------------------------------- */

export const auditFilterSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  tool: z.string().min(1).max(64).optional(),
  ok: z.boolean().optional(),
  approval: z.enum(['not_required', 'approved', 'denied']).optional(),
  keyword: z.string().max(AUDIT_LIMITS.maxKeywordLength).optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional()
})

export type AuditFilterInput = z.input<typeof auditFilterSchema>
export type AuditFilterRequest = z.output<typeof auditFilterSchema>

export const auditQueryInputSchema = auditFilterSchema.extend({
  page: z.number().int().min(1).optional().default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(AUDIT_LIMITS.maxPageSize)
    .optional()
    .default(AUDIT_LIMITS.defaultPageSize)
})

export type AuditQueryInput = z.input<typeof auditQueryInputSchema>
export type AuditQueryRequest = z.output<typeof auditQueryInputSchema>
export type AuditQueryResult = AuditPage
export type AuditStatsResult = AuditStats

export const auditExportInputSchema = auditFilterSchema.extend({
  format: z.enum(['json', 'csv'])
})

export type AuditExportInput = z.input<typeof auditExportInputSchema>
export type AuditExportRequest = z.output<typeof auditExportInputSchema>
export type AuditExportResponse = AuditExportResult

export const gitDiffInputSchema = z.object({
  relativePath: relativePathSchema,
  /** true：对比 HEAD 与索引区；false：对比索引区与工作区 */
  staged: z.boolean().optional().default(false)
})

export type GitDiffInput = z.input<typeof gitDiffInputSchema>
export type GitDiffRequest = z.output<typeof gitDiffInputSchema>

export const gitPathsInputSchema = z.object({
  paths: z.array(relativePathSchema).min(1).max(GIT_LIMITS.maxPathsPerRequest)
})

export type GitPathsInput = z.input<typeof gitPathsInputSchema>
export type GitPathsRequest = z.output<typeof gitPathsInputSchema>

export const gitCommitInputSchema = z.object({
  message: z.string().min(1).max(GIT_LIMITS.maxMessageLength),
  /** true：先暂存全部变更（含未跟踪）再提交 */
  all: z.boolean().optional().default(false)
})

export type GitCommitInput = z.input<typeof gitCommitInputSchema>
export type GitCommitRequest = z.output<typeof gitCommitInputSchema>

export const gitCheckoutInputSchema = z.object({
  branch: z.string().min(1).max(GIT_LIMITS.maxBranchLength),
  create: z.boolean().optional().default(false)
})

export type GitCheckoutInput = z.input<typeof gitCheckoutInputSchema>
export type GitCheckoutRequest = z.output<typeof gitCheckoutInputSchema>

/* -------------------------------------------------------------------------- */
/* P4：运行任务、Node 调试、扩展管理器                                         */
/* -------------------------------------------------------------------------- */

const taskIdSchema = z.string().min(1).max(400)

export const taskStartInputSchema = z.object({
  taskId: taskIdSchema,
  /** 已确认过完整命令的自定义任务无需再次确认；未确认时由渲染层弹窗 */
  confirmed: z.boolean().optional().default(false)
})

export type TaskStartInput = z.input<typeof taskStartInputSchema>
export type TaskStartRequest = z.output<typeof taskStartInputSchema>
export type TaskStartResult = TaskRun
export type TaskListResult = TaskDiscovery
export type TaskStopResult = { stopped: boolean; runId: string }

export const taskStopInputSchema = z.object({
  runId: z.string().min(1).max(64)
})

export type TaskStopInput = z.input<typeof taskStopInputSchema>
export type TaskStopRequest = z.output<typeof taskStopInputSchema>

const breakpointSchema = z.object({
  id: z.string().min(1).max(120),
  relativePath: relativePathSchema,
  line: z.number().int().min(1).max(1_000_000),
  enabled: z.boolean().optional().default(true),
  condition: z.string().max(DEBUG_LIMITS.maxConditionLength).optional()
})

export type DebugBreakpointInput = z.input<typeof breakpointSchema>
export type DebugBreakpointRequest = z.output<typeof breakpointSchema>

export const debugStartInputSchema = z.object({
  configId: z.string().min(1).max(200),
  /** 当前活动文件相对路径，用于 `${file}` 变量 */
  activeFile: relativePathSchema.optional(),
  breakpoints: z.array(breakpointSchema).max(DEBUG_LIMITS.maxBreakpoints).optional().default([])
})

export type DebugStartInput = z.input<typeof debugStartInputSchema>
export type DebugStartRequest = z.output<typeof debugStartInputSchema>
export type DebugStartResult = { session: DebugSession; commandLine: string }

export const debugBreakpointsInputSchema = z.object({
  breakpoints: z.array(breakpointSchema).max(DEBUG_LIMITS.maxBreakpoints)
})

export type DebugBreakpointsInput = z.input<typeof debugBreakpointsInputSchema>
export type DebugBreakpointsRequest = z.output<typeof debugBreakpointsInputSchema>
export type DebugBreakpointsResult = DebugBreakpoint[]

export const debugCommandInputSchema = z.object({
  command: z.enum(['continue', 'pause', 'stepOver', 'stepInto', 'stepOut', 'restart'])
})

export type DebugCommandInput = z.input<typeof debugCommandInputSchema>
export type DebugCommandRequest = z.output<typeof debugCommandInputSchema>

export const debugFrameInputSchema = z.object({
  frameId: z.string().min(1).max(200)
})

export type DebugFrameInput = z.input<typeof debugFrameInputSchema>
export type DebugFrameRequest = z.output<typeof debugFrameInputSchema>
export type DebugScopesResult = DebugScope[]

export const debugVariablesInputSchema = z.object({
  variablesReference: z.string().min(1).max(200)
})

export type DebugVariablesInput = z.input<typeof debugVariablesInputSchema>
export type DebugVariablesRequest = z.output<typeof debugVariablesInputSchema>
export type DebugVariablesResult = DebugVariable[]

export const debugEvaluateInputSchema = z.object({
  expression: z.string().min(1).max(DEBUG_LIMITS.maxExpressionLength),
  frameId: z.string().min(1).max(200).optional()
})

export type DebugEvaluateInput = z.input<typeof debugEvaluateInputSchema>
export type DebugEvaluateRequest = z.output<typeof debugEvaluateInputSchema>
export type DebugEvaluateResult = DebugEvaluation

export const extensionsInstallLocalInputSchema = z.object({
  /** 绝对路径；为空时由主进程弹出目录选择框 */
  directory: z
    .string()
    .max(FS_LIMITS.maxRelativePathLength * 4)
    .optional()
})

export type ExtensionsInstallLocalInput = z.input<typeof extensionsInstallLocalInputSchema>
export type ExtensionsInstallLocalRequest = z.output<typeof extensionsInstallLocalInputSchema>

export const extensionsInstallVsixInputSchema = z.object({
  /** 绝对路径；为空时由主进程弹出文件选择框 */
  filePath: z
    .string()
    .max(FS_LIMITS.maxRelativePathLength * 4)
    .optional()
})

export type ExtensionsInstallVsixInput = z.input<typeof extensionsInstallVsixInputSchema>
export type ExtensionsInstallVsixRequest = z.output<typeof extensionsInstallVsixInputSchema>

export const extensionsScanInputSchema = z.object({
  /** 默认为 %USERPROFILE%/.vscode/extensions */
  directory: z
    .string()
    .max(FS_LIMITS.maxRelativePathLength * 4)
    .optional()
})

export type ExtensionsScanInput = z.input<typeof extensionsScanInputSchema>
export type ExtensionsScanRequest = z.output<typeof extensionsScanInputSchema>

export const extensionsImportInputSchema = z.object({
  /** 候选 id（VS Code 扩展目录名或 publisher.name） */
  id: z.string().min(1).max(200),
  directory: z
    .string()
    .max(FS_LIMITS.maxRelativePathLength * 4)
    .optional()
})

export type ExtensionsImportInput = z.input<typeof extensionsImportInputSchema>
export type ExtensionsImportRequest = z.output<typeof extensionsImportInputSchema>

export const extensionsSetEnabledInputSchema = z.object({
  id: z.string().min(1).max(200),
  enabled: z.boolean()
})

export type ExtensionsSetEnabledInput = z.input<typeof extensionsSetEnabledInputSchema>
export type ExtensionsSetEnabledRequest = z.output<typeof extensionsSetEnabledInputSchema>

export const extensionsIdInputSchema = z.object({
  id: z.string().min(1).max(200)
})

export type ExtensionsIdInput = z.input<typeof extensionsIdInputSchema>
export type ExtensionsIdRequest = z.output<typeof extensionsIdInputSchema>
export type ExtensionListResult = ExtensionInfo[]
export type ExtensionInstallResponse = ExtensionInstallResult
export type VscodeScanResponse = VscodeScanResult
export type ExtensionContributionsResult = ExtensionContributionBundle
