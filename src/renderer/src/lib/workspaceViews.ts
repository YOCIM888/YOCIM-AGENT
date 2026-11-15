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
  {
    key: 'scm',
    label: '源代码管理',
    testid: 'workspace-tab-scm',
    phase: 'P3',
    summary: [
      '变更分组：已暂存 / 未暂存 / 未跟踪',
      '暂存、提交、拉取、推送、发布分支',
      '分支切换与只读 Diff，依赖系统 Git'
    ]
  },
  {
    key: 'extensions',
    label: '扩展安装',
    testid: 'workspace-tab-extensions',
    phase: 'P4',
    summary: [
      '本地文件夹 / VSIX / VS Code 扩展目录导入',
      '启用、禁用、卸载与兼容性分级',
      '第一层仅支持声明式贡献，不执行扩展代码'
    ]
  },
  {
    key: 'debug',
    label: '运行和调试',
    testid: 'workspace-tab-debug',
    phase: 'P4',
    summary: [
      '运行 npm scripts 与自定义任务，输出可停止',
      'Node.js 调试：断点、单步、变量、调用堆栈',
      '启动配置首次运行需确认完整命令'
    ]
  },
  {
    key: 'remote',
    label: '远程管理器',
    testid: 'workspace-tab-remote',
    phase: 'P5',
    summary: [
      'WSL 发行版枚举与连接（先行）',
      'SSH 主机管理（后置），凭据加密存储',
      '远程工作区浏览、编辑、搜索、Git 与运行'
    ]
  }
]

export function isWorkspaceView(value: string | null): value is WorkspaceView {
  return WORKSPACE_VIEWS.some((view) => view.key === value)
}
