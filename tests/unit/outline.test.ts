import { describe, expect, it } from 'vitest'
import { extractOutline } from '../../src/renderer/src/lib/outline'

describe('extractOutline', () => {
  it('extracts TS classes, interfaces, functions and variables with depth', () => {
    const content = [
      "import { x } from './x'",
      'export class Foo {',
      '  bar(): void {',
      '    return',
      '  }',
      '}',
      'export interface Shape {',
      '  area: number',
      '}',
      'export type Id = string',
      'export enum Color {',
      '  Red',
      '}',
      'export function helper(a: number): number {',
      '  return a',
      '}',
      'const value = 1'
    ].join('\n')
    const symbols = extractOutline(content, 'typescript')
    const names = symbols.map((s) => s.name)
    expect(names).toContain('Foo')
    expect(names).toContain('bar')
    expect(names).toContain('Shape')
    expect(names).toContain('Id')
    expect(names).toContain('Color')
    expect(names).toContain('helper')
    expect(names).toContain('value')
    const bar = symbols.find((s) => s.name === 'bar')
    expect(bar?.kind).toBe('method')
    expect(bar?.depth).toBeGreaterThan(0)
    expect(symbols.find((s) => s.name === 'Foo')?.kind).toBe('class')
    expect(symbols.find((s) => s.name === 'Shape')?.kind).toBe('interface')
    expect(symbols.find((s) => s.name === 'helper')?.kind).toBe('function')
  })

  it('does not treat control-flow keywords as methods', () => {
    const content = [
      'class A {',
      '  run() {',
      '    if (true) {',
      '      return',
      '    }',
      '  }',
      '}'
    ].join('\n')
    const symbols = extractOutline(content, 'javascript')
    expect(symbols.map((s) => s.name)).toEqual(['A', 'run'])
  })

  it('extracts markdown headings with level depth and skips fences', () => {
    const content = ['# Title', '## Section', '```', '# not a heading', '```', '### Sub'].join('\n')
    const symbols = extractOutline(content, 'markdown')
    expect(symbols.map((s) => [s.name, s.depth])).toEqual([
      ['Title', 0],
      ['Section', 1],
      ['Sub', 2]
    ])
  })

  it('extracts JSON top-level keys with line numbers', () => {
    const content = [
      '{',
      '  "name": "demo",',
      '  "version": "1.0.0",',
      '  "nested": { "a": 1 }',
      '}'
    ].join('\n')
    const symbols = extractOutline(content, 'json')
    expect(symbols.map((s) => s.name)).toEqual(['name', 'version', 'nested'])
    expect(symbols.find((s) => s.name === 'version')?.line).toBe(3)
    expect(symbols.every((s) => s.kind === 'key')).toBe(true)
  })

  it('returns empty for invalid JSON', () => {
    expect(extractOutline('{ bad json', 'json')).toEqual([])
  })

  it('extracts CSS selectors and ignores comments', () => {
    const content = [
      '/* comment */',
      '.foo {',
      '  color: red;',
      '}',
      '#bar, .baz {',
      '  margin: 0;',
      '}'
    ].join('\n')
    const symbols = extractOutline(content, 'css')
    expect(symbols.map((s) => s.name)).toEqual(['.foo', '#bar, .baz'])
    expect(symbols.every((s) => s.kind === 'selector')).toBe(true)
  })

  it('uses generic fallback for other languages', () => {
    const content = ['def main():', '    pass', 'class Thing:', '    pass'].join('\n')
    const symbols = extractOutline(content, 'python')
    expect(symbols.map((s) => s.name)).toEqual(['main', 'Thing'])
  })

  it('returns empty for plain text without declarations', () => {
    expect(extractOutline('just some text\nnothing here', 'plaintext')).toEqual([])
  })
})
