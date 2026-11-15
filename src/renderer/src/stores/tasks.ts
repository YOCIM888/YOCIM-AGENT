import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { TaskDefinition, TaskDiscovery, TaskEvent, TaskRun } from '@shared/tasks'

interface OutputChunk {
  id: number
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

const MAX_CHUNKS = 1500
const CONFIRMED_KEY = 'yocim.tasks.confirmed'

function readConfirmed(): Set<string> {
  try {
    const raw = localStorage.getItem(CONFIRMED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeConfirmed(value: Set<string>): void {
  try {
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify([...value]))
  } catch {
    // 忽略本地存储失败
  }
}

export const useTasksStore = defineStore('tasks', () => {
  const discovery = ref<TaskDiscovery | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const runs = ref<TaskRun[]>([])
  const output = ref<OutputChunk[]>([])
  const confirmed = reactive(readConfirmed())
  let chunkId = 0
  let listening = false

  const tasks = computed<TaskDefinition[]>(() => discovery.value?.tasks ?? [])
  const runningRuns = computed(() => runs.value.filter((run) => run.status === 'running'))
  const hasRunning = computed(() => runningRuns.value.length > 0)
  const outputText = computed(() => output.value.map((chunk) => chunk.text).join(''))

  function appendOutput(chunk: Omit<OutputChunk, 'id'>): void {
    output.value.push({ ...chunk, id: ++chunkId })
    if (output.value.length > MAX_CHUNKS) {
      output.value.splice(0, output.value.length - MAX_CHUNKS)
    }
  }

  function handleEvent(event: TaskEvent): void {
    if (event.type === 'started') {
      runs.value = [event.run, ...runs.value.filter((run) => run.runId !== event.run.runId)]
      appendOutput({
        runId: event.run.runId,
        stream: 'stdout',
        text: `▶ ${event.run.label} · ${event.run.commandLine}\n`
      })
      return
    }
    if (event.type === 'output') {
      appendOutput({ runId: event.runId, stream: event.stream, text: event.text })
      return
    }
    runs.value = runs.value.map((run) => (run.runId === event.run.runId ? event.run : run))
    const statusText =
      event.run.status === 'exited'
        ? `✔ 已退出（code ${event.run.exitCode ?? 0}）`
        : event.run.status === 'stopped'
          ? '■ 已停止'
          : `✖ 失败（code ${event.run.exitCode ?? '-'}）${event.run.message ? `：${event.run.message}` : ''}`
    appendOutput({
      runId: event.run.runId,
      stream: event.run.status === 'failed' ? 'stderr' : 'stdout',
      text: `${statusText}\n`
    })
  }

  function ensureListener(): void {
    if (listening) return
    listening = true
    window.yocim.tasks.onEvent(handleEvent)
  }

  async function refresh(): Promise<void> {
    ensureListener()
    loading.value = true
    error.value = null
    try {
      const result = await window.yocim.tasks.list()
      if (!result.ok) {
        error.value = result.error.message
        discovery.value = null
        return
      }
      discovery.value = result.data
      error.value = result.data.error ?? null
    } finally {
      loading.value = false
    }
  }

  function needsConfirmation(task: TaskDefinition): boolean {
    return task.source === 'custom' && !confirmed.has(task.id)
  }

  function markConfirmed(taskId: string): void {
    confirmed.add(taskId)
    writeConfirmed(new Set(confirmed))
  }

  async function start(
    task: TaskDefinition,
    options: { confirmed?: boolean } = {}
  ): Promise<boolean> {
    ensureListener()
    notice.value = null
    const result = await window.yocim.tasks.start({
      taskId: task.id,
      confirmed: options.confirmed === true || !needsConfirmation(task)
    })
    if (!result.ok) {
      error.value = result.error.message
      return false
    }
    if (options.confirmed) markConfirmed(task.id)
    error.value = null
    return true
  }

  async function stop(runId: string): Promise<void> {
    const result = await window.yocim.tasks.stop({ runId })
    if (!result.ok) error.value = result.error.message
  }

  async function stopAll(): Promise<void> {
    for (const run of runningRuns.value) await stop(run.runId)
  }

  function clearOutput(): void {
    output.value = []
  }

  function reset(): void {
    discovery.value = null
    runs.value = []
    output.value = []
    error.value = null
    notice.value = null
  }

  return {
    discovery,
    loading,
    error,
    notice,
    runs,
    output,
    tasks,
    runningRuns,
    hasRunning,
    outputText,
    refresh,
    start,
    stop,
    stopAll,
    clearOutput,
    needsConfirmation,
    markConfirmed,
    reset
  }
})
