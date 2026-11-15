<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '../stores/chat'
import { useChatStore } from '../stores/chat'
import { useProjectsStore } from '../stores/projects'
import { useSessionStore } from '../stores/session'
import AgentTimeline from './AgentTimeline.vue'
import ChatComposer from './ChatComposer.vue'
import MarkdownMessage from './MarkdownMessage.vue'
import WelcomeState from './WelcomeState.vue'

const chat = useChatStore()
const sessions = useSessionStore()
const projects = useProjectsStore()
const listRef = ref<HTMLDivElement | null>(null)
const stickToBottom = ref(true)

const projectName = computed(() => {
  const projectId = sessions.activeSession?.projectId
  if (!projectId) return ''
  return projects.projects.find((project) => project.id === projectId)?.name ?? ''
})

const runState = computed(() => {
  if (chat.pendingApprovals.length) return '等待审批'
  if (chat.sending) return '生成中'
  return '就绪'
})

const runTone = computed(() => {
  if (chat.pendingApprovals.length) return 'warning'
  if (chat.sending) return 'active'
  return 'idle'
})

function handleScroll(): void {
  const element = listRef.value
  if (!element) return
  stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 80
}

function scrollToBottom(force = false): void {
  if (!force && !stickToBottom.value) return
  void nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  })
}

function roleLabel(role: ChatMessage['role']): string {
  if (role === 'user') return '我'
  if (role === 'assistant') return '助手'
  return '系统'
}

watch(
  () => chat.messages.length,
  () => scrollToBottom(true)
)
watch(
  () => chat.messages[chat.messages.length - 1]?.content,
  () => scrollToBottom()
)
watch(
  () => chat.pendingApprovals.length,
  () => scrollToBottom(true)
)
</script>

<template>
  <section class="chat" data-testid="chat-panel">
    <header class="chat-header">
      <div class="session-block">
        <span class="session-title">{{ sessions.activeSession?.title ?? '新会话' }}</span>
        <span v-if="projectName" class="project-chip">{{ projectName }}</span>
      </div>
      <div class="run-block">
        <span class="status-dot" :class="runTone"></span>
        <span class="status-label" data-testid="chat-status">{{ runState }}</span>
      </div>
    </header>

    <template v-if="!chat.messages.length">
      <div class="welcome-wrap">
        <WelcomeState />
        <div class="welcome-composer">
          <ChatComposer :show-context="false" />
        </div>
      </div>
    </template>

    <template v-else>
      <div ref="listRef" class="messages" @scroll.passive="handleScroll">
        <article
          v-for="message in chat.messages"
          :key="message.id"
          class="message"
          :class="message.role"
        >
          <template v-if="message.role === 'system'">
            <span class="role">{{ roleLabel(message.role) }}</span>
            <p class="content system-content">{{ message.content }}</p>
          </template>
          <div v-else-if="message.role === 'user'" class="content user-bubble">
            {{ message.content }}
          </div>
          <div v-else class="content">
            <MarkdownMessage
              v-if="message.content"
              :content="message.content"
              :streaming="message.streaming"
            />
            <span v-if="message.streaming" class="cursor">▍</span>
            <AgentTimeline
              v-if="message.steps?.length"
              :steps="message.steps"
              :started-at="message.runStartedAt"
              :ended-at="message.runEndedAt"
            />
            <div v-if="message.error" class="error-card" data-testid="error-card">
              <div class="error-head">
                <span class="error-icon">!</span>
                <span>请求失败</span>
              </div>
              <p class="error-message">{{ message.error.message }}</p>
              <button
                type="button"
                class="retry"
                :disabled="chat.sending"
                data-testid="error-retry"
                @click="chat.retry()"
              >
                重试
              </button>
            </div>
          </div>
        </article>
      </div>

      <div class="bottom-composer">
        <ChatComposer />
      </div>
    </template>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 42px;
  padding: 0 22px;
  border-bottom: 1px solid var(--border);
}

.session-block {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.session-title {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-chip {
  max-width: 200px;
  overflow: hidden;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-block {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}

.status-dot.active {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.status-dot.warning {
  background: var(--warning);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.welcome-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 24px 24px 48px;
  overflow: auto;
}

.welcome-composer {
  width: 100%;
  max-width: 760px;
}

.messages {
  flex: 1;
  min-height: 0;
  padding: 24px 24px 12px;
  overflow: auto;
}

.message {
  display: flex;
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 8px 0;
  animation: message-in 140ms ease-out;
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.message.user {
  justify-content: flex-end;
}

.message.system {
  gap: 8px;
}

.role {
  flex: none;
  padding-top: 3px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.content {
  min-width: 0;
}

.user-bubble {
  max-width: 82%;
  padding: 8px 13px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--text);
  font-size: 13.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  user-select: text;
}

.message.system .content {
  font-size: 12px;
  color: var(--text-muted);
  white-space: pre-wrap;
  user-select: text;
}

.cursor {
  color: var(--accent);
}

.error-card {
  margin-top: 8px;
  padding: 10px 14px;
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--danger-soft);
}

.error-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--danger);
}

.error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1px solid var(--danger);
  border-radius: 50%;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.error-message {
  margin: 6px 0 8px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
  user-select: text;
  word-break: break-word;
}

.retry {
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.retry:disabled {
  opacity: 0.5;
  cursor: default;
}

.retry:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--accent);
}

.bottom-composer {
  width: calc(100% - 48px);
  max-width: 820px;
  margin: 0 auto 18px;
}

@media (max-width: 1200px) {
  .chat-header {
    padding: 0 16px;
  }

  .welcome-wrap {
    padding: 20px 16px 36px;
  }

  .messages {
    padding: 20px 16px 12px;
  }

  .bottom-composer {
    width: calc(100% - 32px);
  }
}
</style>
