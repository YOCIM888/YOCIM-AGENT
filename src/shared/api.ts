import type { AgentEvent } from './agent'
import type { ApprovalRequest } from './approval'
import type { AuditEntry, AuditExportResult, AuditPage, AuditStats } from './audit'
import type {
  AuditExportInput,
  AuditFilterInput,
  AuditListInput,
  AuditQueryInput,
  ApprovalRespondInput,
  ApprovalRespondResult,
  ChatCancelInput,
  ChatCancelResult,
  ChatCompressInput,
  ChatCompressResult,
  ChatPersistStepsInput,
  ChatPersistStepsResult,
  ChatPlanResult,
  ChatSendInput,
  ChatSendResult,
  ClipboardWriteTextInput,
  DebugBreakpointsInput,
  DebugBreakpointsResult,
  DebugCommandInput,
  DebugEvaluateInput,
  DebugEvaluateResult,
  DebugFrameInput,
  DebugScopesResult,
  DebugStartInput,
  DebugStartResult,
  DebugVariablesInput,
  DebugVariablesResult,
  ExtensionContributionsResult,
  ExtensionInstallResponse,
  ExtensionListResult,
  ExtensionsIdInput,
  ExtensionsImportInput,
  ExtensionsInstallLocalInput,
  ExtensionsInstallVsixInput,
  ExtensionsScanInput,
  ExtensionsSetEnabledInput,
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
  FsWriteFileInput,
  FsWriteFileResult,
  GitCheckoutInput,
  GitCommitDetailInput,
  GitCommitInput,
  GitGraphInput,
  GitDiffInput,
  GitPathsInput,
  IpcResult,
  SearchCancelInput,
  SearchCancelResult,
  SearchEvent,
  SearchReplaceInput,
  SearchReplaceResult,
  SearchStartInput,
  SearchStartResult,
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
  ProjectIdInput,
  ConventionGenerateResult,
  ConventionRecord,
  ConventionSaveInput,
  ProjectRemoveResult,
  ProjectRenameInput,
  ProjectListResult,
  ProviderDeleteInput,
  ProviderSaveInput,
  SettingsResult,
  SettingsSetActiveInput,
  SettingsSetApprovalModeInput,
  SettingsSetCommandWhitelistInput,
  SettingsSetContextWindowInput,
  SettingsSetImageInput,
  SettingsSetPricingInput,
  SettingsSetReasoningEffortInput,
  SettingsSetSearchInput,
  SettingsSetStorageInput,
  BillingBalanceInput,
  BillingBalanceResult,
  BillingSummaryInput,
  BillingSummaryResult,
  StorageInfoResult,
  TimelineListResult,
  TimelineReadInput,
  TimelineReadResult,
  TimelineRestoreResult,
  TaskListResult,
  TaskStartInput,
  TaskStartResult,
  TaskStopInput,
  TaskStopResult,
  TerminalRunInput,
  VscodeScanResponse,
  UpdateDownloadInput,
  WindowControlInput,
  WorkspaceInfo,
  WorkspaceOpenProjectInput
} from './ipc'
import type { UpdateCheckResult, UpdateInfo } from './update'
import type { ContextUsage } from './context'
import type { DebugConfigFile, DebugEvent } from './debug'
import type {
  RemoteConnectInput,
  RemoteConnectResponse,
  RemoteDisconnectResponse,
  RemoteIdInput,
  RemoteProbeResponse,
  RemoteTargetInputPayload,
  RemoteTargetListResponse
} from './ipc'
import type { RemoteConnectionState } from './remote'
import type { TaskEvent } from './tasks'
import type { TerminalEvent, TerminalRunResult, TerminalState } from './terminal'
import type { ProjectSummary, SessionSummary } from './session'
import type {
  GitBranches,
  GitCommitDetail,
  GitCommitResult,
  GitDiffResult,
  GitGraph,
  GitLogEntry,
  GitOperationResult,
  GitStatus
} from './git'

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
  writeFile(input: FsWriteFileInput): Promise<IpcResult<FsWriteFileResult>>
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

export interface YocimSearchApi {
  start(input: SearchStartInput): Promise<IpcResult<SearchStartResult>>
  cancel(input: SearchCancelInput): Promise<IpcResult<SearchCancelResult>>
  replace(input: SearchReplaceInput): Promise<IpcResult<SearchReplaceResult>>
  onEvent(listener: (event: SearchEvent) => void): () => void
}

