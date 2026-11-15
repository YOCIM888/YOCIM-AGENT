import DOMPurify from 'dompurify'
import { marked } from 'marked'

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'form', 'input', 'button'],
  FORBID_ATTR: ['style']
}

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { gfm: true, breaks: true, async: false })
  return DOMPurify.sanitize(typeof html === 'string' ? html : '', SANITIZE_OPTIONS)
}
