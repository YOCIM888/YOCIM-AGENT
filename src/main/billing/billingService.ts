import type { BillingSummary, BillingUsageItem, ProviderBalance } from '../../shared/billing'
import { AppError } from '../../shared/errors'
import { estimateCost } from '../../shared/settings'
import type { UsageRepository } from '../db/repositories'
import type { SettingsService } from '../settings/settingsService'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

const BALANCE_TIMEOUT_MS = 15_000

/** 支持官方余额查询的 Provider 预设 */
const BALANCE_PRESETS = new Set(['deepseek'])

interface DeepSeekBalancePayload {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string | number
    granted_balance?: string | number
    topped_up_balance?: string | number
  }>
}

function toNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 账单服务：
 * 1) 查询 Provider 账户余额（目前只有 DeepSeek 提供官方接口）；
 * 2) 汇总本地 token 用量，按用户填写的单价估算费用。
 */
export class BillingService {
  constructor(
    private readonly usage: UsageRepository,
    private readonly settings: SettingsService,
    private readonly fetchImpl?: FetchFn
  ) {}

  /** 查询单个 Provider 的余额 */
  async getBalance(providerId: string): Promise<ProviderBalance> {
    const settings = this.settings.getPublic()
    const provider = settings.providers.find((item) => item.id === providerId)
    if (!provider) throw new AppError('E_NOT_FOUND', 'Provider 不存在')

    const base: ProviderBalance = {
      providerId,
      providerName: provider.name,
      supported: BALANCE_PRESETS.has(provider.presetId),
      isAvailable: null,
      currency: null,
      totalBalance: null,
      grantedBalance: null,
      toppedUpBalance: null,
      balances: [],
      fetchedAt: Date.now()
    }

    if (!base.supported) return base

    const apiKey = this.settings.getProviderApiKey(providerId)
    if (!apiKey) {
      return { ...base, error: '该 Provider 尚未配置 API Key' }
    }

    const doFetch = this.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init))
    // DeepSeek 的余额接口挂在站点根路径上（不带 /v1）
    const root = provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
    const url = `${root}/user/balance`

    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS)
      })
      if (!response.ok) {
        return { ...base, error: `余额查询失败：HTTP ${response.status}` }
      }
      let payload: DeepSeekBalancePayload
      try {
        payload = (await response.json()) as DeepSeekBalancePayload
      } catch {
        return { ...base, error: '余额查询失败：响应无法解析' }
      }

      const balances = (payload.balance_infos ?? [])
        .map((info) => ({
          currency: info.currency ?? 'CNY',
          totalBalance: toNumber(info.total_balance),
          grantedBalance: toNumber(info.granted_balance),
          toppedUpBalance: toNumber(info.topped_up_balance)
        }))
        .filter((info) => info.currency)

      if (!balances.length) {
        return { ...base, isAvailable: payload.is_available ?? null, error: '未返回余额明细' }
      }
      // 主币种优先人民币，其次美元
      const primary = balances.find((item) => item.currency === 'CNY') ?? balances[0]
      return {
        ...base,
        isAvailable: payload.is_available ?? null,
        currency: primary.currency,
        totalBalance: primary.totalBalance,
        grantedBalance: primary.grantedBalance,
        toppedUpBalance: primary.toppedUpBalance,
        balances
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络错误'
      return { ...base, error: `余额查询失败：${message}` }
    }
  }

  /** 汇总用量并按单价估算费用 */
  getSummary(sinceDays?: number): BillingSummary {
    const since =
      typeof sinceDays === 'number' && sinceDays > 0
        ? Date.now() - Math.round(sinceDays) * 24 * 60 * 60 * 1000
        : undefined
    const aggregates = this.usage.aggregate(since)
    const totals = this.usage.totals(since)
    const pricing = this.settings.getPricing()
    const providers = this.settings.getPublic().providers

    const items: BillingUsageItem[] = aggregates.map((aggregate) => {
      const provider = providers.find((item) => item.id === aggregate.providerId)
      const price = pricing.find(
        (item) => item.providerId === aggregate.providerId && item.model === aggregate.model
      )
      const cost = price ? estimateCost(price, aggregate.inputTokens, aggregate.outputTokens) : null
      return {
        providerId: aggregate.providerId,
        providerName: provider?.name ?? aggregate.providerId,
        model: aggregate.model,
        inputTokens: aggregate.inputTokens,
        outputTokens: aggregate.outputTokens,
        calls: aggregate.calls,
        cost,
        currency: price?.currency ?? 'USD',
        priced: Boolean(price),
        lastUsedAt: aggregate.lastUsedAt
      }
    })

    const currencies = new Set(items.filter((item) => item.priced).map((item) => item.currency))
    return {
      items,
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCalls: totals.calls,
      totalCost: items.reduce((sum, item) => sum + (item.cost ?? 0), 0),
      mixedCurrency: currencies.size > 1,
      unpricedItems: items.filter((item) => !item.priced).length,
      updatedAt: Date.now()
    }
  }
}
