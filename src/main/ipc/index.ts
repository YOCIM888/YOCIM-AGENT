import { BrowserWindow, ipcMain, safeStorage } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '../../shared/agent'
import type { ApprovalRequest } from '../../shared/approval'
import { AppError } from '../../shared/errors'
import {
  approvalRespondInputSchema,
  auditListInputSchema,
  chatCancelInputSchema,
  chatSendInputSchema,
  fsReadFileInputSchema,
  fsTreeInputSchema,
  IPC_CHANNELS,
  projectRenameInputSchema,
  providerDeleteInputSchema,
  providerSaveInputSchema,
  sessionArchiveInputSchema,
  sessionCreateInputSchema,
  sessionIdInputSchema,
  sessionListInputSchema,
  sessionMoveInputSchema,
  sessionPinInputSchema,
  sessionRenameInputSchema,
  settingsSetActiveInputSchema,
  settingsSetApprovalModeInputSchema,
  windowControlInputSchema,
  workspaceOpenProjectInputSchema,
  type ApprovalRespondRequest,
  type ApprovalRespondResult,
  type AuditListRequest,
  type AuditListResult,
  type ChatCancelRequest,
  type ChatCancelResult,
  type ChatSendRequest,
  type ChatSendResult,
  type FsReadFileRequest,
  type FsReadFileResult,
  type FsTreeNode,
  type FsTreeRequest,
  type IpcResult,
  type ProjectListResult,
  type ProjectRenameRequest,
  type ProviderDeleteRequest,
  type ProviderSaveRequest,
  type SessionArchiveRequest,
  type SessionCreateRequest,
  type SessionDeleteResult,
  type SessionExportResult,
  type SessionIdRequest,
  type SessionListRequest,
  type SessionListResult,
  type SessionMessagesResult,
  type SessionMoveRequest,
  type SessionPinRequest,
  type SessionRenameRequest,
  type SettingsResult,
  type SettingsSetActiveRequest,
  type SettingsSetApprovalModeRequest,
  type WindowControlRequest,
  type WorkspaceInfo,
  type WorkspaceOpenProjectRequest
} from '../../shared/ipc'
import type { ProjectSummary } from '../../shared/session'
import { AgentService } from '../agent/agentService'
import { ApprovalManager } from '../approval/approvalManager'
import { AuditStore } from '../audit/auditStore'
import {
  AuditRepository,
  MessageRepository,
  ProjectRepository,
  SessionRepository,
  SettingsRepository,
  ToolCallRepository
} from '../db/repositories'
import { SessionService } from '../sessions/sessionService'
import { SettingsService, type SettingsCrypto } from '../settings/settingsService'
import { ToolService } from '../tools/toolService'
import { readWorkspaceFile, readWorkspaceTree } from '../workspace/workspaceFs'
import { workspaceService } from '../workspace/workspaceService'
import { runIpcHandler, type InputSchema } from './runIpcHandler'

function broadcastAgentEvent(event: AgentEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.chatEvent, event)
    }
  }
}

function broadcastApprovalRequest(request: ApprovalRequest): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.approvalRequest, request)
    }
  }
}

function createSettingsCrypto(): SettingsCrypto | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return {
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame) return false

  const url = frame.url
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return url.startsWith(devUrl)
  return url.startsWith('file://') && /\/out\/renderer\//.test(url)
}

