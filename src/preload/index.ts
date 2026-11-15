import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AgentEvent } from '../shared/agent'
import type { YocimApi } from '../shared/api'
import type { ApprovalRequest } from '../shared/approval'
import type { AuditEntry } from '../shared/audit'
import { IPC_CHANNELS } from '../shared/ipcChannels'
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
  FsTreeNode,
  FsTreeInput,
  IpcResult,
  ProjectListResult,
  ProjectRenameInput,
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
  SettingsUpdateInput,
  WindowControlInput,
  WorkspaceInfo,
  WorkspaceOpenProjectInput
} from '../shared/ipc'
import type { ProjectSummary, SessionSummary } from '../shared/session'

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
      invoke<IpcResult<FsReadFileResult>>(IPC_CHANNELS.fsReadFile, input)
  },
  chat: {
    send: (input: ChatSendInput) => invoke<IpcResult<ChatSendResult>>(IPC_CHANNELS.chatSend, input),
    cancel: (input: ChatCancelInput) =>
      invoke<IpcResult<ChatCancelResult>>(IPC_CHANNELS.chatCancel, input),
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
    list: (input: AuditListInput) => invoke<IpcResult<AuditEntry[]>>(IPC_CHANNELS.auditList, input)
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
      invoke<IpcResult<ProjectSummary>>(IPC_CHANNELS.projectRename, input)
  },
  settings: {
    get: () => invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsGet),
    set: (input: SettingsUpdateInput) =>
      invoke<IpcResult<SettingsResult>>(IPC_CHANNELS.settingsSet, input)
  },
  window: {
    control: (input: WindowControlInput) =>
      invoke<IpcResult<null>>(IPC_CHANNELS.windowControl, input)
  }
}

contextBridge.exposeInMainWorld('yocim', api)
