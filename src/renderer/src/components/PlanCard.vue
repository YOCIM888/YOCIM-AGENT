<script setup lang="ts">
import type { PlanItem } from '@shared/agent'
import { computed } from 'vue'
import { useChatStore } from '../stores/chat'

const props = defineProps<{
  plan: PlanItem[]
  paused?: boolean
}>()

const chat = useChatStore()

const doneCount = computed(() => props.plan.filter((item) => item.status === 'done').length)
const percent = computed(() =>
  props.plan.length ? Math.round((doneCount.value / props.plan.length) * 100) : 0
)

function statusLabel(item: PlanItem): string {
  if (item.status === 'done') return '完成'
  if (item.status === 'doing') return '进行中'
  return '待办'
}
</script>

<template>
  <div class="plan-card" data-testid="plan-card">
    <div class="plan-head">
      <span class="plan-title">任务计划</span>
      <span class="plan-progress">{{ doneCount }}/{{ plan.length }} · {{ percent }}%</span>
    </div>
    <div class="plan-bar">
      <div class="plan-bar-fill" :style="{ width: `${percent}%` }"></div>
    </div>
    <ol class="plan-items">
      <li
        v-for="(item, index) in plan"
        :key="index"
        class="plan-item"
        :class="item.status"
        :data-testid="`plan-item-${item.status}`"
      >
        <span class="mark">{{
          item.status === 'done' ? '✓' : item.status === 'doing' ? '◐' : '○'
        }}</span>
        <span class="step">{{ item.step }}</span>
        <span class="status">{{ statusLabel(item) }}</span>
      </li>
    </ol>
    <button
      v-if="paused"
      type="button"
      class="continue"
      data-testid="plan-continue"
      @click="chat.continuePlan()"
    >
      继续执行
    </button>
  </div>
</template>

<style scoped>
.plan-card {
  margin: 0 0 10px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.plan-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.plan-progress {
  font-size: 11px;
  color: var(--text-muted);
}

.plan-bar {
  height: 3px;
  margin: 8px 0;
  border-radius: 999px;
  background: var(--bg-subtle);
  overflow: hidden;
}

.plan-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.3s ease;
}

.plan-items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  line-height: 1.5;
}

.mark {
  flex: none;
  color: var(--text-muted);
}

.plan-item.doing .mark,
.plan-item.doing .step {
  color: var(--accent);
}

.plan-item.done .mark {
  color: var(--success);
}

.plan-item.done .step {
  color: var(--text-muted);
  text-decoration: line-through;
}

.step {
  flex: 1;
  min-width: 0;
  color: var(--text);
  word-break: break-word;
}

.status {
  flex: none;
  font-size: 10.5px;
  color: var(--text-muted);
}

.plan-item.doing .status {
  color: var(--accent);
}

.continue {
  margin-top: 8px;
  padding: 5px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
