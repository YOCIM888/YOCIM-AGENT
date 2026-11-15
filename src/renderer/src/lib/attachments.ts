import {
  ATTACHMENT_LIMITS,
  type ContextAttachment,
  type ContextAttachmentRange
} from '@shared/attachment'

export interface SelectionAttachmentInput {
  id: string
  relativePath: string
  content: string
  language?: string
  range: ContextAttachmentRange
}

/** 编辑器选区 → 上下文附件；与文件树「添加到对话」共用同一模型。 */
export function createSelectionAttachment(input: SelectionAttachmentInput): ContextAttachment {
  const truncated = input.content.length > ATTACHMENT_LIMITS.maxFileBytes
  return {
    id: input.id,
    type: 'selection',
    relativePath: input.relativePath,
    content: truncated ? input.content.slice(0, ATTACHMENT_LIMITS.maxFileBytes) : input.content,
    language: input.language,
    range: input.range,
    ...(truncated ? { truncated: true } : {})
  }
}

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
