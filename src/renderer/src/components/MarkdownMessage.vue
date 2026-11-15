<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '../lib/markdown'

const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const html = ref(renderMarkdown(props.content))
let timer: ReturnType<typeof setTimeout> | null = null
let pending = props.content

function flush(): void {
  timer = null
  html.value = renderMarkdown(pending)
}

watch(
  () => props.content,
  (value) => {
    pending = value
    if (props.streaming) {
      if (timer === null) timer = setTimeout(flush, 60)
      return
    }
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    flush()
  }
)

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) return
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    flush()
  }
)

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const anchor = target?.closest('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (href.startsWith('https://') || href.startsWith('http://')) {
    window.open(href, '_blank', 'noopener')
  }
}

onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer)
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 内容已通过 DOMPurify 白名单净化 -->
  <div class="markdown-body" @click="handleClick" v-html="html"></div>
</template>

<style scoped>
.markdown-body {
  font-size: 13.5px;
  line-height: 1.75;
  user-select: text;
  word-break: break-word;
}

.markdown-body :deep(*) {
  max-width: 100%;
}

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 14px 0 8px;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-body :deep(h1) {
  font-size: 20px;
}

.markdown-body :deep(h2) {
  font-size: 17px;
}

.markdown-body :deep(h3) {
  font-size: 15px;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}

.markdown-body :deep(li) {
  margin: 2px 0;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-muted);
}

.markdown-body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-subtle);
  font-family: var(--font-mono);
  font-size: 12px;
}

.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  overflow: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 12px;
}

.markdown-body :deep(table) {
  display: block;
  max-width: 100%;
  margin: 8px 0;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 12.5px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 5px 8px;
  border: 1px solid var(--border);
}

.markdown-body :deep(th) {
  background: var(--bg-subtle);
  font-weight: 600;
}

.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
