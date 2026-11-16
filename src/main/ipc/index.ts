import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentEvent } from '../../shared/agent'
import type { ContextUsage } from '../../shared/context'
import type { ApprovalRequest } from '../../shared/approval'
import type { AuditExportResult, AuditFilter, AuditPage, AuditStats } from '../../shared/audit'
import type {
  DebugBreakpoint,
  DebugConfigFile,
  DebugEvaluation,
  DebugEvent,
  DebugScope,
  DebugSession,
  DebugVariable
} from '../../shared/debug'
import type {
  ExtensionContributionBundle,
  ExtensionInfo,
  ExtensionInstallResult,
  VscodeScanResult
} from '../../shared/extensions'
import type { TaskDiscovery, TaskEvent, TaskRun } from '../../shared/tasks'
import type { RemoteConnectionState } from '../../shared/remote'
import { AppError } from '../../shared/errors'
import type {
  GitBranches,
  GitCommitDetail,
  GitCommitResult,
  GitDiffResult,
  GitGraph,
  GitLogEntry,
  GitOperationResult,
  GitStatus
} from '../../shared/git'
import {
  approvalRespondInputSchema,
  AUDIT_LIMITS,
  auditExportInputSchema,
  auditFilterSchema,
  auditListInputSchema,
  auditQueryInputSchema,
  billingBalanceInputSchema,
  billingSummaryInputSchema,
  chatCancelInputSchema,
  chatSendInputSchema,
  debugBreakpointsInputSchema,
  debugCommandInputSchema,
  debugEvaluateInputSchema,
  debugFrameInputSchema,
  debugStartInputSchema,
  debugVariablesInputSchema,
  extensionsIdInputSchema,
  extensionsImportInputSchema,
  extensionsInstallLocalInputSchema,
  extensionsInstallVsixInputSchema,
  extensionsScanInputSchema,
  extensionsSetEnabledInputSchema,
  taskStartInputSchema,
  taskStopInputSchema,
  clipboardWriteTextInputSchema,
  fsClipboardInputSchema,
  fsCreateEntryInputSchema,
  fsPathInputSchema,
  fsReadFileInputSchema,
  fsRenameInputSchema,
  fsTransferInputSchema,
  fsTreeInputSchema,
  fsWriteFileInputSchema,
  gitCheckoutInputSchema,
  gitCommitDetailInputSchema,
  gitGraphInputSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitPathsInputSchema,
  IPC_CHANNELS,
  projectIdInputSchema,
  projectRenameInputSchema,
  remoteConnectInputSchema,
  remoteIdInputSchema,
  remoteTargetInputSchema,
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
  settingsSetContextWindowInputSchema,
  settingsSetImageInputSchema,
  settingsSetPricingInputSchema,
  settingsSetReasoningEffortInputSchema,
  settingsSetSearchInputSchema,
  settingsSetStorageInputSchema,
  storagePickInputSchema,
  chatCompressInputSchema,
  timelineReadInputSchema,
  updateDownloadInputSchema,
  windowControlInputSchema,
  workspaceOpenProjectInputSchema,
  type ApprovalRespondRequest,
  type ApprovalRespondResult,
  type AuditExportRequest,
  type AuditFilterRequest,
  type AuditListRequest,
  type AuditQueryRequest,
  type AuditListResult,
  type BillingBalanceRequest,
  type BillingBalanceResult,
  type BillingSummaryRequest,
  type BillingSummaryResult,
  type ChatCancelRequest,
  type ChatCompressInput,
  type ChatCompressResult,
  type ChatPlanResult,
  type SettingsSetContextWindowRequest,
  type SettingsSetImageRequest,
  type SettingsSetPricingRequest,
  type SettingsSetReasoningEffortRequest,
  type SettingsSetSearchRequest,
  type SettingsSetStorageRequest,
  type StorageInfoResult,
  type StoragePickRequest,
  type ChatCancelResult,
  type ChatSendRequest,
  type ChatSendResult,
  type DebugBreakpointsRequest,
  type DebugCommandRequest,
  type DebugEvaluateRequest,
  type DebugFrameRequest,
  type DebugStartRequest,
  type DebugVariablesRequest,
  type ExtensionsIdRequest,
  type ExtensionsImportRequest,
  type ExtensionsInstallLocalRequest,
  type ExtensionsInstallVsixRequest,
  type ExtensionsScanRequest,
  type ExtensionsSetEnabledRequest,
  type TaskStartRequest,
  type TaskStopRequest,
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
  type GitCheckoutRequest,
  type GitCommitDetailRequest,
  type GitGraphRequest,
  type GitCommitRequest,
  type GitDiffRequest,
  type GitPathsRequest,
  type IpcResult,
  type RemoteConnectRequest,
  type RemoteConnectResult as RemoteConnectResultType,
  type RemoteDisconnectResult as RemoteDisconnectResultType,
  type RemoteIdRequest,
  type RemoteProbeResult as RemoteProbeResultType,
  type RemoteTargetListResult as RemoteTargetListResultType,
  type RemoteTargetSaveRequest,
  type SearchCancelRequest,
  type SearchCancelResult,
  type SearchEvent,
  type SearchQuery,
  type ProjectIdRequest,
  type ProjectListResult,
  type ProjectRemoveResult,
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
  type UpdateDownloadRequest,
  type WindowControlRequest,
  type WorkspaceInfo,
  type WorkspaceOpenProjectRequest
} from '../../shared/ipc'
import type { ProjectSummary } from '../../shared/session'
import type { UpdateCheckResult } from '../../shared/update'
import { AgentService } from '../agent/agentService'
import { AllowRuleStore } from '../approval/allowRules'
import { ApprovalManager } from '../approval/approvalManager'
import { auditToCsv, auditToJson } from '../audit/auditExport'
import { AuditStore } from '../audit/auditStore'
import {
  AuditRepository,
  AgentContextRepository,
  AgentPlanRepository,
  ExtensionRepository,
  FileHistoryRepository,
  MessageRepository,
  ProjectRepository,
  SessionRepository,
  SettingsRepository,
  ToolCallRepository,
  UsageRepository
} from '../db/repositories'
import { DebugService } from '../debug/debugService'
import { ExtensionService } from '../extensions/extensionService'
import { TaskService } from '../tasks/taskService'
import { SessionService } from '../sessions/sessionService'
import { GitService } from '../git/gitService'
import { runGit } from '../git/gitRunner'
import { loadProjectCommands } from '../tools/commandPolicy'
import { PlanStore } from '../agent/planStore'
import { SettingsService, type SettingsCrypto } from '../settings/settingsService'
import { BillingService } from '../billing/billingService'
import { StorageService } from '../storage/storageService'
import { currentAppVersion } from '../update/appVersion'
import { checkForUpdate } from '../update/updateService'
import { createSearchServiceRunner } from '../tools/searchTools'
import { createTavilySearchRunner } from '../tools/webSearchTools'
import { createImageGenRunner } from '../tools/imageGenTools'
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
import { RemoteTargetRepository } from '../db/repositories'
import { RemoteService } from '../remote/remoteService'
import { setRemoteExec } from '../remote/execRegistry'
import {
  copyRemoteEntry,
  createRemoteEntry,
  deleteRemoteEntry,
  moveRemoteEntry,
  readRemoteFile,
  readRemoteTree,
  renameRemoteEntry,
  writeRemoteFile
} from '../remote/remoteFs'

