export const IPC_CHANNELS = {
  workspaceSelect: 'workspace:select',
  workspaceCurrent: 'workspace:current',
  fsTree: 'fs:tree',
  fsReadFile: 'fs:readFile',
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
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  approvalRespond: 'approval:respond',
  approvalRequest: 'approval:request',
  auditList: 'audit:list',
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
  workspaceOpenProject: 'workspace:openProject',
  settingsGet: 'settings:get',
  settingsSaveProvider: 'settings:saveProvider',
  settingsDeleteProvider: 'settings:deleteProvider',
  settingsSetActive: 'settings:setActive',
  settingsSetApprovalMode: 'settings:setApprovalMode',
  windowControl: 'window:control'
} as const

export const FS_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTreeEntries: 500,
  maxDepth: 8,
  maxRelativePathLength: 1024
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
