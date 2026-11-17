import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AgentEvent } from '../shared/agent'
import type { ContextUsage } from '../shared/context'
import type { YocimApi } from '../shared/api'
import type { ApprovalRequest } from '../shared/approval'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import type {
  ApprovalRespondInput,
  ApprovalRespondResult,
  AuditExportInput,
  AuditFilterInput,
  AuditListInput,
  AuditQueryInput,
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
  FsTreeNode,
  FsTreeInput,
  FsWriteFileInput,
  FsWriteFileResult,
  GitCheckoutInput,
  GitCommitDetailInput,
  GitCommitInput,
  GitGraphInput,
  GitDiffInput,
  GitPathsInput,
  IpcResult,
  ProjectListResult,
  SearchCancelInput,
  SearchCancelResult,
  SearchEvent,
  SearchReplaceInput,
  SearchReplaceResult,
  SearchStartInput,
  SearchStartResult,
  ProjectIdInput,
  ProjectRemoveResult,
  ProjectRenameInput,
  ProviderDeleteInput,
  ProviderSaveInput,
  SessionArchiveInput,
  SessionCreateInput,
  SessionDeleteResult,
  SessionExportResult,
  SessionIdInput,
  SessionListInput,
  SessionListResult,
  SessionMessagesResult,
  SessionMoveInput,
  SessionPinInput,
  SessionRenameInput,
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
  TaskListResult,
  TaskStartInput,
  TaskStartResult,
  TaskStopInput,
  TaskStopResult,
  TimelineListResult,
  TimelineReadInput,
  TimelineReadResult,
  TimelineRestoreResult,
  UpdateDownloadInput,
  WindowControlInput,
  WorkspaceInfo,
  WorkspaceOpenProjectInput,
  VscodeScanResponse
} from '../shared/ipc'
import type { DebugConfigFile, DebugEvent } from '../shared/debug'
import type {
  RemoteConnectInput,
  RemoteConnectResponse,
  RemoteDisconnectResponse,
  RemoteIdInput,
  RemoteProbeResponse,
  RemoteTargetInputPayload,
  RemoteTargetListResponse
} from '../shared/ipc'
import type { RemoteConnectionState } from '../shared/remote'
import type { TaskEvent } from '../shared/tasks'
import type { UpdateCheckResult, UpdateInfo } from '../shared/update'
import type { ProjectSummary, SessionSummary } from '../shared/session'
import type {
  GitBranches,
  GitCommitDetail,
  GitCommitResult,
  GitDiffResult,
  GitGraph,
  GitLogEntry,
  GitOperationResult,
  GitStatus
} from '../shared/git'
import type { AuditEntry, AuditExportResult, AuditPage, AuditStats } from '../shared/audit'

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>
}

