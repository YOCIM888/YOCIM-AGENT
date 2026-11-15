import type { ApprovalMode } from './approval'
import type { PublicProvider } from './providers'

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
}

export interface PublicSettings {
  providers: PublicProvider[]
  activeProviderId: string
  activeModel: string
  approvalMode: ApprovalMode
}
