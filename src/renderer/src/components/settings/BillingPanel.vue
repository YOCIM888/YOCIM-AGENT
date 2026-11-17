<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref, watch } from 'vue'
import type { ProviderBalance } from '@shared/billing'
import { PRICING_CURRENCIES, type ModelPricing } from '@shared/settings'
import { useAppSettingsStore } from '../../stores/appSettings'
import { useProvidersStore } from '../../stores/providers'

const store = useAppSettingsStore()
const providersStore = useProvidersStore()

const balanceProviderId = ref('')
const balanceLoading = ref(false)
const balance = ref<ProviderBalance | null>(null)
const rangeDays = ref(0)
const rows = ref<ModelPricing[]>([])
const newProviderId = ref('')
const newModel = ref('')
const saving = ref(false)
const saved = ref(false)
const localError = ref('')

const billableProviders = computed(() =>
  providersStore.providers.filter((provider) => provider.id !== 'mock')
)
const newProvider = computed(
  () => providersStore.providers.find((item) => item.id === newProviderId.value) ?? null
)
const summary = computed(() => store.summary)
function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatMoney(value: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  if (value > 0 && value < 0.01) return `${symbol}< 0.01`
  return `${symbol}${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function syncRows(): void {
  rows.value = store.pricing.map((item) => ({ ...item }))
}

async function queryBalance(): Promise<void> {
  if (!balanceProviderId.value) return
  balanceLoading.value = true
  try {
    balance.value = await store.fetchBalance(balanceProviderId.value)
  } finally {
    balanceLoading.value = false
  }
}

function addRow(): void {
  if (!newProviderId.value || !newModel.value) return
  const exists = rows.value.some(
    (row) => row.providerId === newProviderId.value && row.model === newModel.value
  )
  if (exists) {
    localError.value = t('该模型已经在价格表里了')
    return
  }
  localError.value = ''
  rows.value = [
    ...rows.value,
    {
      providerId: newProviderId.value,
      model: newModel.value,
      inputPrice: 0,
      outputPrice: 0,
      currency: 'USD'
    }
  ]
  newModel.value = ''
}

function removeRow(index: number): void {
  rows.value = rows.value.filter((_, i) => i !== index)
}

async function savePricing(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    const ok = await store.setPricing({ entries: rows.value })
    if (!ok) return
    syncRows()
    saved.value = true
    await store.fetchSummary(rangeDays.value || undefined)
  } finally {
    saving.value = false
  }
}

watch(rangeDays, () => {
  void store.fetchSummary(rangeDays.value || undefined)
})

watch(
  () => newProviderId.value,
  () => {
    newModel.value = ''
  }
)

onMounted(async () => {
  await Promise.all([store.refresh(), providersStore.refresh()])
  syncRows()
  const first = billableProviders.value[0]
  if (first) balanceProviderId.value = first.id
  if (newProviderId.value === '' && first) newProviderId.value = first.id
  await store.fetchSummary(undefined)
})
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">{{ t('账户余额') }}</h3>
        <span class="muted">{{ t('DeepSeek 官方接口') }}</span>
      </div>
      <p class="sp-section-sub">
        {{
          t(
            'DeepSeek 提供官方的余额查询接口；其他 Provider 暂不支持自动查询，可在下面填写单价自行估算花费。'
          )
        }}
      </p>

      <div v-if="billableProviders.length" class="sp-row align-end">
        <label class="sp-field">
          <span>Provider</span>
          <select v-model="balanceProviderId" data-testid="billing-provider">
            <option v-for="provider in billableProviders" :key="provider.id" :value="provider.id">
              {{ provider.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="sp-btn"
          :disabled="balanceLoading || !balanceProviderId"
          data-testid="billing-balance-refresh"
          @click="queryBalance"
        >
          {{ balanceLoading ? t('查询中…') : t('查询余额') }}
        </button>
      </div>
      <p v-else class="sp-hint">
        {{
          t(
            '目前只有内置的 Mock 模型。先到「模型」页添加一个真实 Provider，才能查询余额并统计花费。'
          )
        }}
      </p>

      <div v-if="balance" class="balance-card" data-testid="billing-balance">
        <template v-if="balance.error">
          <p class="sp-error">{{ t(balance.error) }}</p>
        </template>
        <template v-else-if="!balance.supported">
          <p class="sp-hint">「{{ balance.providerName }}{{ t('」暂未接入余额查询接口。') }}</p>
        </template>
        <template v-else>
          <div class="balance-main">
            <span class="balance-label">{{ t('总余额') }}</span>
            <span class="balance-value" data-testid="billing-balance-total">
              {{ balance.currency === 'CNY' ? '¥' : '$' }}
              {{ balance.totalBalance?.toFixed(2) ?? '—' }}
              <em>{{ balance.currency }}</em>
            </span>
            <span class="balance-state" :class="{ low: balance.isAvailable === false }">
              {{ balance.isAvailable === false ? t('余额不足') : t('可用') }}
            </span>
          </div>
          <div class="balance-detail">
            <span>{{ t('赠金') }} {{ balance.grantedBalance?.toFixed(2) ?? '—' }}</span>
            <span>{{ t('充值') }} {{ balance.toppedUpBalance?.toFixed(2) ?? '—' }}</span>
            <span v-if="balance.balances.length > 1">
              {{ t('共') }} {{ balance.balances.length }} {{ t('个币种账户') }}
            </span>
          </div>
        </template>
      </div>
    </section>

    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">{{ t('用量与费用') }}</h3>
        <label class="sp-field inline">
          <span>{{ t('统计范围') }}</span>
          <select v-model.number="rangeDays" data-testid="billing-range">
            <option :value="0">{{ t('全部') }}</option>
            <option :value="7">{{ t('最近 7 天') }}</option>
            <option :value="30">{{ t('最近 30 天') }}</option>
            <option :value="90">{{ t('最近 90 天') }}</option>
          </select>
        </label>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">{{ t('输入 token') }}</span>
          <span class="stat-value">{{ formatTokens(summary?.totalInputTokens ?? 0) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t('输出 token') }}</span>
          <span class="stat-value">{{ formatTokens(summary?.totalOutputTokens ?? 0) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t('模型调用') }}</span>
          <span class="stat-value">{{ formatNumber(summary?.totalCalls ?? 0) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t('预估费用') }}</span>
          <span class="stat-value" data-testid="billing-total-cost">
            {{ summary?.mixedCurrency ? t('多币种') : formatMoney(summary?.totalCost ?? 0, 'USD') }}
          </span>
        </div>
      </div>

      <table v-if="summary?.items.length" class="sp-table">
        <thead>
          <tr>
            <th>{{ t('Provider / 模型') }}</th>
            <th class="num">{{ t('输入') }}</th>
            <th class="num">{{ t('输出') }}</th>
            <th class="num">{{ t('调用') }}</th>
            <th class="num">{{ t('预估费用') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in summary.items" :key="`${item.providerId}-${item.model}`">
            <td>
              <span class="cell-main">{{ item.model }}</span>
              <span class="cell-sub">{{ item.providerName }}</span>
            </td>
            <td class="num">{{ formatTokens(item.inputTokens) }}</td>
            <td class="num">{{ formatTokens(item.outputTokens) }}</td>
            <td class="num">{{ formatNumber(item.calls) }}</td>
            <td class="num">
              <span v-if="item.cost !== null">{{ formatMoney(item.cost, item.currency) }}</span>
              <span v-else class="unpriced">{{ t('未设单价') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="sp-empty">{{ t('还没有用量记录——发一次对话后这里就会出现统计。') }}</p>

      <p v-if="summary?.unpricedItems" class="sp-hint">
        {{
          t('有 {count} 个模型还没设置单价，补上后这里会显示估算费用。', {
            count: summary.unpricedItems
          })
        }}
      </p>
    </section>

    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">{{ t('模型价格') }}</h3>
        <span class="muted">{{ t('每百万 token') }}</span>
      </div>
      <p class="sp-section-sub">
        {{ t('手动填写各模型的输入 / 输出单价，费用估算就是「token 用量 × 单价」。') }}
      </p>

      <table v-if="rows.length" class="sp-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>{{ t('模型') }}</th>
            <th class="num">{{ t('输入价') }}</th>
            <th class="num">{{ t('输出价') }}</th>
            <th>{{ t('币种') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="`${row.providerId}-${row.model}`">
            <td>
              {{
                providersStore.providers.find((p) => p.id === row.providerId)?.name ??
                row.providerId
              }}
            </td>
            <td>{{ row.model }}</td>
            <td>
              <input
                v-model.number="row.inputPrice"
                type="number"
                min="0"
                step="0.01"
                data-testid="billing-price-input"
              />
            </td>
            <td>
              <input
                v-model.number="row.outputPrice"
                type="number"
                min="0"
                step="0.01"
                data-testid="billing-price-output"
              />
            </td>
            <td>
              <select v-model="row.currency">
                <option v-for="currency in PRICING_CURRENCIES" :key="currency" :value="currency">
                  {{ currency }}
                </option>
              </select>
            </td>
            <td>
              <button type="button" class="sp-btn sm ghost" @click="removeRow(index)">
                {{ t('移除') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="sp-empty">{{ t('还没有配置任何价格。') }}</p>

      <div v-if="billableProviders.length" class="sp-row align-end">
        <label class="sp-field">
          <span>Provider</span>
          <select v-model="newProviderId" data-testid="billing-new-provider">
            <option v-for="provider in billableProviders" :key="provider.id" :value="provider.id">
              {{ provider.name }}
            </option>
          </select>
        </label>
        <label class="sp-field">
          <span>{{ t('模型') }}</span>
          <select v-model="newModel" data-testid="billing-new-model">
            <option value="">{{ t('选择模型…') }}</option>
            <option v-for="model in newProvider?.models ?? []" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
        </label>
        <button type="button" class="sp-btn" data-testid="billing-add-price" @click="addRow">
          {{ t('添加') }}
        </button>
      </div>
      <p v-else class="sp-hint">{{ t('添加真实 Provider 后即可为它的模型填写单价。') }}</p>

      <div class="sp-row">
        <button
          type="button"
          class="sp-btn primary"
          :disabled="saving"
          data-testid="billing-save-pricing"
          @click="savePricing"
        >
          {{ t('保存价格表') }}
        </button>
        <span v-if="saved" class="sp-notice">{{ t('已保存') }}</span>
      </div>
    </section>

    <p v-if="localError" class="sp-error">{{ localError }}</p>
    <p v-if="store.error" class="sp-error">{{ t(store.error) }}</p>
  </div>
</template>

<style scoped>
.muted {
  font-size: 11.5px;
  color: var(--text-muted);
}

.sp-field.inline {
  flex: none;
  min-width: 160px;
}

.balance-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.balance-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.balance-label {
  font-size: 11.5px;
  color: var(--text-muted);
}

.balance-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.balance-value em {
  margin-left: 3px;
  font-size: 11px;
  font-style: normal;
  color: var(--text-muted);
}

.balance-state {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--success) 45%, transparent);
  border-radius: 999px;
  color: var(--success);
  font-size: 11px;
}

.balance-state.low {
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  color: var(--danger);
}

.balance-detail {
  display: flex;
  gap: 14px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.cell-main {
  display: block;
  color: var(--text);
}

.cell-sub {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
}

.unpriced {
  color: var(--text-muted);
  font-size: 11px;
}
</style>
