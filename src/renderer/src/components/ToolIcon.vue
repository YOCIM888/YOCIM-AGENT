<script setup lang="ts">
import { computed } from 'vue'
import { toolIconKey, type ToolIconKey } from '../lib/timeline'

const props = defineProps<{
  name: string
}>()

const key = computed<ToolIconKey>(() => toolIconKey(props.name))
</script>

<template>
  <svg
    class="tool-icon"
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 读文件：文档 -->
    <g v-if="key === 'read'">
      <path d="M4.1 2.1h5.1l2.7 2.7v9.1a.9.9 0 0 1-.9.9H4.1a.9.9 0 0 1-.9-.9V3a.9.9 0 0 1 .9-.9Z" />
      <path d="M9.1 2.2v2.8h2.7" />
      <path d="M5.8 8.4h4.4M5.8 10.9h3" />
    </g>
    <!-- 写文件：铅笔 -->
    <g v-else-if="key === 'write'">
      <path d="M10.4 2.4 13.6 5.6 6.3 12.9 2.6 13.9l1-3.7 6.8-7.8Z" />
      <path d="M9.1 3.7 12.3 6.9" />
    </g>
    <!-- 编辑文件：笔尖带改动线 -->
    <g v-else-if="key === 'edit'">
      <path d="M10.4 2.4 13.6 5.6 7.4 11.8l-3.6-3.6 6.6-5.8Z" />
      <path d="M9.1 3.7 12.3 6.9" />
      <path d="M2.4 14.3h3.2M2.4 14.3l2.8-2.8" />
    </g>
    <!-- 列目录：文件夹 -->
    <g v-else-if="key === 'folder'">
      <path
        d="M1.9 4.3a1 1 0 0 1 1-1h3.2l1.5 1.8h5.5a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1V4.3Z"
      />
      <path d="M1.9 7.1h12.2" />
    </g>
    <!-- 搜索：放大镜 -->
    <g v-else-if="key === 'search'">
      <circle cx="7.1" cy="7.1" r="4.4" />
      <path d="m10.5 10.5 3 3" />
    </g>
    <!-- 执行命令：终端 -->
    <g v-else-if="key === 'terminal'">
      <rect x="2.1" y="3.2" width="11.8" height="9.6" rx="1.4" />
      <path d="m5 6.4 2 1.8-2 1.8" />
      <path d="M9 10.4h2.8" />
    </g>
    <!-- 计划：清单 -->
    <g v-else-if="key === 'plan'">
      <path d="m2.5 4.6 1.5 1.5L6.6 3.5" />
      <path d="m2.5 10.4 1.5 1.5 2.6-2.6" />
      <path d="M8.4 4.8h5M8.4 10.6h5" />
    </g>
    <!-- 生图：相框 + 山景 -->
    <g v-else-if="key === 'image'">
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.5" />
      <circle cx="5.7" cy="6.1" r="1.2" />
      <path d="m2.2 11.4 3.4-3.1 2.3 2.1 2.2-2.4 3.7 3.6" />
    </g>
    <!-- 浏览器：地球 -->
    <g v-else-if="key === 'browser'">
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.3 8h11.4" />
      <path d="M8 2.2c1.6 1.8 2.4 3.6 2.4 5.8S9.6 12 8 13.8C6.4 12 5.6 10.2 5.6 8S6.4 4 8 2.2Z" />
    </g>
    <!-- Git：分支 -->
    <g v-else>
      <circle cx="4.8" cy="3.9" r="1.9" />
      <circle cx="4.8" cy="12.1" r="1.9" />
      <circle cx="11.3" cy="5.6" r="1.9" />
      <path d="M4.8 5.8v4.4" />
      <path d="M11.3 7.5v.8a2.3 2.3 0 0 1-2.3 2.3H6.7" />
    </g>
  </svg>
</template>

<style scoped>
.tool-icon {
  flex: none;
  display: block;
}
</style>
