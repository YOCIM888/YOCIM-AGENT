import type { ToolExecutionOutcome } from '../../shared/agent'
import type { ToolExecutionContext } from './toolService'
import type { ApprovalManager } from '../approval/approvalManager'
import type { ApprovalMode } from '../../shared/approval'
import {
  BROWSER_LIMITS,
  isBrowserActionMethod,
  summarizeCdpParams,
  type BrowserCdpMethod,
  type BrowserWaitKind
} from '../../shared/browser'
import { AppError } from '../../shared/errors'
import { summarizeToolArgs } from '../../shared/tools'
import type { BrowserCdpArgs, BrowserWaitArgs } from './toolSchemas'
import type { BrowserService } from '../browser/browserService'

export interface BrowserToolDeps {
  service: BrowserService
  approvals: ApprovalManager
  getApprovalMode: () => ApprovalMode
}

function describeError(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : '浏览器操作失败'
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** CDP 结果压成模型可读文本；截图单独走 images 附件 */
function formatCdpResult(
  method: BrowserCdpMethod,
  result: Record<string, unknown>,
  outcome: ToolExecutionOutcome
): void {
  if (method === 'Page.captureScreenshot') {
    const data = typeof result['data'] === 'string' ? result['data'] : ''
    const dataUrl = data ? `data:image/png;base64,${data}` : ''
    if (dataUrl && dataUrl.length <= BROWSER_LIMITS.maxScreenshotDataUrl) {
      outcome.images = [dataUrl]
      outcome.content = '已截取当前页面截图（见附件）。如需页面文字，可配合 Runtime.evaluate 读取 document.title 或 innerText。'
    } else {
      outcome.content = '截图过大或为空，未随结果返回；可缩小视口后重试。'
    }
    return
  }

  if (method === 'Runtime.evaluate') {
    const nested = (result['result'] ?? {}) as Record<string, unknown>
    const exception = result['exceptionDetails']
    if (exception) {
      const details = exception as Record<string, unknown>
      outcome.ok = false
      outcome.content = `页面表达式抛出异常：${clip(
        String(details['text'] ?? '未知异常'),
        500
      )}`
      return
    }
    const value = nested['value']
    const description = nested['description']
    const text =
      value !== undefined
        ? typeof value === 'string'
          ? value
          : JSON.stringify(value)
        : typeof description === 'string'
          ? description
          : JSON.stringify(nested)
    outcome.content = `Runtime.evaluate 结果：${clip(String(text ?? 'undefined'), BROWSER_LIMITS.maxToolOutputChars)}`
    return
  }

  if (method === 'Page.navigate') {
    const error = result['errorText']
    outcome.ok = !error
    outcome.content = error
      ? `导航失败：${String(error)}`
      : `已导航到 ${String(result['url'] ?? '')}；建议随后用 browser_wait load 等待加载完成。`
    return
  }

  outcome.content = `${method} 返回：${clip(JSON.stringify(result) ?? '{}', BROWSER_LIMITS.maxToolOutputChars)}`
}

/**
 * 浏览器工具执行器。副作用类 CDP 方法在 manual 档走统一审批卡；
 * 人类暂停/接管期间由 BrowserService 明确拒绝，不静默排队。
 */
export async function runBrowserCdp(
  args: BrowserCdpArgs,
  context: ToolExecutionContext,
  callId: string,
  deps: BrowserToolDeps
): Promise<ToolExecutionOutcome> {
  const method = args.method
  const params = args.params

  if (isBrowserActionMethod(method) && deps.getApprovalMode() === 'manual') {
    const reason =
      method === 'Page.navigate'
        ? 'AI 请求在内置浏览器中打开页面；可能访问外部站点，请确认 URL 与意图。'
        : 'AI 请求向当前页面发送输入事件（点击/按键/聚焦）；敏感操作如支付、删除、发送消息前请人工核对。'
    const decision = await deps.approvals.request(
      {
        callId,
        tool: 'browser_cdp',
        risk: 'high',
        reason,
        argsSummary: clip(summarizeCdpParams(params), 200),
        canAllowAlways: false,
        kind: 'risk'
      },
      context.signal
    )
    if (decision !== 'approve' && decision !== 'approve_session' && decision !== 'approve_project') {
      return { ok: false, content: '用户拒绝了该浏览器操作，未执行。', summary: '审批被拒绝' }
    }
  }

  try {
    const result = await deps.service.execute(
      context.sessionId,
      method,
      params,
      callId,
      args.intent,
      context.signal
    )
    const outcome: ToolExecutionOutcome = {
      ok: true,
      content: '',
      summary: `${method} 完成`
    }
    formatCdpResult(method, result, outcome)
    return outcome
  } catch (error) {
    const message = describeError(error)
    return {
      ok: false,
      content: `浏览器原语 ${method} 失败：${message}。可换用其他观察方式、重试或中止任务。`,
      summary: `${method} 失败：${message.slice(0, 120)}`
    }
  }
}

export async function runBrowserWait(
  args: BrowserWaitArgs,
  context: ToolExecutionContext,
  deps: BrowserToolDeps
): Promise<ToolExecutionOutcome> {
  const kind: BrowserWaitKind = args.kind
  try {
    await deps.service.wait(
      context.sessionId,
      kind,
      args.value,
      args.timeoutMs,
      context.signal
    )
    return {
      ok: true,
      content: `等待条件已满足：${kind}${args.value ? `（${args.value}）` : ''}`,
      summary: `browser_wait ${kind} 完成`
    }
  } catch (error) {
    const message = describeError(error)
    return {
      ok: false,
      content: `等待 ${kind} 失败：${message}。请检查页面状态或换用其他观察方式。`,
      summary: `browser_wait ${kind} 失败`
    }
  }
}

/** 审批卡的统一摘要（工具层复用 summarizeToolArgs 的同一份文案） */
export function browserApprovalSummary(name: string, argsJson: string): string {
  return summarizeToolArgs(name, argsJson)
}
