import { BrowserWindow, clipboard, ipcMain, safeStorage, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '../../shared/agent'
import type { ApprovalRequest } from '../../shared/approval'
import { AppError } from '../../shared/errors'
import {
  approvalRespondInputSchema,
  auditListInputSchema,
  chatCancelInputSchema,
  chatSendInputSchema,
  clipboardWriteTextInputSchema,
  fsClipboardInputSchema,
  fsCreateEntryInputSchema,
  fsPathInputSchema,
  fsReadFileInputSchema,
  fsRenameInputSchema,
  fsTransferInputSchema,
  fsTreeInputSchema,
  fsWriteFileInputSchema,
  IPC_CHANNELS,
  projectRenameInputSchema,
  providerDeleteInputSchema,
  providerSaveInputSchema,
  searchCancelInputSchema,
  searchQuerySchema,
  searchReplaceInputSchema,
  sessionArchiveInputSchema,
  sessionCreateInputSchema,
  sessionIdInputSchema,
  sessionListInputSchema,
  sessionMoveInputSchema,
  sessionPinInputSchema,
  sessionRenameInputSchema,
  settingsSetActiveInputSchema,
  settingsSetApprovalModeInputSchema,
  timelineReadInputSchema,
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
  type ClipboardWriteTextRequest,
  type FsClipboardRequest,
  type FsClipboardResult,
  type FsCreateEntryRequest,
  type FsDeleteResult,
  type FsPathRequest,
  type FsReadFileRequest,
  type FsReadFileResult,
  type FsRenameRequest,
  type FsTransferRequest,
  type FsTransferResult,
  type FsTreeNode,
  type FsTreeRequest,
  type FsWriteFileRequest,
  type FsWriteFileResult,
  type IpcResult,
  type SearchCancelRequest,
  type SearchCancelResult,
  type SearchEvent,
  type SearchQuery,
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
  type SearchReplaceRequest,
  type SearchReplaceResult,
  type SearchStartResult,
  type SessionRenameRequest,
  type SettingsResult,
  type SettingsSetActiveRequest,
  type SettingsSetApprovalModeRequest,
  type TimelineListResult,
  type TimelineReadRequest,
  type TimelineReadResult,
  type TimelineRestoreResult,
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
  FileHistoryRepository,
  MessageRepository,
  ProjectRepository,
  SessionRepository,
  SettingsRepository,
  ToolCallRepository
} from '../db/repositories'
import { SessionService } from '../sessions/sessionService'
import { SettingsService, type SettingsCrypto } from '../settings/settingsService'
import { ToolService } from '../tools/toolService'
import {
  copyWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  renameWorkspaceEntry
} from '../workspace/fileExplorer'
import { fileClipboard } from '../workspace/fileClipboard'
import { SearchService } from '../workspace/searchService'
import { TimelineService } from '../workspace/timelineService'
import { readWorkspaceFile, readWorkspaceTree, writeWorkspaceFile } from '../workspace/workspaceFs'
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

export function registerIpcHandlers(db: DatabaseSync, userData: string): void {
  const sessionRepo = new SessionRepository(db)
  const messageRepo = new MessageRepository(db)
  const projectRepo = new ProjectRepository(db)
  const toolCallRepo = new ToolCallRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const auditRepo = new AuditRepository(db)
  const fileHistoryRepo = new FileHistoryRepository(db)

  const auditStore = new AuditStore({ repo: auditRepo })
  const approvalManager = new ApprovalManager(broadcastApprovalRequest)
  const settingsService = new SettingsService(settingsRepo, createSettingsCrypto())
  const timelineService = new TimelineService({
    history: fileHistoryRepo,
    baseDir: join(userData, 'timeline')
  })
  const searchService = new SearchService({
    getGuard: () => workspaceService.requireGuard(),
    timeline: timelineService
  })
  const trashItem = (absolutePath: string): Promise<void> => shell.trashItem(absolutePath)
  const toolService = new ToolService({
    approvals: approvalManager,
    audit: auditStore,
    toolCalls: toolCallRepo,
    timeline: timelineService,
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
    (input) => readWorkspaceFile(workspaceService.requireGuard(), input, timelineService)
  )

  handleIpc<FsWriteFileRequest, FsWriteFileResult>(
    IPC_CHANNELS.fsWriteFile,
    fsWriteFileInputSchema,
    (input) => writeWorkspaceFile(workspaceService.requireGuard(), input, timelineService)
  )

  handleIpc<FsCreateEntryRequest, FsTreeNode>(
    IPC_CHANNELS.fsCreateFile,
    fsCreateEntryInputSchema,
    (input) => createWorkspaceEntry(workspaceService.requireGuard(), input, 'file')
  )

  handleIpc<FsCreateEntryRequest, FsTreeNode>(
    IPC_CHANNELS.fsCreateFolder,
    fsCreateEntryInputSchema,
    (input) => createWorkspaceEntry(workspaceService.requireGuard(), input, 'directory')
  )

  handleIpc<FsRenameRequest, FsTreeNode>(IPC_CHANNELS.fsRename, fsRenameInputSchema, (input) =>
    renameWorkspaceEntry(workspaceService.requireGuard(), input)
  )

  handleIpc<FsTransferRequest, FsTransferResult>(
    IPC_CHANNELS.fsCopy,
    fsTransferInputSchema,
    (input) => copyWorkspaceEntry(workspaceService.requireGuard(), input)
  )

  handleIpc<FsTransferRequest, FsTransferResult>(
    IPC_CHANNELS.fsMove,
    fsTransferInputSchema,
    async (input) => {
      const guard = workspaceService.requireGuard()
      const result = await moveWorkspaceEntry(guard, input, trashItem)
      const clip = fileClipboard.get()
      if (
        !result.skipped &&
        clip?.mode === 'cut' &&
        clip.workspaceRoot === guard.root &&
        clip.relativePath === input.sourcePath
      ) {
        fileClipboard.clear()
      }
      return result
    }
  )

  handleIpc<FsPathRequest, FsDeleteResult>(
    IPC_CHANNELS.fsDelete,
    fsPathInputSchema,
    async (input) => {
      const guard = workspaceService.requireGuard()
      const result = await deleteWorkspaceEntry(guard, input.relativePath, trashItem)
      const clip = fileClipboard.get()
      if (clip?.workspaceRoot === guard.root && clip.relativePath === input.relativePath) {
        fileClipboard.clear()
      }
      return result
    }
  )

  handleIpc<FsPathRequest, null>(IPC_CHANNELS.fsReveal, fsPathInputSchema, async (input) => {
    const resolved = await workspaceService
      .requireGuard()
      .resolve(input.relativePath, { mustExist: true })
    shell.showItemInFolder(resolved.absolutePath)
    return null
  })

  handleIpc<FsClipboardRequest, FsClipboardResult>(
    IPC_CHANNELS.fsClipboard,
    fsClipboardInputSchema,
    async (input) => {
      if (input.action === 'clear') {
        fileClipboard.clear()
        return null
      }
      const root = workspaceService.current()?.root ?? null
      if (input.action === 'get') {
        const clip = fileClipboard.get()
        return clip && clip.workspaceRoot === root ? fileClipboard.publicState() : null
      }
      const guard = workspaceService.requireGuard()
      const resolved = await guard.resolve(input.relativePath, { mustExist: true })
      fileClipboard.set({
        mode: input.mode,
        relativePath: resolved.relativePath,
        name: resolved.relativePath.split('/').pop() ?? resolved.relativePath,
        workspaceRoot: guard.root,
        ts: Date.now()
      })
      return fileClipboard.publicState()
    }
  )

  handleIpc<ClipboardWriteTextRequest, null>(
    IPC_CHANNELS.clipboardWriteText,
    clipboardWriteTextInputSchema,
    async (input) => {
      clipboard.writeText(input.text)
      return null
    }
  )

  handleIpc<FsPathRequest, TimelineListResult>(
    IPC_CHANNELS.timelineList,
    fsPathInputSchema,
    async (input) => timelineService.list(workspaceService.requireGuard().root, input.relativePath)
  )

  handleIpc<TimelineReadRequest, TimelineReadResult>(
    IPC_CHANNELS.timelineRead,
    timelineReadInputSchema,
    (input) => timelineService.read(input.id)
  )

  handleIpc<TimelineReadRequest, TimelineRestoreResult>(
    IPC_CHANNELS.timelineRestore,
    timelineReadInputSchema,
    (input) => timelineService.restore(input.id, workspaceService.requireGuard())
  )

  handleIpc<SearchQuery, SearchStartResult>(
    IPC_CHANNELS.searchStart,
    searchQuerySchema,
    async (input, event) =>
      searchService.start(input, (payload: SearchEvent) => {
        // 只把流式结果推给发起搜索的窗口
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.searchEvent, payload)
        }
      })
  )

  handleIpc<SearchCancelRequest, SearchCancelResult>(
    IPC_CHANNELS.searchCancel,
    searchCancelInputSchema,
    async (input) => searchService.cancel(input.searchId)
  )

  handleIpc<SearchReplaceRequest, SearchReplaceResult>(
    IPC_CHANNELS.searchReplace,
    searchReplaceInputSchema,
    (input) => searchService.replace(input)
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
