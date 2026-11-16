<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ApprovalDecision } from '@shared/approval'
import type { AgentStep } from '../lib/agentSteps'
import { hasPendingApproval } from '../lib/agentSteps'
import {
  approvalStatusLabel,
  formatDuration,
  stepDuration,
  stepStatusLabel,
  toolDetail
} from '../lib/timeline'
import { useChatStore } from '../stores/chat'
import ToolIcon from './ToolIcon.vue'

const props = defineProps<{
  steps: AgentStep[]
  startedAt?: number
  endedAt?: number
}>()

const chat = useChatStore()
const expanded = ref(false)

/** approvalId → 完整审批请求（含 diff 预览） */
const requestById = computed(() => {
  const map = new Map<string, (typeof chat.pendingApprovals)[number]>()
  for (const request of chat.pendingApprovals) map.set(request.approvalId, request)
  return map
})

function requestOf(step: AgentStep): (typeof chat.pendingApprovals)[number] | null {
  const approvalId = step.approval?.approvalId
  return approvalId ? (requestById.value.get(approvalId) ?? null) : null
}

const pending = computed(() => hasPendingApproval(props.steps))
const isOpen = computed(() => expanded.value || pending.value)

/** 本轮是否仍在运行（未收到结束时间戳）。 */
const running = computed(() => !props.endedAt)

/** 折叠态下实时滚动的计时基准。 */
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

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
  }, 100)
}

watch(
  () => props.endedAt,
  (ended) => {
    if (ended) stopTimer()
    else startTimer()
  },
  { immediate: true }
)

onBeforeUnmount(stopTimer)

/** 正在执行的步骤：折叠时也让人看得见「在忙什么」。 */
const activeStep = computed(() => {
  for (let index = props.steps.length - 1; index >= 0; index -= 1) {
    if (props.steps[index].status === 'running') return props.steps[index]
  }
  return null
})

const activeLabel = computed(() => {
  const step = activeStep.value
  if (!step) return ''
  const detail = toolDetail(step.name, step.argsSummary)
  return detail ? `${step.name} · ${detail}` : step.name
})

const summary = computed(() => {
  if (pending.value) return `等待审批 · ${props.steps.length} 个步骤`
  if (props.startedAt && props.endedAt) return `已执行 ${props.steps.length} 个步骤`
  return `正在执行 ${props.steps.length} 个步骤`
})

const elapsed = computed(() => {
  if (!props.startedAt) return ''
  const end = props.endedAt ?? now.value
  return formatDuration(end - props.startedAt)
})

const leadTone = computed(() => {
  if (pending.value) return 'pending'
  if (running.value) return 'running'
  return 'done'
})

function detailOf(step: AgentStep): string {
  return toolDetail(step.name, step.argsSummary)
}

function riskLabel(risk: 'medium' | 'high'): string {
  return risk === 'high' ? '高风险' : '中风险'
}

function respond(step: AgentStep, decision: ApprovalDecision): void {
  if (!step.approval) return
  expanded.value = true
  void chat.respondApproval(step.approval.approvalId, decision)
}

function linePrefix(type: 'add' | 'del' | 'ctx'): string {
  return type === 'add' ? '+ ' : type === 'del' ? '- ' : '  '
}
</script>

