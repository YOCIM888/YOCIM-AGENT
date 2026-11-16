<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { GitCommitNode } from '@shared/git'
import {
  GRAPH_LANE_WIDTH,
  GRAPH_MERGE_CY,
  GRAPH_NODE_CY,
  GRAPH_ROW_HEIGHT,
  computeGraphLayout,
  formatRelativeTime,
  laneX,
  segmentPieces,
  splitConventionalPrefix
} from '../lib/gitGraph'
import { useScmStore } from '../stores/scm'
import FileTypeIcon from './FileTypeIcon.vue'

const props = defineProps<{ active: boolean }>()

const scm = useScmStore()

/** 详情块里每行文件的高度 */
const FILE_ROW_HEIGHT = 18
/** 详情块头部（作者行 + 统计行）高度 */
const DETAIL_HEADER_HEIGHT = 58
/** 详情里最多平铺几行文件，其余折叠成一句提示 */
const MAX_DETAIL_FILES = 8

const branchMenuOpen = ref(false)

const commits = computed<GitCommitNode[]>(() => scm.graph?.commits ?? [])
const layout = computed(() => computeGraphLayout(commits.value))
const graphWidth = computed(() =>
  Math.max(GRAPH_LANE_WIDTH, layout.value.laneCount * GRAPH_LANE_WIDTH)
)

const localBranches = computed(() => scm.branches?.local ?? [])
const currentBranch = computed(() => scm.graph?.branch || scm.status?.branch || '')

function branchLabel(value: string): string {
  if (value === 'all') return '全部分支'
  return value
}

function detailHeight(sha: string): number {
  const detail = scm.commitDetails[sha]
  if (!detail) return DETAIL_HEADER_HEIGHT
  const visible = Math.min(detail.files.length, MAX_DETAIL_FILES)
  return DETAIL_HEADER_HEIGHT + visible * FILE_ROW_HEIGHT + 10
}

function rowHeight(index: number): number {
  const commit = commits.value[index]
  if (!commit || scm.expandedSha !== commit.sha) return GRAPH_ROW_HEIGHT
  return GRAPH_ROW_HEIGHT + detailHeight(commit.sha)
}

/** 某一行要画的竖线（行内局部坐标） */
function piecesFor(row: number): Array<{ x: number; top: number; bottom: number }> {
  const height = rowHeight(row)
  const result: Array<{ x: number; top: number; bottom: number }> = []
  for (const segment of layout.value.segments) {
    const piece = segmentPieces(segment, row, height)
    if (!piece) continue
    result.push({ x: laneX(segment.lane), top: piece.top, bottom: piece.bottom })
  }
  return result
}

function mergesFor(row: number): Array<{ fromX: number; toX: number }> {
  return layout.value.merges
    .filter((merge) => merge.row === row)
    .map((merge) => ({ fromX: laneX(merge.fromLane), toX: laneX(merge.toLane) }))
}

function isMerge(commit: GitCommitNode): boolean {
  return commit.parents.length > 1
}

function refChips(
  commit: GitCommitNode
): Array<{ label: string; kind: 'branch' | 'remote' | 'tag' }> {
  const chips: Array<{ label: string; kind: 'branch' | 'remote' | 'tag' }> = []
  for (const name of commit.branches) chips.push({ label: name, kind: 'branch' })
  for (const name of commit.remotes) chips.push({ label: name, kind: 'remote' })
  for (const name of commit.tags) chips.push({ label: name, kind: 'tag' })
  return chips
}

function statusClass(status: string): string {
  if (status === 'A') return 'st-a'
  if (status === 'D') return 'st-d'
  if (status === 'R' || status === 'C') return 'st-r'
  return 'st-m'
}

function prefixOf(commit: GitCommitNode): { prefix: string; rest: string } {
  return splitConventionalPrefix(commit.subject)
}

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

async function refresh(): Promise<void> {
  await scm.loadGraph()
}

async function chooseBranch(value: string): Promise<void> {
  branchMenuOpen.value = false
  await scm.setGraphBranch(value)
}

watch(
  () => props.active,
  (active) => {
    if (active && !scm.graph) void scm.loadGraph()
  }
)

onMounted(() => {
  void scm.refreshBranches()
  if (props.active && !scm.graph) void scm.loadGraph()
})
</script>

