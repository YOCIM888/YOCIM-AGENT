<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useWorkspaceStore } from '../stores/workspace'

const props = withDefaults(
  defineProps<{
    modelLabel: string
    showContext?: boolean
  }>(),
  { showContext: true }
)

const chat = useChatStore()
const workspace = useWorkspaceStore()
const textarea = ref<HTMLTextAreaElement | null>(null)

const workspaceName = computed(() => workspace.info?.name ?? '未选择工作区')

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

watch(
  () => chat.draft,
  () => {
    if (!chat.draft) void nextTick(resize)
  }
)
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

    <div class="bar">
      <button type="button" class="attach" disabled title="附件（即将支持）">+</button>
      <template v-if="props.showContext">
        <span class="chip">▤ {{ workspaceName }}</span>
        <span class="chip">标准模式</span>
      </template>
      <span class="spacer"></span>
      <span class="model">{{ modelLabel }}</span>
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

.composer:focus-within {
  border-color: var(--border-strong);
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

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
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
}

.attach:disabled {
  opacity: 0.55;
  cursor: default;
}

.spacer {
  flex: 1;
}

.model {
  overflow: hidden;
  max-width: 180px;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  .chip:first-child {
    display: none;
  }
}
</style>
