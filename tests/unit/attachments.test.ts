import { describe, expect, it } from 'vitest'
import { ATTACHMENT_LIMITS, type ContextAttachment } from '@shared/attachment'
import { checkAttachment, sameAttachmentRange } from '../../src/renderer/src/lib/attachments'

function attachment(overrides: Partial<ContextAttachment> = {}): ContextAttachment {
  return {
    id: 'id',
    type: 'file',
    relativePath: 'a.ts',
    content: 'x',
    ...overrides
  }
}

describe('sameAttachmentRange', () => {
  it('treats two undefined ranges as equal', () => {
    expect(sameAttachmentRange(undefined, undefined)).toBe(true)
  })

  it('distinguishes undefined from a defined range', () => {
    expect(
      sameAttachmentRange(undefined, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 })
    ).toBe(false)
  })

  it('compares all four coordinates', () => {
    const range = { startLine: 1, startColumn: 2, endLine: 3, endColumn: 4 }
    expect(sameAttachmentRange(range, { ...range })).toBe(true)
    expect(sameAttachmentRange(range, { ...range, endColumn: 5 })).toBe(false)
  })
})

describe('checkAttachment', () => {
  it('accepts a new attachment', () => {
    expect(checkAttachment([], attachment())).toBe('ok')
  })

  it('flags duplicate file without range', () => {
    const existing = [attachment({ id: '1', relativePath: 'a.ts' })]
    expect(checkAttachment(existing, attachment({ id: '2', relativePath: 'a.ts' }))).toBe(
      'duplicate'
    )
  })

  it('allows same file with different selection ranges', () => {
    const existing = [
      attachment({ id: '1', range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 } })
    ]
    const candidate = attachment({
      id: '2',
      range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 }
    })
    expect(checkAttachment(existing, candidate)).toBe('ok')
  })

  it('enforces the count limit', () => {
    const existing = Array.from({ length: ATTACHMENT_LIMITS.maxCount }, (_, i) =>
      attachment({ id: `${i}`, relativePath: `f${i}.ts` })
    )
    expect(checkAttachment(existing, attachment({ id: 'new', relativePath: 'new.ts' }))).toBe(
      'count'
    )
  })

  it('enforces the total byte limit', () => {
    const existing = [
      attachment({ id: '1', content: 'a'.repeat(ATTACHMENT_LIMITS.maxTotalBytes - 1) })
    ]
    expect(
      checkAttachment(existing, attachment({ id: '2', relativePath: 'b.ts', content: 'bb' }))
    ).toBe('total')
  })

  it('accepts content exactly at the total limit', () => {
    const existing = [
      attachment({ id: '1', content: 'a'.repeat(ATTACHMENT_LIMITS.maxTotalBytes - 1) })
    ]
    expect(
      checkAttachment(existing, attachment({ id: '2', relativePath: 'b.ts', content: 'b' }))
    ).toBe('ok')
  })
})
