import { z } from 'zod'
import type { IpcErrorCode } from './errors'
import { FS_LIMITS } from './ipcChannels'
import type { AuditEntry } from './audit'
import { PROVIDER_PRESET_IDS } from './providers'
import type { PublicSettings, ProjectSummary, SessionSummary, StoredMessage } from './session'

export type { IpcErrorCode } from './errors'
export { FS_LIMITS, IGNORED_DIRECTORIES, IPC_CHANNELS } from './ipcChannels'

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
  relativePath: z.string().min(1).max(FS_LIMITS.maxRelativePathLength)
})

export type FsReadFileInput = z.input<typeof fsReadFileInputSchema>
export type FsReadFileRequest = z.output<typeof fsReadFileInputSchema>

export const fsReadFileResultSchema = z.object({
  relativePath: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  size: z.number().int().nonnegative()
})

export type FsReadFileResult = z.infer<typeof fsReadFileResultSchema>

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000)
})

export const chatSendInputSchema = z.object({
  sessionId: z.string().min(1).max(64),
  text: z.string().min(1).max(20_000),
  history: z.array(chatHistoryMessageSchema).max(50).optional().default([])
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
