<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref } from 'vue'
import {
  IMAGE_PROVIDERS,
  IMAGE_PROVIDER_LABELS,
  IMAGE_SIZES,
  ZHIPU_IMAGE_ENDPOINT,
  DEFAULT_IMAGE_MODEL,
  type ImageProvider,
  type ImageSize
} from '@shared/settings'
import { useAppSettingsStore } from '../../stores/appSettings'

const store = useAppSettingsStore()

const enabled = ref(false)
const provider = ref<ImageProvider>('zhipu')
const apiKey = ref('')
const baseUrl = ref<string>(ZHIPU_IMAGE_ENDPOINT)
const model = ref<string>(DEFAULT_IMAGE_MODEL)
const size = ref<ImageSize>('1024x1024')
const clearKey = ref(false)
const saving = ref(false)
const saved = ref(false)

const hasKey = computed(() => store.image.hasApiKey)
const isCustom = computed(() => provider.value === 'custom')

/** 切换到智谱时把端点与模型恢复为免费默认值；切回自定义时保留已填内容 */
function onProviderChange(event: Event): void {
  provider.value = (event.target as HTMLSelectElement).value as ImageProvider
  if (!isCustom.value) {
    baseUrl.value = ZHIPU_IMAGE_ENDPOINT
    model.value = DEFAULT_IMAGE_MODEL
  }
}

function load(): void {
  enabled.value = store.image.enabled
  provider.value = store.image.provider
  baseUrl.value = store.image.baseUrl
  model.value = store.image.model
  size.value = store.image.size
  apiKey.value = ''
  clearKey.value = false
}

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    const ok = await store.setImage({
      enabled: enabled.value,
      provider: provider.value,
      baseUrl: isCustom.value ? baseUrl.value.trim() : ZHIPU_IMAGE_ENDPOINT,
      model: isCustom.value ? model.value.trim() || DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_MODEL,
      size: size.value,
      ...(clearKey.value
        ? { apiKey: '' }
        : apiKey.value.trim()
          ? { apiKey: apiKey.value.trim() }
          : {})
    })
    if (!ok) return
    if (clearKey.value) {
      await store.clearImageKey()
      clearKey.value = false
    }
    apiKey.value = ''
    saved.value = true
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await store.refresh()
  load()
})
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">{{ t('AI 生图') }}</h3>
        <label class="sp-check">
          <input v-model="enabled" type="checkbox" data-testid="image-enabled" />
          {{ t('允许 Agent 生图') }}
        </label>
      </div>
      <p class="sp-section-sub">
        {{ t('开启后 Agent 会多出一个') }}
        <code>generate_image</code>
        {{ t('工具，用来根据文字描述生成图片并在对话里展示。 默认使用智谱免费模型') }}
        <code>cogview-3-flash</code>{{ t('（仍需在')
        }}<a
          href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys"
          target="_blank"
          rel="noreferrer"
          >{{ t('智谱开放平台') }}</a
        >{{ t('申请 API Key）；也可用环境变量') }} <code>ZHIPU_API_KEY</code>。
      </p>

      <label class="sp-field">
        <span>{{ t('服务来源') }}</span>
        <select :value="provider" data-testid="image-provider" @change="onProviderChange">
          <option v-for="item in IMAGE_PROVIDERS" :key="item" :value="item">
            {{ t(IMAGE_PROVIDER_LABELS[item]) }}
          </option>
        </select>
      </label>

      <label class="sp-field">
        <span>API Key</span>
        <input
          v-model="apiKey"
          type="password"
          data-testid="image-api-key"
          :placeholder="hasKey ? t('已保存（留空不修改）') : t('填入智谱 API Key')"
        />
      </label>

      <div class="sp-row">
        <label class="sp-check">
          <input v-model="clearKey" type="checkbox" data-testid="image-clear-key" />
          {{ t('清除已保存的 Key') }}
        </label>
        <span class="key-state" :class="{ ok: hasKey }">
          {{ hasKey ? t('已配置') : t('未配置') }}
        </span>
      </div>
    </section>

    <section v-if="isCustom" class="sp-section">
      <h3 class="sp-section-title">{{ t('自定义生图 API') }}</h3>
      <p class="sp-section-sub">
        {{ t('兼容 OpenAI 图像生成格式（') }}<code>POST</code> + <code>Bearer</code>
        {{ t('认证，响应含') }} <code>data[].url</code>{{ t('）的服务可在此接入。') }}
      </p>
      <label class="sp-field">
        <span>{{ t('请求地址') }}</span>
        <input
          v-model="baseUrl"
          type="text"
          data-testid="image-base-url"
          placeholder="https://.../images/generations"
        />
      </label>
      <label class="sp-field">
        <span>{{ t('模型名') }}</span>
        <input v-model="model" type="text" data-testid="image-model" :placeholder="t('模型编码')" />
      </label>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('生图参数') }}</h3>
      <label class="sp-field">
        <span>{{ t('默认分辨率') }}</span>
        <select v-model="size" data-testid="image-size">
          <option v-for="item in IMAGE_SIZES" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <p class="sp-hint">
        {{ t('分辨率也可由 Agent 在单次生成时指定；自定义 API 同样支持上述枚举值。') }}
      </p>
    </section>

    <p v-if="store.error" class="sp-error">{{ t(store.error) }}</p>
    <p v-if="saved" class="sp-notice">{{ t('已保存') }}</p>

    <div class="sp-actions">
      <button
        type="button"
        class="sp-btn primary"
        :disabled="saving"
        data-testid="image-save"
        @click="save"
      >
        {{ t('保存生图设置') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 11px;
}

a {
  color: var(--accent);
}

.key-state {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--text-muted);
}

.key-state.ok {
  color: var(--success);
}

.sp-actions {
  display: flex;
  gap: 10px;
}
</style>
