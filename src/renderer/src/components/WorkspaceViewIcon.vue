<script setup lang="ts">
import type { WorkspaceView } from '../lib/workspaceViews'

defineProps<{ name: WorkspaceView }>()

const ICON_PATHS: Record<WorkspaceView, string[]> = {
  files: ['M4 1.5h5.5L13 5v9.5H4V1.5z', 'M9.5 1.5V5H13'],
  search: ['M7 1.75a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5z', 'M10.8 10.8l3.7 3.7'],
  editor: ['M5.5 4.5L2 8l3.5 3.5', 'M10.5 4.5L14 8l-3.5 3.5', 'M9.25 3l-2.5 10'],
  audit: [
    'M8 1.5l5.5 2v4.2c0 3.4-2.3 5.7-5.5 6.8-3.2-1.1-5.5-3.4-5.5-6.8V3.5L8 1.5z',
    'M5.5 8l1.8 1.8 3.2-3.6'
  ],
  scm: [
    'M4.5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
    'M4.5 11a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
    'M11.5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
    'M4.5 5v6',
    'M11.5 5v.5c0 2.75-3 3.5-7 3.5'
  ],
  extensions: [
    'M2 2h4.75v4.75H2z',
    'M9.25 2H14v4.75H9.25z',
    'M2 9.25h4.75V14H2z',
    'M10.5 10.5h3.5v3.5h-3.5z'
  ],
  debug: [
    'M8 5c2.35 0 3.75 1.7 3.75 4s-1.4 4.5-3.75 4.5S4.25 11.3 4.25 9 5.65 5 8 5z',
    'M5.75 2.5L6.9 4.6',
    'M10.25 2.5L9.1 4.6',
    'M4.25 8H1.75',
    'M4.6 11.2l-2.1 1.6',
    'M11.75 8h2.5',
    'M11.4 11.2l2.1 1.6',
    'M8 5v8.5'
  ],
  remote: [
    'M1.75 2.75h12.5v8.5H1.75z',
    'M8 11.25v2',
    'M5.25 13.25h5.5',
    'M5 5.75l1.75 1.75L5 9.25',
    'M8.5 9.25h2.5'
  ]
}
</script>

<template>
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.3"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in ICON_PATHS[name]" :key="index" :d="d" />
  </svg>
</template>
