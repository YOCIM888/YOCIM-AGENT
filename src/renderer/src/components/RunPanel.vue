<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { DebugConfig } from '@shared/debug'
import type { TaskDefinition } from '@shared/tasks'
import { useDebugStore } from '../stores/debug'
import { useTasksStore } from '../stores/tasks'
import { useWorkspaceStore } from '../stores/workspace'
import CollapsibleSection from './CollapsibleSection.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import DebugBreakpoints from './DebugBreakpoints.vue'
import DebugInspector from './DebugInspector.vue'

const props = defineProps<{ active: boolean }>()

const tasks = useTasksStore()
const debug = useDebugStore()
const workspace = useWorkspaceStore()

const CONFIRMED_KEY = 'yocim.debug.confirmedConfigs'

interface PendingAction {
  kind: 'config' | 'task'
  title: string
  message: string
  config?: DebugConfig
  task?: TaskDefinition
}

const pending = ref<PendingAction | null>(null)
const confirmedConfigs = reactive<Set<string>>(readConfirmed())

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

function persistConfirmed(): void {
  try {
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify([...confirmedConfigs]))
  } catch {
    // 忽略本地存储失败
  }
}

const statusLabel = computed(() => {
  switch (debug.status) {
    case 'starting':
      return '启动中'
    case 'running':
      return '运行中'
    case 'paused':
      return '已暂停'
    case 'error':
      return '启动失败'
    case 'stopped':
      return '已结束'
    default:
      return '未启动'
  }
})

const activeFile = computed(() => workspace.activeTab?.relativePath)
const runningCount = computed(() => tasks.runningRuns.length)

function previewCommand(config: DebugConfig): string {
  return ['node', ...(config.runtimeArgs ?? []), config.program, ...(config.args ?? [])].join(' ')
}

function requestStartConfig(config: DebugConfig): void {
  if (confirmedConfigs.has(config.id)) {
    void debug.start(config, activeFile.value)
    return
  }
  pending.value = {
    kind: 'config',
    title: '确认调试命令',
    message: `将执行：${previewCommand(config)}（首次运行需确认完整命令）`,
    config
  }
}

function requestStartTask(task: TaskDefinition): void {
  if (!tasks.needsConfirmation(task)) {
    void tasks.start(task, { confirmed: true })
    return
  }
  pending.value = {
    kind: 'task',
    title: '确认任务命令',
    message: `将执行：${task.commandLine}（自定义任务首次运行需确认）`,
    task
  }
}

async function confirmPending(): Promise<void> {
  const action = pending.value
  pending.value = null
  if (!action) return
  if (action.kind === 'config' && action.config) {
    confirmedConfigs.add(action.config.id)
    persistConfirmed()
    await debug.start(action.config, activeFile.value)
    return
  }
  if (action.task) await tasks.start(action.task, { confirmed: true })
}

function dismissPending(): void {
  pending.value = null
}

function refreshAll(): void {
  void tasks.refresh()
  void debug.refreshConfigs()
}

async function startDebug(config: DebugConfig): Promise<void> {
  requestStartConfig(config)
}

watch(
  () => props.active,
  (active) => {
    if (active) refreshAll()
  }
)

watch(
  () => workspace.info?.root,
  () => {
    tasks.reset()
    refreshAll()
  }
)

onMounted(refreshAll)
</script>