function handleIpc<TInput, TOutput>(
  channel: string,
  schema: InputSchema<TInput> | null,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>
): void {
  ipcMain.handle(
    channel,
    (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<TOutput>> => {
      if (!isTrustedSender(event)) {
        const forbidden: IpcResult<TOutput> = {
          ok: false,
          error: { code: 'E_FORBIDDEN', message: '非法调用来源' }
        }
        return Promise.resolve(forbidden)
      }
      return runIpcHandler(schema, (input) => handler(input, event), raw)
    }
  )
}

export function registerIpcHandlers(db: DatabaseSync): void {
  const sessionRepo = new SessionRepository(db)
  const messageRepo = new MessageRepository(db)
  const projectRepo = new ProjectRepository(db)
  const toolCallRepo = new ToolCallRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const auditRepo = new AuditRepository(db)

  const auditStore = new AuditStore({ repo: auditRepo })
  const approvalManager = new ApprovalManager(broadcastApprovalRequest)
  const settingsService = new SettingsService(settingsRepo, createSettingsCrypto())
  const toolService = new ToolService({
    approvals: approvalManager,
    audit: auditStore,
    toolCalls: toolCallRepo,
    requireGuard: () => workspaceService.requireGuard(),
    getApprovalMode: () => settingsService.getApprovalMode()
  })
  const sessionService = new SessionService({
    sessions: sessionRepo,
    projects: projectRepo,
    messages: messageRepo,
    getWorkspaceRoot: () => workspaceService.current()?.root ?? null
  })
  sessionService.ensureProjectForCurrentWorkspace()

  const agentService = new AgentService({
    resolveProvider: () => settingsService.createProvider(),
    emit: broadcastAgentEvent,
    toolDefinitions: toolService.getDefinitions(),
    toolExecutor: (call, context) => toolService.execute(call, context),
    persist: { sessions: sessionRepo, messages: messageRepo }
  })

  handleIpc<undefined, WorkspaceInfo | null>(IPC_CHANNELS.workspaceSelect, null, async () => {
    const info = await workspaceService.select()
    if (info) sessionService.ensureProjectForCurrentWorkspace()
    return info
  })

  handleIpc<undefined, WorkspaceInfo | null>(IPC_CHANNELS.workspaceCurrent, null, async () =>
    workspaceService.current()
  )

  handleIpc<WorkspaceOpenProjectRequest, WorkspaceInfo>(
    IPC_CHANNELS.workspaceOpenProject,
    workspaceOpenProjectInputSchema,
    async (input) => {
      const project = projectRepo.get(input.projectId)
      if (!project) throw new AppError('E_NOT_FOUND', '项目不存在')
      return workspaceService.openRoot(project.root)
    }
  )

  handleIpc<FsTreeRequest, FsTreeNode[]>(IPC_CHANNELS.fsTree, fsTreeInputSchema, (input) =>
    readWorkspaceTree(workspaceService.requireGuard(), input)
  )

  handleIpc<FsReadFileRequest, FsReadFileResult>(
    IPC_CHANNELS.fsReadFile,
    fsReadFileInputSchema,
    (input) => readWorkspaceFile(workspaceService.requireGuard(), input)
  )

  handleIpc<ChatSendRequest, ChatSendResult>(
    IPC_CHANNELS.chatSend,
    chatSendInputSchema,
    async (input) => agentService.start(input)
  )

  handleIpc<ChatCancelRequest, ChatCancelResult>(
    IPC_CHANNELS.chatCancel,
    chatCancelInputSchema,
    async (input) => ({ cancelled: agentService.cancel(input.runId) })
  )

  handleIpc<ApprovalRespondRequest, ApprovalRespondResult>(
    IPC_CHANNELS.approvalRespond,
    approvalRespondInputSchema,
    async (input) => ({
      accepted: approvalManager.respond(input.approvalId, input.decision)
    })
  )

  handleIpc<AuditListRequest, AuditListResult>(
    IPC_CHANNELS.auditList,
    auditListInputSchema,
    async (input) => auditStore.list({ sessionId: input.sessionId, limit: input.limit })
  )

  handleIpc<SessionListRequest, SessionListResult>(
    IPC_CHANNELS.sessionList,
    sessionListInputSchema,
    async (input) => sessionService.list(input)
  )

  handleIpc<SessionCreateRequest, SessionListResult[number]>(
    IPC_CHANNELS.sessionCreate,
    sessionCreateInputSchema,
    async (input) => sessionService.create(input)
  )

  handleIpc<SessionRenameRequest, SessionListResult[number]>(
    IPC_CHANNELS.sessionRename,
    sessionRenameInputSchema,
    async (input) => sessionService.rename(input)
  )

  handleIpc<SessionIdRequest, SessionDeleteResult>(
    IPC_CHANNELS.sessionDelete,
    sessionIdInputSchema,
    async (input) => ({ deleted: sessionService.remove(input.sessionId) })
  )

  handleIpc<SessionIdRequest, SessionMessagesResult>(
    IPC_CHANNELS.sessionMessages,
    sessionIdInputSchema,
    async (input) => sessionService.messages(input.sessionId)
  )

  handleIpc<SessionIdRequest, SessionExportResult>(
    IPC_CHANNELS.sessionExport,
    sessionIdInputSchema,
    (input) => sessionService.exportToFile(input.sessionId)
  )

  handleIpc<SessionPinRequest, SessionListResult[number]>(
    IPC_CHANNELS.sessionPin,
    sessionPinInputSchema,
    async (input) => sessionService.pin(input)
  )

  handleIpc<SessionArchiveRequest, SessionListResult[number]>(
    IPC_CHANNELS.sessionArchive,
    sessionArchiveInputSchema,
    async (input) => sessionService.archive(input)
  )

  handleIpc<SessionMoveRequest, SessionListResult[number]>(
    IPC_CHANNELS.sessionMove,
    sessionMoveInputSchema,
    async (input) => sessionService.move(input)
  )

  handleIpc<undefined, ProjectListResult>(IPC_CHANNELS.projectList, null, async () =>
    sessionService.listProjects()
  )

  handleIpc<ProjectRenameRequest, ProjectSummary>(
    IPC_CHANNELS.projectRename,
    projectRenameInputSchema,
    async (input) => sessionService.renameProject(input)
  )

  handleIpc<undefined, SettingsResult>(IPC_CHANNELS.settingsGet, null, async () =>
    settingsService.getPublic()
  )

  handleIpc<ProviderSaveRequest, SettingsResult>(
    IPC_CHANNELS.settingsSaveProvider,
    providerSaveInputSchema,
    async (input) => settingsService.saveProvider(input)
  )

  handleIpc<ProviderDeleteRequest, SettingsResult>(
    IPC_CHANNELS.settingsDeleteProvider,
    providerDeleteInputSchema,
    async (input) => settingsService.deleteProvider(input)
  )

  handleIpc<SettingsSetActiveRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetActive,
    settingsSetActiveInputSchema,
    async (input) => settingsService.setActive(input)
  )

  handleIpc<SettingsSetApprovalModeRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetApprovalMode,
    settingsSetApprovalModeInputSchema,
    async (input) => settingsService.setApprovalMode(input)
  )

  handleIpc<WindowControlRequest, null>(
    IPC_CHANNELS.windowControl,
    windowControlInputSchema,
    async (input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new AppError('E_NOT_FOUND', '窗口不存在')
      if (input.action === 'minimize') {
        window.minimize()
      } else if (input.action === 'maximize') {
        if (window.isMaximized()) {
          window.unmaximize()
        } else {
          window.maximize()
        }
      } else {
        window.close()
      }
      return null
    }
  )
}
