// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/renderer/src/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings, lists, code and tables', () => {
    const html = renderMarkdown(
      '# 标题\n\n- 项目一\n- 项目二\n\n`inline`\n\n| A | B |\n| - | - |\n| 1 | 2 |'
    )
    expect(html).toContain('<h1')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>inline</code>')
    expect(html).toContain('<table>')
  })

  it('strips scripts, event handlers and javascript: links', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[bad](javascript:alert(3))'
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })

  it('keeps safe links and emphasis', () => {
    const html = renderMarkdown('**加粗** [链接](https://example.com)')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('href="https://example.com"')
  })
})
