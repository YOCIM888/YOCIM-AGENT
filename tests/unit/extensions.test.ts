import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { normalizeManifest, sanitizeId } from '../../src/main/extensions/manifest'
import { parseSnippetFile, snippetMatchesLanguage } from '../../src/main/extensions/snippets'
import { readZipEntries } from '../../src/main/extensions/zip'

interface RawZipEntry {
  name: string
  content: string
  /** 8 = deflate，0 = stored */
  method?: 0 | 8
  /** 直接指定条目名而不参与校验，用于构造非法路径 */
  rawName?: string
}

/** 组装一个最小 zip（仅测试用：不支持 zip64/注释/数据描述符） */
function buildZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.rawName ?? entry.name, 'utf8')
    const method = entry.method ?? 0
    const raw = Buffer.from(entry.content, 'utf8')
    const data = method === 8 ? deflateRawSync(raw) : raw

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuffer, eocd])
}

describe('normalizeManifest', () => {
  it('grades declarative-only extensions as usable', () => {
    const manifest = normalizeManifest({
      name: 'theme-pack',
      publisher: 'Acme',
      version: '1.2.3',
      displayName: 'Theme Pack',
      contributes: {
        languages: [{ id: 'foo', extensions: ['.foo'] }],
        grammars: [{ language: 'foo', scopeName: 'source.foo', path: 'syntaxes/foo.json' }],
        snippets: [{ language: 'foo', path: 'snippets/foo.json' }],
        themes: [{ label: 'Foo', uiTheme: 'vs-dark', path: 'themes/foo.json' }]
      }
    })

    expect(manifest?.id).toBe('acme.theme-pack')
    expect(manifest?.compatibility).toBe('declarative')
    expect(manifest?.contributions).toMatchObject({
      languages: 1,
      grammars: 1,
      snippets: 1,
      themes: 1,
      commands: 0
    })
    expect(manifest?.grammars[0]).toEqual({
      language: 'foo',
      scopeName: 'source.foo',
      path: 'syntaxes/foo.json'
    })
  })

  it('grades command contributions as partial', () => {
    const manifest = normalizeManifest({
      name: 'commands-only',
      publisher: 'acme',
      contributes: { commands: [{ command: 'demo.run', title: 'Run' }] }
    })
    expect(manifest?.compatibility).toBe('partial')
    expect(manifest?.compatibilityReason).toContain('命令')
    expect(manifest?.commands).toEqual([{ id: 'demo.run', title: 'Run' }])
  })

  it('marks runtime entries, debuggers and extension packs as incompatible', () => {
    const withMain = normalizeManifest({
      name: 'runtime',
      publisher: 'acme',
      main: './out/extension.js'
    })
    expect(withMain?.compatibility).toBe('incompatible')
    expect(withMain?.runtimeEntry).toBe('./out/extension.js')
    expect(withMain?.compatibilityReason).toContain('./out/extension.js')

    const withDebugger = normalizeManifest({
      name: 'debugger',
      publisher: 'acme',
      contributes: { debuggers: [{ type: 'node' }] }
    })
    expect(withDebugger?.compatibility).toBe('incompatible')

    const withPack = normalizeManifest({
      name: 'pack',
      publisher: 'acme',
      extensionPack: ['acme.other']
    })
    expect(withPack?.compatibility).toBe('incompatible')
  })

  it('falls back to directory hints and rejects unusable input', () => {
    expect(normalizeManifest({ version: '1.0.0' }, 'acme.hinted')?.name).toBe('acme.hinted')
    expect(normalizeManifest({})).toBeNull()
    expect(normalizeManifest([])).toBeNull()
    expect(normalizeManifest({ version: '1.0.0' })).toBeNull()
  })

  it('sanitizes ids to a filesystem-safe form', () => {
    expect(sanitizeId('Acme Corp/My Extension')).toBe('acme-corp-my-extension')
    expect(sanitizeId('--acme.test--')).toBe('acme.test')
  })
})

