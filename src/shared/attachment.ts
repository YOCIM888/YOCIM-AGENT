import { z } from 'zod'

export const ATTACHMENT_LIMITS = {
  maxCount: 10,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 200 * 1024
} as const

export const contextAttachmentRangeSchema = z.object({
  startLine: z.number().int().min(1),
  startColumn: z.number().int().min(1),
  endLine: z.number().int().min(1),
  endColumn: z.number().int().min(1)
})

export const contextAttachmentSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['file', 'selection']),
  relativePath: z.string().min(1).max(1024),
  content: z.string().max(ATTACHMENT_LIMITS.maxFileBytes),
  language: z.string().max(64).optional(),
  range: contextAttachmentRangeSchema.optional(),
  truncated: z.boolean().optional()
})

export type ContextAttachmentRange = z.infer<typeof contextAttachmentRangeSchema>
export type ContextAttachment = z.infer<typeof contextAttachmentSchema>

/** 附件摘要：用于消息气泡展示，不含文件内容 */
export interface AttachmentSummary {
  type: ContextAttachment['type']
  relativePath: string
  range?: ContextAttachmentRange
  truncated?: boolean
}

export function summarizeAttachments(attachments: ContextAttachment[]): AttachmentSummary[] {
  return attachments.map(({ type, relativePath, range, truncated }) => ({
    type,
    relativePath,
    ...(range ? { range } : {}),
    ...(truncated ? { truncated } : {})
  }))
}