<template>
  <div class="graph" data-testid="git-graph">
    <header class="graph-head">
      <button
        type="button"
        class="branch-chip"
        data-testid="git-graph-branch"
        @click="branchMenuOpen = !branchMenuOpen"
      >
        <span class="branch-dot"></span>
        <span>{{ branchLabel(scm.graphBranch) }}</span>
        <span class="chevron">▾</span>
      </button>

      <span v-if="currentBranch && scm.graphBranch === 'all'" class="current-branch">
        当前 {{ currentBranch }}
      </span>

      <span class="count" data-testid="git-graph-count"> {{ commits.length }} 个提交 </span>

      <span class="spacer"></span>

      <button
        type="button"
        class="icon"
        title="刷新提交图"
        data-testid="git-graph-refresh"
        :disabled="scm.graphLoading"
        @click="refresh"
      >
        ↻
      </button>
    </header>

    <div v-if="branchMenuOpen" class="branch-menu" data-testid="git-graph-branch-menu">
      <button
        type="button"
        class="branch-option"
        :class="{ current: scm.graphBranch === 'all' }"
        data-testid="git-graph-branch-all"
        @click="chooseBranch('all')"
      >
        全部分支
      </button>
      <button
        v-for="branch in localBranches"
        :key="branch"
        type="button"
        class="branch-option"
        :class="{ current: scm.graphBranch === branch }"
        :data-testid="`git-graph-branch-${branch}`"
        @click="chooseBranch(branch)"
      >
        {{ branch }}
      </button>
    </div>

    <p v-if="scm.graphError" class="graph-error" data-testid="git-graph-error">
      {{ scm.graphError }}
    </p>

    <p
      v-else-if="!commits.length && !scm.graphLoading"
      class="graph-empty"
      data-testid="git-graph-empty"
    >
      这个仓库还没有提交记录。
    </p>

    <div class="graph-list" :style="{ '--graph-width': `${graphWidth}px` }">
      <div
        v-for="(commit, index) in commits"
        :key="commit.sha"
        class="graph-item"
        :class="{ active: scm.expandedSha === commit.sha }"
        :style="{ height: `${rowHeight(index)}px` }"
      >
        <div class="graph-row">
          <svg
            class="graph-svg"
            :width="graphWidth"
            :height="rowHeight(index)"
            :viewBox="`0 0 ${graphWidth} ${rowHeight(index)}`"
            aria-hidden="true"
          >
            <line
              v-for="(piece, pieceIndex) in piecesFor(index)"
              :key="`l-${pieceIndex}`"
              :x1="piece.x"
              :x2="piece.x"
              :y1="piece.top"
              :y2="piece.bottom"
              class="rail"
            />
            <path
              v-for="(merge, mergeIndex) in mergesFor(index)"
              :key="`m-${mergeIndex}`"
              :d="`M ${merge.fromX} ${GRAPH_NODE_CY} V ${GRAPH_MERGE_CY} H ${merge.toX}`"
              class="rail merge"
            />
            <circle
              :cx="laneX(layout.laneOf[index])"
              :cy="GRAPH_NODE_CY"
              :r="commit.current ? 5 : isMerge(commit) ? 4.5 : 3.5"
              class="node"
              :class="{ current: commit.current, merge: isMerge(commit) }"
            />
            <circle
              v-if="commit.current"
              :cx="laneX(layout.laneOf[index])"
              :cy="GRAPH_NODE_CY"
              r="8.5"
              class="halo"
            />
          </svg>

          <button
            type="button"
            class="subject"
            :title="commit.subject"
            :data-testid="`git-commit-${commit.shortSha}`"
            @click="scm.toggleCommit(commit.sha)"
          >
            <span
              v-if="prefixOf(commit).prefix"
              class="prefix"
              :class="`pf-${prefixOf(commit).prefix}`"
            >
              {{ prefixOf(commit).prefix }}:
            </span>
            <span class="subject-text">{{ prefixOf(commit).rest || commit.subject }}</span>
          </button>

          <div class="refs">
            <span
              v-for="chip in refChips(commit)"
              :key="`${chip.kind}-${chip.label}`"
              class="chip"
              :class="chip.kind"
            >
              {{ chip.label }}
            </span>
          </div>
        </div>

        <div v-if="scm.expandedSha === commit.sha" class="detail" data-testid="git-commit-detail">
          <div class="detail-head">
            <span class="author">{{ commit.author }}</span>
            <span class="dot">·</span>
            <span class="time">{{ formatRelativeTime(commit.date) }}</span>
            <code class="sha">{{ commit.shortSha }}</code>
          </div>

          <div class="detail-stats">
            <span v-if="scm.detailLoading === commit.sha" class="loading">加载中…</span>
            <template v-else-if="scm.commitDetails[commit.sha]">
              <span class="added">+{{ scm.commitDetails[commit.sha].totalAdded }}</span>
              <span class="deleted">−{{ scm.commitDetails[commit.sha].totalDeleted }}</span>
              <span class="file-count">
                {{ scm.commitDetails[commit.sha].files.length }} 个文件
              </span>
            </template>
          </div>

          <ul v-if="scm.commitDetails[commit.sha]?.files.length" class="file-list">
            <li
              v-for="file in scm.commitDetails[commit.sha].files.slice(0, MAX_DETAIL_FILES)"
              :key="file.path"
              class="file-row"
              :title="file.originalPath ? `${file.originalPath} → ${file.path}` : file.path"
            >
              <span class="status" :class="statusClass(file.status)">{{ file.status || 'M' }}</span>
              <FileTypeIcon :name="fileName(file.path)" type="file" />
              <span class="file-name">{{ fileName(file.path) }}</span>
              <span class="added">+{{ file.added }}</span>
              <span class="deleted">−{{ file.deleted }}</span>
            </li>
          </ul>
          <p v-else-if="scm.detailLoading !== commit.sha" class="detail-empty">
            这个提交没有文件改动。
          </p>
          <p
            v-if="(scm.commitDetails[commit.sha]?.files.length ?? 0) > MAX_DETAIL_FILES"
            class="more"
          >
            还有 {{ scm.commitDetails[commit.sha].files.length - MAX_DETAIL_FILES }} 个文件未显示
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.graph-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 2px 2px 8px;
}

