<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref, watch } from 'vue'
import type { ExtensionCompatibility, ExtensionInfo } from '@shared/extensions'
import { useExtensionsStore } from '../stores/extensions'
import { useWorkspaceStore } from '../stores/workspace'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ active: boolean }>()

const extensions = useExtensionsStore()
const workspace = useWorkspaceStore()

const showImport = ref(false)
const pendingUninstall = ref<ExtensionInfo | null>(null)

const COMPAT_LABEL = computed<Record<ExtensionCompatibility, string>>(() => ({
  declarative: t('仅声明式'),
  partial: t('部分兼容'),
  incompatible: t('不兼容')
}))

const importableCount = computed(
  () => extensions.candidates.filter((item) => item.compatibility !== 'incompatible').length
)

function contributionSummary(extension: ExtensionInfo): string {
  const parts: string[] = []
  const c = extension.contributions
  if (c.commands) parts.push(t('命令 {count}', { count: c.commands }))
  if (c.snippets) parts.push(t('片段 {count}', { count: c.snippets }))
  if (c.languages) parts.push(t('语言 {count}', { count: c.languages }))
  if (c.grammars) parts.push(t('语法 {count}', { count: c.grammars }))
  if (c.themes) parts.push(t('主题 {count}', { count: c.themes }))
  return parts.length ? parts.join(' · ') : t('无声明式贡献')
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN')
}

async function openImport(): Promise<void> {
  showImport.value = true
  await extensions.scanVscode()
}

async function confirmUninstall(): Promise<void> {
  const target = pendingUninstall.value
  pendingUninstall.value = null
  if (target) await extensions.uninstall(target.id)
}

watch(
  () => props.active,
  (active) => {
    if (active) void extensions.refresh()
  }
)

watch(
  () => workspace.info?.root,
  () => {
    void extensions.refresh()
  }
)

onMounted(() => {
  void extensions.refresh()
})
</script>

<template>
  <aside class="extensions" data-testid="extensions-panel">
    <div class="ext-head">
      <span class="title">{{ t('扩展') }}</span>
      <span class="count" data-testid="extensions-count">{{ extensions.enabledCount }}</span>
      <button
        type="button"
        class="icon"
        :title="t('刷新扩展列表')"
        data-testid="extensions-refresh"
        :disabled="extensions.loading"
        @click="extensions.refresh()"
      >
        ↻
      </button>
    </div>

    <div class="actions">
      <button
        type="button"
        data-testid="extensions-install-local"
        :disabled="extensions.busyId === 'install-local'"
        @click="extensions.installLocal()"
      >
        {{ t('本地目录') }}
      </button>
      <button
        type="button"
        data-testid="extensions-install-vsix"
        :disabled="extensions.busyId === 'install-vsix'"
        @click="extensions.installVsix()"
      >
        VSIX
      </button>
      <button type="button" data-testid="extensions-scan" @click="openImport">
        {{ t('从 VS Code 导入') }}
      </button>
    </div>

    <div v-if="extensions.error" class="error" data-testid="extensions-error">
      {{ t(extensions.error) }}
    </div>
    <div v-if="extensions.notice" class="notice" data-testid="extensions-notice">
      {{ t(extensions.notice) }}
    </div>

    <div v-if="!extensions.list.length" class="hint" data-testid="extensions-empty">
      {{
        t(
          '暂无扩展。可安装本地扩展目录、.vsix 包，或从 VS Code 扩展目录导入；第一层只支持声明式贡献，不执行扩展代码。'
        )
      }}
    </div>

    <ul v-else class="ext-list">
      <li
        v-for="extension in extensions.list"
        :key="extension.id"
        class="ext-row"
        :class="{ disabled: !extension.enabled }"
        :data-testid="`extension-${extension.id}`"
      >
        <div class="ext-main">
          <div class="ext-line">
            <span class="ext-name" :title="extension.displayName">{{ extension.displayName }}</span>
            <span
              class="compat"
              :class="extension.compatibility"
              :data-testid="`extension-compat-${extension.id}`"
              :title="extension.compatibilityReason"
            >
              {{ COMPAT_LABEL[extension.compatibility] }}
            </span>
          </div>
          <div class="ext-meta">
            v{{ extension.version }}
            <span v-if="extension.publisher"> · {{ extension.publisher }}</span>
            <span> · {{ extension.source }}</span>
          </div>
          <div class="ext-contrib">{{ contributionSummary(extension) }}</div>
          <div class="ext-actions">
            <button
              type="button"
              class="mini"
              :data-testid="`extension-toggle-${extension.id}`"
              :disabled="extensions.busyId === extension.id"
              @click="extensions.setEnabled(extension.id, !extension.enabled)"
            >
              {{ extension.enabled ? t('禁用') : t('启用') }}
            </button>
            <button
              type="button"
              class="mini"
              :data-testid="`extension-detail-toggle-${extension.id}`"
              @click="extensions.toggleDetail(extension.id)"
            >
              {{ extensions.detailId === extension.id ? t('收起') : t('详情') }}
            </button>
            <button
              type="button"
              class="mini"
              :data-testid="`extension-reveal-${extension.id}`"
              @click="extensions.reveal(extension.id)"
            >
              {{ t('目录') }}
            </button>
            <button
              type="button"
              class="mini danger"
              :data-testid="`extension-uninstall-${extension.id}`"
              @click="pendingUninstall = extension"
            >
              {{ t('卸载') }}
            </button>
          </div>
          <div
            v-if="extensions.detailId === extension.id"
            class="ext-detail"
            :data-testid="`extension-detail-${extension.id}`"
          >
            <p :data-testid="`extension-reason-${extension.id}`">
              {{ extension.compatibilityReason }}
            </p>
            <p v-if="extension.description" class="desc">{{ extension.description }}</p>
            <p v-if="extension.runtimeEntry" class="warn">
              {{ t('运行时代码入口：') }}{{ extension.runtimeEntry }}{{ t('（不会被执行）') }}
            </p>
            <p class="path">{{ extension.dir }}</p>
            <p class="meta">{{ t('安装于') }} {{ formatDate(extension.installedAt) }}</p>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="showImport" class="overlay" data-testid="vscode-import-dialog">
      <section class="dialog">
        <header>
          <h2>{{ t('从 VS Code 导入') }}</h2>
          <button type="button" data-testid="vscode-import-close" @click="showImport = false">
            ×
          </button>
        </header>
        <p class="dialog-dir">
          {{ extensions.scan?.directory ?? t('正在扫描…') }}
          <span v-if="extensions.scan?.exists === false">{{ t('（目录不存在）') }}</span>
        </p>
        <div v-if="extensions.scanning" class="hint">{{ t('正在扫描扩展目录…') }}</div>
        <div
          v-else-if="!extensions.candidates.length"
          class="hint"
          data-testid="vscode-import-empty"
        >
          {{ t('未发现可导入的扩展') }}
        </div>
        <ul v-else class="candidate-list">
          <li
            v-for="candidate in extensions.candidates"
            :key="candidate.id"
            class="candidate"
            :data-testid="`vscode-candidate-${candidate.id}`"
          >
            <span class="candidate-main">
              <span class="candidate-name">{{ candidate.displayName }}</span>
              <span class="candidate-meta">
                v{{ candidate.version }} · {{ COMPAT_LABEL[candidate.compatibility] }}
              </span>
              <span class="candidate-reason">{{ candidate.compatibilityReason }}</span>
            </span>
            <button
              v-if="!candidate.installed"
              type="button"
              class="mini"
              :disabled="extensions.busyId === candidate.id"
              :data-testid="`vscode-import-${candidate.id}`"
              @click="extensions.importVscode(candidate.id)"
            >
              {{ t('导入') }}
            </button>
            <span v-else class="installed">{{ t('已安装') }}</span>
          </li>
        </ul>
        <footer class="dialog-foot">
          <span data-testid="vscode-import-summary">
            {{ t('共') }} {{ extensions.candidates.length }} {{ t('个，可导入') }}
            {{ importableCount }} {{ t('个') }}
          </span>
        </footer>
      </section>
    </div>

    <ConfirmDialog
      v-if="pendingUninstall"
      :title="t('卸载扩展')"
      :message="
        t('确定卸载 {name}？其资源目录会被删除，此操作不可撤销。', {
          name: pendingUninstall.displayName
        })
      "
      :confirm-label="t('卸载')"
      danger
      testid="extension-uninstall-dialog"
      @confirm="confirmUninstall"
      @close="pendingUninstall = null"
    />
  </aside>
