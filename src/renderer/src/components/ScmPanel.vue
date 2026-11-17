<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref, watch } from 'vue'
import type { GitFileChange } from '@shared/git'
import { useScmStore, type ScmGroup } from '../stores/scm'
import { useWorkspaceStore } from '../stores/workspace'
import ConfirmDialog from './ConfirmDialog.vue'
import FileTypeIcon from './FileTypeIcon.vue'
import GitGraphView from './GitGraphView.vue'

const props = defineProps<{ active: boolean }>()

const scm = useScmStore()
const workspace = useWorkspaceStore()

type ScmView = 'changes' | 'graph'

const view = ref<ScmView>('changes')
const branchMenuOpen = ref(false)
const newBranch = ref('')
const creatingBranch = ref(false)
const showOutput = ref(false)
const pendingDiscard = ref<GitFileChange | null>(null)

const GROUP_LABELS = computed<Record<ScmGroup, string>>(() => ({
  staged: t('已暂存'),
  unstaged: t('更改'),
  untracked: t('未跟踪'),
  conflicted: t('冲突')
}))

const GROUPS: ScmGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked']

const remoteBranches = computed(() => scm.branches?.remote ?? [])
const localBranches = computed(() => scm.branches?.local ?? [])
const hasChanges = computed(() => scm.changeCount > 0)

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function dirName(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(0, index) : ''
}

function statusLetter(change: GitFileChange, group: ScmGroup): string {
  if (group === 'conflicted') return '!'
  if (group === 'untracked') return 'U'
  return (group === 'staged' ? change.indexStatus : change.worktreeStatus) || 'M'
}

async function toggleBranchMenu(): Promise<void> {
  branchMenuOpen.value = !branchMenuOpen.value
  if (branchMenuOpen.value) await scm.refreshBranches()
}

async function selectBranch(branch: string): Promise<void> {
  branchMenuOpen.value = false
  if (branch === scm.status?.branch) return
  await scm.checkout(branch)
}

async function createBranch(): Promise<void> {
  const name = newBranch.value.trim()
  if (!name) return
  const ok = await scm.checkout(name, true)
  if (ok) {
    newBranch.value = ''
    creatingBranch.value = false
    branchMenuOpen.value = false
  }
}

async function confirmDiscard(): Promise<void> {
  const change = pendingDiscard.value
  pendingDiscard.value = null
  if (change) await scm.discard([change.path])
}