describe('parseSnippetFile', () => {
  const options = { extensionId: 'acme.demo', extensionName: 'Demo', language: '*' }

  it('parses prefix/body/scope variants', () => {
    const snippets = parseSnippetFile(
      JSON.stringify({
        打印日志: {
          prefix: 'demolog',
          body: ["console.log('$1')", ''],
          description: 'demo log',
          scope: 'javascript,typescript'
        },
        多前缀: { prefix: ['mlog', 'ml'], body: 'console.log(1)' },
        无前缀: { body: 'console.log(2)' }
      }),
      options
    )

    expect(snippets).toHaveLength(2)
    expect(snippets[0]).toMatchObject({
      extensionId: 'acme.demo',
      extensionName: 'Demo',
      language: 'javascript,typescript',
      label: '打印日志',
      prefix: 'demolog',
      body: "console.log('$1')\n",
      description: 'demo log'
    })
    expect(snippets[1]?.prefix).toBe('mlog,ml')
    expect(snippets[1]?.language).toBe('*')
  })

  it('respects an explicit language and ignores broken input', () => {
    const snippets = parseSnippetFile(JSON.stringify({ demo: { prefix: 'dm', body: 'x' } }), {
      ...options,
      language: 'javascript'
    })
    expect(snippets[0]?.language).toBe('javascript')
    expect(parseSnippetFile('not json', options)).toEqual([])
    expect(parseSnippetFile('[]', options)).toEqual([])
  })
})

describe('snippetMatchesLanguage', () => {
  const base = {
    extensionId: 'acme.demo',
    extensionName: 'Demo',
    label: 'demo',
    prefix: 'dm',
    body: 'x'
  }

  it('matches wildcard, single and listed languages', () => {
    expect(snippetMatchesLanguage({ ...base, language: '*' }, 'go')).toBe(true)
    expect(snippetMatchesLanguage({ ...base, language: 'javascript' }, 'javascript')).toBe(true)
    expect(
      snippetMatchesLanguage({ ...base, language: 'javascript, typescript' }, 'typescript')
    ).toBe(true)
    expect(snippetMatchesLanguage({ ...base, language: 'javascript' }, 'go')).toBe(false)
  })
})

describe('readZipEntries', () => {
  it('reads stored and deflated entries and skips directory entries', () => {
    const zip = buildZip([
      { name: 'extension/', content: '' },
      { name: 'extension/package.json', content: '{"name":"demo"}' },
      { name: 'extension/readme.md', content: 'hello vsix', method: 8 }
    ])
    const entries = readZipEntries(zip)
    expect(entries.map((entry) => entry.name)).toEqual([
      'extension/package.json',
      'extension/readme.md'
    ])
    expect(entries[0]?.data.toString('utf8')).toBe('{"name":"demo"}')
    expect(entries[1]?.data.toString('utf8')).toBe('hello vsix')
  })

  it('rejects path traversal and absolute paths', () => {
    expect(() =>
      readZipEntries(buildZip([{ name: 'x', content: '', rawName: '../evil.sh' }]))
    ).toThrow(/非法路径/)
    expect(() =>
      readZipEntries(buildZip([{ name: 'x', content: '', rawName: '/etc/passwd' }]))
    ).toThrow(/非法路径/)
    expect(() =>
      readZipEntries(buildZip([{ name: 'x', content: '', rawName: 'C:/windows/x.dll' }]))
    ).toThrow(/非法路径/)
  })

  it('rejects non-zip input and oversized archives', () => {
    expect(() => readZipEntries(Buffer.from('definitely not a zip'))).toThrow(/合法的 zip/)
  })

  it('rejects unsupported compression methods', () => {
    const zip = buildZip([{ name: 'a.txt', content: 'x' }])
    zip.writeUInt16LE(14, 8) // 篡改本地头与中央目录之外的 method 字段
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    zip.writeUInt16LE(14, central + 10)
    expect(() => readZipEntries(zip)).toThrow(/不支持的压缩方式/)
  })
})
