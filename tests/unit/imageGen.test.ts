import { describe, expect, it, vi } from 'vitest'
import {
  createImageGenRunner,
  runGenerateImage,
  type ImageGenConfig
} from '../../src/main/tools/imageGenTools'
import { parseToolArguments } from '../../src/main/tools/toolSchemas'
import { normalizeImageSettings } from '../../src/shared/settings'
import { toolIconKey } from '../../src/renderer/src/lib/timeline'

const config: ImageGenConfig = {
  apiKey: 'zhipu-test',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4/images/generations',
  model: 'cogview-3-flash',
  size: '1024x1024'
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

describe('zhipu image runner', () => {
  it('sends the zhipu payload and maps the image url', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        created: 123,
        data: [{ url: 'https://cdn.bigmodel.cn/a.png' }],
        content_filter: [{ role: 'assistant', level: 1 }]
      })
    )
    const runner = createImageGenRunner(() => config, fetchImpl)
    const outcome = await runner('一只猫', '1024x1024', '', new AbortController().signal)

    expect(outcome.url).toBe('https://cdn.bigmodel.cn/a.png')
    expect(outcome.filterLevel).toBe(1)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(config.baseUrl)
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('cogview-3-flash')
    expect(body.prompt).toBe('一只猫')
    expect(body.size).toBe('1024x1024')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer zhipu-test')
  })

  it('uses the model and size overrides when provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ url: 'https://x.dev/b.png' }] }))
    const runner = createImageGenRunner(() => config, fetchImpl)
    await runner('风景', '1440x720', 'glm-image', new AbortController().signal)

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.model).toBe('glm-image')
    expect(body.size).toBe('1440x720')
  })

  it('reports missing configuration as unsupported', async () => {
    const runner = createImageGenRunner(() => null, vi.fn())
    await expect(runner('test', '', '', new AbortController().signal)).rejects.toThrow(/未启用/)
  })

  it('reports a missing image url as an error', async () => {
    const runner = createImageGenRunner(
      () => config,
      vi.fn(async () => jsonResponse({ data: [] }))
    )
    await expect(runner('test', '', '', new AbortController().signal)).rejects.toThrow(/未返回图片/)
  })

  it('describes auth failures with a settings hint', async () => {
    const runner = createImageGenRunner(
      () => config,
      vi.fn(async () => jsonResponse({ error: { message: 'invalid key' } }, false, 401))
    )
    await expect(runner('test', '', '', new AbortController().signal)).rejects.toThrow(
      /设置 → 生图/
    )
  })
})

describe('runGenerateImage', () => {
  it('returns the image url for the UI and a markdown link for the model', async () => {
    const runner = vi.fn(async () => ({ url: 'https://cdn.bigmodel.cn/c.png', filterLevel: null }))
    const outcome = await runGenerateImage(
      { prompt: '一只狗' },
      runner,
      new AbortController().signal
    )

    expect(outcome.ok).toBe(true)
    expect(outcome.images).toEqual(['https://cdn.bigmodel.cn/c.png'])
    expect(outcome.content).toContain('![生成图片](https://cdn.bigmodel.cn/c.png)')
    expect(outcome.summary).toContain('已生成 1 张')
  })

  it('turns runner failures into readable output without throwing', async () => {
    const runner = vi.fn(async () => {
      throw new Error('网络不可达')
    })
    const outcome = await runGenerateImage(
      { prompt: '一只鸟' },
      runner,
      new AbortController().signal
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain('生图失败')
    expect(outcome.images).toBeUndefined()
  })

  it('rejects an empty prompt', async () => {
    const outcome = await runGenerateImage({ prompt: '   ' }, vi.fn(), new AbortController().signal)
    expect(outcome.ok).toBe(false)
  })
})

describe('generate_image tool contract', () => {
  it('parses prompt with optional size and model', () => {
    const parsed = parseToolArguments(
      'generate_image',
      JSON.stringify({
        prompt: '一只猫',
        size: '1024x1024',
        model: 'cogview-3-flash'
      })
    )
    expect(parsed.tool).toBe('generate_image')
  })

  it('normalizes image settings with zhipu defaults', () => {
    const settings = normalizeImageSettings(null)
    expect(settings.provider).toBe('zhipu')
    expect(settings.model).toBe('cogview-3-flash')
    expect(settings.size).toBe('1024x1024')
    expect(settings.baseUrl).toContain('open.bigmodel.cn')
  })

  it('gets an image timeline icon', () => {
    expect(toolIconKey('generate_image')).toBe('image')
  })
})