async function toggleOutput(): Promise<void> {
  showOutput.value = !showOutput.value
  if (showOutput.value) await scm.loadOutput()
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

watch(
  () => props.active,
  (active) => {
    if (active) void scm.refresh()
  }
)

watch(
  () => workspace.info?.root,
  () => {
    scm.reset()
    void scm.refresh()
    void scm.refreshBranches()
  }
)

onMounted(() => {
  void scm.refresh()
  void scm.refreshBranches()
})
</script>

<template>
  <aside class="scm" data-testid="scm-panel">
    <div class="scm-head">
      <span class="title">{{ t('源代码管理') }}</span>
      <span v-if="scm.changeCount" class="count" data-testid="scm-count">{{
        scm.changeCount
      }}</span>
      <div class="view-switch" role="tablist">
        <button
          type="button"
          class="view-tab"
          :class="{ on: view === 'changes' }"
          role="tab"
          :aria-selected="view === 'changes'"
          data-testid="scm-view-changes"
          @click="view = 'changes'"
        >
          {{ t('变更') }}
        </button>
        <button
          type="button"
          class="view-tab"
          :class="{ on: view === 'graph' }"
          role="tab"
          :aria-selected="view === 'graph'"
          data-testid="scm-view-graph"
          @click="view = 'graph'"
        >
          {{ t('提交图') }}
        </button>
      </div>
      <button
        type="button"
        class="icon"
        :title="t('刷新状态')"
        data-testid="scm-refresh"
        :disabled="scm.loading"
        @click="scm.refresh()"
      >
        ↻
      </button>
      <button
        type="button"
        class="icon"
        :class="{ on: showOutput }"
        :title="t('Git 输出')"
        data-testid="scm-toggle-output"
        @click="toggleOutput"
      >
        ⌸
      </button>
    </div>

    <p v-if="scm.error" class="error" data-testid="scm-error">
      {{ t(scm.error) }}
      <button type="button" class="dismiss" @click="scm.clearError()">×</button>
    </p>
    <p v-else-if="scm.notice" class="notice" data-testid="scm-notice">{{ t(scm.notice) }}</p>

    <div v-if="!workspace.info" class="hint" data-testid="scm-no-workspace">
      {{ t('请先打开工作区后使用源代码管理。') }}
    </div>

    <div v-else-if="scm.status && !scm.status.available" class="hint" data-testid="scm-git-missing">
      <p>{{ scm.status.message }}</p>
      <p class="sub">{{ t('安装 Git 后重启应用即可启用源代码管理。') }}</p>
    </div>

    <div v-else-if="scm.status && !scm.status.isRepo" class="hint" data-testid="scm-not-repo">
      <p>{{ t('当前工作区不是 Git 仓库。') }}</p>
      <button type="button" class="primary" data-testid="scm-init" @click="scm.initRepo()">
        {{ t('初始化仓库') }}
      </button>
    </div>

    <template v-else-if="scm.status">
      <GitGraphView v-if="view === 'graph'" :active="props.active && view === 'graph'" />
      <template v-else>
        <div class="branch-row">
          <button
            type="button"
            class="branch"
            data-testid="scm-branch"
            :title="scm.status.detached ? t('分离头指针') : scm.status.branch"
            @click="toggleBranchMenu"
          >
            <span class="branch-icon">⎇</span>
            <span class="branch-name">{{
              scm.status.detached ? 'detached HEAD' : scm.status.branch || t('未命名分支')
            }}</span>
            <span class="chevron">▾</span>
          </button>
          <span v-if="scm.status.upstream" class="ahead-behind" data-testid="scm-ahead-behind">
            {{ scm.aheadBehind }}
          </span>
        </div>

        <div v-if="branchMenuOpen" class="branch-menu" data-testid="scm-branch-menu">
          <button
            v-for="branch in localBranches"
            :key="branch"
            type="button"
            class="branch-option"
            :class="{ current: branch === scm.status.branch }"
            :data-testid="`scm-branch-option-${branch}`"
            @click="selectBranch(branch)"
          >
            {{ branch }}
          </button>
          <div v-if="remoteBranches.length" class="branch-sub">{{ t('远程分支') }}</div>
          <button
            v-for="branch in remoteBranches"
            :key="branch"
            type="button"
            class="branch-option remote"
            :data-testid="`scm-remote-option-${branch}`"
            @click="selectBranch(branch.replace(/^origin\//, ''))"
          >
            {{ branch }}
          </button>
          <div class="branch-new">
            <input
              v-if="creatingBranch"
              v-model="newBranch"
              type="text"
              class="branch-input"
              :placeholder="t('新分支名')"
              data-testid="scm-branch-input"
              @keydown.enter="createBranch"
              @keydown.esc="creatingBranch = false"
            />
            <button
              v-else
              type="button"
              class="branch-create"
              data-testid="scm-branch-new"
              @click="creatingBranch = true"
            >
              {{ t('+ 新建分支') }}
            </button>
            <button
              v-if="creatingBranch"
              type="button"
              class="branch-create"
              data-testid="scm-branch-create"
              @click="createBranch"
            >
              {{ t('创建') }}
            </button>
          </div>
        </div>

        <textarea
          v-model="scm.message"
          class="message"
          rows="2"
          :placeholder="t('提交信息（Ctrl+Enter 提交）')"
          data-testid="scm-message"
          @keydown.ctrl.enter.prevent="scm.commit(false)"
        ></textarea>
        <div class="commit-row">
          <button
            type="button"
            class="primary"
            data-testid="scm-commit"
            :disabled="!scm.canCommit || Boolean(scm.busy)"
            @click="scm.commit(false)"
          >
            {{ t('提交') }}
          </button>
          <button
            type="button"
            class="secondary"
            data-testid="scm-commit-all"
            :disabled="!scm.message.trim() || Boolean(scm.busy)"
            @click="scm.commit(true)"
          >
            {{ t('全部暂存并提交') }}
          </button>
        </div>

        <div class="groups">
          <p v-if="!hasChanges" class="empty" data-testid="scm-empty">{{ t('没有变更。') }}</p>
          <section
            v-for="group in GROUPS"
            v-show="scm.groupsOf(group).length"
            :key="group"
            class="group"
          >
            <button
              type="button"
              class="group-head"
              :data-testid="`scm-group-${group}`"
              :aria-expanded="!scm.collapsed[group]"
              @click="scm.toggleGroup(group)"
            >
              <span class="chevron">{{ scm.collapsed[group] ? '▸' : '▾' }}</span>
              <span class="group-title">{{ GROUP_LABELS[group] }}</span>
              <span class="group-count">{{ scm.groupsOf(group).length }}</span>
            </button>
            <ul v-show="!scm.collapsed[group]" class="file-list">
              <li
                v-for="change in scm.groupsOf(group)"
                :key="`${group}-${change.path}`"
                class="file-row"
                :class="{ conflict: group === 'conflicted' }"
              >
                <button
                  type="button"
                  class="file-main"
                  :title="change.path"
                  :data-testid="`scm-file-${group}-${change.path}`"
                  @click="scm.openDiff(change, group === 'staged')"
                >
                  <span
                    class="status"
                    :class="`status-${statusLetter(change, group).toLowerCase()}`"
                  >
                    {{ statusLetter(change, group) }}
                  </span>
                  <FileTypeIcon :name="baseName(change.path)" type="file" />
                  <span class="file-name">{{ baseName(change.path) }}</span>
                  <span v-if="dirName(change.path)" class="file-dir">{{
                    dirName(change.path)
                  }}</span>
                </button>
                <span class="actions" @click.stop>
                  <button
                    v-if="group === 'staged'"
                    type="button"
                    class="action"
                    :title="t('取消暂存')"
                    :data-testid="`scm-unstage-${change.path}`"
                    @click="scm.unstage([change.path])"
                  >
                    −
                  </button>
                  <button
                    v-else-if="group !== 'conflicted'"
                    type="button"
                    class="action"
                    :title="t('暂存')"
                    :data-testid="`scm-stage-${change.path}`"
                    @click="scm.stage([change.path])"
                  >
                    +
                  </button>
                  <button
                    v-if="group === 'unstaged'"
                    type="button"
                    class="action danger"
                    :title="t('放弃更改')"
                    :data-testid="`scm-discard-${change.path}`"
                    @click="pendingDiscard = change"
                  >
                    ↺
                  </button>
                  <button
                    v-if="group === 'conflicted'"
                    type="button"
                    class="action"
                    :title="t('打开文件查看冲突')"
                    :data-testid="`scm-open-${change.path}`"
                    @click="scm.openFile(change)"
                  >
                    ↗
                  </button>
                  <button
                    type="button"
                    class="action"
                    :title="t('在文件资源管理器中显示')"
                    :data-testid="`scm-reveal-${change.path}`"
                    @click="scm.reveal(change)"
                  >
                    ⋯
                  </button>
                </span>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <div class="footer">
        <button
          type="button"
          class="footer-action"
          data-testid="scm-pull"
          :disabled="Boolean(scm.busy)"
          :title="t('拉取（--ff-only）')"
          @click="scm.network('pull')"
        >
          {{ t('拉取') }}
        </button>
        <button
          type="button"
          class="footer-action"
          data-testid="scm-push"
          :disabled="Boolean(scm.busy)"
          :title="t('推送')"
          @click="scm.network('push')"
        >
          {{ t('推送') }}
        </button>
        <button
          type="button"
          class="footer-action"
          data-testid="scm-publish"
          :disabled="Boolean(scm.busy)"
          :title="t('发布分支（push -u origin）')"
          @click="scm.network('publish')"
        >
          {{ t('发布分支') }}
        </button>
        <span class="spacer"></span>
        <span v-if="scm.busy" class="busy" data-testid="scm-busy">{{ t('执行中…') }}</span>
      </div>

      <section v-if="showOutput" class="output" data-testid="scm-output">
        <header>
          <span>{{ t('Git 输出') }}</span>
          <button type="button" class="icon" @click="scm.loadOutput()">↻</button>
        </header>
        <p v-if="!scm.output.length" class="empty">{{ t('暂无 Git 命令记录。') }}</p>
        <ul v-else>
          <li
            v-for="entry in scm.output"
            :key="entry.id"
            :class="{ failed: !entry.ok }"
            :data-testid="`scm-output-${entry.id}`"
          >
            <span class="out-time">{{ formatTime(entry.ts) }}</span>
            <span class="out-cmd">{{ entry.command }}</span>
            <span v-if="entry.message" class="out-msg">{{ entry.message }}</span>
          </li>
        </ul>
      </section>
    </template>

    <ConfirmDialog
      v-if="pendingDiscard"
      :title="t('放弃更改')"
      :message="
        t('将丢弃「{path}」未暂存的修改，且无法撤销。确定继续吗？', { path: pendingDiscard.path })
      "
      :confirm-label="t('放弃更改')"
      danger
      testid="scm-discard-dialog"
      @confirm="confirmDiscard"
      @close="pendingDiscard = null"
    />
  </aside>
</template>

<style scoped>
.scm {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px 12px;
  overflow: hidden;
}

.scm-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
}