<template>
  <aside class="run" data-testid="run-panel">
    <div class="run-head">
      <span class="title">运行和调试</span>
      <span v-if="debug.isActive" class="status" data-testid="debug-status">{{ statusLabel }}</span>
      <button
        type="button"
        class="icon"
        title="刷新配置与任务"
        data-testid="run-refresh"
        :disabled="tasks.loading || debug.loading"
        @click="refreshAll"
      >
        ↻
      </button>
    </div>

    <div v-if="tasks.error" class="error" data-testid="run-error">{{ tasks.error }}</div>
    <div v-if="debug.error" class="error" data-testid="debug-error">{{ debug.error }}</div>
    <div v-if="tasks.notice" class="notice" data-testid="run-notice">{{ tasks.notice }}</div>

    <div v-if="!workspace.info" class="hint" data-testid="run-no-workspace">
      打开工作区后可运行 npm scripts、自定义任务并调试 Node.js
    </div>

    <div v-else class="run-body">
      <div v-if="debug.isActive" class="toolbar" data-testid="debug-toolbar">
        <button
          type="button"
          title="继续 (F5)"
          data-testid="debug-continue"
          :disabled="!debug.isPaused"
          @click="debug.command('continue')"
        >
          ▶
        </button>
        <button
          type="button"
          title="暂停"
          data-testid="debug-pause"
          :disabled="debug.isPaused"
          @click="debug.command('pause')"
        >
          ⏸
        </button>
        <button
          type="button"
          title="单步跳过"
          data-testid="debug-step-over"
          :disabled="!debug.isPaused"
          @click="debug.command('stepOver')"
        >
          ⤵
        </button>
        <button
          type="button"
          title="单步进入"
          data-testid="debug-step-into"
          :disabled="!debug.isPaused"
          @click="debug.command('stepInto')"
        >
          ⇥
        </button>
        <button
          type="button"
          title="单步跳出"
          data-testid="debug-step-out"
          :disabled="!debug.isPaused"
          @click="debug.command('stepOut')"
        >
          ⇤
        </button>
        <button
          type="button"
          title="重启"
          data-testid="debug-restart"
          @click="debug.command('restart')"
        >
          ⟳
        </button>
        <button
          type="button"
          class="stop"
          title="停止"
          data-testid="debug-stop"
          @click="debug.stop()"
        >
          ■
        </button>
        <span class="session-name" :title="debug.session?.commandLine">
          {{ debug.session?.configName }}
        </span>
      </div>

      <CollapsibleSection
        title="运行配置"
        section="runConfigs"
        testid="run-configs"
        :count="debug.configs.length"
      >
        <div v-if="debug.configFile?.error" class="hint" data-testid="run-configs-empty">
          {{ debug.configFile.error }}
        </div>
        <ul v-else class="list">
          <li
            v-for="config in debug.configs"
            :key="config.id"
            class="row"
            :data-testid="`run-config-${config.id}`"
          >
            <span class="row-main">
              <span class="row-label" :title="config.program">{{ config.name }}</span>
              <span class="row-detail">{{ config.source }} · {{ config.program }}</span>
            </span>
            <button
              type="button"
              class="row-action"
              title="启动调试"
              :data-testid="`run-config-start-${config.id}`"
              :disabled="debug.busy || debug.isActive"
              @click="startDebug(config)"
            >
              ▶
            </button>
          </li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="任务"
        section="runTasks"
        testid="run-tasks"
        :count="tasks.tasks.length"
      >
        <div v-if="!tasks.tasks.length" class="hint" data-testid="run-tasks-empty">
          未发现可运行任务：需要 package.json 的 scripts，或新建 .yocim/tasks.json
        </div>
        <ul v-else class="list">
          <li
            v-for="task in tasks.tasks"
            :key="task.id"
            class="row"
            :data-testid="`run-task-${task.id}`"
          >
            <span class="row-main">
              <span class="row-label" :title="task.commandLine">{{ task.label }}</span>
              <span class="row-detail">{{ task.commandLine }}</span>
            </span>
            <button
              v-if="!tasks.runningRuns.some((run) => run.taskId === task.id)"
              type="button"
              class="row-action"
              title="运行任务"
              :data-testid="`run-task-start-${task.id}`"
              @click="requestStartTask(task)"
            >
              ▶
            </button>
            <button
              v-else
              type="button"
              class="row-action stop"
              title="停止任务"
              :data-testid="`run-task-stop-${task.id}`"
              @click="
                tasks.stop(tasks.runningRuns.find((run) => run.taskId === task.id)?.runId ?? '')
              "
            >
              ■
            </button>
          </li>
        </ul>
      </CollapsibleSection>

      <DebugBreakpoints />

      <DebugInspector v-if="debug.session" />

      <CollapsibleSection
        title="调试控制台"
        section="debugConsole"
        testid="debug-console"
        :count="debug.consoleLines.length"
      >
        <div class="console-tools">
          <button type="button" data-testid="debug-console-clear" @click="debug.clearConsole()">
            清空
          </button>
        </div>
        <pre class="console" data-testid="debug-console-text">{{ debug.consoleText }}</pre>
      </CollapsibleSection>

      <CollapsibleSection
        title="任务输出"
        section="runOutput"
        testid="run-output"
        :count="runningCount"
      >
        <div class="console-tools">
          <button type="button" data-testid="run-output-clear" @click="tasks.clearOutput()">
            清空
          </button>
        </div>
        <pre class="console" data-testid="run-output-text">{{ tasks.outputText }}</pre>
      </CollapsibleSection>
    </div>

    <ConfirmDialog
      v-if="pending"
      :title="pending.title"
      :message="pending.message"
      confirm-label="运行"
      testid="run-confirm-dialog"
      @confirm="confirmPending"
      @close="dismissPending"
    />
  </aside>
</template>

<style scoped>
.run {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.run-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
}

.icon {
  flex: none;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.error,
.notice {
  flex: none;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.5;
}

.error {
  color: var(--danger);
}

.notice {
  color: var(--text-muted);
}

.hint {
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.run-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.toolbar button {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.toolbar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.toolbar button.stop {
  color: var(--danger);
}

.session-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list {
  margin: 0;
  padding: 2px 0 4px;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
}

.row:hover {
  background: var(--bg-hover);
}

.row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.row-label {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-detail {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-action {
  flex: none;
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}

.row-action:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.row-action:disabled {
  opacity: 0.35;
  cursor: default;
}

.row-action.stop {
  border-color: var(--danger);
  color: var(--danger);
}

.console-tools {
  display: flex;
  justify-content: flex-end;
  padding: 4px 8px 0;
}

.console-tools button {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.console {
  max-height: 220px;
  margin: 0;
  padding: 6px 10px 8px;
  overflow: auto;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
