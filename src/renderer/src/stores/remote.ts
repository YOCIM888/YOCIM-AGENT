import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { RemoteConnectionState, RemoteEnvironment, RemoteTargetSummary } from '@shared/remote'
import type { RemoteTargetInputPayload, WorkspaceInfo } from '@shared/ipc'
import { useSettingsStore } from './settings'
import { useWorkspaceStore } from './workspace'

export interface RemoteFormState {
  id?: string
  kind: 'wsl' | 'ssh'
  name: string
  distro: string
  host: string
  port: string
  username: string
  authType: 'agent' | 'key' | 'password'
  keyPath: string
  rootPath: string
  secret: string
}

function emptyForm(kind: 'wsl' | 'ssh' = 'wsl'): RemoteFormState {
  return {
    kind,
    name: '',
    distro: '',
    host: '',
    port: '22',
    username: '',
    authType: 'key',
    keyPath: '',
    rootPath: '',
    secret: ''
  }
}

export const useRemoteStore = defineStore('remote', () => {
  const environment = ref<RemoteEnvironment | null>(null)
  const targets = ref<RemoteTargetSummary[]>([])
  const connection = ref<RemoteConnectionState | null>(null)
  const loading = ref(false)
  const probing = ref(false)
  const saving = ref(false)
  const busyId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const form = ref<RemoteFormState | null>(null)

  const connected = computed(() => connection.value?.status === 'connected')
  const pendingFingerprint = computed(() => connection.value?.pendingFingerprint ?? null)
  const wslDistros = computed(() => environment.value?.wsl.distros ?? [])

  function clearMessages(): void {
    error.value = null
    notice.value = null
  }

  async function probe(): Promise<void> {
    probing.value = true
    try {
      const result = await window.yocim.remote.probe()
      if (!result.ok) {
        error.value = result.error.message
        return
      }
      environment.value = result.data
    } finally {
      probing.value = false
    }
  }

  async function refresh(options: { silent?: boolean } = {}): Promise<void> {
    loading.value = true
    if (!options.silent) clearMessages()
    try {
      const [list, current] = await Promise.all([
        window.yocim.remote.list(),
        window.yocim.remote.current()
      ])
      if (!list.ok) {
        error.value = list.error.message
        return
      }
      targets.value = list.data
      if (current.ok) connection.value = current.data
    } finally {
      loading.value = false
    }
  }

  async function initialize(): Promise<void> {
    await Promise.all([probe(), refresh()])
  }

  function startCreate(kind: 'wsl' | 'ssh' = 'wsl'): void {
    clearMessages()
    const initial = emptyForm(kind)
    const defaultDistro = environment.value?.wsl.defaultDistro
    if (kind === 'wsl' && defaultDistro) initial.distro = defaultDistro
    form.value = initial
  }

  function startEdit(target: RemoteTargetSummary): void {
    clearMessages()
    form.value = {
      id: target.id,
      kind: target.kind,
      name: target.name,
      distro: target.distro ?? '',
      host: target.host ?? '',
      port: String(target.port ?? 22),
      username: target.username ?? '',
      authType: target.authType ?? 'key',
      keyPath: target.keyPath ?? '',
      rootPath: target.rootPath,
      secret: ''
    }
  }

  function cancelForm(): void {
    form.value = null
  }

  function buildPayload(state: RemoteFormState): RemoteTargetInputPayload {
    const payload: RemoteTargetInputPayload = {
      kind: state.kind,
      rootPath: state.rootPath.trim(),
      ...(state.id ? { id: state.id } : {}),
      ...(state.name.trim() ? { name: state.name.trim() } : {})
    }
    if (state.kind === 'wsl') {
      payload.distro = state.distro.trim()
    } else {
      payload.host = state.host.trim()
      payload.username = state.username.trim()
      payload.port = Number(state.port) || 22
      payload.authType = state.authType
      if (state.authType === 'key') payload.keyPath = state.keyPath.trim()
      if (state.secret) payload.secret = state.secret
    }
    return payload
  }

  async function save(): Promise<boolean> {
    const state = form.value
    if (!state) return false
    saving.value = true
    clearMessages()
    try {
      const result = await window.yocim.remote.save(buildPayload(state))
      if (!result.ok) {
        error.value = result.error.message
        return false
      }
      targets.value = result.data
      form.value = null
      const saved = result.data.find((item) => item.id === state.id) ?? result.data[0]
      notice.value = saved ? `已保存远程目标：${saved.name}` : '已保存远程目标'
      return true
    } finally {
      saving.value = false
    }
  }

  async function remove(id: string): Promise<void> {
    clearMessages()
    busyId.value = id
    try {
      const result = await window.yocim.remote.remove({ id })
      if (!result.ok) {
        error.value = result.error.message
        return
      }
      targets.value = result.data
      const wasConnected = connection.value?.targetId === id
      const current = await window.yocim.remote.current()
      if (current.ok) connection.value = current.data
      if (wasConnected) await useWorkspaceStore().restore()
      notice.value = '已删除远程目标'
    } finally {
      busyId.value = null
    }
  }

  async function applyWorkspace(workspace: WorkspaceInfo): Promise<void> {
    await useWorkspaceStore().applyInfo(workspace)
    useSettingsStore().setWorkspaceView('files')
  }

  async function connect(id: string, trust = false): Promise<void> {
    clearMessages()
    busyId.value = id
    try {
      const result = await window.yocim.remote.connect({
        id,
        ...(trust ? { trustHostFingerprint: true } : {})
      })
      if (!result.ok) {
        error.value = result.error.message
        await refresh({ silent: true })
        return
      }
      connection.value = result.data.connection
      if (result.data.connection.pendingFingerprint) {
        notice.value = '首次连接该主机，请核对指纹后确认'
        return
      }
      if (result.data.workspace) {
        await applyWorkspace(result.data.workspace)
        notice.value = `已连接到 ${result.data.connection.label}`
      }
    } finally {
      busyId.value = null
    }
  }

  async function trustAndConnect(): Promise<void> {
    const id = connection.value?.targetId
    if (!id) return
    await connect(id, true)
  }

  async function disconnect(): Promise<void> {
    clearMessages()
    busyId.value = connection.value?.targetId ?? 'disconnect'
    try {
      const result = await window.yocim.remote.disconnect()
      if (!result.ok) {
        error.value = result.error.message
        return
      }
      connection.value = result.data.connection
      if (result.data.workspace) await applyWorkspace(result.data.workspace)
      else await useWorkspaceStore().restore()
      notice.value = '已断开远程连接'
    } finally {
      busyId.value = null
    }
  }

  function reset(): void {
    environment.value = null
    targets.value = []
    connection.value = null
    form.value = null
    error.value = null
    notice.value = null
    busyId.value = null
  }

  return {
    environment,
    targets,
    connection,
    loading,
    probing,
    saving,
    busyId,
    error,
    notice,
    form,
    connected,
    pendingFingerprint,
    wslDistros,
    probe,
    refresh,
    initialize,
    startCreate,
    startEdit,
    cancelForm,
    save,
    remove,
    connect,
    trustAndConnect,
    disconnect,
    reset
  }
})
