import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors'
import {
  chatSendInputSchema,
  fsTreeInputSchema,
  storagePickInputSchema
} from '../../src/shared/ipc'
import { runIpcHandler } from '../../src/main/ipc/runIpcHandler'

describe('runIpcHandler', () => {
  it('wraps successful handler results', async () => {
    const result = await runIpcHandler<{ value: number }, number>(
      { parse: () => ({ value: 21 }) },
      async (input) => input.value * 2
    )
    expect(result).toEqual({ ok: true, data: 42 })
  })

  it('applies zod defaults before invoking the handler', async () => {
    const result = await runIpcHandler(fsTreeInputSchema, async (input) => input, {})
    expect(result).toEqual({ ok: true, data: { relativePath: '', depth: 2 } })
  })

  it('rejects invalid input with E_INVALID_INPUT', async () => {
    const result = await runIpcHandler(fsTreeInputSchema, async (input) => input, {
      relativePath: 42,
      depth: 99
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('E_INVALID_INPUT')
    }
  })

  it('maps AppError codes', async () => {
    const result = await runIpcHandler(null, async () => {
      throw new AppError('E_PATH_ESCAPE', '路径超出工作区范围')
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'E_PATH_ESCAPE', message: '路径超出工作区范围' }
    })
  })

  it('maps unexpected errors to E_UNKNOWN', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runIpcHandler(null, async () => {
      throw new Error('boom')
    })
    expect(result).toEqual({ ok: false, error: { code: 'E_UNKNOWN', message: 'boom' } })
    spy.mockRestore()
  })
})

describe('chatSendInputSchema', () => {
  it('defaults history and attachments to empty lists', async () => {
    const result = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: '你好'
    })
    expect(result).toEqual({
      ok: true,
      data: { sessionId: 'session-1', text: '你好', history: [], attachments: [] }
    })
  })

  it('rejects too many attachments and oversized total content', async () => {
    const attachment = (id: string, content: string) => ({
      id,
      type: 'file',
      relativePath: `${id}.ts`,
      content
    })
    const tooMany = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: 'hi',
      attachments: Array.from({ length: 11 }, (_, i) => attachment(`f${i}`, 'x'))
    })
    expect(tooMany.ok).toBe(false)

    const oversized = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: 'hi',
      attachments: [attachment('big', 'x'.repeat(200 * 1024 + 1))]
    })
    expect(oversized.ok).toBe(false)

    const ok = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: 'hi',
      attachments: [attachment('a', 'export const a = 1')]
    })
    expect(ok.ok).toBe(true)
  })

  it('rejects empty text and oversized history', async () => {
    const empty = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: ''
    })
    expect(empty.ok).toBe(false)

    const oversized = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: 'hi',
      history: Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' }))
    })
    expect(oversized.ok).toBe(false)
  })

  it('rejects unsupported history roles', async () => {
    const result = await runIpcHandler(chatSendInputSchema, async (input) => input, {
      sessionId: 'session-1',
      text: 'hi',
      history: [{ role: 'system', content: 'x' }]
    })
    expect(result.ok).toBe(false)
  })
})

describe('storagePickInputSchema', () => {
  it('accepts the empty payload sent by the renderer', async () => {
    const result = await runIpcHandler(storagePickInputSchema, async (input) => input, undefined)
    expect(result).toEqual({ ok: true, data: {} })
  })

  it('keeps an explicit directory flag', async () => {
    const result = await runIpcHandler(storagePickInputSchema, async (input) => input, {
      directory: false
    })
    expect(result).toEqual({ ok: true, data: { directory: false } })
  })
})
