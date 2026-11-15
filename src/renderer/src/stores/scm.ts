import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  countGitChanges,
  type GitBranches,
  type GitFileChange,
  type GitLogEntry,
  type GitStatus
} from '@shared/git'
import { languageForPath } from '../lib/monaco'
import type { IpcResult } from '@shared/ipc'
import { useWorkspaceStore } from './workspace'

export type ScmGroup = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

const GROUPS_STORAGE_KEY = 'yocim.ui.gitPanel'

function readCollapsed(): Record<ScmGroup, boolean> {
  const fallback: Record<ScmGroup, boolean> = {
    staged: false,
    unstaged: false,
    untracked: false,
    conflicted: false
  }
  try {
    const raw = localStorage.getItem(GROUPS_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<ScmGroup, boolean>>
    return {
      staged: typeof parsed.staged === 'boolean' ? parsed.staged : false,
      unstaged: typeof parsed.unstaged === 'boolean' ? parsed.unstaged : false,
      untracked: typeof parsed.untracked === 'boolean' ? parsed.untracked : false,
      conflicted: typeof parsed.conflicted === 'boolean' ? parsed.conflicted : false
    }
  } catch {
    return fallback
  }
}

function persistCollapsed(value: Record<ScmGroup, boolean>): void {
  try {
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 本地偏好写入失败不影响使用
  }
}

export const useScmStore = defineStore('scm', () => {
  const workspace = useWorkspaceStore()

  const status = ref<GitStatus | null>(null)
  const branches = ref<GitBranches | null>(null)
  const output = ref<GitLogEntry[]>([])
  const collapsed = ref<Record<ScmGroup, boolean>>(readCollapsed())
  const message = ref('')
  const loading = ref(false)
  const busy = ref('')
  const error = ref('')
  const notice = ref('')

  const changeCount = computed(() => (status.value ? countGitChanges(status.value) : 0))
  const hasRepo = computed(() => Boolean(status.value?.isRepo))
  const canCommit = computed(
    () => message.value.trim().length > 0 && (status.value?.staged.length ?? 0) > 0
  )
  const aheadBehind = computed(() => {
    const value = status.value
    if (!value?.upstream) return ''
    return `↑${value.ahead} ↓${value.behind}`
  })

  function groupsOf(key: ScmGroup): GitFileChange[] {
    return status.value?.[key] ?? []
  }

  function setError(text: string): void {
    error.value = text
    notice.value = ''
  }

  function clearError(): void {
    error.value = ''
  }

  function applyStatus(next: GitStatus): void {
    status.value = next
    if (!next.isRepo && next.message) error.value = next.message
  }

  async function refresh(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      loading.value = true
      clearError()
    }
    try {
      const response = await window.yocim.git.status()
      if (!response.ok) {
        setError(response.error.message)
        return
      }
      applyStatus(response.data)
    } finally {
      loading.value = false
    }
  }

  async function refreshBranches(): Promise<void> {
    const response = await window.yocim.git.branches()
    if (response.ok) branches.value = response.data
  }

  async function loadOutput(): Promise<void> {
    const response = await window.yocim.git.output()
    if (response.ok) output.value = response.data
  }

  async function run(
    label: string,
    action: () => Promise<IpcResult<GitStatus>>,
    successText: string
  ): Promise<boolean> {
    if (busy.value) return false
    busy.value = label
    clearError()
    notice.value = ''
    try {
      const response = await action()
      if (!response.ok) {
        setError(response.error.message)
        return false
      }
      applyStatus(response.data)
      notice.value = successText
      await loadOutput()
      return true
    } finally {
      busy.value = ''
    }
  }

  function stage(paths: string[]): Promise<boolean> {
    return run('stage', () => window.yocim.git.stage({ paths }), `已暂存 ${paths.length} 个文件`)
  }

  function unstage(paths: string[]): Promise<boolean> {
    return run(
      'unstage',
      () => window.yocim.git.unstage({ paths }),
      `已取消暂存 ${paths.length} 个文件`
    )
  }

  function discard(paths: string[]): Promise<boolean> {
    return run(
      'discard',
      () => window.yocim.git.discard({ paths }),
      `已放弃 ${paths.length} 个文件的更改`
    )
  }

  async function commit(all = false): Promise<boolean> {
    const text = message.value.trim()
    if (!text) {
      setError('请先填写提交信息')
      return false
    }
    busy.value = all ? 'commit-all' : 'commit'
    clearError()
    notice.value = ''
    try {
      const response = await window.yocim.git.commit({ message: text, all })
      if (!response.ok) {
        setError(response.error.message)
        return false
      }
      applyStatus(response.data.status)
      message.value = ''
      notice.value = `已提交 ${response.data.commit || ''}`.trim()
      await Promise.all([loadOutput(), refreshBranches()])
      workspace.refreshTree()
      return true
    } finally {
      busy.value = ''
    }
  }

  async function network(kind: 'pull' | 'push' | 'publish'): Promise<boolean> {
    busy.value = kind
    clearError()
    notice.value = ''
    try {
      const response = await window.yocim.git[kind]()
      if (!response.ok) {
        setError(response.error.message)
        return false
      }
      applyStatus(response.data.status)
      notice.value =
        kind === 'pull' ? '已拉取远程更新' : kind === 'push' ? '已推送提交' : '已发布分支'
      await Promise.all([loadOutput(), refreshBranches()])
      return true
    } finally {
      busy.value = ''
    }
  }

  async function checkout(branch: string, create = false): Promise<boolean> {
    const ok = await run(
      'checkout',
      () => window.yocim.git.checkout({ branch, create }),
      create ? `已创建并切换到 ${branch}` : `已切换到 ${branch}`
    )
    if (ok) {
      await Promise.all([refreshBranches(), workspace.refreshTree()])
    }
    return ok
  }

  async function initRepo(): Promise<boolean> {
    const ok = await run('init', () => window.yocim.git.init(), '已初始化 Git 仓库')
    if (ok) await refreshBranches()
    return ok
  }

  async function openDiff(change: GitFileChange, staged: boolean): Promise<void> {
    const response = await window.yocim.git.diff({ relativePath: change.path, staged })
    if (!response.ok) {
      setError(response.error.message)
      return
    }
    if (response.data.binary) {
      setError('二进制文件不支持 Diff 预览')
      return
    }
    if (response.data.message) {
      setError(response.data.message)
      return
    }
    workspace.openDiff({
      title: `${change.path}${staged ? '（已暂存）' : ''}`,
      relativePath: change.path,
      language: languageForPath(change.path),
      original: response.data.original,
      modified: response.data.modified
    })
  }

  async function openFile(change: GitFileChange): Promise<void> {
    await workspace.openPath(change.path, { pin: true })
  }

  async function reveal(change: GitFileChange): Promise<void> {
    await workspace.reveal(change.path)
  }

  function toggleGroup(key: ScmGroup): void {
    collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] }
    persistCollapsed(collapsed.value)
  }

  function reset(): void {
    status.value = null
    branches.value = null
    output.value = []
    message.value = ''
    error.value = ''
    notice.value = ''
    busy.value = ''
  }

  return {
    status,
    branches,
    output,
    collapsed,
    message,
    loading,
    busy,
    error,
    notice,
    changeCount,
    hasRepo,
    canCommit,
    aheadBehind,
    groupsOf,
    setError,
    clearError,
    refresh,
    refreshBranches,
    loadOutput,
    stage,
    unstage,
    discard,
    commit,
    network,
    checkout,
    initRepo,
    openDiff,
    openFile,
    reveal,
    toggleGroup,
    reset
  }
})
