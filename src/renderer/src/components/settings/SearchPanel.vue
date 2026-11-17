<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref } from 'vue'
import {
  SEARCH_DEPTH_LABELS,
  SEARCH_DEPTHS,
  SEARCH_TOPIC_LABELS,
  SEARCH_TOPICS,
  WEB_SEARCH_LIMITS,
  type SearchDepth,
  type SearchTopic
} from '@shared/settings'
import { useAppSettingsStore } from '../../stores/appSettings'

const store = useAppSettingsStore()

const enabled = ref(false)
const apiKey = ref('')
const maxResults = ref(5)
const searchDepth = ref<SearchDepth>('basic')
const topic = ref<SearchTopic>('general')
const includeAnswer = ref(true)
const includeRawContent = ref(false)
const clearKey = ref(false)
const saving = ref(false)
const saved = ref(false)

const hasKey = computed(() => store.search.hasApiKey)
const effectiveMax = computed(() =>
  Math.min(WEB_SEARCH_LIMITS.maxResults, Math.max(WEB_SEARCH_LIMITS.minResults, maxResults.value))
)

function load(): void {
  enabled.value = store.search.enabled
  maxResults.value = store.search.maxResults
  searchDepth.value = store.search.searchDepth
  topic.value = store.search.topic
  includeAnswer.value = store.search.includeAnswer
  includeRawContent.value = store.search.includeRawContent
  apiKey.value = ''
  clearKey.value = false
}

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    const ok = await store.setSearch({
      enabled: enabled.value,
      maxResults: effectiveMax.value,
      searchDepth: searchDepth.value,
      topic: topic.value,
      includeAnswer: includeAnswer.value,
      includeRawContent: includeRawContent.value,
      ...(clearKey.value
        ? { apiKey: '' }
        : apiKey.value.trim()
          ? { apiKey: apiKey.value.trim() }
          : {})
    })
    if (!ok) return
    if (clearKey.value) {
      await store.clearSearchKey()
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
        <h3 class="sp-section-title">{{ t('联网搜索（Tavily）') }}</h3>
        <label class="sp-check">
          <input v-model="enabled" type="checkbox" data-testid="search-enabled" />
          {{ t('允许 Agent 联网搜索') }}
        </label>
      </div>
      <p class="sp-section-sub">
        {{ t('开启后 Agent 会多出一个') }} <code>web_search</code>
        {{
          t(
            '工具，用来查最新的文档、版本号、报错含义等 本地代码里查不到的信息。需要先填写 Tavily API Key（也可用环境变量'
          )
        }}
        <code>TAVILY_API_KEY</code>）。
      </p>

      <label class="sp-field">
        <span>Tavily API Key</span>
        <input
          v-model="apiKey"
          type="password"
          data-testid="search-api-key"
          :placeholder="hasKey ? t('已保存（留空不修改）') : 'tvly-...'"
        />
      </label>

      <div class="sp-row">
        <label class="sp-check">
          <input v-model="clearKey" type="checkbox" data-testid="search-clear-key" />
          {{ t('清除已保存的 Key') }}
        </label>
        <span class="key-state" :class="{ ok: hasKey }">
          {{ hasKey ? t('已配置') : t('未配置') }}
        </span>
      </div>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('搜索参数') }}</h3>

      <div class="sp-row">
        <label class="sp-field">
          <span>{{ t('最大结果条数') }}</span>
          <input
            v-model.number="maxResults"
            type="number"
            min="1"
            :max="WEB_SEARCH_LIMITS.maxResults"
            data-testid="search-max-results"
          />
        </label>
        <label class="sp-field">
          <span>{{ t('搜索强度') }}</span>
          <select v-model="searchDepth" data-testid="search-depth">
            <option v-for="depth in SEARCH_DEPTHS" :key="depth" :value="depth">
              {{ t(SEARCH_DEPTH_LABELS[depth]) }}
            </option>
          </select>
        </label>
        <label class="sp-field">
          <span>{{ t('搜索主题') }}</span>
          <select v-model="topic" data-testid="search-topic">
            <option v-for="item in SEARCH_TOPICS" :key="item" :value="item">
              {{ t(SEARCH_TOPIC_LABELS[item]) }}
            </option>
          </select>
        </label>
      </div>

      <label class="sp-check">
        <input v-model="includeAnswer" type="checkbox" data-testid="search-include-answer" />
        {{ t('附带 Tavily 生成的摘要答案') }}
      </label>
      <label class="sp-check">
        <input v-model="includeRawContent" type="checkbox" data-testid="search-include-raw" />
        {{ t('附带网页原始正文（更全，但更费额度与上下文）') }}
      </label>

      <p class="sp-hint">
        {{ t('进阶强度每次搜索消耗 2 倍额度，但结果更准；最大条数上限') }}
        {{ WEB_SEARCH_LIMITS.maxResults }} {{ t('条。') }}
      </p>
    </section>

    <p v-if="store.error" class="sp-error">{{ t(store.error) }}</p>
    <p v-if="saved" class="sp-notice">{{ t('已保存') }}</p>

    <div class="sp-actions">
      <button
        type="button"
        class="sp-btn primary"
        :disabled="saving"
        data-testid="search-save"
        @click="save"
      >
        {{ t('保存搜索设置') }}
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
