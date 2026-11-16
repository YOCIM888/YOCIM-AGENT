<script setup lang="ts">
import { computed } from 'vue'
import { formatTokenCount, formatWindowSize, usageTone, type ContextUsage } from '@shared/context'

const props = defineProps<{
  usage: ContextUsage | null
  compressing: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  compress: []
}>()

const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const percent = computed(() => Math.round((props.usage?.percent ?? 0) * 100))
const tone = computed(() => usageTone(props.usage?.percent ?? 0))
const dashOffset = computed(() => CIRCUMFERENCE * (1 - Math.min(1, props.usage?.percent ?? 0)))

const title = computed(() => {
  const usage = props.usage
  if (!usage) return '上下文用量：暂无数据'
  const tooltip = `上下文 ${percent.value}%（${formatTokenCount(usage.used)} / ${formatWindowSize(usage.limit)} tokens）`
  return props.compressing ? `正在压缩上下文…（${tooltip}）` : `${tooltip} · 点击手动压缩`
})

function onClick(): void {
  if (props.disabled || props.compressing) return
  emit('compress')
}
</script>

<template>
  <button
    type="button"
    class="ring"
    :class="[tone, { compressing, disabled }]"
    :title="title"
    data-testid="context-ring"
    :aria-label="title"
    @click="onClick"
  >
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle class="track" cx="10" cy="10" :r="RADIUS" fill="none" stroke-width="2.5" />
      <circle
        v-if="percent > 0"
        class="value"
        cx="10"
        cy="10"
        :r="RADIUS"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 10 10)"
      />
    </svg>
    <span v-if="compressing" class="spin"></span>
  </button>
</template>

<style scoped>
.ring {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.ring:hover:not(.disabled) {
  background: var(--bg-hover);
}

.ring.disabled,
.ring.compressing {
  cursor: default;
}

.track {
  stroke: var(--border);
}

.value {
  transition:
    stroke-dashoffset 0.4s ease,
    stroke 0.2s ease;
}

.ring.low .value {
  stroke: var(--accent);
}

.ring.medium .value {
  stroke: var(--warning, #b8860b);
}

.ring.high .value {
  stroke: var(--danger);
}

.spin {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ring-spin 0.8s linear infinite;
}

@keyframes ring-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
