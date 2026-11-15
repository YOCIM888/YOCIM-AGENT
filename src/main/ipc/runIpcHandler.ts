import { ZodError } from 'zod'
import { AppError } from '../../shared/errors'
import type { IpcError, IpcResult } from '../../shared/ipc'

export interface InputSchema<TInput> {
  parse(input: unknown): TInput
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof ZodError) {
    const first = error.issues[0]
    const detail = first ? `${first.path.join('.') || 'input'}: ${first.message}` : '参数不合法'
    return { code: 'E_INVALID_INPUT', message: `参数校验失败（${detail}）` }
  }
  console.error('[ipc] unexpected error', error)
  return {
    code: 'E_UNKNOWN',
    message: error instanceof Error ? error.message : '未知错误'
  }
}

export async function runIpcHandler<TInput, TOutput>(
  schema: InputSchema<TInput> | null,
  handler: (input: TInput) => Promise<TOutput>,
  raw?: unknown
): Promise<IpcResult<TOutput>> {
  try {
    const input = schema ? schema.parse(raw) : (undefined as TInput)
    return { ok: true, data: await handler(input) }
  } catch (error) {
    return { ok: false, error: toIpcError(error) }
  }
}
