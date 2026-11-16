/** 账单相关的共享类型：余额查询结果与用量汇总。 */

/** 单个 Provider 的账户余额 */
export interface ProviderBalance {
  providerId: string
  providerName: string
  /** 该 Provider 是否提供余额查询接口 */
  supported: boolean
  /** 余额是否足以调用 API（不支持查询时为 null） */
  isAvailable: boolean | null
  /** 币种（CNY / USD） */
  currency: string | null
  /** 总可用余额（含赠金与充值） */
  totalBalance: number | null
  /** 未过期的赠金余额 */
  grantedBalance: number | null
  /** 充值余额 */
  toppedUpBalance: number | null
  /** 各币种的明细（DeepSeek 同时返回 CNY 与 USD） */
  balances: Array<{
    currency: string
    totalBalance: number
    grantedBalance: number
    toppedUpBalance: number
  }>
  /** 查询时间 */
  fetchedAt: number
  /** 查询失败时的原因 */
  error?: string
}

/** 用量汇总中的一条（provider + model 维度） */
export interface BillingUsageItem {
  providerId: string
  providerName: string
  model: string
  inputTokens: number
  outputTokens: number
  calls: number
  /** 已配置单价时的预估费用；未配置单价为 null */
  cost: number | null
  currency: string
  /** 是否已配置单价 */
  priced: boolean
  lastUsedAt: number
}

export interface BillingSummary {
  items: BillingUsageItem[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCalls: number
  /** 已配置单价的条目合计费用 */
  totalCost: number
  /** 混合币种时为 true：此时 totalCost 不代表单一币种金额 */
  mixedCurrency: boolean
  /** 没有配置单价的条目数 */
  unpricedItems: number
  updatedAt: number
}

/** 存储目录信息 */
export interface StorageInfo {
  /** 实际生效的数据目录 */
  dataDir: string
  /** 系统默认目录（未自定义时等于 dataDir） */
  defaultDir: string
  /** 是否已自定义 */
  customized: boolean
  /** 是否需要重启才能生效 */
  pendingRestart: boolean
  /** 数据库文件大小（字节） */
  databaseBytes: number
  /** 目录内各子项大小（字节） */
  entries: Array<{ name: string; bytes: number }>
}