<template>
  <div class="timeline" :class="leadTone" data-testid="timeline">
    <button
      type="button"
      class="timeline-toggle"
      :aria-expanded="isOpen"
      data-testid="timeline-toggle"
      @click="expanded = !expanded"
    >
      <span v-if="running" class="sweep" aria-hidden="true"></span>
      <span class="lead" :class="leadTone" aria-hidden="true">
        <svg
          v-if="leadTone === 'running'"
          class="spinner"
          viewBox="0 0 16 16"
          width="13"
          height="13"
        >
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
        <span v-else class="lead-glyph">{{ leadTone === 'pending' ? '!' : '✓' }}</span>
      </span>

      <span class="summary">{{ summary }}</span>
      <span v-if="activeLabel" class="active" :title="activeLabel">{{ activeLabel }}</span>

      <span class="meta">
        <span v-if="elapsed" class="duration">{{ elapsed }}</span>
        <span class="chevron" :class="{ open: isOpen }" aria-hidden="true">
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
          </svg>
        </span>
      </span>
    </button>

    <ol v-if="isOpen" class="steps">
      <li
        v-for="step in steps"
        :key="step.id"
        class="step"
        :class="step.status"
        data-testid="timeline-step"
      >
        <span class="rail" aria-hidden="true">
          <span class="node"><ToolIcon :name="step.name" /></span>
        </span>

        <div class="step-body">
          <div class="step-head">
            <span class="step-name">{{ step.name }}</span>
            <span v-if="detailOf(step)" class="step-detail" :title="step.argsSummary">
              {{ detailOf(step) }}
            </span>
            <span class="step-tail">
              <span v-if="stepDuration(step)" class="step-time">{{ stepDuration(step) }}</span>
              <span class="step-state" :class="step.status">{{ stepStatusLabel(step) }}</span>
            </span>
          </div>

          <p v-if="step.summary" class="step-result">{{ step.summary }}</p>

          <div v-if="step.images?.length" class="step-images">
            <a
              v-for="(src, index) in step.images"
              :key="index"
              :href="src"
              target="_blank"
              rel="noreferrer"
              class="step-image-link"
              :title="src"
            >
              <img :src="src" alt="生成的图片" class="step-image" />
            </a>
          </div>

          <div v-if="step.output" class="output-wrap">
            <pre class="step-output">{{ step.output }}</pre>
          </div>

          <div
            v-if="step.approval"
            class="approval-card"
            :class="step.approval.status"
            data-testid="approval-card"
          >
            <div class="approval-title">
              <span class="approval-mark" aria-hidden="true">!</span>
              <span class="approval-name">需要审批 · {{ step.name }}</span>
              <span class="risk">{{ riskLabel(step.approval.risk) }}</span>
            </div>
            <p class="approval-args">{{ step.argsSummary }}</p>
            <p v-if="requestOf(step)?.reason" class="approval-reason" data-testid="approval-reason">
              {{ requestOf(step)!.reason }}
            </p>

            <div v-if="requestOf(step)?.diff" class="diff-preview" data-testid="approval-diff">
              <div
                v-for="(hunk, hunkIndex) in requestOf(step)!.diff!.hunks"
                :key="hunkIndex"
                class="diff-hunk"
              >
                <div class="diff-header">{{ hunk.header }}</div>
                <pre class="diff-lines"><code
                  v-for="(line, lineIndex) in hunk.lines"
                  :key="lineIndex"
                  :class="line.type"
                >{{ linePrefix(line.type) }}{{ line.text }}
</code></pre>
              </div>
              <div v-if="requestOf(step)!.diff!.truncated" class="diff-truncated">
                （diff 已截断，仅展示部分内容）
              </div>
            </div>

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
                v-if="requestOf(step)?.canAllowAlways"
                type="button"
                class="allow"
                data-testid="approval-allow-session"
                title="本会话内同类操作不再询问（白名单与危险命令拦截仍然生效）"
                @click="respond(step, 'approve_session')"
              >
                会话内允许
              </button>
              <button
                v-if="requestOf(step)?.canAllowAlways"
                type="button"
                class="allow"
                data-testid="approval-allow-project"
                title="本项目内同类操作不再询问（持久化，白名单与危险命令拦截仍然生效）"
                @click="respond(step, 'approve_project')"
              >
                项目内允许
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
            <p v-else class="decision" :class="step.approval.status">
              {{ approvalStatusLabel(step.approval.status) }}
            </p>
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.timeline {
  margin: 10px 0 2px;
}

/* ── 折叠态：实时活动条 ───────────────────────────── */

.timeline-toggle {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 140ms ease,
    background-color 140ms ease;
}

.timeline-toggle:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.timeline.running .timeline-toggle {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-subtle));
}

.timeline.pending .timeline-toggle {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  background: color-mix(in srgb, var(--warning) 8%, var(--bg-subtle));
}

/* 运行中：底边一条来回扫的高光，表示还有活儿在干 */
.sweep {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-repeat: no-repeat;
  background-size: 38% 100%;
  animation: sweep 1.7s ease-in-out infinite;
}

@keyframes sweep {
  from {
    background-position: -40% 0;
  }
  to {
    background-position: 140% 0;
  }
}

.lead {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
}

.lead.running {
  color: var(--accent);
}

.lead.pending {
  color: var(--warning);
}

.lead.done {
  color: var(--success);
}

.lead-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
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

.summary {
  flex: none;
  white-space: nowrap;
  color: var(--text);
  font-weight: 500;
}

.active {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.duration {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.chevron {
  display: inline-flex;
  color: var(--text-muted);
  transition: transform 160ms ease;
}

.chevron.open {
  transform: rotate(180deg);
}

/* ── 展开态：活动流 ───────────────────────────────── */

.steps {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.step {
  position: relative;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  column-gap: 10px;
  padding: 6px 0;
  border-radius: var(--radius-sm);
}

.rail {
  position: relative;
  display: flex;
  justify-content: center;
}

.rail::after {
  position: absolute;
  top: 24px;
  bottom: -12px;
  left: 50%;
  width: 1px;
  margin-left: -0.5px;
  background: var(--border);
  content: '';
}

.step:last-child .rail::after {
  display: none;
}

.node {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-muted);
  transition:
    border-color 140ms ease,
    color 140ms ease;
}

.step.running .node {
  border-color: var(--accent);
  color: var(--accent);
  animation: node-pulse 1.8s ease-out infinite;
}

.step.done .node {
  border-color: color-mix(in srgb, var(--success) 42%, var(--border));
  color: color-mix(in srgb, var(--success) 82%, var(--text-muted));
}

.step.failed .node {
  border-color: var(--danger);
  color: var(--danger);
}

@keyframes node-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 32%, transparent);
  }
  70% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--accent) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
  }
}

