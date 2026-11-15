import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { ZodError } from 'zod'
import type { ToolCall, ToolExecutionOutcome } from '../../shared/agent'
import type { ApprovalMode } from '../../shared/approval'
import type { AuditApproval } from '../../shared/audit'
import { AppError } from '../../shared/errors'
import { isWriteTool, TOOL_DEFINITIONS, type ToolName } from '../../shared/tools'
import type { ApprovalManager } from '../approval/approvalManager'
import type { AuditStore } from '../audit/auditStore'
import type { ToolCallRepository } from '../db/repositories'
import type { WorkspacePathGuard } from '../workspace/pathGuard'
import { TIMELINE_LIMITS, type TimelineService } from '../workspace/timelineService'
import { assertCommandAllowed, runWorkspaceCommand } from './commandRunner'
import { parseToolArguments, type ParsedToolArguments } from './toolSchemas'
import {
  assertWritableRelativePath,
  runListDir,
  runReadFile,
  runSearchFiles,
  runWriteFile
} from './workspaceTools'

const TOOL_RISK: Record<ToolName, 'medium' | 'high'> = {
  list_dir: 'medium',
  read_file: 'medium',
  search_files: 'medium',
  write_file: 'medium',
  run_command: 'high'
}

const ARGS_SUMMARY_LIMIT = 500

function summarizeArgs(call: ToolCall): string {
  const raw = `${call.name} ${call.argumentsJson}`
  return raw.length > ARGS_SUMMARY_LIMIT ? `${raw.slice(0, ARGS_SUMMARY_LIMIT)}…` : raw
}

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
  toolCalls?: ToolCallRepository
  timeline?: TimelineService
}

export class ToolService {
  constructor(private readonly deps: ToolServiceDeps) {}

  getDefinitions(): typeof TOOL_DEFINITIONS {
    return TOOL_DEFINITIONS
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionOutcome> {
    const argsSummary = summarizeArgs(call)
    let approval: AuditApproval = 'not_required'
    let parsed: ParsedToolArguments

    try {
      parsed = parseToolArguments(call.name, call.argumentsJson)
      if (parsed.tool === 'run_command') {
        assertCommandAllowed(parsed.args.command)
      }
      if (parsed.tool === 'write_file') {
        assertWritableRelativePath(parsed.args.relativePath)
      }
    } catch (error) {
      const message = describeError(error)
      const outcome: ToolExecutionOutcome = {
        ok: false,
        content: `工具调用被拒绝：${message}`,
        summary: message
      }
      this.record(context, call, argsSummary, approval, outcome)
      return outcome
    }

    if (isWriteTool(parsed.tool)) {
      const mode = this.deps.getApprovalMode?.() ?? 'manual'
      const requiresApproval =
        mode === 'manual' || (mode === 'auto' && TOOL_RISK[parsed.tool] === 'high')
      if (requiresApproval) {
        const accepted = await this.deps.approvals.request(
          {
            callId: call.id,
            tool: parsed.tool,
            risk: TOOL_RISK[parsed.tool],
            argsSummary
          },
          context.signal
        )
        approval = accepted ? 'approved' : 'denied'
        if (!accepted) {
          const outcome: ToolExecutionOutcome = {
            ok: false,
            content: '用户拒绝了该操作，未执行。',
            summary: '审批被拒绝'
          }
          this.record(context, call, argsSummary, approval, outcome)
          return outcome
        }
      }
    }

    let outcome: ToolExecutionOutcome
    try {
      outcome = await this.runParsed(parsed, context)
    } catch (error) {
      const message = describeError(error)
      outcome = { ok: false, content: `工具执行失败：${message}`, summary: message }
    }

    this.record(context, call, argsSummary, approval, outcome)
    return outcome
  }

  private async runParsed(
    parsed: ParsedToolArguments,
    context: ToolExecutionContext
  ): Promise<ToolExecutionOutcome> {
    const guard = this.deps.requireGuard()

    switch (parsed.tool) {
      case 'list_dir':
        return runListDir(guard, parsed.args)
      case 'read_file':
        return runReadFile(guard, parsed.args)
      case 'search_files':
        return runSearchFiles(guard, parsed.args)
      case 'write_file': {
        const result = await runWriteFile(guard, parsed.args)
        if (result.ok) {
          await this.snapshotAfterWrite(guard, parsed.args.relativePath)
        }
        return result
      }
      case 'run_command': {
        const cwd = await guard.resolve(parsed.args.cwd, { mustExist: true })
        const cwdInfo = await stat(cwd.absolutePath)
        if (!cwdInfo.isDirectory()) {
          throw new AppError('E_INVALID_INPUT', 'cwd 不是目录')
        }
        return runWorkspaceCommand(parsed.args.command, {
          cwd: cwd.absolutePath,
          timeoutMs: parsed.args.timeoutMs,
          signal: context.signal
        })
      }
    }
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
    outcome: ToolExecutionOutcome
  ): void {
    this.deps.audit.record({
      sessionId: context.sessionId,
      runId: context.runId,
      tool: call.name,
      argsSummary,
      resultSummary: outcome.summary,
      approval,
      ok: outcome.ok
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
