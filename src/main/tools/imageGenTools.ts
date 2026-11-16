import type { ToolExecutionOutcome } from '../../shared/agent'
import { AppError } from '../../shared/errors'
import { IMAGE_GEN_LIMITS, type ImageSize } from '../../shared/settings'
import type { GenerateImageArgs } from './toolSchemas'

type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** 生图配置：来自设置面板（端点 / 模型 / Key），Key 只在主进程内存里流转 */
export interface ImageGenConfig {
  apiKey: string
  baseUrl: string
  model: string
  size: ImageSize
}

export interface ImageGenOutcome {
  /** 生成的图片 URL（智谱返回 data[0].url） */
  url: string
  /** 命中的内容过滤级别（有值时提示用户） */
  filterLevel: number | null
}

/**
 * 生图执行器由主进程注入，便于测试与扩展其它生图 API：
 * 只要换掉 runner 的实现，工具层与 UI 都无需改动。
 */
export type ImageGenRunner = (
  prompt: string,
  size: string,
  model: string,
  signal: AbortSignal
) => Promise<ImageGenOutcome>

interface ZhipuImageResponse {
  created?: number
  data?: Array<{ url?: string }>
  content_filter?: Array<{ role?: string; level?: number }>
  error?: { message?: string; code?: string }
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as ZhipuImageResponse
    detail = parsed.error?.message ?? ''
  } catch {
    // 忽略错误体解析失败
  }
  if (response.status === 401 || response.status === 403) {
    return '生图 API 拒绝了该 Key，请在设置 → 生图里检查或重新填写'
  }
  return `生图 API 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`
}

/**
 * 创建调用 OpenAI 兼容图像生成端点的执行器（默认指向智谱）。
 * 请求体与响应结构遵循智谱 images/generations：`{model, prompt, size}` → `{data:[{url}]}`。
 */
export function createImageGenRunner(
  getConfig: () => ImageGenConfig | null,
  fetchImpl?: FetchFn
): ImageGenRunner {
  const doFetch = fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init))
  return async (prompt, size, model, signal) => {
    const config = getConfig()
    if (!config) {
      throw new AppError('E_UNSUPPORTED', '生图未启用或未配置 API Key，请先在设置 → 生图里开启')
    }

    const timeout = AbortSignal.timeout(IMAGE_GEN_LIMITS.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])

    const response = await doFetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: model || config.model,
        prompt,
        size: size || config.size
      }),
      signal: combined
    })

    if (!response.ok) throw new AppError('E_IO', await describeHttpError(response))

    let payload: ZhipuImageResponse
    try {
      payload = (await response.json()) as ZhipuImageResponse
    } catch {
      throw new AppError('E_IO', '生图 API 返回了无法解析的响应')
    }

    const url = payload.data?.[0]?.url
    if (typeof url !== 'string' || !url.trim()) {
      throw new AppError('E_IO', '生图 API 未返回图片地址（可能触发了内容过滤）')
    }
    const filterLevel =
      payload.content_filter?.find((item) => item.role === 'assistant')?.level ?? null
    return { url: url.trim(), filterLevel: typeof filterLevel === 'number' ? filterLevel : null }
  }
}

/**
 * 执行一次生图，把结果渲染成模型友好的文本，并把图片 URL 放进 images 供 UI 展示。
 * 失败时返回可读的错误说明，而不是抛出，让 Agent 能自行调整 prompt。
 */
export async function runGenerateImage(
  args: GenerateImageArgs,
  runner: ImageGenRunner,
  signal: AbortSignal
): Promise<ToolExecutionOutcome> {
  const prompt = args.prompt.trim()
  if (!prompt) {
    return { ok: false, content: '图片描述为空', summary: 'generate_image 参数无效' }
  }
  try {
    const outcome = await runner(prompt, args.size ?? '', args.model ?? '', signal)
    const notice =
      outcome.filterLevel !== null
        ? '\n（提示：本次生成命中了内容过滤，级别 ' + outcome.filterLevel + '）'
        : ''
    const content = `已生成图片：\n![生成图片](${outcome.url})\n图片地址：${outcome.url}${notice}`
    return {
      ok: true,
      content: content.slice(0, IMAGE_GEN_LIMITS.maxToolOutputChars),
      summary: `生图「${prompt.slice(0, 40)}」：已生成 1 张`,
      images: [outcome.url]
    }
  } catch (error) {
    const message = error instanceof AppError ? error.message : '生图失败'
    return {
      ok: false,
      content: `生图失败：${message}`,
      summary: `生图失败：${message}`
    }
  }
}
