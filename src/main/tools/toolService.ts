import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { ZodError } from 'zod'
import type { ToolCall, ToolExecutionOutcome } from '../../shared/agent'
import type { ApprovalMode, ApprovalRequest } from '../../shared/approval'
import type { AuditApproval } from '../../shared/audit'
import { AppError } from '../../shared/errors'
import { isWriteTool, summarizeToolArgs, TOOL_DEFINITIONS } from '../../shared/tools'
import { isCommandWhitelisted, normalizeCommandWhitelist } from '../../shared/settings'
import type { AllowRuleStore } from '../approval/allowRules'
import type { ApprovalManager } from '../approval/approvalManager'
import type { AuditStore } from '../audit/auditStore'
import type { ToolCallRepository } from '../db/repositories'
import type { WorkspaceGuardLike, WorkspacePathGuard } from '../workspace/pathGuard'
import { SearchService } from '../workspace/searchService'
import { TIMELINE_LIMITS, type TimelineService } from '../workspace/timelineService'
import { runWorkspaceCommand } from './commandRunner'
import {
  assertCommandAllowed,
  DEFAULT_ALLOWED_COMMANDS,
  loadProjectCommands
} from './commandPolicy'
import { createSearchServiceRunner, type ToolSearchRunner } from './searchTools'
import { createLocalToolFileIo, type ToolFileIo } from './toolFileIo'
import type { PlanStore } from '../agent/planStore'
import { parseToolArguments, type ParsedToolArguments } from './toolSchemas'
import { runUpdatePlan } from './planTools'
import { buildEditPreview, buildWritePreview, runEditFile, runWriteFile } from './editTools'
import {
  assertWritableRelativePath,
  runListDir,
  runReadFile,
  runSearchFiles
} from './workspaceTools'
import {
  runGetGitDiff,
  runRunLint,
  runRunTests,
  runRunTypecheck,
  type GitDiffRunner
} from './verifyTools'
import { runWebSearch, type WebSearchRunner } from './webSearchTools'
import { runGenerateImage, type ImageGenRunner } from './imageGenTools'
import { allowRuleValue, classifyCommand, needsApproval } from './commandRisk'

function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (error instanceof ZodError) {
    const first = error.issues[0]
    return first ? `参数校验失败：${first.message}` : '参数校验失败'
  }
  return error instanceof Error ? error.message : '工具执行失败'
}

export interface ToolExecutionContext {
  sessionId: string
  runId: string
  signal: AbortSignal
}

export interface ToolServiceDeps {
  approvals: ApprovalManager
  audit: AuditStore
  requireGuard: () => WorkspacePathGuard
  getApprovalMode?: () => ApprovalMode
  /** 开放模式下免拦截的命令白名单；每次执行都重新读取，配置改动即时生效 */
  getCommandWhitelist?: () => readonly string[]
  /** 「加入白名单」决策的落盘回调；缺省时本次仍放行但不持久化 */
  addCommandToWhitelist?: (command: string) => void
  toolCalls?: ToolCallRepository
  timeline?: TimelineService
  /** 文件访问实现：默认本地 fs；接入 SSH 远程工作区时替换为 SFTP 实现 */
  fileIo?: ToolFileIo
  /** Git / 搜索使用的守卫：SSH 远程工作区返回虚拟守卫；默认复用 requireGuard */
  accessGuard?: () => WorkspaceGuardLike
  /** 搜索执行器：默认新建 SearchService（ripgrep + 内置回退 + 远程） */
  search?: ToolSearchRunner
  /** 项目级命令白名单扩展；默认读工作区 .yocim/commands.json */
  projectCommands?: () => Promise<ReadonlySet<string>>
  /** 命令输出流式回调（已节流），用于 tool:output 事件 */
  onToolOutput?: (callId: string, runId: string, text: string) => void
  /** get_git_diff 的执行器（复用 gitRunner，支持远程） */
  gitDiff?: GitDiffRunner
  /** 会话计划存储（update_plan 读写）；缺省时该工具报不可用 */
  planStore?: PlanStore
  /** 会话/项目级允许规则（T4.2）；缺省时所有写操作走人工审批 */
  allowRules?: AllowRuleStore
  /** 联网搜索执行器（Tavily）；缺省或未配置 Key 时 web_search 工具不会暴露给模型 */
  webSearch?: WebSearchRunner
  /** 联网搜索是否可用：用于决定是否把 web_search 放进工具列表 */
  webSearchEnabled?: () => boolean
  /** 生图执行器（智谱 / 自定义）；缺省或未配置 Key 时 generate_image 工具不会暴露给模型 */
  imageGen?: ImageGenRunner
  /** 生图是否可用：用于决定是否把 generate_image 放进工具列表 */
  imageGenEnabled?: () => boolean
  /**
   * 工作区是否有未提交改动：git pull 在工作区干净时降为本地风险；
   * 缺省或查询失败时按「有改动」保守处理。
   */
  isWorktreeDirty?: () => Promise<boolean>
}

