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
  ClipboardWriteTextInput,
  FsClipboardInput,
  FsClipboardResult,
  FsCreateEntryInput,
  FsDeleteResult,
  FsPathInput,
  FsReadFileInput,
  FsReadFileResult,
  FsRenameInput,
  FsTransferInput,
  FsTransferResult,
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
  TimelineListResult,
  TimelineReadInput,
  TimelineReadResult,
  TimelineRestoreResult,
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
  createFile(input: FsCreateEntryInput): Promise<IpcResult<FsTreeNode>>
  createFolder(input: FsCreateEntryInput): Promise<IpcResult<FsTreeNode>>
  rename(input: FsRenameInput): Promise<IpcResult<FsTreeNode>>
  copy(input: FsTransferInput): Promise<IpcResult<FsTransferResult>>
  move(input: FsTransferInput): Promise<IpcResult<FsTransferResult>>
  delete(input: FsPathInput): Promise<IpcResult<FsDeleteResult>>
  reveal(input: FsPathInput): Promise<IpcResult<null>>
  clipboard(input: FsClipboardInput): Promise<IpcResult<FsClipboardResult>>
}

export interface YocimClipboardApi {
  writeText(input: ClipboardWriteTextInput): Promise<IpcResult<null>>
}

export interface YocimTimelineApi {
  list(input: FsPathInput): Promise<IpcResult<TimelineListResult>>
  read(input: TimelineReadInput): Promise<IpcResult<TimelineReadResult>>
  restore(input: TimelineReadInput): Promise<IpcResult<TimelineRestoreResult>>
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
  clipboard: YocimClipboardApi
  timeline: YocimTimelineApi
}
