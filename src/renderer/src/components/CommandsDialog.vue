<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref } from 'vue'
import { COMMAND_WHITELIST_LIMITS, normalizeCommandWhitelist } from '@shared/settings'
import { useAppSettingsStore } from '../stores/appSettings'

const emit = defineEmits<{
  close: []
}>()

const store = useAppSettingsStore()
const rows = ref<string[]>([])
const draft = ref('')
const localError = ref('')
const saving = ref(false)
const saved = ref(false)

const dirty = computed(() => JSON.stringify(rows.value) !== JSON.stringify(store.commandWhitelist))

function syncRows(): void {
  rows.value = [...store.commandWhitelist]
}

function addCommand(): void {
  const normalized = normalizeCommandWhitelist([draft.value])[0]
  if (!normalized) {
    localError.value = draft.value.trim()
      ? t('命令不能超过 {max} 个字符', { max: COMMAND_WHITELIST_LIMITS.maxCommandLength })
      : t('请先输入命令')
    return
  }
  if (rows.value.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    localError.value = t('该命令已在白名单中')
    return
  }
  if (rows.value.length >= COMMAND_WHITELIST_LIMITS.maxEntries) {
    localError.value = t('白名单最多 {max} 条', { max: COMMAND_WHITELIST_LIMITS.maxEntries })
    return
  }
  rows.value = [...rows.value, normalized]
  draft.value = ''
  localError.value = ''
  saved.value = false
}

function removeCommand(index: number): void {
  rows.value = rows.value.filter((_, itemIndex) => itemIndex !== index)
  saved.value = false
}

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  localError.value = ''
  try {
    const ok = await store.setCommandWhitelist({ entries: [...rows.value] })
    if (!ok) return
    syncRows()
    saved.value = true
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await store.refresh()
  syncRows()
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="commands-dialog">
      <header class="dialog-head">
        <h2>{{ t('命令管理') }}</h2>
        <button
          type="button"
          class="close"
          :aria-label="t('关闭命令管理弹窗')"
          data-testid="commands-dialog-close-icon"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="dialog-body">
        <div class="sp-section">
          <div class="sp-section-head">
            <h3 class="sp-section-title">{{ t('命令白名单') }}</h3>
            <p class="sp-section-sub">
              {{
                t(
                  '仅在开放模式生效：命中白名单的命令直接执行，不再拦截或二次确认。可填可执行程序名（如 docker），也可填完整命令（如 npm run dev）。'
                )
              }}
            </p>
          </div>

          <div class="sp-row align-end">
            <div class="sp-field grow">
              <label for="command-whitelist-input">{{ t('添加命令') }}</label>
              <input
                id="command-whitelist-input"
                v-model="draft"
                data-testid="command-whitelist-input"
                :placeholder="t('例如：docker 或 npm run dev')"
                maxlength="2000"
                @keydown.enter.prevent="addCommand"
              />
            </div>
            <button
              type="button"
              class="sp-btn"
              data-testid="command-whitelist-add"
              @click="addCommand"
            >
              {{ t('添加') }}
            </button>
          </div>

          <p
            v-if="localError || store.error"
            class="sp-error"
            data-testid="command-whitelist-error"
          >
            {{ t(localError || store.error) }}
          </p>

          <ul v-if="rows.length" class="list" data-testid="command-whitelist-list">
            <li
              v-for="(command, index) in rows"
              :key="command"
              class="item"
              data-testid="command-whitelist-item"
            >
              <code :title="command">{{ command }}</code>
              <button
                type="button"
                class="sp-btn sm ghost"
                :aria-label="t('删除 {name}', { name: command })"
                data-testid="command-whitelist-remove"
                @click="removeCommand(index)"
              >
                {{ t('删除') }}
              </button>
            </li>
          </ul>
          <p v-else class="sp-empty" data-testid="command-whitelist-empty">
            {{
              t(
                '还没有自定义白名单命令。开放模式下遇到被拦截的命令时，也可以在处理提示里选择「加入白名单」。'
              )
            }}
          </p>

          <p v-if="saved" class="sp-notice" data-testid="command-whitelist-saved">
            {{ t('已保存，后续任务立即生效。') }}
          </p>
        </div>
      </div>

      <footer class="dialog-foot">
        <span class="hint"
          >{{ t('最多') }} {{ COMMAND_WHITELIST_LIMITS.maxEntries }} {{ t('条') }}</span
        >
        <span v-if="dirty" class="hint dirty">{{ t('有未保存的更改') }}</span>
        <button
          type="button"
          class="sp-btn"
          data-testid="command-whitelist-done"
          @click="emit('close')"
        >
          {{ t('完成') }}
        </button>
        <button
          type="button"
          class="sp-btn primary"
          data-testid="command-whitelist-save"
          :disabled="saving || store.loading"
          @click="save"
        >
          {{ saving ? t('保存中…') : t('保存') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(16, 24, 40, 0.28);
  -webkit-app-region: no-drag;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.dialog-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.dialog-head h2 {
  margin: 0;
  font-size: 16px;
}

.close {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dialog-body {
  padding: 4px 20px 12px;
  border-top: 1px solid var(--border);
  overflow: auto;
}

.grow {
  flex: 1;
  min-width: 0;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.item code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}

.dialog-foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}

.hint {
  margin-right: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.hint.dirty {
  margin-right: 0;
  color: var(--warning);
}
</style>
