import type { AgentEvent } from './agent'
import type { ApprovalRequest } from './approval'
import type { AuditEntry } from './audit'
import type {
  ApprovalRespondInput,
  ApprovalRespondResult,
  AuditListInput,
  ChatCancelInput,
  ChatCancelResult,
  ChatSendInput,
  ChatSendResult,
  FsReadFileInput,
  FsReadFileResult,
  FsTreeInput,
  FsTreeNode,
  IpcResult,
  SessionCreateInput,
  SessionDeleteResult,
  SessionExportResult,
  SessionIdInput,
  SessionListInput,
  SessionListResult,
  SessionMessagesResult,
  SessionRenameInput,
  SessionPinInput,
  SessionArchiveInput,
  SessionMoveInput,
  ProjectRenameInput,
  ProjectListResult,
  ProviderDeleteInput,
  ProviderSaveInput,
  SettingsResult,
  SettingsSetActiveInput,
  SettingsSetApprovalModeInput,
  WindowControlInput,
  WorkspaceInfo,
  WorkspaceOpenProjectInput
} from './ipc'
import type { ProjectSummary, SessionSummary } from './session'

export interface YocimVersions {
  electron: string
  node: string
  chrome: string
}

export interface YocimWorkspaceApi {
  select(): Promise<IpcResult<WorkspaceInfo | null>>
  current(): Promise<IpcResult<WorkspaceInfo | null>>
  openProject(input: WorkspaceOpenProjectInput): Promise<IpcResult<WorkspaceInfo>>
  tree(input: FsTreeInput): Promise<IpcResult<FsTreeNode[]>>
  readFile(input: FsReadFileInput): Promise<IpcResult<FsReadFileResult>>
}

export interface YocimChatApi {
  send(input: ChatSendInput): Promise<IpcResult<ChatSendResult>>
  cancel(input: ChatCancelInput): Promise<IpcResult<ChatCancelResult>>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export interface YocimApprovalApi {
  respond(input: ApprovalRespondInput): Promise<IpcResult<ApprovalRespondResult>>
  onRequest(listener: (request: ApprovalRequest) => void): () => void
}

export interface YocimAuditApi {
  list(input: AuditListInput): Promise<IpcResult<AuditEntry[]>>
}

export interface YocimSessionApi {
  list(input: SessionListInput): Promise<IpcResult<SessionListResult>>
  create(input: SessionCreateInput): Promise<IpcResult<SessionSummary>>
  rename(input: SessionRenameInput): Promise<IpcResult<SessionSummary>>
  remove(input: SessionIdInput): Promise<IpcResult<SessionDeleteResult>>
  messages(input: SessionIdInput): Promise<IpcResult<SessionMessagesResult>>
  exportToFile(input: SessionIdInput): Promise<IpcResult<SessionExportResult>>
  pin(input: SessionPinInput): Promise<IpcResult<SessionSummary>>
  archive(input: SessionArchiveInput): Promise<IpcResult<SessionSummary>>
  move(input: SessionMoveInput): Promise<IpcResult<SessionSummary>>
}

export interface YocimProjectApi {
  list(): Promise<IpcResult<ProjectListResult>>
  rename(input: ProjectRenameInput): Promise<IpcResult<ProjectSummary>>
}

export interface YocimSettingsApi {
  get(): Promise<IpcResult<SettingsResult>>
  saveProvider(input: ProviderSaveInput): Promise<IpcResult<SettingsResult>>
  removeProvider(input: ProviderDeleteInput): Promise<IpcResult<SettingsResult>>
  setActive(input: SettingsSetActiveInput): Promise<IpcResult<SettingsResult>>
  setApprovalMode(input: SettingsSetApprovalModeInput): Promise<IpcResult<SettingsResult>>
}

export interface YocimWindowApi {
  control(input: WindowControlInput): Promise<IpcResult<null>>
}

export interface YocimApi {
  platform: string
  versions: YocimVersions
  workspace: YocimWorkspaceApi
  chat: YocimChatApi
  approval: YocimApprovalApi
  audit: YocimAuditApi
  sessions: YocimSessionApi
  projects: YocimProjectApi
  settings: YocimSettingsApi
  window: YocimWindowApi
}
