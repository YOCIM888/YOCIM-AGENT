import {
  ATTACHMENT_LIMITS,
  type ContextAttachment,
  type ContextAttachmentRange
} from '@shared/attachment'

export function sameAttachmentRange(
  a?: ContextAttachmentRange,
  b?: ContextAttachmentRange
): boolean {
  if (!a || !b) return !a && !b
  return (
    a.startLine === b.startLine &&
    a.startColumn === b.startColumn &&
    a.endLine === b.endLine &&
    a.endColumn === b.endColumn
  )
}

export type AttachmentCheck = 'ok' | 'duplicate' | 'count' | 'total'

export function checkAttachment(
  existing: ContextAttachment[],
  candidate: ContextAttachment
): AttachmentCheck {
  const duplicate = existing.some(
    (item) =>
      item.relativePath === candidate.relativePath &&
      sameAttachmentRange(item.range, candidate.range)
  )
  if (duplicate) return 'duplicate'
  if (existing.length >= ATTACHMENT_LIMITS.maxCount) return 'count'
  const total =
    existing.reduce((sum, item) => sum + item.content.length, 0) + candidate.content.length
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) return 'total'
  return 'ok'
}
