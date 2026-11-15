<script setup lang="ts">
import { computed } from 'vue'
import { fileIconCategory, fileIconLabel, ICON_COLORS } from '../lib/fileIcons'

const props = withDefaults(
  defineProps<{
    name: string
    type: 'file' | 'directory'
    expanded?: boolean
  }>(),
  { expanded: false }
)

const category = computed(() =>
  props.type === 'directory' ? 'folder' : fileIconCategory(props.name)
)
const color = computed(() => ICON_COLORS[category.value])
const label = computed(() => fileIconLabel(props.name))
</script>

<template>
  <svg
    v-if="type === 'directory'"
    class="file-icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <path
      v-if="expanded"
      :fill="color"
      d="M1.5 3h4l1.2 1.5h7.8v1.2H2.2L1 12.5V3.5A.5.5 0 0 1 1.5 3Zm.9 3.9h12.4l-1.3 6.1H1.6l.8-6.1Z"
    />
    <path
      v-else
      :fill="color"
      d="M1.5 3h4l1.2 1.5h7.8c.3 0 .5.2.5.5v8c0 .3-.2.5-.5.5h-13a.5.5 0 0 1-.5-.5V3.5c0-.3.2-.5.5-.5Z"
    />
  </svg>
  <svg v-else class="file-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="none"
      :stroke="color"
      stroke-width="1.1"
      d="M4 1.5h5L12.5 5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
    />
    <path fill="none" :stroke="color" stroke-width="1.1" d="M9 1.5V5h3.5" />
    <text
      x="8"
      y="12.4"
      text-anchor="middle"
      :fill="color"
      font-size="4.6"
      font-weight="700"
      font-family="var(--font-mono, monospace)"
    >
      {{ label }}
    </text>
  </svg>
</template>

<style scoped>
.file-icon {
  flex: none;
  display: block;
}
</style>