const api: YocimApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    chrome: process.versions.chrome ?? ''
  },
  workspace: {
    select: () => invoke<IpcResult<WorkspaceInfo | null>>(IPC_CHANNELS.workspaceSelect),
    current: () => invoke<IpcResult<WorkspaceInfo | null>>(IPC_CHANNELS.workspaceCurrent),
    openProject: (input: WorkspaceOpenProjectInput) =>
      invoke<IpcResult<WorkspaceInfo>>(IPC_CHANNELS.workspaceOpenProject, input),
    tree: (input: FsTreeInput) => invoke<IpcResult<FsTreeNode[]>>(IPC_CHANNELS.fsTree, input),
    readFile: (input: FsReadFileInput) =>
      invoke<IpcResult<FsReadFileResult>>(IPC_CHANNELS.fsReadFile, input),
    writeFile: (input: FsWriteFileInput) =>
      invoke<IpcResult<FsWriteFileResult>>(IPC_CHANNELS.fsWriteFile, input),
    createFile: (input: FsCreateEntryInput) =>
      invoke<IpcResult<FsTreeNode>>(IPC_CHANNELS.fsCreateFile, input),
    createFolder: (input: FsCreateEntryInput) =>
      invoke<IpcResult<FsTreeNode>>(IPC_CHANNELS.fsCreateFolder, input),
    rename: (input: FsRenameInput) => invoke<IpcResult<FsTreeNode>>(IPC_CHANNELS.fsRename, input),
    copy: (input: FsTransferInput) =>
      invoke<IpcResult<FsTransferResult>>(IPC_CHANNELS.fsCopy, input),
    move: (input: FsTransferInput) =>
      invoke<IpcResult<FsTransferResult>>(IPC_CHANNELS.fsMove, input),
    delete: (input: FsPathInput) => invoke<IpcResult<FsDeleteResult>>(IPC_CHANNELS.fsDelete, input),
    reveal: (input: FsPathInput) => invoke<IpcResult<null>>(IPC_CHANNELS.fsReveal, input),
    clipboard: (input: FsClipboardInput) =>
      invoke<IpcResult<FsClipboardResult>>(IPC_CHANNELS.fsClipboard, input)
  },
  search: {
    start: (input: SearchStartInput) =>
      invoke<IpcResult<SearchStartResult>>(IPC_CHANNELS.searchStart, input),
    cancel: (input: SearchCancelInput) =>
      invoke<IpcResult<SearchCancelResult>>(IPC_CHANNELS.searchCancel, input),
    replace: (input: SearchReplaceInput) =>
      invoke<IpcResult<SearchReplaceResult>>(IPC_CHANNELS.searchReplace, input),
    onEvent: (listener: (event: SearchEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: SearchEvent): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.searchEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.searchEvent, handler)
      }
    }
  },
  chat: {
    send: (input: ChatSendInput) => invoke<IpcResult<ChatSendResult>>(IPC_CHANNELS.chatSend, input),
    cancel: (input: ChatCancelInput) =>
      invoke<IpcResult<ChatCancelResult>>(IPC_CHANNELS.chatCancel, input),
    compress: (input: ChatCompressInput) =>
      invoke<IpcResult<ChatCompressResult>>(IPC_CHANNELS.chatCompress, input),
    contextUsage: (input: SessionIdInput) =>
      invoke<IpcResult<ContextUsage>>(IPC_CHANNELS.chatContextUsage, input),
    getPlan: (input: SessionIdInput) =>
      invoke<IpcResult<ChatPlanResult>>(IPC_CHANNELS.chatGetPlan, input),
    persistSteps: (input: ChatPersistStepsInput) =>
      invoke<IpcResult<ChatPersistStepsResult>>(IPC_CHANNELS.chatPersistSteps, input),
    onEvent: (listener: (event: AgentEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: AgentEvent): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.chatEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.chatEvent, handler)
      }
    }
  },
  approval: {
    respond: (input: ApprovalRespondInput) =>
      invoke<IpcResult<ApprovalRespondResult>>(IPC_CHANNELS.approvalRespond, input),
    onRequest: (listener: (request: ApprovalRequest) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: ApprovalRequest): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.approvalRequest, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.approvalRequest, handler)
      }
    }
  },
  audit: {
    list: (input: AuditListInput) => invoke<IpcResult<AuditEntry[]>>(IPC_CHANNELS.auditList, input),
    query: (input: AuditQueryInput) => invoke<IpcResult<AuditPage>>(IPC_CHANNELS.auditQuery, input),
    stats: (input: AuditFilterInput) =>
      invoke<IpcResult<AuditStats>>(IPC_CHANNELS.auditStats, input),
    export: (input: AuditExportInput) =>
      invoke<IpcResult<AuditExportResult>>(IPC_CHANNELS.auditExport, input)
  },
  git: {
    status: () => invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitStatus),
    diff: (input: GitDiffInput) => invoke<IpcResult<GitDiffResult>>(IPC_CHANNELS.gitDiff, input),
    branches: () => invoke<IpcResult<GitBranches>>(IPC_CHANNELS.gitBranches),
    stage: (input: GitPathsInput) => invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitStage, input),
    unstage: (input: GitPathsInput) => invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitUnstage, input),
    discard: (input: GitPathsInput) => invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitDiscard, input),
    commit: (input: GitCommitInput) =>
      invoke<IpcResult<GitCommitResult>>(IPC_CHANNELS.gitCommit, input),
    pull: () => invoke<IpcResult<GitOperationResult>>(IPC_CHANNELS.gitPull),
    push: () => invoke<IpcResult<GitOperationResult>>(IPC_CHANNELS.gitPush),
    publish: () => invoke<IpcResult<GitOperationResult>>(IPC_CHANNELS.gitPublish),
    checkout: (input: GitCheckoutInput) =>
      invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitCheckout, input),
    init: () => invoke<IpcResult<GitStatus>>(IPC_CHANNELS.gitInit),
    output: () => invoke<IpcResult<GitLogEntry[]>>(IPC_CHANNELS.gitOutput),
    graph: (input: GitGraphInput) => invoke<IpcResult<GitGraph>>(IPC_CHANNELS.gitGraph, input),
    commitDetail: (input: GitCommitDetailInput) =>
      invoke<IpcResult<GitCommitDetail>>(IPC_CHANNELS.gitCommitDetail, input)
  },
  tasks: {
    list: () => invoke<IpcResult<TaskListResult>>(IPC_CHANNELS.tasksList),
    start: (input: TaskStartInput) =>
      invoke<IpcResult<TaskStartResult>>(IPC_CHANNELS.tasksStart, input),
    stop: (input: TaskStopInput) =>
      invoke<IpcResult<TaskStopResult>>(IPC_CHANNELS.tasksStop, input),
    onEvent: (listener: (event: TaskEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: TaskEvent): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.tasksEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.tasksEvent, handler)
      }
    }
  },
  debug: {
    configs: () => invoke<IpcResult<DebugConfigFile>>(IPC_CHANNELS.debugConfigs),
    start: (input: DebugStartInput) =>
      invoke<IpcResult<DebugStartResult>>(IPC_CHANNELS.debugStart, input),
    stop: () => invoke<IpcResult<{ stopped: boolean }>>(IPC_CHANNELS.debugStop),
    setBreakpoints: (input: DebugBreakpointsInput) =>
      invoke<IpcResult<DebugBreakpointsResult>>(IPC_CHANNELS.debugSetBreakpoints, input),
    command: (input: DebugCommandInput) =>
      invoke<IpcResult<{ ok: boolean }>>(IPC_CHANNELS.debugCommand, input),
    scopes: (input: DebugFrameInput) =>
      invoke<IpcResult<DebugScopesResult>>(IPC_CHANNELS.debugScopes, input),
    variables: (input: DebugVariablesInput) =>
      invoke<IpcResult<DebugVariablesResult>>(IPC_CHANNELS.debugVariables, input),
    evaluate: (input: DebugEvaluateInput) =>
      invoke<IpcResult<DebugEvaluateResult>>(IPC_CHANNELS.debugEvaluate, input),
    onEvent: (listener: (event: DebugEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: DebugEvent): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.debugEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.debugEvent, handler)
      }
    }
  },
  remote: {
    probe: () => invoke<IpcResult<RemoteProbeResponse>>(IPC_CHANNELS.remoteProbe),
    list: () => invoke<IpcResult<RemoteTargetListResponse>>(IPC_CHANNELS.remoteList),
    save: (input: RemoteTargetInputPayload) =>
      invoke<IpcResult<RemoteTargetListResponse>>(IPC_CHANNELS.remoteSave, input),
    remove: (input: RemoteIdInput) =>
      invoke<IpcResult<RemoteTargetListResponse>>(IPC_CHANNELS.remoteDelete, input),
    connect: (input: RemoteConnectInput) =>
      invoke<IpcResult<RemoteConnectResponse>>(IPC_CHANNELS.remoteConnect, input),
    disconnect: () => invoke<IpcResult<RemoteDisconnectResponse>>(IPC_CHANNELS.remoteDisconnect),
    current: () => invoke<IpcResult<RemoteConnectionState>>(IPC_CHANNELS.remoteCurrent)
  },
  extensions: {
    list: () => invoke<IpcResult<ExtensionListResult>>(IPC_CHANNELS.extensionsList),
    installLocal: (input: ExtensionsInstallLocalInput) =>
      invoke<IpcResult<ExtensionInstallResponse>>(IPC_CHANNELS.extensionsInstallLocal, input),
    installVsix: (input: ExtensionsInstallVsixInput) =>
      invoke<IpcResult<ExtensionInstallResponse>>(IPC_CHANNELS.extensionsInstallVsix, input),
    scanVscode: (input: ExtensionsScanInput) =>
      invoke<IpcResult<VscodeScanResponse>>(IPC_CHANNELS.extensionsScanVscode, input),
    importVscode: (input: ExtensionsImportInput) =>
      invoke<IpcResult<ExtensionInstallResponse>>(IPC_CHANNELS.extensionsImportVscode, input),
    setEnabled: (input: ExtensionsSetEnabledInput) =>
      invoke<IpcResult<ExtensionListResult>>(IPC_CHANNELS.extensionsSetEnabled, input),
    uninstall: (input: ExtensionsIdInput) =>
      invoke<IpcResult<ExtensionListResult>>(IPC_CHANNELS.extensionsUninstall, input),
    contributions: () =>
      invoke<IpcResult<ExtensionContributionsResult>>(IPC_CHANNELS.extensionsContributions),
    reveal: (input: ExtensionsIdInput) =>
      invoke<IpcResult<null>>(IPC_CHANNELS.extensionsReveal, input)
  },
  sessions: {
    list: (input: SessionListInput) =>
      invoke<IpcResult<SessionListResult>>(IPC_CHANNELS.sessionList, input),
    create: (input: SessionCreateInput) =>
      invoke<IpcResult<SessionSummary>>(IPC_CHANNELS.sessionCreate, input),
    rename: (input: SessionRenameInput) =>
      invoke<IpcResult<SessionSummary>>(IPC_CHANNELS.sessionRename, input),
    remove: (input: SessionIdInput) =>
      invoke<IpcResult<SessionDeleteResult>>(IPC_CHANNELS.sessionDelete, input),
    messages: (input: SessionIdInput) =>
      invoke<IpcResult<SessionMessagesResult>>(IPC_CHANNELS.sessionMessages, input),
    exportToFile: (input: SessionIdInput) =>
      invoke<IpcResult<SessionExportResult>>(IPC_CHANNELS.sessionExport, input),
    pin: (input: SessionPinInput) =>
      invoke<IpcResult<SessionSummary>>(IPC_CHANNELS.sessionPin, input),
    archive: (input: SessionArchiveInput) =>
      invoke<IpcResult<SessionSummary>>(IPC_CHANNELS.sessionArchive, input),
    move: (input: SessionMoveInput) =>
      invoke<IpcResult<SessionSummary>>(IPC_CHANNELS.sessionMove, input)
  },
  projects: {
    list: () => invoke<IpcResult<ProjectListResult>>(IPC_CHANNELS.projectList),
    rename: (input: ProjectRenameInput) =>
      invoke<IpcResult<ProjectSummary>>(IPC_CHANNELS.projectRename, input),
    open: (input: ProjectIdInput) =>
      invoke<IpcResult<WorkspaceInfo>>(IPC_CHANNELS.projectOpen, input),
    remove: (input: ProjectIdInput) =>
      invoke<IpcResult<ProjectRemoveResult>>(IPC_CHANNELS.projectRemove, input)
  },
  settings: {
    get: () => invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsGet),
    saveProvider: (input: ProviderSaveInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSaveProvider, input),
    removeProvider: (input: ProviderDeleteInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsDeleteProvider, input),
    setActive: (input: SettingsSetActiveInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetActive, input),
    setApprovalMode: (input: SettingsSetApprovalModeInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetApprovalMode, input),
    setCommandWhitelist: (input: SettingsSetCommandWhitelistInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetCommandWhitelist, input),
    setContextWindow: (input: SettingsSetContextWindowInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetContextWindow, input),
    setReasoningEffort: (input: SettingsSetReasoningEffortInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetReasoningEffort, input),
    setSearch: (input: SettingsSetSearchInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetSearch, input),
    clearSearchKey: () => invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsClearSearchKey),
    setImage: (input: SettingsSetImageInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetImage, input),
    clearImageKey: () => invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsClearImageKey),
    setPricing: (input: SettingsSetPricingInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetPricing, input),
    setStorage: (input: SettingsSetStorageInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSetStorage, input)
  },
  billing: {
    getBalance: (input: BillingBalanceInput) =>
      invoke<IpcResult<BillingBalanceResult>>(IPC_CHANNELS.billingBalance, input),
    getSummary: (input: BillingSummaryInput) =>
      invoke<IpcResult<BillingSummaryResult>>(IPC_CHANNELS.billingSummary, input)
  },
  storage: {
    info: () => invoke<IpcResult<StorageInfoResult>>(IPC_CHANNELS.storageInfo),
    pick: () => invoke<IpcResult<string | null>>(IPC_CHANNELS.storagePick),
    open: () => invoke<IpcResult<null>>(IPC_CHANNELS.storageOpen)
  },
  window: {
    control: (input: WindowControlInput) =>
      invoke<IpcResult<null>>(IPC_CHANNELS.windowControl, input)
  },
  update: {
    check: () => invoke<IpcResult<UpdateCheckResult>>(IPC_CHANNELS.updateCheck),
    openDownload: (input: UpdateDownloadInput) =>
      invoke<IpcResult<null>>(IPC_CHANNELS.updateOpen, input),
    onAvailable: (listener: (info: UpdateInfo) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: UpdateInfo): void => {
        listener(payload)
      }
      ipcRenderer.on(IPC_CHANNELS.updateAvailable, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.updateAvailable, handler)
      }
    }
  },
  clipboard: {
    writeText: (input: ClipboardWriteTextInput) =>
      invoke<IpcResult<null>>(IPC_CHANNELS.clipboardWriteText, input)
  },
  timeline: {
    list: (input: FsPathInput) =>
      invoke<IpcResult<TimelineListResult>>(IPC_CHANNELS.timelineList, input),
    read: (input: TimelineReadInput) =>
      invoke<IpcResult<TimelineReadResult>>(IPC_CHANNELS.timelineRead, input),
    restore: (input: TimelineReadInput) =>
      invoke<IpcResult<TimelineRestoreResult>>(IPC_CHANNELS.timelineRestore, input)
  }
}

contextBridge.exposeInMainWorld('yocim', api)