.branch-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.branch-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.branch-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.chevron {
  color: var(--text-muted);
  font-size: 9px;
}

.current-branch {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10.5px;
}

.count {
  color: var(--text-muted);
  font-size: 10.5px;
}

.spacer {
  flex: 1;
}

.icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.icon:disabled {
  opacity: 0.5;
  cursor: default;
}

.branch-menu {
  flex: none;
  margin-bottom: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

.branch-option {
  display: block;
  width: 100%;
  padding: 4px 6px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.branch-option:hover {
  background: var(--bg-hover);
}

.branch-option.current {
  color: var(--accent);
}

.graph-error {
  margin: 0 0 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11px;
}

.graph-empty {
  margin: 0;
  padding: 12px 0;
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: center;
}

.graph-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 10px;
}

.graph-item {
  position: relative;
}

.graph-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding-right: 6px;
}

.graph-item:hover .graph-row {
  background: var(--bg-hover);
}

.graph-item.active .graph-row {
  background: var(--accent-soft);
}

.graph-item.active {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  border-radius: var(--radius-sm);
}

.graph-svg {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}

.rail {
  stroke: color-mix(in srgb, var(--text-muted) 62%, transparent);
  stroke-width: 1.6;
}

.rail.merge {
  stroke: var(--accent);
  stroke-opacity: 0.6;
}

.node {
  fill: var(--accent);
  stroke: var(--bg-elevated);
  stroke-width: 1.5;
}

.node.merge {
  fill: var(--bg-elevated);
  stroke: var(--accent);
  stroke-width: 2;
}

.node.current {
  fill: var(--accent);
  stroke: var(--bg-elevated);
  stroke-width: 2;
}

.halo {
  fill: none;
  stroke: var(--accent);
  stroke-opacity: 0.28;
  stroke-width: 2;
}

.subject {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex: 1;
  min-width: 0;
  margin-left: calc(var(--graph-width) + 4px);
  padding: 4px 0 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

.subject-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prefix {
  flex: none;
  font-weight: 600;
  color: var(--accent);
}

.pf-feat {
  color: #3f9c6d;
}

.pf-fix {
  color: var(--danger);
}

.pf-docs {
  color: #4a7fd0;
}

.pf-build,
.pf-chore,
.pf-refactor,
.pf-test {
  color: #b07d2a;
}

.refs {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
}

.chip {
  padding: 1px 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 10px;
  white-space: nowrap;
}

.chip.branch {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip.remote {
  border-color: var(--border);
  color: var(--text-muted);
}

.chip.tag {
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
  background: var(--warning-soft);
  color: var(--warning);
}

.detail {
  margin: 2px 6px 8px calc(var(--graph-width) + 4px);
  padding: 8px 10px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
}

.time {
  flex: none;
}

.detail-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 3px 0 6px;
  font-size: 10.5px;
}

.author {
  color: var(--text);
  font-weight: 500;
}

.dot {
  opacity: 0.6;
}

.sha {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-hover);
  font-family: var(--font-mono);
  font-size: 10px;
}

.loading {
  color: var(--text-muted);
}

.added {
  color: #2f9e5f;
  font-variant-numeric: tabular-nums;
}

.deleted {
  color: var(--danger);
  font-variant-numeric: tabular-nums;
}

.file-count {
  color: var(--text-muted);
}

.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 18px;
  font-size: 10.5px;
}

.status {
  flex: none;
  width: 10px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--text-muted);
}

.st-a {
  color: #2f9e5f;
}

.st-d {
  color: var(--danger);
}

.st-r {
  color: #b07d2a;
}

.st-m {
  color: var(--text-muted);
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more,
.detail-empty {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 10.5px;
}
</style>
