export const IPC_CHANNELS = {
  workspaceSelect: 'workspace:select',
  workspaceCurrent: 'workspace:current',
  fsTree: 'fs:tree',
  fsReadFile: 'fs:readFile',
  fsWriteFile: 'fs:writeFile',
  fsCreateFile: 'fs:createFile',
  fsCreateFolder: 'fs:createFolder',
  fsRename: 'fs:rename',
  fsCopy: 'fs:copy',
  fsMove: 'fs:move',
  fsDelete: 'fs:delete',
  fsReveal: 'fs:reveal',
  fsClipboard: 'fs:clipboard',
  clipboardWriteText: 'clipboard:writeText',
  timelineList: 'timeline:list',
  timelineRead: 'timeline:read',
  timelineRestore: 'timeline:restore',
  searchStart: 'search:start',
  searchCancel: 'search:cancel',
  searchEvent: 'search:event',
  searchReplace: 'search:replace',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatCompress: 'chat:compress',
  chatContextUsage: 'chat:context-usage',
  chatGetPlan: 'chat:plan',
  chatPersistSteps: 'chat:persist-steps',
  chatEvent: 'chat:event',
  approvalRespond: 'approval:respond',
  approvalRequest: 'approval:request',
  auditList: 'audit:list',
  auditQuery: 'audit:query',
  auditStats: 'audit:stats',
  auditExport: 'audit:export',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitBranches: 'git:branches',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitPublish: 'git:publish',
  gitCheckout: 'git:checkout',
  gitInit: 'git:init',
  gitOutput: 'git:output',
  gitGraph: 'git:graph',
  gitCommitDetail: 'git:commitDetail',
  tasksList: 'tasks:list',
  tasksStart: 'tasks:start',
  tasksStop: 'tasks:stop',
  tasksEvent: 'tasks:event',
  terminalState: 'terminal:state',
  terminalRun: 'terminal:run',
  terminalCancel: 'terminal:cancel',
  terminalEvent: 'terminal:event',
  browserState: 'browser:state',
  browserViewport: 'browser:viewport',
  browserNavigate: 'browser:navigate',
  browserControl: 'browser:control',
  browserRetry: 'browser:retry',
  browserAudit: 'browser:audit',
  browserEvent: 'browser:event',
  debugConfigs: 'debug:configs',
  debugStart: 'debug:start',
  debugStop: 'debug:stop',
  debugSetBreakpoints: 'debug:setBreakpoints',
  debugCommand: 'debug:command',
  debugScopes: 'debug:scopes',
  debugVariables: 'debug:variables',
  debugEvaluate: 'debug:evaluate',
  debugEvent: 'debug:event',
  extensionsList: 'extensions:list',
  extensionsInstallLocal: 'extensions:installLocal',
  extensionsInstallVsix: 'extensions:installVsix',
  extensionsScanVscode: 'extensions:scanVscode',
  extensionsImportVscode: 'extensions:importVscode',
  extensionsSetEnabled: 'extensions:setEnabled',
  extensionsUninstall: 'extensions:uninstall',
  extensionsContributions: 'extensions:contributions',
  extensionsReveal: 'extensions:reveal',
  remoteProbe: 'remote:probe',
  remoteList: 'remote:list',
  remoteSave: 'remote:save',
  remoteDelete: 'remote:delete',
  remoteConnect: 'remote:connect',
  remoteDisconnect: 'remote:disconnect',
  remoteCurrent: 'remote:current',
  sessionList: 'session:list',
  sessionCreate: 'session:create',
  sessionRename: 'session:rename',
  sessionDelete: 'session:delete',
  sessionMessages: 'session:messages',
  sessionExport: 'session:export',
  sessionPin: 'session:pin',
  sessionArchive: 'session:archive',
  sessionMove: 'session:move',
  projectList: 'project:list',
  projectRename: 'project:rename',
  projectOpen: 'project:open',
  projectRemove: 'project:remove',
  conventionsGet: 'conventions:get',
  conventionsSave: 'conventions:save',
  conventionsDelete: 'conventions:delete',
  conventionsGenerate: 'conventions:generate',
  conventionsCopy: 'conventions:copy',
  workspaceOpenProject: 'workspace:openProject',
  settingsGet: 'settings:get',
  settingsSaveProvider: 'settings:saveProvider',
  settingsDeleteProvider: 'settings:deleteProvider',
  settingsSetActive: 'settings:setActive',
  settingsSetApprovalMode: 'settings:setApprovalMode',
  settingsSetCommandWhitelist: 'settings:setCommandWhitelist',
  settingsSetContextWindow: 'settings:setContextWindow',
  settingsSetReasoningEffort: 'settings:setReasoningEffort',
  settingsSetSearch: 'settings:setSearch',
  settingsClearSearchKey: 'settings:clearSearchKey',
  settingsSetImage: 'settings:setImage',
  settingsClearImageKey: 'settings:clearImageKey',
  settingsSetBrowser: 'settings:setBrowser',
  settingsSetPricing: 'settings:setPricing',
  settingsSetStorage: 'settings:setStorage',
  billingBalance: 'billing:balance',
  billingSummary: 'billing:summary',
  storageInfo: 'storage:info',
  storagePick: 'storage:pick',
  storageOpen: 'storage:open',
  updateCheck: 'update:check',
  updateOpen: 'update:open',
  updateAvailable: 'update:available',
  windowControl: 'window:control'
} as const