export class ToolService {
  private readonly io: ToolFileIo
  private readonly search: ToolSearchRunner
  /** 审批请求时记录的内容 hash（T4.4 写前预检），执行后清理 */
  private readonly approvalHashes = new Map<string, string>()

  constructor(private readonly deps: ToolServiceDeps) {
    this.io = deps.fileIo ?? createLocalToolFileIo({ requireGuard: deps.requireGuard })
    this.search =
      deps.search ??
      createSearchServiceRunner(
        new SearchService({
          getGuard: () => deps.accessGuard?.() ?? deps.requireGuard(),
          timeline: deps.timeline
        })
      )
  }

  getDefinitions(): typeof TOOL_DEFINITIONS {
    // 没配好的工具不对模型暴露：暴露了模型就会反复调用一个必然失败的工具
    return TOOL_DEFINITIONS.filter((definition) => {
      if (definition.name === 'web_search') {
        return Boolean(this.deps.webSearch && this.deps.webSearchEnabled?.() !== false)
      }
      if (definition.name === 'generate_image') {
        return Boolean(this.deps.imageGen && this.deps.imageGenEnabled?.() !== false)
      }
      return true
    })
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionOutcome> {
    const startedAt = Date.now()
    let argsSummary = summarizeToolArgs(call.name, call.argumentsJson)
    let approval: AuditApproval = 'not_required'
    let parsed: ParsedToolArguments

    const mode = this.deps.getApprovalMode?.() ?? 'manual'

    try {
      parsed = parseToolArguments(call.name, call.argumentsJson)
    } catch (error) {
      const message = describeError(error)
      const outcome: ToolExecutionOutcome = {
        ok: false,
        content: `工具调用被拒绝：${message}`,
        summary: message
      }
      this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
      return outcome
    }

    try {
      if (parsed.tool === 'run_command') {
        const whitelist = normalizeCommandWhitelist(this.deps.getCommandWhitelist?.() ?? [])
        const whitelisted = mode === 'open' && isCommandWhitelisted(parsed.args.command, whitelist)
        if (!whitelisted) {
          let blocked: unknown = null
          try {
            const project =
              (await this.deps.projectCommands?.()) ??
              (await loadProjectCommands(this.deps.requireGuard().root))
            assertCommandAllowed(
              parsed.args.command,
              new Set([...DEFAULT_ALLOWED_COMMANDS, ...project])
            )
          } catch (error) {
            blocked = error
          }

          if (blocked) {
            const message = describeError(blocked)
            if (mode !== 'open') {
              const outcome: ToolExecutionOutcome = {
                ok: false,
                content: `工具调用被拒绝：${message}`,
                summary: message
              }
              this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
              return outcome
            }

            // 开放模式：硬拦截不再直接终止，给用户「允许一次 / 加入白名单」的机会
            const decision = await this.deps.approvals.request(
              {
                callId: call.id,
                tool: parsed.tool,
                risk: 'high',
                reason: message,
                argsSummary,
                kind: 'blocked',
                blockedCommand: parsed.args.command
              },
              context.signal
            )
            // 只有新决策能解禁硬拦截；旧的 approve / approve_session 等一律按拒绝处理
            if (decision !== 'allow_once' && decision !== 'allow_whitelist') {
              const outcome: ToolExecutionOutcome = {
                ok: false,
                content: `用户拒绝了该操作，未执行。${message}`,
                summary: message
              }
              this.record(context, call, argsSummary, 'denied', outcome, Date.now() - startedAt)
              return outcome
            }
            if (decision === 'allow_whitelist') {
              try {
                this.deps.addCommandToWhitelist?.(parsed.args.command)
                argsSummary = `${argsSummary}（已加入白名单）`
              } catch {
                argsSummary = `${argsSummary}（本次放行，白名单写入失败）`
              }
            } else {
              argsSummary = `${argsSummary}（本次放行）`
            }
            approval = 'approved'
          }
        }
      }
      if (parsed.tool === 'write_file' || parsed.tool === 'edit_file') {
        assertWritableRelativePath(parsed.args.relativePath)
      }
    } catch (error) {
      // 路径守卫等策略错误保持「直接拒绝」；命令策略的开放模式分支已在上面处理
      const message = describeError(error)
      const outcome: ToolExecutionOutcome = {
        ok: false,
        content: `工具调用被拒绝：${message}`,
        summary: message
      }
      this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
      return outcome
    }

    if (isWriteTool(parsed.tool)) {
      /** 审批卡解释「为什么这一步需要确认」 */
      let approvalReason: string | undefined
      /** 外部操作才标高风险；本地操作在 manual 档询问时标中风险 */
      let approvalRisk: ApprovalRequest['risk']
      let requiresApproval: boolean

      if (parsed.tool === 'run_command') {
        const info = await classifyCommand(parsed.args.command, async () => {
          if (!this.deps.isWorktreeDirty) return true
          try {
            return await this.deps.isWorktreeDirty()
          } catch {
            return true
          }
        })
        approvalReason = info.reason
        approvalRisk = info.risk === 'external' ? 'high' : 'medium'
        requiresApproval = needsApproval(info.risk, mode)
      } else {
        approvalReason = '将修改工作区文件，可通过时间线恢复历史版本'
        approvalRisk = 'medium'
        requiresApproval = needsApproval('local', mode)
      }
      /** 命中允许规则时的规则名（审计记录用） */
      let ruleName: string | null = null
      if (requiresApproval && this.deps.allowRules) {
        const root = this.deps.requireGuard().root
        if (parsed.tool === 'run_command') {
          ruleName = this.deps.allowRules.matchesCommand(
            root,
            context.sessionId,
            parsed.args.command
          )
        } else if (parsed.tool === 'write_file' || parsed.tool === 'edit_file') {
          ruleName = this.deps.allowRules.matchesWritePath(
            root,
            context.sessionId,
            parsed.args.relativePath
          )
        }
        if (ruleName) requiresApproval = false
      }

      /** 写工具审批预览：diff hunks + 请求时的内容 hash（T4.1/T4.3/T4.4） */
      let previewDiff: ApprovalRequest['diff'] | undefined
      if (requiresApproval && (parsed.tool === 'write_file' || parsed.tool === 'edit_file')) {
        try {
          const preview =
            parsed.tool === 'edit_file'
              ? await buildEditPreview(this.io, parsed.args)
              : await buildWritePreview(this.io, parsed.args)
          previewDiff = {
            relativePath: preview.relativePath,
            isNew: preview.isNew,
            hunks: preview.hunks,
            truncated: preview.truncated,
            contentHash: preview.contentHash
          }
          this.approvalHashes.set(call.id, preview.contentHash)
        } catch (error) {
          // 预览失败（oldText 不唯一等）= 参数本身不可执行，直接拒绝而不弹审批
          const message = describeError(error)
          const outcome: ToolExecutionOutcome = {
            ok: false,
            content: `工具调用被拒绝：${message}`,
            summary: message
          }
          this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
          return outcome
        }
      }

      if (requiresApproval) {
        const decision = await this.deps.approvals.request(
          {
            callId: call.id,
            tool: parsed.tool,
            risk: approvalRisk,
            reason: approvalReason,
            argsSummary,
            diff: previewDiff,
            canAllowAlways: true
          },
          context.signal
        )
        approval = decision === 'deny' ? 'denied' : 'approved'
        if (decision === 'deny') {
          this.approvalHashes.delete(call.id)
          const outcome: ToolExecutionOutcome = {
            ok: false,
            content: '用户拒绝了该操作，未执行。',
            summary: '审批被拒绝'
          }
          this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
          return outcome
        }
        // T4.2：「本会话允许 / 本项目允许」记住规则，后续同类操作免审批
        if (
          decision !== 'approve' &&
          this.deps.allowRules &&
          (parsed.tool === 'run_command' ||
            parsed.tool === 'write_file' ||
            parsed.tool === 'edit_file')
        ) {
          try {
            this.deps.allowRules.add(
              {
                kind: parsed.tool === 'run_command' ? 'command' : 'path',
                value:
                  parsed.tool === 'run_command'
                    ? allowRuleValue(parsed.args.command)
                    : parsed.args.relativePath,
                scope: decision === 'approve_session' ? 'session' : 'project',
                sessionId: context.sessionId
              },
              this.deps.requireGuard().root
            )
          } catch {
            // 规则创建失败不影响本次已批准的操作
          }
        }
      }

      if (ruleName) {
        approval = 'approved'
        argsSummary = `${argsSummary}（规则「${ruleName}」放行）`
      }
    }

    let outcome: ToolExecutionOutcome
    try {
      outcome = await this.runParsed(parsed, context, call.id)
    } catch (error) {
      const message = describeError(error)
      outcome = { ok: false, content: `工具执行失败：${message}`, summary: message }
    }

    this.record(context, call, argsSummary, approval, outcome, Date.now() - startedAt)
    return outcome
  }

  private async runParsed(
    parsed: ParsedToolArguments,
    context: ToolExecutionContext,
    callId: string
  ): Promise<ToolExecutionOutcome> {
    const verifyOptions = {
      signal: context.signal,
      onOutput: (text: string): void => this.deps.onToolOutput?.(callId, context.runId, text)
    }
    switch (parsed.tool) {
      case 'list_dir':
        return runListDir(this.deps.requireGuard(), parsed.args)
      case 'read_file':
        return runReadFile(this.io, parsed.args)
      case 'search_files':
        return runSearchFiles(this.searchGuard(), this.io, parsed.args, this.search, context.signal)
      case 'write_file': {
        const result = await runWriteFile(this.io, parsed.args, {
          approvalHash: this.approvalHashes.get(callId)
        })
        this.approvalHashes.delete(callId)
        if (result.ok) {
          await this.snapshotAfterWrite(this.deps.requireGuard(), parsed.args.relativePath)
        }
        return result
      }
      case 'edit_file': {
        const result = await runEditFile(this.io, parsed.args, {
          approvalHash: this.approvalHashes.get(callId)
        })
        this.approvalHashes.delete(callId)
        if (result.ok) {
          await this.snapshotAfterWrite(this.deps.requireGuard(), parsed.args.relativePath)
        }
        return result
      }
      case 'run_command': {
        const guard = this.deps.requireGuard()
        const cwd = await guard.resolve(parsed.args.cwd, { mustExist: true })
        const cwdInfo = await stat(cwd.absolutePath)
        if (!cwdInfo.isDirectory()) {
          throw new AppError('E_INVALID_INPUT', 'cwd 不是目录')
        }
        return runWorkspaceCommand(parsed.args.command, {
          cwd: cwd.absolutePath,
          timeoutMs: parsed.args.timeoutMs,
          signal: context.signal,
          onOutput: (text) => this.deps.onToolOutput?.(callId, context.runId, text)
        })
      }
      case 'run_tests':
        return runRunTests(this.io, this.deps.requireGuard(), parsed.args, verifyOptions)
      case 'run_typecheck':
        return runRunTypecheck(this.io, this.deps.requireGuard(), parsed.args, verifyOptions)
      case 'run_lint':
        return runRunLint(this.io, this.deps.requireGuard(), parsed.args, verifyOptions)
      case 'get_git_diff': {
        if (!this.deps.gitDiff) {
          throw new AppError('E_UNSUPPORTED', 'get_git_diff 未配置执行器')
        }
        return runGetGitDiff(
          { staged: parsed.args.staged, relativePath: parsed.args.relativePath },
          this.deps.gitDiff
        )
      }
      case 'update_plan': {
        if (!this.deps.planStore) {
          throw new AppError('E_UNSUPPORTED', '计划存储未启用')
        }
        return runUpdatePlan(this.deps.planStore, context.sessionId, parsed.args)
      }
      case 'web_search': {
        if (!this.deps.webSearch) {
          throw new AppError('E_UNSUPPORTED', '联网搜索未配置')
        }
        return runWebSearch(parsed.args, this.deps.webSearch, context.signal)
      }
      case 'generate_image': {
        if (!this.deps.imageGen) {
          throw new AppError('E_UNSUPPORTED', '生图未配置')
        }
        return runGenerateImage(parsed.args, this.deps.imageGen, context.signal)
      }
    }
  }

  private searchGuard(): WorkspaceGuardLike {
    return this.deps.accessGuard?.() ?? this.deps.requireGuard()
  }

  private async snapshotAfterWrite(guard: WorkspacePathGuard, relativePath: string): Promise<void> {
    const timeline = this.deps.timeline
    if (!timeline) return
    try {
      const resolved = await guard.resolve(relativePath, { mustExist: true })
      const info = await stat(resolved.absolutePath)
      if (!info.isFile() || info.size > TIMELINE_LIMITS.maxSnapshotBytes) return
      const content = await readFile(resolved.absolutePath, 'utf8')
      await timeline.snapshot({
        workspaceRoot: guard.root,
        relativePath: resolved.relativePath,
        source: 'agent',
        content
      })
    } catch {
      // 快照失败不影响工具执行结果
    }
  }

  private record(
    context: ToolExecutionContext,
    call: ToolCall,
    argsSummary: string,
    approval: AuditApproval,
    outcome: ToolExecutionOutcome,
    durationMs: number
  ): void {
    this.deps.audit.record({
      sessionId: context.sessionId,
      runId: context.runId,
      tool: call.name,
      argsSummary,
      resultSummary: outcome.summary,
      approval,
      ok: outcome.ok,
      callId: call.id,
      durationMs: Math.max(0, Math.round(durationMs))
    })
    this.deps.toolCalls?.insert({
      id: randomUUID(),
      sessionId: context.sessionId,
      runId: context.runId,
      callId: call.id,
      tool: call.name,
      argsSummary,
      resultSummary: outcome.summary,
      approval,
      status: outcome.ok ? 'success' : 'failed',
      createdAt: Date.now()
    })
  }
}