export interface YocimChatApi {
  send(input: ChatSendInput): Promise<IpcResult<ChatSendResult>>
  cancel(input: ChatCancelInput): Promise<IpcResult<ChatCancelResult>>
  compress(input: ChatCompressInput): Promise<IpcResult<ChatCompressResult>>
  contextUsage(input: SessionIdInput): Promise<IpcResult<ContextUsage>>
  getPlan(input: SessionIdInput): Promise<IpcResult<ChatPlanResult>>
  persistSteps(input: ChatPersistStepsInput): Promise<IpcResult<ChatPersistStepsResult>>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export interface YocimApprovalApi {
  respond(input: ApprovalRespondInput): Promise<IpcResult<ApprovalRespondResult>>
  onRequest(listener: (request: ApprovalRequest) => void): () => void
}

export interface YocimAuditApi {
  list(input: AuditListInput): Promise<IpcResult<AuditEntry[]>>
  query(input: AuditQueryInput): Promise<IpcResult<AuditPage>>
  stats(input: AuditFilterInput): Promise<IpcResult<AuditStats>>
  export(input: AuditExportInput): Promise<IpcResult<AuditExportResult>>
}

export interface YocimGitApi {
  status(): Promise<IpcResult<GitStatus>>
  diff(input: GitDiffInput): Promise<IpcResult<GitDiffResult>>
  branches(): Promise<IpcResult<GitBranches>>
  stage(input: GitPathsInput): Promise<IpcResult<GitStatus>>
  unstage(input: GitPathsInput): Promise<IpcResult<GitStatus>>
  discard(input: GitPathsInput): Promise<IpcResult<GitStatus>>
  commit(input: GitCommitInput): Promise<IpcResult<GitCommitResult>>
  pull(): Promise<IpcResult<GitOperationResult>>
  push(): Promise<IpcResult<GitOperationResult>>
  publish(): Promise<IpcResult<GitOperationResult>>
  checkout(input: GitCheckoutInput): Promise<IpcResult<GitStatus>>
  init(): Promise<IpcResult<GitStatus>>
  output(): Promise<IpcResult<GitLogEntry[]>>
  graph(input: GitGraphInput): Promise<IpcResult<GitGraph>>
  commitDetail(input: GitCommitDetailInput): Promise<IpcResult<GitCommitDetail>>
}

export interface YocimTasksApi {
  list(): Promise<IpcResult<TaskListResult>>
  start(input: TaskStartInput): Promise<IpcResult<TaskStartResult>>
  stop(input: TaskStopInput): Promise<IpcResult<TaskStopResult>>
  onEvent(listener: (event: TaskEvent) => void): () => void
}

export interface YocimTerminalApi {
  state(): Promise<IpcResult<TerminalState>>
  run(input: TerminalRunInput): Promise<IpcResult<TerminalRunResult>>
  cancel(): Promise<IpcResult<{ stopped: boolean }>>
  onEvent(listener: (event: TerminalEvent) => void): () => void
}

export interface YocimDebugApi {
  configs(): Promise<IpcResult<DebugConfigFile>>
  start(input: DebugStartInput): Promise<IpcResult<DebugStartResult>>
  stop(): Promise<IpcResult<{ stopped: boolean }>>
  setBreakpoints(input: DebugBreakpointsInput): Promise<IpcResult<DebugBreakpointsResult>>
  command(input: DebugCommandInput): Promise<IpcResult<{ ok: boolean }>>
  scopes(input: DebugFrameInput): Promise<IpcResult<DebugScopesResult>>
  variables(input: DebugVariablesInput): Promise<IpcResult<DebugVariablesResult>>
  evaluate(input: DebugEvaluateInput): Promise<IpcResult<DebugEvaluateResult>>
  onEvent(listener: (event: DebugEvent) => void): () => void
}

export interface YocimExtensionsApi {
  list(): Promise<IpcResult<ExtensionListResult>>
  installLocal(input: ExtensionsInstallLocalInput): Promise<IpcResult<ExtensionInstallResponse>>
  installVsix(input: ExtensionsInstallVsixInput): Promise<IpcResult<ExtensionInstallResponse>>
  scanVscode(input: ExtensionsScanInput): Promise<IpcResult<VscodeScanResponse>>
  importVscode(input: ExtensionsImportInput): Promise<IpcResult<ExtensionInstallResponse>>
  setEnabled(input: ExtensionsSetEnabledInput): Promise<IpcResult<ExtensionListResult>>
  uninstall(input: ExtensionsIdInput): Promise<IpcResult<ExtensionListResult>>
  contributions(): Promise<IpcResult<ExtensionContributionsResult>>
  reveal(input: ExtensionsIdInput): Promise<IpcResult<null>>
}

export interface YocimRemoteApi {
  probe(): Promise<IpcResult<RemoteProbeResponse>>
  list(): Promise<IpcResult<RemoteTargetListResponse>>
  save(input: RemoteTargetInputPayload): Promise<IpcResult<RemoteTargetListResponse>>
  remove(input: RemoteIdInput): Promise<IpcResult<RemoteTargetListResponse>>
  connect(input: RemoteConnectInput): Promise<IpcResult<RemoteConnectResponse>>
  disconnect(): Promise<IpcResult<RemoteDisconnectResponse>>
  current(): Promise<IpcResult<RemoteConnectionState>>
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
  /** 在系统文件管理器中打开项目目录，并把工作区切换到该项目 */
  open(input: ProjectIdInput): Promise<IpcResult<WorkspaceInfo>>
  /** 仅从应用内移除项目与会话，不触碰磁盘文件 */
  remove(input: ProjectIdInput): Promise<IpcResult<ProjectRemoveResult>>
}

export interface YocimConventionsApi {
  get(input: ProjectIdInput): Promise<IpcResult<ConventionRecord | null>>
  save(input: ConventionSaveInput): Promise<IpcResult<ConventionRecord>>
  remove(input: ProjectIdInput): Promise<IpcResult<{ removed: boolean }>>
  generate(input: ProjectIdInput): Promise<IpcResult<ConventionGenerateResult>>
  copy(input: ProjectIdInput): Promise<IpcResult<null>>
}

export interface YocimSettingsApi {
  get(): Promise<IpcResult<SettingsResult>>
  saveProvider(input: ProviderSaveInput): Promise<IpcResult<SettingsResult>>
  removeProvider(input: ProviderDeleteInput): Promise<IpcResult<SettingsResult>>
  setActive(input: SettingsSetActiveInput): Promise<IpcResult<SettingsResult>>
  setApprovalMode(input: SettingsSetApprovalModeInput): Promise<IpcResult<SettingsResult>>
  setCommandWhitelist(input: SettingsSetCommandWhitelistInput): Promise<IpcResult<SettingsResult>>
  setContextWindow(input: SettingsSetContextWindowInput): Promise<IpcResult<SettingsResult>>
  setReasoningEffort(input: SettingsSetReasoningEffortInput): Promise<IpcResult<SettingsResult>>
  setSearch(input: SettingsSetSearchInput): Promise<IpcResult<SettingsResult>>
  clearSearchKey(): Promise<IpcResult<SettingsResult>>
  setImage(input: SettingsSetImageInput): Promise<IpcResult<SettingsResult>>
  clearImageKey(): Promise<IpcResult<SettingsResult>>
  setPricing(input: SettingsSetPricingInput): Promise<IpcResult<SettingsResult>>
  setStorage(input: SettingsSetStorageInput): Promise<IpcResult<SettingsResult>>
}

export interface YocimBillingApi {
  getBalance(input: BillingBalanceInput): Promise<IpcResult<BillingBalanceResult>>
  getSummary(input: BillingSummaryInput): Promise<IpcResult<BillingSummaryResult>>
}

export interface YocimStorageApi {
  info(): Promise<IpcResult<StorageInfoResult>>
  pick(): Promise<IpcResult<string | null>>
  open(): Promise<IpcResult<null>>
}

export interface YocimWindowApi {
  control(input: WindowControlInput): Promise<IpcResult<null>>
}

export interface YocimUpdateApi {
  /** 手动/自动检查 GitHub Release；异常收敛在 data.status 里 */
  check(): Promise<IpcResult<UpdateCheckResult>>
  /** 在系统浏览器打开匹配当前平台的安装包页面 */
  openDownload(input: UpdateDownloadInput): Promise<IpcResult<null>>
  /** 启动时发现新版本的推送通知 */
  onAvailable(listener: (info: UpdateInfo) => void): () => void
}

export interface YocimApi {
  platform: string
  versions: YocimVersions
  workspace: YocimWorkspaceApi
  search: YocimSearchApi
  chat: YocimChatApi
  approval: YocimApprovalApi
  audit: YocimAuditApi
  git: YocimGitApi
  tasks: YocimTasksApi
  terminal: YocimTerminalApi
  debug: YocimDebugApi
  extensions: YocimExtensionsApi
  remote: YocimRemoteApi
  sessions: YocimSessionApi
  projects: YocimProjectApi
  conventions: YocimConventionsApi
  settings: YocimSettingsApi
  billing: YocimBillingApi
  storage: YocimStorageApi
  window: YocimWindowApi
  update: YocimUpdateApi
  clipboard: YocimClipboardApi
  timeline: YocimTimelineApi
}
