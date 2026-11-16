import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { AppError } from '../../shared/errors'
import type {
  ProjectIdRequest,
  ProjectRemoveResult,
  ProjectRenameRequest,
  SessionArchiveRequest,
  SessionCreateRequest,
  SessionExportResult,
  SessionListRequest,
  SessionMoveRequest,
  SessionPinRequest,
  SessionRenameRequest
} from '../../shared/ipc'
import type { ProjectSummary, SessionSummary, StoredMessage } from '../../shared/session'
import type { MessageRepository, ProjectRepository, SessionRepository } from '../db/repositories'
import { buildSessionMarkdown } from './sessionExport'

function sanitizeFileName(title: string): string {
  const cleaned = Array.from(title)
    .map((character) => {
      if (character.charCodeAt(0) < 32) return '_'
      return /[<>:"/\\|?*]/.test(character) ? '_' : character
    })
    .join('')
    .slice(0, 80)
    .trim()
  return cleaned || 'session'
}

export interface SessionServiceDeps {
  sessions: SessionRepository
  projects: ProjectRepository
  messages: MessageRepository
  getWorkspaceRoot: () => string | null
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  listProjects(): ProjectSummary[] {
    return this.deps.projects.list()
  }

  renameProject(input: ProjectRenameRequest): ProjectSummary {
    const name = input.name.trim()
    if (!name) throw new AppError('E_INVALID_INPUT', '项目名称不能为空')
    const updated = this.deps.projects.rename(input.projectId, name)
    if (!updated) throw new AppError('E_NOT_FOUND', '项目不存在')
    return updated
  }

  removeProject(input: ProjectIdRequest): ProjectRemoveResult {
    const project = this.deps.projects.get(input.projectId)
    if (!project) throw new AppError('E_NOT_FOUND', '项目不存在')
    return this.deps.projects.delete(project.id)
  }

  ensureProjectForCurrentWorkspace(): ProjectSummary | null {
    const root = this.deps.getWorkspaceRoot()
    if (!root) return null
    return this.deps.projects.ensure(root)
  }

  list(input: SessionListRequest = { includeArchived: false }): SessionSummary[] {
    return this.deps.sessions.list({
      projectId: input.projectId,
      includeArchived: input.includeArchived
    })
  }

  create(input: SessionCreateRequest): SessionSummary {
    let project: ProjectSummary | null = null

    if (input.projectId) {
      project = this.deps.projects.get(input.projectId)
      if (!project) throw new AppError('E_NOT_FOUND', '项目不存在')
    } else {
      const root = this.deps.getWorkspaceRoot()
      if (root) {
        project = this.deps.projects.ensure(root)
      }
    }

    const projectSessions = project
      ? this.deps.sessions.list({ projectId: project.id, includeArchived: true })
      : this.deps.sessions.list({ includeArchived: true })
    const title = input.title?.trim() || `会话 ${projectSessions.length + 1}`

    return this.deps.sessions.create({
      title,
      workspaceRoot: project?.root ?? null,
      projectId: project?.id ?? null
    })
  }

  rename(input: SessionRenameRequest): SessionSummary {
    const title = input.title.trim()
    if (!title) throw new AppError('E_INVALID_INPUT', '会话标题不能为空')
    const updated = this.deps.sessions.rename(input.sessionId, title)
    if (!updated) throw new AppError('E_NOT_FOUND', '会话不存在')
    return updated
  }

  pin(input: SessionPinRequest): SessionSummary {
    const updated = this.deps.sessions.setPinned(input.sessionId, input.pinned)
    if (!updated) throw new AppError('E_NOT_FOUND', '会话不存在')
    return updated
  }

  archive(input: SessionArchiveRequest): SessionSummary {
    const updated = this.deps.sessions.setArchived(input.sessionId, input.archived)
    if (!updated) throw new AppError('E_NOT_FOUND', '会话不存在')
    return updated
  }

  move(input: SessionMoveRequest): SessionSummary {
    const project = this.deps.projects.get(input.projectId)
    if (!project) throw new AppError('E_NOT_FOUND', '目标项目不存在')
    const updated = this.deps.sessions.move(input.sessionId, project.id, project.root)
    if (!updated) throw new AppError('E_NOT_FOUND', '会话不存在')
    return updated
  }

  remove(sessionId: string): boolean {
    return this.deps.sessions.delete(sessionId)
  }

  messages(sessionId: string): StoredMessage[] {
    if (!this.deps.sessions.get(sessionId)) {
      throw new AppError('E_NOT_FOUND', '会话不存在')
    }
    return this.deps.messages.listBySession(sessionId)
  }

  async exportToFile(sessionId: string): Promise<SessionExportResult> {
    const session = this.deps.sessions.get(sessionId)
    if (!session) throw new AppError('E_NOT_FOUND', '会话不存在')

    const messages = this.deps.messages.listBySession(sessionId)
    const markdown = buildSessionMarkdown(session, messages)
    const safeTitle = sanitizeFileName(session.title)

    const result = await dialog.showSaveDialog({
      title: '导出会话',
      defaultPath: join(app.getPath('documents'), `${safeTitle}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { path: null }

    await writeFile(result.filePath, markdown, 'utf8')
    return { path: result.filePath }
  }
}
