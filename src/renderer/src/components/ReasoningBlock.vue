<script setup lang="ts">
import { t } from '../i18n'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { formatDuration } from '../lib/timeline'

const props = defineProps<{
  /** 已收到的思考内容（流式累积） */
  content: string
  /** 本轮是否还在产出思考内容 */
  streaming?: boolean
}>()

const startedAt = Date.now()
const endedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

/** null = 跟随默认行为（思考中展开、结束后折叠）；用户手动点过之后以用户选择为准。 */
const manualOpen = ref<boolean | null>(null)
const isOpen = computed(() => manualOpen.value ?? Boolean(props.streaming))

const bodyRef = ref<HTMLDivElement | null>(null)

function stopTimer(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function startTimer(): void {
  if (timer !== null) return
  now.value = Date.now()
  timer = setInterval(() => {
    now.value = Date.now()
  }, 200)
}

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) {
      startTimer()
    } else {
      endedAt.value = endedAt.value ?? Date.now()
      stopTimer()
    }
  },
  { immediate: true }
)

onBeforeUnmount(stopTimer)

const elapsed = computed(() => {
  const end = props.streaming ? now.value : (endedAt.value ?? now.value)
  return formatDuration(end - startedAt)
})

const label = computed(() =>
  props.streaming ? t('正在思考…') : t('已思考 · {elapsed}', { elapsed: elapsed.value })
)

async function scrollToEnd(): Promise<void> {
  await nextTick()
  const element = bodyRef.value
  if (element) element.scrollTop = element.scrollHeight
}

watch(
  () => props.content,
  () => {
    if (isOpen.value) void scrollToEnd()
  }
)

function toggle(): void {
  manualOpen.value = !isOpen.value
  if (manualOpen.value) void scrollToEnd()
}
</script>

<template>
  <div class="reasoning" :class="{ running: streaming }" data-testid="reasoning-block">
    <button
      type="button"
      class="reasoning-toggle"
      :aria-expanded="isOpen"
      data-testid="reasoning-toggle"
      @click="toggle"
    >
      <span v-if="streaming" class="lead running" aria-hidden="true">
        <svg class="spinner" viewBox="0 0 16 16" width="13" height="13">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.2"
            stroke-width="1.9"
          />
          <path
            d="M8 2a6 6 0 0 1 6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <span v-else class="lead done" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m3 8.5 3.2 3.2L13 5" />
        </svg>
      </span>

      <span class="label">{{ label }}</span>
      <span class="hint">{{ t('推理过程') }}</span>
    </button>

    <div v-if="isOpen" ref="bodyRef" class="reasoning-body" data-testid="reasoning-content">
      <span class="text">{{ content }}</span><span
        v-if="streaming"
        class="caret"
        aria-hidden="true"
      ></span>
    </div>
  </div>
</template>

<style scoped>
.reasoning {
  margin: 2px 0 10px;
}

.reasoning-toggle {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  transition: color 140ms ease;
}

.reasoning-toggle:hover {
  color: var(--text);
}

.reasoning.running .reasoning-toggle {
  color: var(--text);
}

.lead {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.lead.running {
  color: var(--accent);
}

.lead.done {
  color: var(--success);
}

.spinner {
  display: block;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.label {
  flex: none;
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
}

.hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reasoning-body {
  max-height: 220px;
  margin-top: 2px;
  padding: 2px 0 4px 24px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;
  overflow: auto;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  user-select: text;
}

.text {
  color: inherit;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 12px;
  margin-left: 1px;
  border-radius: 1px;
  background: var(--accent);
  vertical-align: text-bottom;
  animation: caret-blink 1.05s ease-in-out infinite;
}

@keyframes caret-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.15;
  }
}
</style>
