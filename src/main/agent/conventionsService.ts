import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMessage, ChatProvider } from '../../shared/agent'
import { CONVENTION_GENERATE_MARKER } from '../../shared/conventions'
import { AppError } from '../../shared/errors'
import { CONVENTION_LIMITS } from '../../shared/ipcChannels'
import type { ProjectConventionRepository } from '../db/repositories'
import { loadWorkspaceRules } from './rules'
import { buildRepoMap } from './repoMap'
import { redactSecrets } from '../util/redact'

const SYSTEM_PROMPT = `你是项目文档助手。请基于给定上下文生成一份「项目约定」Markdown，供其他 AI 快速接手项目。
只写上下文中能证实的信息；不确定或缺失的内容写「待确认」，不要编造。
不要把密钥、Token、密码、私有地址等敏感信息写进结果。
只输出 Markdown 正文，不要 explanation 或代码围栏。
固定按这些二级标题输出，分节内用 1-4 条短项目符号：
## 项目概览
## 技术栈与运行方式
## 目录与核心模块
## 开发规范
## 数据与接口约定
## 测试与发布
## 注意事项 / 禁忌
## 当前已知问题`

export interface ConventionProject {
  id: string
  name: string
  root: string
}

export interface ConventionsServiceDeps {
  resolveProvider: () => ChatProvider
  getProject: (projectId: string) => ConventionProject | null
  conventions: ProjectConventionRepository
  /** 便于单测注入上下文读取 */
  readText?: (path: string) => Promise<string>
  loadRules?: (root: string) => Promise<{ content: string } | null>
  buildMap?: (root: string) => Promise<string>
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n[内容过长，已截断]` : trimmed
}

function section(title: string, body: string): string {
  return body ? `### ${title}\n${body}` : `### ${title}\n（无可用信息）`
}

/**
 * 一次性生成项目约定：直接调用当前 Provider，不经过 AgentService，
 * 因此不会写会话消息、agent_context 或聊天时间线。
 */
export class ConventionsService {
  constructor(private readonly deps: ConventionsServiceDeps) {}

  async generate(projectId: string): Promise<{ content: string }> {
    const project = this.deps.getProject(projectId)
    if (!project) throw new AppError('E_NOT_FOUND', '项目不存在')

    const context = await this.collectContext(project)
    const existing = this.deps.conventions.get(projectId)?.content ?? ''
    const userContent = redactSecrets(
      [
        CONVENTION_GENERATE_MARKER,
        `项目名称：${project.name}`,
        project.root.startsWith('ssh://') ? '项目类型：SSH 远程工作区（无法读取本地文件）' : '',
        section('README', context.readme),
        section('package.json 摘要', context.packageInfo),
        section('现有项目规则', context.rules),
        section('目录结构概览', context.repoMap),
        section('当前项目约定（如已有，请在不矛盾的前提下更新）', clip(existing, 4000)),
        '请按 system 中的固定分节输出项目约定 Markdown。'
      ]
        .filter(Boolean)
        .join('\n\n')
    )
    const messages: AgentMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ]

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONVENTION_LIMITS.generateTimeoutMs)
    let output = ''
    try {
      const provider = this.deps.resolveProvider()
      for await (const event of provider.stream({ messages }, controller.signal)) {
        if (controller.signal.aborted) break
        if (event.type === 'text') {
          output += event.text
          if (output.length > CONVENTION_LIMITS.maxOutputChars) break
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError('E_IO', '生成超时，请稍后重试')
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new AppError('E_IO', `生成失败：${detail}`)
    } finally {
      clearTimeout(timer)
    }

    if (controller.signal.aborted && !output) {
      throw new AppError('E_IO', '生成超时，请稍后重试')
    }
    const content = redactSecrets(output.trim()).slice(0, CONVENTION_LIMITS.maxOutputChars)
    if (!content) throw new AppError('E_UNKNOWN', '模型没有返回内容，请重试')
    return { content }
  }

  private async collectContext(
    project: ConventionProject
  ): Promise<{ readme: string; packageInfo: string; rules: string; repoMap: string }> {
    if (project.root.startsWith('ssh://')) {
      return { readme: '', packageInfo: '', rules: '', repoMap: '' }
    }
    const readText = this.deps.readText ?? ((path: string) => readFile(path, 'utf8'))
    let readme = ''
    for (const name of ['README.md', 'README.MD', 'readme.md']) {
      try {
        readme = clip(await readText(join(project.root, name)), CONVENTION_LIMITS.maxContextChars)
        break
      } catch {
        // README 是可选上下文
      }
    }

    let packageInfo = ''
    try {
      const parsed: unknown = JSON.parse(await readText(join(project.root, 'package.json')))
      if (parsed && typeof parsed === 'object') {
        const data = parsed as Record<string, unknown>
        packageInfo = clip(
          JSON.stringify(
            {
              name: data['name'],
              description: data['description'],
              scripts: data['scripts'],
              dependencies: data['dependencies'],
              devDependencies: data['devDependencies']
            },
            null,
            2
          ),
          3000
        )
      }
    } catch {
      // package.json 也是可选上下文
    }

    let rules = ''
    try {
      const loaded = await (this.deps.loadRules ?? loadWorkspaceRules)(project.root)
      rules = clip(loaded?.content ?? '', CONVENTION_LIMITS.maxContextChars)
    } catch {
      // 规则文件读取失败不阻塞生成
    }

    let repoMap = ''
    try {
      repoMap = clip(await (this.deps.buildMap ?? buildRepoMap)(project.root), 4000)
    } catch {
      // 目录读取失败不阻塞生成
    }

    return { readme, packageInfo, rules, repoMap }
  }
}