.step-body {
  min-width: 0;
}

.step-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.step-name {
  flex: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}

.step.running .step-name {
  color: var(--accent);
}

.step-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-tail {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-left: auto;
}

.step-time {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.step-state {
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
}

.step-state.running {
  background: var(--accent-soft);
  color: var(--accent);
}

.step-state.done {
  color: var(--text-muted);
}

.step-state.failed {
  background: var(--danger-soft);
  color: var(--danger);
}

.step-result {
  margin: 4px 0 0;
  padding-left: 9px;
  border-left: 2px solid var(--border);
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.step.failed .step-result {
  border-left-color: var(--danger);
  color: var(--danger);
}

.step-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.step-image-link {
  display: block;
  line-height: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}

.step-image {
  display: block;
  width: 200px;
  height: 200px;
  object-fit: cover;
  background: var(--bg-subtle);
}

.output-wrap {
  position: relative;
  margin-top: 6px;
}

.step-output {
  max-height: 180px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  overflow: auto;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/* 输出块底部渐隐，暗示还有更多内容 */
.output-wrap::after {
  position: absolute;
  right: 1px;
  bottom: 1px;
  left: 1px;
  height: 20px;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  background: linear-gradient(transparent, var(--bg-subtle));
  content: '';
  pointer-events: none;
}

/* ── 审批卡 ───────────────────────────────────────── */

.approval-card {
  margin-top: 9px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 38%, var(--border));
  border-left: 3px solid var(--warning);
  border-radius: var(--radius-md);
  background: var(--warning-soft);
}

/* 审批有结果后，卡片配色跟着结论走，不再一直亮黄灯 */
.approval-card.approved {
  border-color: color-mix(in srgb, var(--success) 34%, var(--border));
  border-left-color: var(--success);
  background: var(--success-soft);
}

.approval-card.denied {
  border-color: color-mix(in srgb, var(--danger) 34%, var(--border));
  border-left-color: var(--danger);
  background: var(--danger-soft);
}

.approval-card.approved .approval-mark {
  background: var(--success);
}

.approval-card.denied .approval-mark {
  background: var(--danger);
}

.approval-card.approved .risk,
.approval-card.denied .risk {
  border-color: var(--border-strong);
  color: var(--text-muted);
}

.approval-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.approval-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--warning);
  color: var(--bg);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.approval-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk {
  flex: none;
  padding: 1px 8px;
  border: 1px solid color-mix(in srgb, var(--warning) 55%, transparent);
  border-radius: 999px;
  color: var(--warning);
  font-size: 10px;
  font-weight: 500;
}

.approval-args {
  margin: 7px 0 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  user-select: text;
  word-break: break-all;
}

.approval-reason {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.diff-preview {
  max-height: 220px;
  margin-top: 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  overflow: auto;
}

.diff-hunk + .diff-hunk {
  border-top: 1px dashed var(--border);
}

.diff-header {
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 10.5px;
}

.diff-lines {
  margin: 0;
  padding: 4px 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.diff-lines code {
  display: block;
  padding: 0 10px;
}

.diff-lines code.add {
  background: var(--success-soft);
  color: var(--success);
}

.diff-lines code.del {
  background: var(--danger-soft);
  color: var(--danger);
  text-decoration: line-through;
}

.diff-lines code.ctx {
  color: var(--text-muted);
}

.diff-truncated {
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10.5px;
}

.approval-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.approval-actions button {
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    color 140ms ease;
}

.approval-actions button:hover {
  border-color: var(--border-strong);
}

.approval-actions .approve {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 500;
}

.approval-actions .approve:hover {
  filter: brightness(1.06);
}

.approval-actions .allow {
  background: transparent;
  color: var(--text-muted);
}

.approval-actions .allow:hover {
  color: var(--text);
}

.approval-actions .deny {
  background: transparent;
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  color: var(--danger);
}

.approval-actions .deny:hover {
  background: var(--danger-soft);
}

.decision {
  margin: 9px 0 0;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
}

.decision.approved {
  color: var(--success);
}

.decision.denied {
  color: var(--danger);
}
</style>
