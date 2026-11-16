import type { ApprovalMode } from './approval'
import type { PublicProvider } from './providers'
import type { ImageSettings, ModelPricing, SearchSettings, StorageSettings } from './settings'

export interface SessionSummary {
  id: string
  title: string
  workspaceRoot: string | null
  projectId: string | null
  pinnedAt: number | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ProjectSummary {
  id: string
  name: string
  root: string
  createdAt: number
  updatedAt: number
  sessionCount: number
  lastSessionAt: number | null
}

export type StoredMessageRole = 'user' | 'assistant'

export interface StoredMessage {
  id: string
  role: StoredMessageRole
  content: string
  createdAt: number
  /** 助手消息对应的思考内容（可展开查看） */
  reasoningContent?: string
}

export interface PublicSettings {
  providers: PublicProvider[]
  activeProviderId: string
  activeModel: string
  approvalMode: ApprovalMode
  /** 联网搜索设置（Tavily） */
  search: SearchSettings
  /** 生图设置（智谱 cogview-3-flash / 自定义） */
  image: ImageSettings
  /** 模型价格表：用于账单里的费用估算 */
  pricing: ModelPricing[]
  /** 存储设置（数据目录） */
  storage: StorageSettings
}
