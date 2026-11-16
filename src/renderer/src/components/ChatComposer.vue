<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { ApprovalMode } from '@shared/approval'
import type { ContextAttachment } from '@shared/attachment'
import { CONTEXT_WINDOW_OPTIONS, formatWindowSize } from '@shared/context'
import {
  REASONING_EFFORT_LABELS,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffort
} from '@shared/providers'
import type { ContextMenuItem } from '../lib/menu'
import { useChatStore } from '../stores/chat'
import { usePreferencesStore } from '../stores/preferences'
import { useProvidersStore } from '../stores/providers'
import { useWorkspaceStore } from '../stores/workspace'
import ContextMenu from './ContextMenu.vue'
import ContextRing from './ContextRing.vue'

const chat = useChatStore()
const workspace = useWorkspaceStore()
const providers = useProvidersStore()
const preferences = usePreferencesStore()
const textarea = ref<HTMLTextAreaElement | null>(null)
const modelMenu = ref<{ x: number; y: number } | null>(null)
const approvalMenu = ref<{ x: number; y: number } | null>(null)

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  manual: '手动模式',
  auto: '自动模式',
  open: '开放模式'
}

const APPROVAL_TITLES: Record<ApprovalMode, string> = {
  manual: '审批模式：手动 · 写文件与命令都需要审批',
  auto: '审批模式：自动 · 自动批准写文件，命令仍需审批',
  open: '审批模式：开放 · 自动批准所有工具操作'
}

const workspaceName = computed(() => workspace.info?.name ?? '未选择工作区')
const activeLabel = computed(
  () => providers.activeModel || providers.activeProvider?.name || '配置模型'
)
const activeTitle = computed(() =>
  providers.activeProvider
    ? `${providers.activeProvider.name} · ${providers.activeModel}`
    : '配置模型'
)
const approvalLabel = computed(() => APPROVAL_LABELS[preferences.approvalMode])
const approvalTitle = computed(() => APPROVAL_TITLES[preferences.approvalMode])
const approvalItems = computed<ContextMenuItem[]>(() =>
  (['manual', 'auto', 'open'] as ApprovalMode[]).map((mode) => ({
    id: mode,
    label: `${preferences.approvalMode === mode ? '✓ ' : ''}${APPROVAL_LABELS[mode]}`,
    testid: `approval-mode-${mode}`,
    separatorBefore: mode !== 'manual'
  }))
)

const modelItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = []
  for (const provider of providers.providers) {
    provider.models.forEach((model, index) => {
      const active = provider.id === providers.activeProviderId && model === providers.activeModel
      items.push({
        id: `${provider.id}::${model}`,
        label: `${active ? '✓ ' : ''}${provider.name} · ${model}`,
        testid: `model-option-${provider.id}-${model}`,
        separatorBefore: index === 0 && items.length > 0
      })
    })
  }
  if (!items.length) {
    items.push({ id: 'none', label: '暂无可用模型，请在设置中添加', disabled: true })
  }
  return items
})

