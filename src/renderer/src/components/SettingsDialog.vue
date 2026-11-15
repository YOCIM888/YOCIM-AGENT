<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PublicSettings } from '@shared/session'

const emit = defineEmits<{
  close: []
}>()

const provider = ref<'mock' | 'openai'>('mock')
const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const clearKey = ref(false)
const hasApiKey = ref(false)
const loading = ref(false)
const error = ref('')

function applySettings(settings: PublicSettings): void {
  provider.value = settings.provider
  baseUrl.value = settings.baseUrl
  model.value = settings.model
  hasApiKey.value = settings.hasApiKey
}

onMounted(async () => {
  const result = await window.yocim.settings.get()
  if (result.ok) {
    applySettings(result.data)
  } else {
    error.value = result.error.message
  }
})

async function save(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const key = apiKey.value.trim()
    const result = await window.yocim.settings.set({
      provider: provider.value,
      baseUrl: baseUrl.value,
      model: model.value,
      ...(clearKey.value ? { apiKey: '' } : key ? { apiKey: key } : {})
    })
    if (!result.ok) {
      error.value = result.error.message
      return
    }
    applySettings(result.data)
    apiKey.value = ''
    clearKey.value = false
    emit('close')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="settings-dialog">
      <h2>模型设置</h2>

      <label class="field">
        <span>Provider</span>
        <select v-model="provider" data-testid="settings-provider">
          <option value="mock">Mock（离线）</option>
          <option value="openai">OpenAI-compatible</option>
        </select>
      </label>

      <label class="field">
        <span>Base URL</span>
        <input
          v-model="baseUrl"
          data-testid="settings-base-url"
          placeholder="https://api.example.com/v1"
        />
      </label>

      <label class="field">
        <span>模型</span>
        <input v-model="model" data-testid="settings-model" placeholder="gpt-4o-mini" />
      </label>

      <label class="field">
        <span>API Key</span>
        <input
          v-model="apiKey"
          type="password"
          data-testid="settings-api-key"
          :placeholder="hasApiKey ? '已保存（留空不修改）' : '输入 API Key'"
        />
      </label>

      <label class="checkbox">
        <input v-model="clearKey" type="checkbox" />
        清除已保存的 API Key
      </label>

      <p class="hint">API Key 通过系统安全存储加密保存，不会写入日志或明文数据库。</p>
      <p v-if="error" class="error">{{ error }}</p>

      <div class="actions">
        <button
          type="button"
          class="primary"
          data-testid="settings-save"
          :disabled="loading"
          @click="save"
        >
          保存
        </button>
        <button type="button" @click="emit('close')">关闭</button>
      </div>
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
}

.dialog {
  width: 440px;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.dialog h2 {
  margin: 0 0 16px;
  font-size: 17px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input,
.field select {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: var(--accent);
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.hint {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
}

.error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.actions button {
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.actions button:hover {
  background: var(--bg-hover);
}

.actions button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
}

.actions button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
