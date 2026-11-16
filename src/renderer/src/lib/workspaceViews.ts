export type WorkspaceView =
  'files' | 'search' | 'editor' | 'audit' | 'scm' | 'extensions' | 'debug' | 'remote'

export interface WorkspaceViewDef {
  key: WorkspaceView
  label: string
  testid: string
  /** 骨架视图的交付阶段；已实现的视图不填 */
  phase?: string
  /** 骨架视图展示的规划能力摘要 */
  summary?: string[]
}

export const WORKSPACE_VIEWS: WorkspaceViewDef[] = [
  { key: 'files', label: '文件', testid: 'workspace-tab-files' },
  { key: 'search', label: '搜索', testid: 'workspace-tab-search' },
  { key: 'editor', label: '编辑器', testid: 'workspace-tab-editor' },
  { key: 'audit', label: '审计', testid: 'audit-toggle' },
  { key: 'scm', label: '源代码管理', testid: 'workspace-tab-scm' },
  { key: 'extensions', label: '扩展安装', testid: 'workspace-tab-extensions' },
  { key: 'debug', label: '运行和调试', testid: 'workspace-tab-debug' },
  { key: 'remote', label: '远程管理器', testid: 'workspace-tab-remote' }
]

export function isWorkspaceView(value: string | null): value is WorkspaceView {
  return WORKSPACE_VIEWS.some((view) => view.key === value)
}