import { workspaceService } from '../workspace/workspaceService'
import { normalizeWorkspaceRelativePath } from '../workspace/pathGuard'
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

function broadcastTaskEvent(event: TaskEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.tasksEvent, event)
    }
  }
}

function broadcastDebugEvent(event: DebugEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.debugEvent, event)
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

function auditFilterOf(input: AuditFilterRequest): AuditFilter {
  const keyword = input.keyword?.trim()
  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.tool ? { tool: input.tool } : {}),
    ...(typeof input.ok === 'boolean' ? { ok: input.ok } : {}),
    ...(input.approval ? { approval: input.approval } : {}),
    ...(keyword ? { keyword } : {}),
    ...(typeof input.from === 'number' ? { from: input.from } : {}),
    ...(typeof input.to === 'number' ? { to: input.to } : {})
  }
}

export function registerIpcHandlers(db: DatabaseSync, userData: string, dataDir?: string): void {
  // dataDir 可自定义（设置 → 存储）；缺省等于系统默认目录
  const storageRoot = dataDir ?? userData
  const sessionRepo = new SessionRepository(db)
  const messageRepo = new MessageRepository(db)
  const agentContextRepo = new AgentContextRepository(db)
  const planStore = new PlanStore({
    repo: new AgentPlanRepository(db),
    onChange: (sessionId, plan) => {
      broadcastAgentEvent({
        type: 'plan:updated',
        runId: 'plan',
        seq: 0,
        ts: Date.now(),
        sessionId,
        plan
      })
    }
  })
  const projectRepo = new ProjectRepository(db)
  const toolCallRepo = new ToolCallRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const auditRepo = new AuditRepository(db)
  const allowRules = new AllowRuleStore(settingsRepo)
  const fileHistoryRepo = new FileHistoryRepository(db)
  const extensionRepo = new ExtensionRepository(db)
  const remoteTargetRepo = new RemoteTargetRepository(db)

  const auditStore = new AuditStore({ repo: auditRepo })
  const approvalManager = new ApprovalManager(broadcastApprovalRequest)
  const settingsService = new SettingsService(settingsRepo, createSettingsCrypto())
  const usageRepo = new UsageRepository(db)
  const billingService = new BillingService(usageRepo, settingsService)
  const storageService = new StorageService(userData, storageRoot)
  const timelineService = new TimelineService({
    history: fileHistoryRepo,
    baseDir: join(storageRoot, 'timeline')
  })
  const searchService = new SearchService({
    getGuard: () => workspaceService.accessGuard(),
    timeline: timelineService
  })
  const gitService = new GitService({ getGuard: () => workspaceService.accessGuard() })
  const taskService = new TaskService({
    getRoot: () => workspaceService.current()?.root ?? null,
    emit: broadcastTaskEvent
  })
  const debugService = new DebugService({
    getRoot: () => workspaceService.current()?.root ?? null,
    emit: broadcastDebugEvent
  })
  const extensionService = new ExtensionService({
    repo: extensionRepo,
    userData: storageRoot
  })
  const remoteService = new RemoteService({
    targets: remoteTargetRepo,
    openWorkspace: (info) => workspaceService.openRemote(info),
    restoreWorkspaceRoot: async (root) => {
      if (!root) return null
      return workspaceService.openRoot(root).catch(() => null)
    },
    setRemoteExec: (exec) => setRemoteExec(exec)
  })
  app.once('before-quit', () => {
    taskService.dispose()
    remoteService.dispose()
    void debugService.dispose()
  })
  const trashItem = (absolutePath: string): Promise<void> => shell.trashItem(absolutePath)
  const toolService = new ToolService({
    approvals: approvalManager,
    audit: auditStore,
    toolCalls: toolCallRepo,
    timeline: timelineService,
    requireGuard: () => workspaceService.requireGuard(),
    // 搜索走 accessGuard：SSH 远程工作区没有本地守卫，需要虚拟守卫交给远端 rg
    accessGuard: () => workspaceService.accessGuard(),
    search: createSearchServiceRunner(searchService),
    getApprovalMode: () => settingsService.getApprovalMode(),
    // git pull 的条件确认：工作区不干净（或无法查询）时仍需人工确认
    isWorktreeDirty: async () => {
      const result = await runGit(['status', '--porcelain'], {
        cwd: workspaceService.accessGuard().root,
        timeoutMs: 10_000
      })
      return result.code !== 0 || result.stdout.trim().length > 0
    },
    projectCommands: async () => {
      try {
        return await loadProjectCommands(workspaceService.accessGuard().root)
      } catch {
        // 配置文件非法时回退默认白名单；具体报错会在 assertCommandAllowed 前抛出
        return new Set<string>()
      }
    },
    onToolOutput: (callId, runId, text) => {
      broadcastAgentEvent({
        type: 'tool:output',
        runId,
        seq: 0,
        ts: Date.now(),
        callId,
        text
      })
    },
    planStore,
    allowRules,
    webSearch: createTavilySearchRunner(() => settingsService.getWebSearchConfig()),
    webSearchEnabled: () => settingsService.getWebSearchConfig() !== null,
    imageGen: createImageGenRunner(() => settingsService.getImageConfig()),
    imageGenEnabled: () => settingsService.getImageConfig() !== null,
    gitDiff: async ({ staged, relativePath }) => {
      const args = ['diff', '--unified=3', ...(staged ? ['--cached'] : [])]
      if (relativePath) args.push('--', relativePath)
      const result = await runGit(args, {
        cwd: workspaceService.accessGuard().root,
        timeoutMs: 30_000
      })
      if (result.spawnError) {
        return { ok: false, text: '', message: result.spawnError }
      }
      const text = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      return {
        ok: result.code === 0,
        text,
        message: result.code === 0 ? undefined : result.stderr.slice(0, 300)
      }
    }
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
    toolDefinitions: () => toolService.getDefinitions(),
    toolExecutor: (call, context) => toolService.execute(call, context),
    persist: { sessions: sessionRepo, messages: messageRepo, context: agentContextRepo },
    workspaceInfo: () => {
      const info = workspaceService.current()
      if (!info) return null
      return {
        name: info.name,
        root: info.root,
        remote: info.remote?.kind ?? null
      }
    },
    contextWindow: () => settingsService.getContextWindow(),
    planStore,
    onUsage: (usage, sessionId) => {
      const settings = settingsService.getPublic()
      const provider = settings.providers.find((item) => item.id === settings.activeProviderId)
      usageRepo.insert({
        id: randomUUID(),
        sessionId,
        providerId: settings.activeProviderId,
        model: settings.activeModel || provider?.model || 'unknown',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        createdAt: Date.now()
      })
    }
  })

  handleIpc<ChatCompressInput, ChatCompressResult>(
    IPC_CHANNELS.chatCompress,
    chatCompressInputSchema,
    (input) => agentService.compress(input.sessionId)
  )

  handleIpc<SessionIdRequest, ContextUsage>(
    IPC_CHANNELS.chatContextUsage,
    sessionIdInputSchema,
    async (input) => agentService.usage(input.sessionId)
  )

  handleIpc<SessionIdRequest, ChatPlanResult>(
    IPC_CHANNELS.chatGetPlan,
    sessionIdInputSchema,
    async (input) => agentService.plan(input.sessionId)
  )

  handleIpc<undefined, WorkspaceInfo | null>(IPC_CHANNELS.workspaceSelect, null, async () => {
    remoteService.forget()
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
      remoteService.forget()
      return workspaceService.openRoot(project.root)
    }
  )

  const sshRemote = (): { rootPath: string } | null => {
    const remote = workspaceService.currentRemote()
    return remote?.kind === 'ssh' ? { rootPath: remote.rootPath } : null
  }

  handleIpc<FsTreeRequest, FsTreeNode[]>(IPC_CHANNELS.fsTree, fsTreeInputSchema, async (input) => {
    const ssh = sshRemote()
    if (ssh) return readRemoteTree(await remoteService.sshSftp(), ssh.rootPath, input)
    return readWorkspaceTree(workspaceService.requireGuard(), input)
  })

  handleIpc<FsReadFileRequest, FsReadFileResult>(
    IPC_CHANNELS.fsReadFile,
    fsReadFileInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) {
        return readRemoteFile(
          await remoteService.sshSftp(),
          ssh.rootPath,
          input,
          timelineService,
          ssh.rootPath
        )
      }
      return readWorkspaceFile(workspaceService.requireGuard(), input, timelineService)
    }
  )

  handleIpc<FsWriteFileRequest, FsWriteFileResult>(
    IPC_CHANNELS.fsWriteFile,
    fsWriteFileInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) {
        return writeRemoteFile(
          await remoteService.sshSftp(),
          ssh.rootPath,
          input,
          timelineService,
          ssh.rootPath
        )
      }
      return writeWorkspaceFile(workspaceService.requireGuard(), input, timelineService)
    }
  )

  handleIpc<FsCreateEntryRequest, FsTreeNode>(
    IPC_CHANNELS.fsCreateFile,
    fsCreateEntryInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) {
        return createRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input, 'file')
      }
      return createWorkspaceEntry(workspaceService.requireGuard(), input, 'file')
    }
  )

  handleIpc<FsCreateEntryRequest, FsTreeNode>(
    IPC_CHANNELS.fsCreateFolder,
    fsCreateEntryInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) {
        return createRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input, 'directory')
      }
      return createWorkspaceEntry(workspaceService.requireGuard(), input, 'directory')
    }
  )

  handleIpc<FsRenameRequest, FsTreeNode>(
    IPC_CHANNELS.fsRename,
    fsRenameInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) return renameRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input)
      return renameWorkspaceEntry(workspaceService.requireGuard(), input)
    }
  )

  handleIpc<FsTransferRequest, FsTransferResult>(
    IPC_CHANNELS.fsCopy,
    fsTransferInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) return copyRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input)
      return copyWorkspaceEntry(workspaceService.requireGuard(), input)
    }
  )

  handleIpc<FsTransferRequest, FsTransferResult>(
    IPC_CHANNELS.fsMove,
    fsTransferInputSchema,
    async (input) => {
      const ssh = sshRemote()
      if (ssh) {
        return moveRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input)
      }
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
      const ssh = sshRemote()
      if (ssh) {
        return deleteRemoteEntry(await remoteService.sshSftp(), ssh.rootPath, input.relativePath)
      }
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
    const remote = workspaceService.currentRemote()
    if (remote?.kind === 'ssh') {
      throw new AppError('E_UNSUPPORTED', '远程工作区没有本地文件系统位置，无法在资源管理器中显示')
    }
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
      const remote = workspaceService.currentRemote()
      if (remote?.kind === 'ssh') {
        fileClipboard.set({
          mode: input.mode,
          relativePath: normalizeWorkspaceRelativePath(input.relativePath),
          name: normalizeWorkspaceRelativePath(input.relativePath).split('/').pop() ?? '',
          workspaceRoot: remote.targetId,
          ts: Date.now()
        })
        return fileClipboard.publicState()
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

  handleIpc<AuditQueryRequest, AuditPage>(
    IPC_CHANNELS.auditQuery,
    auditQueryInputSchema,
    async (input) => auditStore.query(auditFilterOf(input), input.page, input.pageSize)
  )

  handleIpc<AuditFilterRequest, AuditStats>(
    IPC_CHANNELS.auditStats,
    auditFilterSchema,
    async (input) => auditStore.stats(auditFilterOf(input))
  )

  handleIpc<AuditExportRequest, AuditExportResult>(
    IPC_CHANNELS.auditExport,
    auditExportInputSchema,
    async (input) => {
      const entries = auditStore.all(auditFilterOf(input), AUDIT_LIMITS.maxExportRows)
      if (!entries.length) return { path: null, count: 0 }
      const isJson = input.format === 'json'
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const result = await dialog.showSaveDialog({
        title: '导出审计日志',
        defaultPath: join(
          app.getPath('documents'),
          `yocim-audit-${stamp}.${isJson ? 'json' : 'csv'}`
        ),
        filters: [
          isJson ? { name: 'JSON', extensions: ['json'] } : { name: 'CSV', extensions: ['csv'] }
        ]
      })
      if (result.canceled || !result.filePath) return { path: null, count: 0 }
      await writeFile(result.filePath, isJson ? auditToJson(entries) : auditToCsv(entries), 'utf8')
      return { path: result.filePath, count: entries.length }
    }
  )

  handleIpc<undefined, GitStatus>(IPC_CHANNELS.gitStatus, null, async () => gitService.status())

  handleIpc<GitDiffRequest, GitDiffResult>(
    IPC_CHANNELS.gitDiff,
    gitDiffInputSchema,
    async (input) => gitService.diff(input)
  )

  handleIpc<undefined, GitBranches>(IPC_CHANNELS.gitBranches, null, async () =>
    gitService.branches()
  )

  handleIpc<GitPathsRequest, GitStatus>(IPC_CHANNELS.gitStage, gitPathsInputSchema, async (input) =>
    gitService.stage(input)
  )

  handleIpc<GitPathsRequest, GitStatus>(
    IPC_CHANNELS.gitUnstage,
    gitPathsInputSchema,
    async (input) => gitService.unstage(input)
  )

  handleIpc<GitPathsRequest, GitStatus>(
    IPC_CHANNELS.gitDiscard,
    gitPathsInputSchema,
    async (input) => gitService.discard(input)
  )

  handleIpc<GitCommitRequest, GitCommitResult>(
    IPC_CHANNELS.gitCommit,
    gitCommitInputSchema,
    async (input) => gitService.commit(input)
  )

  handleIpc<undefined, GitOperationResult>(IPC_CHANNELS.gitPull, null, async () =>
    gitService.pull()
  )

  handleIpc<undefined, GitOperationResult>(IPC_CHANNELS.gitPush, null, async () =>
    gitService.push()
  )

  handleIpc<undefined, GitOperationResult>(IPC_CHANNELS.gitPublish, null, async () =>
    gitService.publish()
  )

  handleIpc<GitCheckoutRequest, GitStatus>(
    IPC_CHANNELS.gitCheckout,
    gitCheckoutInputSchema,
    async (input) => gitService.checkout(input)
  )

  handleIpc<undefined, GitStatus>(IPC_CHANNELS.gitInit, null, async () => gitService.init())

  handleIpc<undefined, GitLogEntry[]>(IPC_CHANNELS.gitOutput, null, async () =>
    gitService.outputLog()
  )

  handleIpc<GitGraphRequest, GitGraph>(IPC_CHANNELS.gitGraph, gitGraphInputSchema, async (input) =>
    gitService.graph(input)
  )

  handleIpc<GitCommitDetailRequest, GitCommitDetail>(
    IPC_CHANNELS.gitCommitDetail,
    gitCommitDetailInputSchema,
    async (input) => gitService.commitDetail(input.sha)
  )

  handleIpc<undefined, TaskDiscovery>(IPC_CHANNELS.tasksList, null, async () => taskService.list())

  handleIpc<TaskStartRequest, TaskRun>(
    IPC_CHANNELS.tasksStart,
    taskStartInputSchema,
    async (input) => taskService.start(input)
  )

  handleIpc<TaskStopRequest, { stopped: boolean; runId: string }>(
    IPC_CHANNELS.tasksStop,
    taskStopInputSchema,
    async (input) => ({ stopped: await taskService.stop(input.runId), runId: input.runId })
  )

  handleIpc<undefined, DebugConfigFile>(IPC_CHANNELS.debugConfigs, null, async () =>
    debugService.configs()
  )

  handleIpc<DebugStartRequest, { session: DebugSession; commandLine: string }>(
    IPC_CHANNELS.debugStart,
    debugStartInputSchema,
    async (input) => {
      const remote = workspaceService.currentRemote()
      if (remote) {
        throw new AppError(
          'E_UNSUPPORTED',
          `远程工作区（${remote.kind === 'wsl' ? 'WSL' : 'SSH'}）暂不支持调试，请在远程终端中启动调试器`
        )
      }
      const session = await debugService.start(input)
      return { session, commandLine: session.commandLine }
    }
  )

  handleIpc<undefined, { stopped: boolean }>(IPC_CHANNELS.debugStop, null, async () => ({
    stopped: await debugService.stop()
  }))

  handleIpc<DebugBreakpointsRequest, DebugBreakpoint[]>(
    IPC_CHANNELS.debugSetBreakpoints,
    debugBreakpointsInputSchema,
    async (input) => debugService.setBreakpoints(input.breakpoints)
  )

  handleIpc<DebugCommandRequest, { ok: boolean }>(
    IPC_CHANNELS.debugCommand,
    debugCommandInputSchema,
    async (input) => {
      await debugService.command(input.command)
      return { ok: true }
    }
  )

  handleIpc<DebugFrameRequest, DebugScope[]>(
    IPC_CHANNELS.debugScopes,
    debugFrameInputSchema,
    async (input) => debugService.scopes(input.frameId)
  )

  handleIpc<DebugVariablesRequest, DebugVariable[]>(
    IPC_CHANNELS.debugVariables,
    debugVariablesInputSchema,
    async (input) => debugService.variables(input.variablesReference)
  )

  handleIpc<DebugEvaluateRequest, DebugEvaluation>(
    IPC_CHANNELS.debugEvaluate,
    debugEvaluateInputSchema,
    async (input) => debugService.evaluate(input.expression, input.frameId)
  )

  handleIpc<undefined, ExtensionInfo[]>(IPC_CHANNELS.extensionsList, null, async () =>
    extensionService.list()
  )

  handleIpc<ExtensionsInstallLocalRequest, ExtensionInstallResult>(
    IPC_CHANNELS.extensionsInstallLocal,
    extensionsInstallLocalInputSchema,
    async (input) => {
      let directory = input.directory
      if (!directory) {
        const picked = await dialog.showOpenDialog({
          title: '选择扩展目录（包含 yocim-extension.json 或 package.json）',
          properties: ['openDirectory']
        })
        directory = picked.filePaths[0]
        if (picked.canceled || !directory) {
          throw new AppError('E_INVALID_INPUT', '未选择扩展目录')
        }
      }
      return extensionService.installLocal(directory)
    }
  )

  handleIpc<ExtensionsInstallVsixRequest, ExtensionInstallResult>(
    IPC_CHANNELS.extensionsInstallVsix,
    extensionsInstallVsixInputSchema,
    async (input) => {
      let filePath = input.filePath
      if (!filePath) {
        const picked = await dialog.showOpenDialog({
          title: '选择 VSIX 扩展包',
          properties: ['openFile'],
          filters: [{ name: 'VSIX 扩展包', extensions: ['vsix'] }]
        })
        filePath = picked.filePaths[0]
        if (picked.canceled || !filePath) {
          throw new AppError('E_INVALID_INPUT', '未选择 VSIX 文件')
        }
      }
      return extensionService.installVsix(filePath)
    }
  )

  handleIpc<ExtensionsScanRequest, VscodeScanResult>(
    IPC_CHANNELS.extensionsScanVscode,
    extensionsScanInputSchema,
    async (input) => extensionService.scanVscode(input.directory)
  )

  handleIpc<ExtensionsImportRequest, ExtensionInstallResult>(
    IPC_CHANNELS.extensionsImportVscode,
    extensionsImportInputSchema,
    async (input) => extensionService.importVscode(input.id, input.directory)
  )

  handleIpc<ExtensionsSetEnabledRequest, ExtensionInfo[]>(
    IPC_CHANNELS.extensionsSetEnabled,
    extensionsSetEnabledInputSchema,
    async (input) => extensionService.setEnabled(input.id, input.enabled)
  )

  handleIpc<ExtensionsIdRequest, ExtensionInfo[]>(
    IPC_CHANNELS.extensionsUninstall,
    extensionsIdInputSchema,
    async (input) => extensionService.uninstall(input.id)
  )

  handleIpc<undefined, ExtensionContributionBundle>(
    IPC_CHANNELS.extensionsContributions,
    null,
    async () => extensionService.contributions()
  )

  handleIpc<ExtensionsIdRequest, null>(
    IPC_CHANNELS.extensionsReveal,
    extensionsIdInputSchema,
    async (input) => {
      shell.showItemInFolder(extensionService.resolveEntryPath(input.id))
      return null
    }
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

  handleIpc<ProjectIdRequest, WorkspaceInfo>(
    IPC_CHANNELS.projectOpen,
    projectIdInputSchema,
    async (input) => {
      const project = projectRepo.get(input.projectId)
      if (!project) throw new AppError('E_NOT_FOUND', '项目不存在')
      // SSH 项目没有可在系统文件管理器中打开的本地目录，只切换工作区。
      if (!project.root.startsWith('ssh://')) {
        try {
          await access(project.root)
        } catch {
          throw new AppError('E_NOT_FOUND', '项目目录不存在或无法访问')
        }
        const error = await shell.openPath(project.root)
        if (error) throw new AppError('E_IO', `打开目录失败：${error}`)
      }
      remoteService.forget()
      return workspaceService.openRoot(project.root)
    }
  )

  handleIpc<ProjectIdRequest, ProjectRemoveResult>(
    IPC_CHANNELS.projectRemove,
    projectIdInputSchema,
    async (input) => sessionService.removeProject(input)
  )

  handleIpc<undefined, RemoteProbeResultType>(IPC_CHANNELS.remoteProbe, null, async () =>
    remoteService.probe()
  )

  handleIpc<undefined, RemoteTargetListResultType>(IPC_CHANNELS.remoteList, null, async () =>
    remoteService.list()
  )

  handleIpc<RemoteTargetSaveRequest, RemoteTargetListResultType>(
    IPC_CHANNELS.remoteSave,
    remoteTargetInputSchema,
    async (input) => {
      if (!workspaceService.currentRemote()) {
        remoteService.rememberLocalRoot(workspaceService.current()?.root ?? null)
      }
      return remoteService.save(input)
    }
  )

  handleIpc<RemoteIdRequest, RemoteTargetListResultType>(
    IPC_CHANNELS.remoteDelete,
    remoteIdInputSchema,
    async (input) => remoteService.delete(input.id)
  )

  handleIpc<RemoteConnectRequest, RemoteConnectResultType>(
    IPC_CHANNELS.remoteConnect,
    remoteConnectInputSchema,
    async (input) => {
      if (!workspaceService.currentRemote()) {
        remoteService.rememberLocalRoot(workspaceService.current()?.root ?? null)
      }
      const result = await remoteService.connect(input.id, {
        ...(input.trustHostFingerprint ? { trustHostFingerprint: true } : {})
      })
      if (result.workspace) sessionService.ensureProjectForCurrentWorkspace()
      return result
    }
  )

  handleIpc<undefined, RemoteDisconnectResultType>(IPC_CHANNELS.remoteDisconnect, null, async () =>
    remoteService.disconnect()
  )

  handleIpc<undefined, RemoteConnectionState>(IPC_CHANNELS.remoteCurrent, null, async () =>
    remoteService.current()
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

  handleIpc<SettingsSetContextWindowRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetContextWindow,
    settingsSetContextWindowInputSchema,
    async (input) => settingsService.setContextWindow(input)
  )

  handleIpc<SettingsSetReasoningEffortRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetReasoningEffort,
    settingsSetReasoningEffortInputSchema,
    async (input) => settingsService.setReasoningEffort(input)
  )

  handleIpc<SettingsSetSearchRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetSearch,
    settingsSetSearchInputSchema,
    async (input) => settingsService.setSearch(input)
  )

  handleIpc<undefined, SettingsResult>(IPC_CHANNELS.settingsClearSearchKey, null, async () =>
    settingsService.clearSearchApiKey()
  )

  handleIpc<SettingsSetImageRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetImage,
    settingsSetImageInputSchema,
    async (input) => settingsService.setImage(input)
  )

  handleIpc<undefined, SettingsResult>(IPC_CHANNELS.settingsClearImageKey, null, async () =>
    settingsService.clearImageApiKey()
  )

  handleIpc<SettingsSetPricingRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetPricing,
    settingsSetPricingInputSchema,
    async (input) => settingsService.setPricing(input)
  )

  handleIpc<SettingsSetStorageRequest, SettingsResult>(
    IPC_CHANNELS.settingsSetStorage,
    settingsSetStorageInputSchema,
    async (input) => {
      const result = settingsService.setStorage(input)
      // 引导文件写在系统默认目录，重启后才会切到新目录
      storageService.persistDataDir(input.dataDir)
      return result
    }
  )

  handleIpc<BillingBalanceRequest, BillingBalanceResult>(
    IPC_CHANNELS.billingBalance,
    billingBalanceInputSchema,
    async (input) => billingService.getBalance(input.providerId)
  )

  handleIpc<BillingSummaryRequest, BillingSummaryResult>(
    IPC_CHANNELS.billingSummary,
    billingSummaryInputSchema,
    async (input) => billingService.getSummary(input.sinceDays)
  )

  handleIpc<undefined, StorageInfoResult>(IPC_CHANNELS.storageInfo, null, async () =>
    storageService.getInfo()
  )

  handleIpc<StoragePickRequest, string | null>(
    IPC_CHANNELS.storagePick,
    storagePickInputSchema,
    async () => {
      const picked = await dialog.showOpenDialog({
        title: '选择数据目录',
        defaultPath: storageService.getInfo().dataDir,
        properties: ['openDirectory', 'createDirectory']
      })
      if (picked.canceled || !picked.filePaths.length) return null
      return picked.filePaths[0]
    }
  )

  handleIpc<undefined, null>(IPC_CHANNELS.storageOpen, null, async () => {
    const target = storageService.getInfo().dataDir
    const error = await shell.openPath(target)
    if (error) throw new AppError('E_IO', `打开目录失败：${error}`)
    return null
  })

  handleIpc<undefined, UpdateCheckResult>(IPC_CHANNELS.updateCheck, null, async () =>
    checkForUpdate({
      currentVersion: currentAppVersion(),
      platform: process.platform,
      arch: process.arch
    })
  )

  handleIpc<UpdateDownloadRequest, null>(
    IPC_CHANNELS.updateOpen,
    updateDownloadInputSchema,
    async (input) => {
      await shell.openExternal(input.url)
      return null
    }
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
