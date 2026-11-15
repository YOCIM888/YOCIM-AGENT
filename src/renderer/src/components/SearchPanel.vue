<script setup lang="ts">
import { watch } from 'vue'
import type { SearchFileResult, SearchMatch } from '@shared/ipc'
import { useSearchStore } from '../stores/search'
import { useWorkspaceStore } from '../stores/workspace'
import ReplacePreviewDialog from './ReplacePreviewDialog.vue'

const search = useSearchStore()
const workspace = useWorkspaceStore()

watch(
  () => [search.query, search.replaceText, search.include, search.exclude],
  () => search.scheduleSearch()
)

function lineParts(match: SearchMatch): { before: string; hit: string; after: string } {
  const text = match.lineText
  const start = Math.min(Math.max(match.column - 1, 0), text.length)
  const end = Math.min(Math.max(match.endColumn - 1, start), text.length)
  return { before: text.slice(0, start), hit: text.slice(start, end), after: text.slice(end) }
}

function jump(file: SearchFileResult, match: SearchMatch): void {
  search.jump(file.relativePath, match.line, match.column, match.endColumn)
}

function replaceAll(): void {
  void search.requestReplace('all')
}

function replaceFile(file: SearchFileResult): void {
  void search.requestReplace('file', file)
}

function replaceMatch(file: SearchFileResult, match: SearchMatch): void {
  void search.requestReplace('single', file, match.line, match.column)
}
</script>

<template>
  <section class="search-panel" data-testid="search-panel">
    <div class="search-head">
      <span class="title">搜索</span>
      <button
        type="button"
        class="icon"
        title="显示替换"
        data-testid="search-toggle-replace"
        :class="{ on: search.options.showReplace }"
        @click="search.setOption('showReplace', !search.options.showReplace)"
      >
        ⇄
      </button>
      <button
        type="button"
        class="icon"
        title="筛选选项"
        data-testid="search-toggle-filters"
        :class="{ on: search.options.showFilters }"
        @click="search.setOption('showFilters', !search.options.showFilters)"
      >
        ⋯
      </button>
      <button
        type="button"
        class="icon"
        title="刷新搜索"
        data-testid="search-refresh"
        :disabled="!workspace.info"
        @click="search.startSearch()"
      >
        ↻
      </button>
    </div>

    <div class="query-row">
      <input
        v-model="search.query"
        type="text"
        class="query-input"
        placeholder="搜索工作区…"
        data-testid="search-input"
        aria-label="搜索内容"
      />
      <button
        v-if="search.loading"
        type="button"
        class="cancel"
        title="取消搜索"
        data-testid="search-cancel"
        @click="search.cancelSearch()"
      >
        ×
      </button>
    </div>

    <div class="toggles">
      <button
        type="button"
        class="toggle"
        :class="{ on: search.options.caseSensitive }"
        title="区分大小写"
        data-testid="search-option-case"
        @click="search.setOption('caseSensitive', !search.options.caseSensitive)"
      >
        Aa
      </button>
      <button
        type="button"
        class="toggle"
        :class="{ on: search.options.wholeWord }"
        title="全词匹配"
        data-testid="search-option-word"
        @click="search.setOption('wholeWord', !search.options.wholeWord)"
      >
        ab
      </button>
      <button
        type="button"
        class="toggle"
        :class="{ on: search.options.useRegex }"
        title="使用正则表达式"
        data-testid="search-option-regex"
        @click="search.setOption('useRegex', !search.options.useRegex)"
      >
        .*
      </button>
    </div>

    <div v-if="search.options.showReplace" class="replace-row">
      <input
        v-model="search.replaceText"
        type="text"
        class="query-input"
        placeholder="替换为…"
        data-testid="search-replace-input"
        aria-label="替换内容"
      />
      <button
        type="button"
        class="toggle"
        :class="{ on: search.options.preserveCase }"
        title="保留大小写"
        data-testid="search-option-preserve-case"
        @click="search.setOption('preserveCase', !search.options.preserveCase)"
      >
        AB
      </button>
      <button
        type="button"
        class="replace-all"
        title="全局替换（先预览）"
        data-testid="search-replace-all"
        :disabled="!search.results.length || search.loading"
        @click="replaceAll"
      >
        全部替换
      </button>
    </div>

    <div v-if="search.options.showFilters" class="filters">
      <label>
        包含
        <input
          v-model="search.include"
          type="text"
          placeholder="*.ts, src/**"
          data-testid="search-include"
        />
      </label>
      <label>
        排除
        <input
          v-model="search.exclude"
          type="text"
          placeholder="*.min.js"
          data-testid="search-exclude"
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="search.options.includeIgnored"
          data-testid="search-option-ignored"
          @change="search.setOption('includeIgnored', !search.options.includeIgnored)"
        />
        包含忽略文件
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="search.options.onlyOpenEditors"
          data-testid="search-option-open"
          @change="search.setOption('onlyOpenEditors', !search.options.onlyOpenEditors)"
        />
        仅在打开文件中搜索
      </label>
    </div>

    <div class="status" data-testid="search-status">
      <span v-if="search.loading">搜索中…</span>
      <span v-else-if="search.hasQuery">
        {{ search.totalFiles }} 个文件 · {{ search.matchCount }} 处命中
      </span>
      <span v-else>输入关键字开始搜索</span>
    </div>
    <p v-if="search.truncated" class="warning" data-testid="search-truncated">
      达到结果上限（5000 条），请收窄搜索条件
    </p>
    <p
      v-if="search.engine === 'builtin' && search.hasQuery"
      class="engine"
      data-testid="search-engine-notice"
    >
      未检测到 ripgrep，已使用内置搜索；把 rg 放入 resources/ripgrep 可加速
    </p>
    <p v-if="search.notice" class="engine" data-testid="search-notice">{{ search.notice }}</p>
    <p v-if="search.error" class="error" data-testid="search-error">{{ search.error }}</p>
    <p
      v-if="!search.results.length && !search.loading && search.hasQuery"
      class="empty"
      data-testid="search-empty"
    >
      没有匹配结果
    </p>

    <div class="results">
      <div v-for="file in search.results" :key="file.relativePath" class="file-group">
        <div
          class="file-head"
          :data-testid="`search-file-${file.relativePath}`"
          :data-path="file.relativePath"
        >
          <button
            type="button"
            class="file-toggle"
            :data-testid="`search-file-toggle-${file.relativePath}`"
            @click="search.toggleFile(file.relativePath)"
          >
            <span class="chevron">{{ search.expanded.has(file.relativePath) ? '▾' : '▸' }}</span>
            <span class="file-name">{{ file.relativePath.split('/').pop() }}</span>
            <span class="file-path">{{ file.relativePath }}</span>
            <span class="count">{{ file.matches.length }}</span>
          </button>
          <button
            v-if="search.options.showReplace"
            type="button"
            class="file-replace"
            title="替换该文件内全部命中"
            :data-testid="`search-file-replace-${file.relativePath}`"
            @click="replaceFile(file)"
          >
            ⤳
          </button>
        </div>
        <div v-if="search.expanded.has(file.relativePath)" class="matches">
          <div
            v-for="match in file.matches"
            :key="`${match.line}-${match.column}`"
            class="match"
            :data-testid="`search-result-${file.relativePath}-${match.line}-${match.column}`"
          >
            <button type="button" class="match-main" @click="jump(file, match)">
              <span class="line-no">{{ match.line }}:{{ match.column }}</span>
              <span class="line-text">
                {{ lineParts(match).before }}<mark>{{ lineParts(match).hit }}</mark
                >{{ lineParts(match).after }}
              </span>
            </button>
            <button
              v-if="search.options.showReplace"
              type="button"
              class="match-replace"
              title="仅替换这一处"
              :data-testid="`search-result-replace-${match.line}-${match.column}`"
              @click="replaceMatch(file, match)"
            >
              ⤳
            </button>
          </div>
        </div>
      </div>
    </div>

    <ReplacePreviewDialog
      v-if="search.preview"
      :result="search.preview"
      :scope="search.previewScope"
      @confirm="search.applyReplace()"
      @cancel="search.cancelReplace()"
    />
  </section>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.search-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
}

.icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.icon:hover,
.icon.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.query-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 2px;
}

.query-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}

.cancel {
  flex: none;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.toggles {
  display: flex;
  gap: 4px;
  padding: 2px 8px 6px;
}

.toggle {
  min-width: 24px;
  height: 22px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.toggle.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.replace-all {
  flex: none;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.replace-all:disabled {
  opacity: 0.45;
  cursor: default;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 4px 8px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}

.filters label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filters input[type='text'] {
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

.filters .check {
  cursor: pointer;
}

.status {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 11px;
}

.warning,
.engine,
.error,
.empty {
  margin: 0;
  padding: 5px 10px;
  font-size: 11px;
  line-height: 1.5;
}

.warning {
  color: var(--warning);
}

.engine {
  color: var(--text-muted);
}

.error {
  color: var(--danger);
}

.empty {
  color: var(--text-muted);
}

.results {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.file-group {
  border-bottom: 1px solid var(--border);
}

.file-head {
  display: flex;
  align-items: center;
  padding-right: 4px;
}

.file-head:hover {
  background: var(--bg-hover);
}

.file-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}

.chevron {
  flex: none;
  width: 10px;
  color: var(--text-muted);
}

.file-name {
  flex: none;
  font-weight: 600;
}

.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
}

.file-replace,
.match-replace {
  flex: none;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.file-replace:hover,
.match-replace:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.match {
  display: flex;
  align-items: center;
  padding-left: 14px;
  padding-right: 4px;
}

.match:hover {
  background: var(--bg-hover);
}

.match-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
}

.line-no {
  flex: none;
  color: var(--text-muted);
}

.line-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
}

mark {
  border-radius: 2px;
  background: var(--warning-soft);
  color: var(--text);
}
</style>
