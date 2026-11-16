import { describe, expect, it } from 'vitest'
import { isWriteTool, summarizeToolArgs, TOOL_DEFINITIONS } from '../../src/shared/tools'

function names(): string[] {
  return TOOL_DEFINITIONS.map((tool) => tool.name)
}

describe('tool definitions', () => {
  it('exposes edit_file and verification tools alongside the original tools', () => {
    expect(names()).toEqual([
      'list_dir',
      'read_file',
      'search_files',
      'write_file',
      'edit_file',
      'run_command',
      'run_tests',
      'run_typecheck',
      'run_lint',
      'get_git_diff',
      'update_plan',
      'web_search'
    ])
  })

  it('treats verification tools as read-only', () => {
    expect(isWriteTool('run_tests')).toBe(false)
    expect(isWriteTool('run_typecheck')).toBe(false)
    expect(isWriteTool('run_lint')).toBe(false)
    expect(isWriteTool('get_git_diff')).toBe(false)
    expect(isWriteTool('web_search')).toBe(false)
  })

  it('treats edit_file as a write tool requiring approval', () => {
    expect(isWriteTool('edit_file')).toBe(true)
    expect(isWriteTool('read_file')).toBe(false)
  })

  it('documents paging and glob parameters', () => {
    const read = TOOL_DEFINITIONS.find((tool) => tool.name === 'read_file')
    const props = read?.parameters['properties'] as Record<string, unknown>
    expect(Object.keys(props)).toEqual(['relativePath', 'offset', 'limit'])

    const search = TOOL_DEFINITIONS.find((tool) => tool.name === 'search_files')
    const searchProps = search?.parameters['properties'] as Record<string, unknown>
    expect(Object.keys(searchProps)).toContain('regex')
    expect(Object.keys(searchProps)).toContain('contextLines')
  })
})

describe('summarizeToolArgs', () => {
  it('keeps patch arguments short', () => {
    const summary = summarizeToolArgs(
      'edit_file',
      JSON.stringify({
        relativePath: 'src/a.ts',
        edits: [
          { oldText: 'x'.repeat(2000), newText: 'y'.repeat(2000) },
          { oldText: 'a', newText: 'b' }
        ]
      })
    )
    expect(summary).toBe('edit_file src/a.ts（2 处修改）')
    expect(summary.length).toBeLessThan(80)
  })

  it('describes read ranges only when paging is used', () => {
    expect(summarizeToolArgs('read_file', JSON.stringify({ relativePath: 'a.ts' }))).toBe(
      'read_file a.ts'
    )
    expect(
      summarizeToolArgs('read_file', JSON.stringify({ relativePath: 'a.ts', offset: 5, limit: 10 }))
    ).toBe('read_file a.ts（第 5-14 行）')
  })

  it('surfaces search flags', () => {
    const summary = summarizeToolArgs(
      'search_files',
      JSON.stringify({ query: 'export', regex: true, include: 'src/**' })
    )
    expect(summary).toContain('export')
    expect(summary).toContain('in src/**')
    expect(summary).toContain('正则')
  })

  it('clips long commands and falls back to raw text on bad JSON', () => {
    const command = summarizeToolArgs(
      'run_command',
      JSON.stringify({ command: `node -e "${'a'.repeat(300)}"` })
    )
    expect(command.length).toBeLessThan(140)

    expect(summarizeToolArgs('run_command', 'not-json')).toContain('not-json')
  })
})
