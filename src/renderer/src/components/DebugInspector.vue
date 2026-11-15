<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDebugStore } from '../stores/debug'
import { useWorkspaceStore } from '../stores/workspace'
import CollapsibleSection from './CollapsibleSection.vue'
import DebugVariableTree from './DebugVariableTree.vue'

const debug = useDebugStore()
const workspace = useWorkspaceStore()
const watchInput = ref('')
const frameCount = computed(() => debug.frames.length)

async function addWatch(): Promise<void> {
  const expression = watchInput.value.trim()
  if (!expression) return
  debug.addWatch(expression)
  watchInput.value = ''
}

async function selectFrame(index: number): Promise<void> {
  const frame = debug.frames[index]
  if (!frame) return
  await debug.loadFrame(frame.id)
  if (frame.relativePath && frame.line) {
    await workspace.openPath(frame.relativePath, { pin: false })
    workspace.requestReveal(frame.line)
  }
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
</script>

<template>
  <div class="inspector" data-testid="debug-inspector">
    <CollapsibleSection
      title="变量"
      section="debugVariables"
      testid="debug-variables"
      :count="debug.scopes.length"
    >
      <div v-if="!debug.isPaused" class="hint" data-testid="debug-variables-idle">
        命中断点后显示作用域与变量
      </div>
      <div v-else class="scope-list">
        <div v-for="scope in debug.scopes" :key="scope.variablesReference" class="scope">
          <div class="scope-name" :data-testid="`debug-scope-${scope.type}`">{{ scope.name }}</div>
          <DebugVariableTree :variables="debug.variableCache[scope.variablesReference] ?? []" />
        </div>
      </div>
    </CollapsibleSection>

    <CollapsibleSection
      title="监视"
      section="debugWatches"
      testid="debug-watches"
      :count="debug.watchExpressions.length"
    >
      <div class="watch-input">
        <input
          v-model="watchInput"
          type="text"
          placeholder="表达式，如 total + 1"
          data-testid="debug-watch-input"
          @keydown.enter.prevent="addWatch"
        />
        <button type="button" data-testid="debug-watch-add" @click="addWatch">+</button>
      </div>
      <div v-if="!debug.watchExpressions.length" class="hint">添加表达式后在暂停时求值</div>
      <ul v-else class="watch-list">
        <li
          v-for="(result, index) in debug.watchResults"
          :key="result.expression"
          class="watch-row"
          :data-testid="`debug-watch-${index}`"
        >
          <span class="watch-expression" :title="result.expression">{{ result.expression }}</span>
          <span class="watch-value" :class="{ error: result.error }" :title="result.value">
            {{ result.value }}
          </span>
          <button
            type="button"
            class="remove"
            title="移除监视"
            :data-testid="`debug-watch-remove-${index}`"
            @click="debug.removeWatch(result.expression)"
          >
            ×
          </button>
        </li>
      </ul>
    </CollapsibleSection>

    <CollapsibleSection
      title="调用堆栈"
      section="debugCallstack"
      testid="debug-callstack"
      :count="frameCount"
    >
      <div v-if="!frameCount" class="hint">暂停后显示调用堆栈</div>
      <ul v-else class="stack-list">
        <li
          v-for="(frame, index) in debug.frames"
          :key="frame.id"
          class="stack-row"
          :class="{ active: debug.selectedFrameId === frame.id }"
          :data-testid="`debug-frame-${index}`"
          @click="selectFrame(index)"
        >
          <span class="stack-name">{{ frame.name }}</span>
          <span class="stack-location">
            {{ frame.relativePath ? `${baseName(frame.relativePath)}:${frame.line}` : '内部帧' }}
          </span>
        </li>
      </ul>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  flex: none;
}

.hint {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.scope-list {
  padding: 6px 8px 8px;
}

.scope + .scope {
  margin-top: 6px;
}

.scope-name {
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 600;
}

.watch-input {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
}

.watch-input input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 11.5px;
}

.watch-input button,
.remove {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.watch-input button:hover,
.remove:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.watch-list,
.stack-list {
  margin: 0;
  padding: 0 0 6px;
  list-style: none;
}

.watch-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11.5px;
}

.watch-expression {
  flex: none;
  max-width: 42%;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-value.error {
  color: var(--danger);
}

.stack-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11.5px;
  cursor: pointer;
}

.stack-row:hover {
  background: var(--bg-hover);
}

.stack-row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.stack-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stack-location {
  flex: none;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
}
</style>