</template>

<style scoped>
.extensions {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

.ext-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
}

.count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
}

.icon {
  flex: none;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.actions {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.actions button {
  flex: 1;
  min-width: 0;
  padding: 4px 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.error,
.notice {
  flex: none;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.5;
}

.error {
  color: var(--danger);
}

.notice {
  color: var(--text-muted);
}

.hint {
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}

.ext-list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}

.ext-row {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.ext-row.disabled {
  opacity: 0.65;
}

.ext-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ext-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compat {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 15px;
}

.compat.declarative {
  background: var(--accent-soft);
  color: var(--accent);
}

.compat.partial {
  background: rgba(180, 130, 20, 0.16);
  color: #a8791a;
}

.compat.incompatible {
  background: rgba(190, 60, 60, 0.14);
  color: var(--danger);
}

.ext-meta,
.ext-contrib {
  margin-top: 2px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ext-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.mini {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.mini:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.mini:disabled {
  opacity: 0.5;
  cursor: default;
}

.mini.danger {
  color: var(--danger);
  border-color: rgba(190, 60, 60, 0.4);
}

.ext-detail {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 10.5px;
  line-height: 1.6;
}

.ext-detail p {
  margin: 0 0 4px;
}

.ext-detail .warn {
  color: var(--danger);
}

.ext-detail .path {
  font-family: var(--font-mono);
  word-break: break-all;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.28);
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 88vw);
  max-height: 76vh;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.dialog header {
  display: flex;
  align-items: center;
  padding: 14px 16px 6px;
}

.dialog h2 {
  flex: 1;
  margin: 0;
  font-size: 14px;
}

.dialog header button {
  width: 22px;
  height: 22px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.dialog-dir {
  margin: 0;
  padding: 0 16px 8px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  word-break: break-all;
}

.candidate-list {
  flex: 1;
  margin: 0;
  padding: 0 8px;
  overflow-y: auto;
  list-style: none;
}

.candidate {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.candidate-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.candidate-name {
  font-size: 12px;
}

.candidate-meta,
.candidate-reason {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.installed {
  flex: none;
  color: var(--text-muted);
  font-size: 10.5px;
}

.dialog-foot {
  padding: 8px 16px 12px;
  color: var(--text-muted);
  font-size: 10.5px;
}
</style>