.title {
  font-size: 12px;
  font-weight: 600;
}

.count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
}

.icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.icon + .icon {
  margin-left: 0;
}

.icon:hover,
.icon.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.view-switch {
  display: flex;
  flex: none;
  gap: 1px;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.view-tab {
  padding: 2px 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.view-tab:hover {
  color: var(--text);
}

.view-tab.on {
  background: var(--bg-elevated);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.error,
.notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  line-height: 1.5;
}

.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.notice {
  background: var(--warning-soft);
  color: var(--warning);
}

.dismiss {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}

.hint {
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.hint p {
  margin: 0 0 8px;
}

.hint .sub {
  margin: 0;
  font-size: 10.5px;
}

.hint .primary,
.branch-create,
.footer-action,
.secondary {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.hint .primary:hover,
.branch-create:hover,
.footer-action:hover:not(:disabled),
.secondary:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.branch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
}

.branch {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}

.branch:hover {
  border-color: var(--accent);
}

.branch-icon,
.chevron {
  flex: none;
  color: var(--text-muted);
  font-size: 9px;
}

.branch-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ahead-behind {
  flex: none;
  color: var(--text-muted);
  font-size: 10.5px;
}

.branch-menu {
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

.branch-option.remote {
  color: var(--text-muted);
}

.branch-sub {
  padding: 4px 6px 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.branch-new {
  display: flex;
  gap: 4px;
  padding: 2px;
}

.branch-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.message {
  flex: none;
  width: 100%;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  resize: vertical;
}

.commit-row {
  display: flex;
  gap: 6px;
  padding: 6px 0;
}

.primary {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.primary:disabled,
.secondary:disabled,
.footer-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.groups {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.empty {
  margin: 0;
  padding: 8px 0;
  color: var(--text-muted);
  font-size: 11.5px;
}

.group {
  border-top: 1px solid var(--border);
}

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 2px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-align: left;
  text-transform: uppercase;
  cursor: pointer;
}

.group-head:hover {
  background: var(--bg-hover);
}

.group-title {
  flex: 1;
}

.group-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
}

.file-list {
  margin: 0;
  padding: 0 0 4px;
  list-style: none;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px 1px 2px;
  border-radius: 4px;
  font-size: 11.5px;
  cursor: pointer;
}

.file-row:hover {
  background: var(--bg-hover);
}

.file-main {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  padding: 2px 4px 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}

.status {
  flex: none;
  width: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.status-m,
.status-r,
.status-a {
  color: var(--warning);
}

.status-d,
.status-u {
  color: var(--danger);
}

.file-row.conflict .file-name {
  color: var(--danger);
}

.file-name {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex: none;
  gap: 1px;
  opacity: 0;
}

.file-row:hover .actions,
.file-row:focus-within .actions {
  opacity: 1;
}

.action {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.action:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.action.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.footer {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.footer-action {
  padding: 3px 8px;
  font-size: 10.5px;
}

.spacer {
  flex: 1;
}

.busy {
  color: var(--text-muted);
  font-size: 10.5px;
}

.output {
  flex: none;
  max-height: 150px;
  margin-top: 8px;
  overflow: auto;
  border-top: 1px solid var(--border);
}

.output header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 600;
}

.output .icon {
  width: 18px;
  height: 18px;
}

.output ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.output li {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  padding: 3px 0;
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 10px;
}

.output li.failed .out-cmd {
  color: var(--danger);
}

.out-time {
  color: var(--text-muted);
}

.out-cmd {
  word-break: break-all;
}

.out-msg {
  flex-basis: 100%;
  color: var(--text-muted);
}
</style>
