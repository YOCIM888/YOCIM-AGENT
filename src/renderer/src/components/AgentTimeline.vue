<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApprovalDecision } from '@shared/approval'
import type { AgentStep } from '../lib/agentSteps'
import { hasPendingApproval } from '../lib/agentSteps'
import { useChatStore } from '../stores/chat'

const props = defineProps<{
  steps: AgentStep[]
  startedAt?: number
  endedAt?: number
}>()

const chat = useChatStore()
const expanded = ref(false)

const pending = computed(() => hasPendingApproval(props.steps))
const isOpen = computed(() => expanded.value || pending.value)

const summary = computed(() => {
  if (pending.value) return `等待审批 · ${props.steps.length} 个步骤`
  if (props.startedAt && props.endedAt) {
    return `已执行 ${props.steps.length} 个步骤 · ${formatDuration(props.endedAt - props.startedAt)}`
  }
  return `正在执行 ${props.steps.length} 个步骤`
})

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function statusLabel(step: AgentStep): string {
  if (step.status === 'running') return '执行中'
  if (step.status === 'done') return '完成'
  return '失败'
}

function approvalLabel(step: AgentStep): string {
  if (step.approval?.status === 'approved') return '已批准'
  if (step.approval?.status === 'denied') return '已拒绝'
  return '待审批'
}

function respond(step: AgentStep, decision: ApprovalDecision): void {
  if (!step.approval) return
  expanded.value = true
  void chat.respondApproval(step.approval.approvalId, decision)
}
</script>

<template>
  <div class="timeline" data-testid="timeline">
    <button
      type="button"
      class="timeline-toggle"
      :aria-expanded="isOpen"
      data-testid="timeline-toggle"
      @click="expanded = !expanded"
    >
      <span class="chevron">{{ isOpen ? '▾' : '▸' }}</span>
      <span class="summary">{{ summary }}</span>
      <span v-if="!endedAt && !pending" class="spinner"></span>
    </button>

    <ol v-if="isOpen" class="steps">
      <li
        v-for="step in steps"
        :key="step.id"
        class="step"
        :class="step.status"
        data-testid="timeline-step"
      >
        <span class="dot"></span>
        <div class="step-body">
          <div class="step-head">
            <span class="step-name">{{ step.name }}</span>
            <span class="step-status">{{ statusLabel(step) }}</span>
          </div>
          <code class="step-args">{{ step.argsSummary }}</code>
          <p v-if="step.summary" class="step-result">{{ step.summary }}</p>

          <div v-if="step.approval" class="approval-card" data-testid="approval-card">
            <div class="approval-title">
              <span>需要审批：{{ step.name }}</span>
              <span class="risk">{{ step.approval.risk }}</span>
            </div>
            <p class="approval-args">{{ step.argsSummary }}</p>
            <div v-if="step.approval.status === 'pending'" class="approval-actions">
              <button
                type="button"
                class="approve"
                data-testid="approval-approve"
                @click="respond(step, 'approve')"
              >
                批准
              </button>
              <button
                type="button"
                class="deny"
                data-testid="approval-deny"
                @click="respond(step, 'deny')"
              >
                拒绝
              </button>
            </div>
            <p v-else class="decision">{{ approvalLabel(step) }}</p>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.timeline {
  margin: 8px 0 2px;
}

.timeline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.timeline-toggle:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chevron {
  font-size: 10px;
}

.summary {
  white-space: nowrap;
}

.spinner {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.steps {
  margin: 10px 0 0;
  padding: 0 0 0 4px;
  list-style: none;
}

.step {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 0 0 12px;
}

.step:not(:last-child)::before {
  position: absolute;
  top: 12px;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--border);
  content: '';
}

.dot {
  position: relative;
  z-index: 1;
  flex: none;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--border-strong);
}

.step.running .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.step.done .dot {
  background: var(--success);
}

.step.failed .dot {
  background: var(--danger);
}

.step-body {
  flex: 1;
  min-width: 0;
}

.step-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.step-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}

.step-status {
  font-size: 10.5px;
  color: var(--text-muted);
}

.step.failed .step-status {
  color: var(--danger);
}

.step-args {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-result {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.step.failed .step-result {
  color: var(--danger);
}

.approval-card {
  margin-top: 8px;
  padding: 9px 12px;
  border: 1px solid var(--warning);
  border-radius: var(--radius-md);
  background: var(--warning-soft);
}

.approval-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--warning);
}

.risk {
  padding: 1px 8px;
  border: 1px solid var(--warning);
  border-radius: 999px;
  font-size: 10px;
}

.approval-args {
  margin: 6px 0 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text);
  user-select: text;
  word-break: break-all;
}

.approval-actions {
  display: flex;
  gap: 8px;
}

.approval-actions button {
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.approve {
  background: var(--accent);
  color: var(--accent-contrast);
}

.deny {
  background: var(--danger-soft);
  color: var(--danger);
}

.decision {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-muted);
}
</style>
