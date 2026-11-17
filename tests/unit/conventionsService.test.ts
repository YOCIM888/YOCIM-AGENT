import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ConventionsService } from '../../src/main/agent/conventionsService'
import { MockProvider } from '../../src/main/agent/providers/mockProvider'
import { migrate } from '../../src/main/db/database'
import { ProjectConventionRepository } from '../../src/main/db/repositories'
import type { ChatProvider, ProviderEvent, ProviderRequest } from '../../src/shared/agent'
import { AppError } from '../../src/shared/errors'

function createRepo(): ProjectConventionRepository {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return new ProjectConventionRepository(db)
}

function capturingProvider(text: string, capture: { request?: ProviderRequest }): ChatProvider {
  return {
    stream: async function* (request: ProviderRequest): AsyncGenerator<ProviderEvent> {
      capture.request = request
      yield { type: 'text', text }
      yield { type: 'done', finishReason: 'stop' }
    }
  }
}

const project = { id: 'p1', name: 'Demo 项目', root: '/tmp/demo' }

describe('ConventionsService', () => {
  it('builds a structured prompt from project context and redacts secrets', async () => {
    const conventions = createRepo()
    const capture: { request?: ProviderRequest } = {}
    const service = new ConventionsService({
      resolveProvider: () => capturingProvider('## 项目概览\n- Demo', capture),
      getProject: (id) => (id === project.id ? project : null),
      conventions,
      readText: async (path) => {
        if (path.endsWith('README.md')) return '# Demo\napi_key=supersecretvalue\n'
        if (path.endsWith('package.json')) return '{"name":"demo","scripts":{"test":"vitest"}}'
        return ''
      },
      loadRules: async () => ({ content: '规则：提交前跑测试' }),
      buildMap: async () => 'src/（源码）'
    })

    const result = await service.generate(project.id)
    expect(result.content).toContain('项目概览')
    const user = capture.request?.messages[1]?.content ?? ''
    expect(user).toContain('项目名称：Demo 项目')
    expect(user).toContain('规则：提交前跑测试')
    expect(user).toContain('src/（源码）')
    expect(user).toContain('"test": "vitest"')
    expect(user).not.toContain('supersecretvalue')
  })

  it('does not touch sessions or messages and rejects unknown projects', async () => {
    const conventions = createRepo()
    const service = new ConventionsService({
      resolveProvider: () => capturingProvider('内容', {}),
      getProject: () => null,
      conventions
    })
    await expect(service.generate('missing')).rejects.toMatchObject({
      code: 'E_NOT_FOUND'
    } satisfies Partial<AppError>)
  })

  it('surfaces provider failures without creating a convention', async () => {
    const conventions = createRepo()
    const provider: ChatProvider = {
      stream: async function* (): AsyncGenerator<ProviderEvent> {
        yield { type: 'text', text: 'partial' }
        throw new Error('boom')
      }
    }
    const service = new ConventionsService({
      resolveProvider: () => provider,
      getProject: (id) => (id === project.id ? project : null),
      conventions
    })
    await expect(service.generate(project.id)).rejects.toThrow(/生成失败/)
    expect(conventions.get(project.id)).toBeNull()
  })

  it('returns the mock provider draft for offline generation', async () => {
    const conventions = createRepo()
    const service = new ConventionsService({
      resolveProvider: () => new MockProvider({ delayMs: 0 }),
      getProject: (id) => (id === project.id ? project : null),
      conventions
    })
    const result = await service.generate(project.id)
    expect(result.content).toContain('## 项目概览')
    expect(result.content).toContain('## 当前已知问题')
  })
})