function resize(): void {
  const element = textarea.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 180)}px`
}

function submit(): void {
  if (!chat.draft.trim() || chat.sending) return
  void chat.send()
  void nextTick(resize)
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function chipLabel(attachment: ContextAttachment): string {
  const name = baseName(attachment.relativePath)
  return attachment.range
    ? `${name}:${attachment.range.startLine}-${attachment.range.endLine}`
    : name
}

function attachCurrent(): void {
  const file = workspace.activeFile
  if (!file) return
  void chat.attachFile({ relativePath: file.relativePath })
}

function openModelMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const height = Math.min(
    modelItems.value.length * 30 + 16 + MODEL_MENU_FOOTER_HEIGHT,
    window.innerHeight * 0.6
  )
  modelMenu.value = { x: rect.left, y: rect.top - height - 6 }
}

const MODEL_MENU_FOOTER_HEIGHT = 96

const windowOptions = CONTEXT_WINDOW_OPTIONS
const activeWindowLabel = computed(() => formatWindowSize(providers.contextWindow))

const effortOptions = REASONING_EFFORT_LEVELS

async function changeContextWindow(value: string): Promise<void> {
  const provider = providers.activeProvider
  if (!provider) return
  const next = Number(value)
  if (!Number.isFinite(next)) return
  const ok = await providers.setContextWindow({
    providerId: provider.id,
    model: providers.activeModel,
    contextWindow: next
  })
  // 圆环显示的是最近一次用量（含 limit），窗口变了要立刻按新窗口重算
  if (ok) void chat.refreshActiveUsage()
}

async function changeReasoningEffort(value: string): Promise<void> {
  const provider = providers.activeProvider
  if (!provider) return
  await providers.setReasoningEffort({
    providerId: provider.id,
    model: providers.activeModel,
    effort: value as ReasoningEffort
  })
}

async function selectModel(id: string): Promise<void> {
  modelMenu.value = null
  if (id === 'none') return
  const separator = id.indexOf('::')
  if (separator < 0) return
  await providers.setActive(id.slice(0, separator), id.slice(separator + 2))
}

function openApprovalMenu(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const height = approvalItems.value.length * 30 + 16
  approvalMenu.value = { x: rect.left, y: rect.top - height - 6 }
}

async function selectApprovalMode(id: string): Promise<void> {
  approvalMenu.value = null
  await preferences.setApprovalMode(id as ApprovalMode)
}

watch(
  () => chat.draft,
  () => {
    if (!chat.draft) void nextTick(resize)
  }
)

onMounted(() => {
  if (!providers.providers.length) void providers.refresh()
})
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      ref="textarea"
      v-model="chat.draft"
      rows="1"
      placeholder="描述你想构建的内容，Enter 发送（Shift+Enter 换行）"
      data-testid="chat-input"
      @input="resize"
      @keydown.enter.exact.prevent="submit"
    ></textarea>

    <div
      v-if="chat.attachments.length || chat.attachmentError"
      class="attachments"
      data-testid="attachment-chips"
    >
      <span
        v-for="attachment in chat.attachments"
        :key="attachment.id"
        class="attachment"
        :title="attachment.relativePath"
        :data-testid="`attachment-${attachment.id}`"
      >
        <span class="att-name">{{ chipLabel(attachment) }}</span>
        <span v-if="attachment.truncated" class="att-trunc">截断</span>
        <button
          type="button"
          class="att-remove"
          title="移除附件"
          :data-testid="`attachment-remove-${attachment.id}`"
          @click="chat.removeAttachment(attachment.id)"
        >
          ×
        </button>
      </span>
      <button
        v-if="chat.attachments.length"
        type="button"
        class="att-clear"
        data-testid="attachment-clear"
        @click="chat.clearAttachments()"
      >
        清除
      </button>
      <span v-if="chat.attachmentError" class="att-error" data-testid="attachment-error">
        {{ chat.attachmentError }}
      </span>
    </div>

    <div class="bar">
      <button
        type="button"
        class="attach"
        :disabled="!workspace.activeFile"
        title="添加当前文件到对话"
        data-testid="attach-current"
        @click="attachCurrent"
      >
        +
      </button>
      <button
        type="button"
        class="approval"
        :class="preferences.approvalMode"
        :title="approvalTitle"
        data-testid="approval-mode"
        @click="openApprovalMenu"
      >
        <span class="approval-dot"></span>
        {{ approvalLabel }}
      </button>
      <span class="chip">▤ {{ workspaceName }}</span>
      <span class="spacer"></span>
      <ContextRing
        :usage="chat.contextUsage"
        :compressing="chat.compressing"
        :disabled="chat.sending"
        @compress="chat.compress()"
      />
      <button
        type="button"
        class="model"
        :title="activeTitle"
        data-testid="model-picker"
        @click="openModelMenu"
      >
        <span class="model-label">{{ activeLabel }}</span>
        <span class="caret">▴</span>
      </button>
      <button
        v-if="!chat.sending"
        type="submit"
        class="send"
        :disabled="!chat.draft.trim()"
        data-testid="chat-send"
        title="发送"
      >
        ↑
      </button>
      <button v-else type="button" class="stop" data-testid="chat-cancel" @click="chat.cancel()">
        停止
      </button>
    </div>

    <ContextMenu
      v-if="modelMenu"
      :x="modelMenu.x"
      :y="modelMenu.y"
      :items="modelItems"
      :footer-height="MODEL_MENU_FOOTER_HEIGHT"
      @select="selectModel"
      @close="modelMenu = null"
    >
      <template #footer>
        <label class="window-row" data-testid="context-window-row">
          <span class="window-label">上下文窗口（当前 {{ activeWindowLabel }}）</span>
          <select
            class="window-select"
            :value="providers.contextWindow"
            data-testid="context-window-select"
            @change="changeContextWindow(($event.target as HTMLSelectElement).value)"
            @click.stop
          >
            <option v-for="option in windowOptions" :key="option" :value="option">
              {{ formatWindowSize(option) }}
            </option>
          </select>
        </label>
        <label class="window-row" data-testid="reasoning-effort-row">
          <span class="window-label">思考强度</span>
          <select
            class="window-select"
            :value="providers.reasoningEffort"
            data-testid="reasoning-effort-select"
            @change="changeReasoningEffort(($event.target as HTMLSelectElement).value)"
            @click.stop
          >
            <option v-for="option in effortOptions" :key="option" :value="option">
              {{ REASONING_EFFORT_LABELS[option] }}
            </option>
          </select>
        </label>
      </template>
    </ContextMenu>

    <ContextMenu
      v-if="approvalMenu"
      :x="approvalMenu.x"
      :y="approvalMenu.y"
      :items="approvalItems"
      @select="selectApprovalMode"
      @close="approvalMenu = null"
    />
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 12px 12px 10px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

textarea:focus-visible {
  outline: none;
}

textarea {
  width: 100%;
  min-height: 28px;
  max-height: 180px;
  resize: none;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  outline: none;
}

textarea::placeholder {
  color: var(--text-muted);
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text);
  font-size: 11px;
}

.att-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.att-trunc {
  flex: none;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--warning-soft, rgba(220, 182, 122, 0.2));
  color: var(--warning, #b8860b);
  font-size: 9.5px;
}

.att-remove {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.att-remove:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

.att-clear {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.att-clear:hover {
  color: var(--text);
}

.att-error {
  width: 100%;
  color: var(--danger);
  font-size: 10.5px;
}

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.approval {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  white-space: nowrap;
  cursor: pointer;
}

.approval:hover {
  border-color: var(--border);
  background: var(--bg-hover);
}

.approval.auto {
  color: var(--accent);
}

.approval.open {
  color: var(--warning);
}

.approval-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.chip {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
}

.attach {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.attach:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.attach:disabled {
  opacity: 0.55;
  cursor: default;
}

.spacer {
  flex: 1;
}

.model {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.model:hover {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.model-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  flex: none;
  font-size: 9px;
}

.window-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: default;
}

.window-row + .window-row {
  margin-top: 8px;
}

.window-label {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.window-select {
  flex: none;
  max-width: 90px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-subtle);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.send,
.stop {
  flex: none;
  height: 30px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.send {
  width: 30px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 15px;
}

.send:disabled {
  opacity: 0.4;
  cursor: default;
}

.stop {
  padding: 0 14px;
  background: var(--danger-soft);
  color: var(--danger);
}

@media (max-width: 1200px) {
  .chip {
    display: none;
  }
}
</style>
