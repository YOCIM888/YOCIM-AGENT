<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProviderPresetId,
  type ProviderProtocol,
  type PublicProvider
} from '@shared/providers'
import { useProvidersStore } from '../stores/providers'

const emit = defineEmits<{
  close: []
}>()

const store = useProvidersStore()

const selectedId = ref<string | null>(null)
const isNew = ref(false)
const presetId = ref<ProviderPresetId>('deepseek')
const name = ref('')
const protocol = ref<ProviderProtocol>('openai')
const baseUrl = ref('')
const modelsText = ref('')
const model = ref('')
const apiKey = ref('')
const clearKey = ref(false)
const loading = ref(false)
const error = ref('')

const addablePresets = PROVIDER_PRESETS.filter((preset) => preset.id !== 'mock')
const selectedProvider = computed(
  () => store.providers.find((provider) => provider.id === selectedId.value) ?? null
)
const isMock = computed(() => !isNew.value && selectedProvider.value?.id === 'mock')
const isCustom = computed(() => presetId.value === 'custom')
const preset = computed(() => getProviderPreset(presetId.value))
const parsedModels = computed(() =>
  [
    ...new Set(
      modelsText.value
        .split(/[\n,，]/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].slice(0, 50)
)
const modelOptions = computed(() => {
  const list = [...parsedModels.value]
  if (model.value && !list.includes(model.value)) list.unshift(model.value)
  return list
})

function protocolLabel(value: ProviderProtocol): string {
  if (value === 'anthropic') return 'Anthropic'
  if (value === 'gemini') return 'Gemini'
  return 'OpenAI 兼容'
}

function fillFromProvider(provider: PublicProvider): void {
  selectedId.value = provider.id
  isNew.value = false
  presetId.value = provider.presetId
  name.value = provider.name
  protocol.value = provider.protocol
  baseUrl.value = provider.baseUrl
  modelsText.value = provider.models.join('\n')
  model.value = provider.model || provider.models[0] || ''
  apiKey.value = ''
  clearKey.value = false
  error.value = ''
}

function applyPreset(id: ProviderPresetId): void {
  const item = getProviderPreset(id)
  presetId.value = id
  name.value = item.name
  protocol.value = item.protocol
  baseUrl.value = item.baseUrl
  modelsText.value = item.models.join('\n')
  model.value = item.models[0] ?? ''
  apiKey.value = ''
  clearKey.value = false
  error.value = ''
}

function selectProvider(provider: PublicProvider): void {
  fillFromProvider(provider)
}

function startAdd(): void {
  selectedId.value = null
  isNew.value = true
  applyPreset('deepseek')
}

function onPresetChange(): void {
  applyPreset(presetId.value)
}

async function save(): Promise<void> {
  if (isMock.value) return
  loading.value = true
  error.value = ''
  try {
    const models = parsedModels.value.length
      ? parsedModels.value
      : model.value.trim()
        ? [model.value.trim()]
        : []
    const ok = await store.saveProvider({
      ...(isNew.value || !selectedId.value ? {} : { id: selectedId.value }),
      presetId: presetId.value,
      name: name.value.trim() || preset.value.name,
      protocol: protocol.value,
      baseUrl: baseUrl.value,
      model: model.value.trim() || models[0] || '',
      models,
      ...(clearKey.value
        ? { apiKey: '' }
        : apiKey.value.trim()
          ? { apiKey: apiKey.value.trim() }
          : {})
    })
    if (!ok) {
      error.value = store.error
      return
    }
    emit('close')
  } finally {
    loading.value = false
  }
}

async function remove(): Promise<void> {
  const provider = selectedProvider.value
  if (!provider || provider.id === 'mock') return
  loading.value = true
  error.value = ''
  try {
    const ok = await store.removeProvider(provider.id)
    if (!ok) {
      error.value = store.error
      return
    }
    const next = store.providers[0]
    if (next) fillFromProvider(next)
  } finally {
    loading.value = false
  }
}

async function useProvider(): Promise<void> {
  const provider = selectedProvider.value
  if (!provider) return
  loading.value = true
  error.value = ''
  try {
    const target = provider.model || provider.models[0] || ''
    const ok = await store.setActive(provider.id, target)
    if (!ok) error.value = store.error
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await store.refresh()
  const active =
    store.providers.find((provider) => provider.id === store.activeProviderId) ?? store.providers[0]
  if (active) fillFromProvider(active)
})
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="dialog" data-testid="settings-dialog">
      <header class="dialog-head">
        <h2>模型设置</h2>
        <button type="button" class="close" aria-label="关闭设置" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <aside class="provider-list">
          <button
            v-for="provider in store.providers"
            :key="provider.id"
            type="button"
            class="provider-item"
            :class="{ active: !isNew && selectedId === provider.id }"
            :data-provider-id="provider.id"
            :data-testid="`settings-provider-${provider.id}`"
            @click="selectProvider(provider)"
          >
            <span class="provider-name">{{ provider.name }}</span>
            <span class="provider-meta">
              {{ protocolLabel(provider.protocol) }}
              <template v-if="provider.id === store.activeProviderId"> · 当前</template>
            </span>
            <span
              class="key-dot"
              :class="{ ok: provider.hasApiKey }"
              :title="provider.hasApiKey ? '已配置 API Key' : '未配置 API Key'"
            ></span>
          </button>
          <button
            type="button"
            class="add-provider"
            data-testid="settings-add-provider"
            @click="startAdd"
          >
            ＋ 添加提供商
          </button>
        </aside>

        <div class="form">
          <label v-if="isNew" class="field">
            <span>Provider 预设</span>
            <select v-model="presetId" data-testid="settings-preset" @change="onPresetChange">
              <option v-for="item in addablePresets" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <p v-if="isNew" class="preset-desc">{{ preset.description }}</p>

          <label class="field">
            <span>名称</span>
            <input v-model="name" data-testid="settings-name" :disabled="isMock" />
          </label>

          <label v-if="isCustom" class="field">
            <span>协议</span>
            <select v-model="protocol" data-testid="settings-protocol">
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic Messages</option>
              <option value="gemini">Gemini GenerateContent</option>
            </select>
          </label>

          <label class="field">
            <span>Base URL</span>
            <input
              v-model="baseUrl"
              data-testid="settings-base-url"
              :disabled="isMock"
              placeholder="https://api.example.com/v1"
            />
          </label>

          <label class="field">
            <span>模型列表（每行一个，也可用逗号分隔）</span>
            <textarea
              v-model="modelsText"
              data-testid="settings-models"
              rows="3"
              :disabled="isMock"
              placeholder="model-a&#10;model-b"
            ></textarea>
          </label>

          <label class="field">
            <span>当前模型</span>
            <select v-model="model" data-testid="settings-model" :disabled="isMock">
              <option v-for="item in modelOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>

          <label v-if="!isMock" class="field">
            <span>API Key</span>
            <input
              v-model="apiKey"
              type="password"
              data-testid="settings-api-key"
              :placeholder="
                selectedProvider?.hasApiKey
                  ? '已保存（留空不修改）'
                  : preset.requiresApiKey
                    ? '输入 API Key'
                    : '可选（本地服务可留空）'
              "
            />
          </label>

          <label v-if="!isMock" class="checkbox">
            <input v-model="clearKey" type="checkbox" data-testid="settings-clear-key" />
            清除已保存的 API Key
          </label>

          <p class="hint">
            API Key 通过系统安全存储按 Provider 独立加密保存，不会写入日志或明文数据库。
            保存后将自动切换为该 Provider。
          </p>
          <p v-if="isMock" class="hint">内置 Mock Provider 无需配置，可直接在输入卡右下角切换。</p>
          <p v-if="error" class="error">{{ error }}</p>

          <div class="actions">
            <button
              v-if="!isNew && !isMock"
              type="button"
              class="danger"
              :disabled="loading"
              data-testid="settings-delete-provider"
              @click="remove"
            >
              删除
            </button>
            <span class="spacer"></span>
            <button
              v-if="!isNew && selectedProvider"
              type="button"
              :disabled="loading"
              data-testid="settings-use-provider"
              @click="useProvider"
            >
              设为当前
            </button>
            <button
              type="button"
              class="primary"
              :disabled="loading || isMock"
              data-testid="settings-save"
              @click="save"
            >
              保存
            </button>
            <button type="button" @click="emit('close')">关闭</button>
          </div>
        </div>
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
  -webkit-app-region: no-drag;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 12px;
}

.dialog-head h2 {
  margin: 0;
  font-size: 17px;
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

.body {
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--border);
}

.provider-list {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 220px;
  padding: 10px;
  border-right: 1px solid var(--border);
  overflow: auto;
}

.provider-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.provider-item:hover {
  background: var(--bg-hover);
}

.provider-item.active {
  border-color: var(--border);
  background: var(--bg-subtle);
}

.provider-name {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-meta {
  color: var(--text-muted);
  font-size: 10.5px;
}

.key-dot {
  position: absolute;
  top: 12px;
  right: 10px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border-strong);
}

.key-dot.ok {
  background: var(--success);
}

.add-provider {
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.add-provider:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.form {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 16px 22px 18px;
  overflow: auto;
}

.preset-desc {
  margin: -4px 0 10px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input,
.field select,
.field textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.field textarea {
  resize: vertical;
  font-family: var(--font-mono);
  font-size: 12px;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--accent);
}

.field input:disabled,
.field select:disabled,
.field textarea:disabled {
  opacity: 0.6;
  cursor: default;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.hint {
  margin: 0 0 10px;
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
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 8px;
}

.spacer {
  flex: 1;
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

.actions button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.actions button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast);
}

.actions button.danger {
  color: var(--danger);
}

.actions button:disabled {
  opacity: 0.6;
  cursor: default;
}

@media (max-width: 720px) {
  .body {
    flex-direction: column;
  }

  .provider-list {
    width: auto;
    max-height: 160px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>