export const FS_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTreeEntries: 500,
  maxDepth: 8,
  maxRelativePathLength: 1024
} as const

export const SEARCH_LIMITS = {
  maxQueryLength: 512,
  maxReplacementLength: 4096,
  maxPatternLength: 512,
  maxResults: 5000,
  maxMatchesPerFile: 2000,
  maxLineChars: 400,
  maxFileBytes: 1024 * 1024,
  maxReplaceFiles: 200
} as const

export const AUDIT_LIMITS = {
  defaultPageSize: 50,
  maxPageSize: 200,
  maxKeywordLength: 200,
  maxExportRows: 20000
} as const

export const GIT_LIMITS = {
  maxMessageLength: 5000,
  maxBranchLength: 200,
  maxPathsPerRequest: 200,
  /** 单个 Git 命令超时（毫秒） */
  commandTimeoutMs: 60000,
  /** 网络命令（pull/push）超时 */
  networkTimeoutMs: 180000,
  maxDiffBytes: 2 * 1024 * 1024,
  maxLogEntries: 40
} as const

export const TASK_LIMITS = {
  /** 单次运行最多保留的输出字节（超出后停止追加并标记截断） */
  maxOutputBytes: 512 * 1024,
  /** 同时运行的任务数上限 */
  maxConcurrentRuns: 4,
  /** 保留的最近运行记录数 */
  maxRuns: 20,
  maxTaskLabelLength: 200,
  maxTaskArgs: 40,
  maxArgLength: 2000,
  maxEnvEntries: 100,
  /** 自定义任务首次运行的命令长度上限 */
  maxCommandLength: 4000,
  /** 停止任务时等待进程退出的时间 */
  stopTimeoutMs: 5000
} as const

export const CONVENTION_LIMITS = {
  maxContentChars: 20000,
  maxContextChars: 6000,
  maxOutputChars: 20000,
  generateTimeoutMs: 60000
} as const

export const TERMINAL_LIMITS = {
  maxCommandLength: 4000,
  maxOutputBytes: 512 * 1024,
  maxInputChars: 4000
} as const

export const BROWSER_IPC_LIMITS = {
  maxUrlLength: 2048,
  maxViewportDimension: 8192,
  maxAuditLimit: 200
} as const

export const DEBUG_LIMITS = {
  maxConfigs: 50,
  maxBreakpoints: 200,
  maxConditionLength: 500,
  maxArgs: 40,
  maxArgLength: 2000,
  maxEnvEntries: 100,
  maxExpressionLength: 1000,
  maxWatches: 30,
  /** 等待调试器吐出 ws 地址的时间 */
  attachTimeoutMs: 15000,
  /** 单次 CDP 请求超时 */
  requestTimeoutMs: 15000,
  maxConsoleLines: 2000
} as const

export const EXTENSION_LIMITS = {
  maxManifestBytes: 512 * 1024,
  /** VSIX 解压上限：条目数与总解压字节 */
  maxVsixEntries: 4000,
  maxVsixBytes: 60 * 1024 * 1024,
  /** 单个片段文件大小上限 */
  maxSnippetBytes: 256 * 1024,
  maxContributionItems: 500
} as const

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'release',
  'coverage',
  '.DS_Store'
])
