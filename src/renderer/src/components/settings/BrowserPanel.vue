<script setup lang="ts">
const planned = [
  {
    title: '网页浏览',
    detail: '内置无头浏览器会话，Agent 可打开页面、点击元素、填写表单并截图取证。'
  },
  {
    title: '页面抽取',
    detail: '把当前打开的网页转成可读文本，直接喂给模型，省去手工复制粘贴。'
  },
  {
    title: '远程调试接入',
    detail: '接管 Chrome / Edge 的调试端口，让 Agent 在你正在用的浏览器里排查问题。'
  },
  {
    title: '自动化脚本',
    detail: '录制一段浏览流程并重放，用于回归验证与数据采集。'
  }
]
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">浏览器</h3>
        <span class="badge">规划中</span>
      </div>
      <p class="sp-section-sub">
        浏览器能力还在设计阶段，这一页先占位。等功能落地后，这里会放开关、浏览器实例配置与
        权限控制。
      </p>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">打算支持的能力</h3>
      <ul class="plan-list">
        <li v-for="item in planned" :key="item.title">
          <strong>{{ item.title }}</strong>
          <span>{{ item.detail }}</span>
        </li>
      </ul>
    </section>

    <p class="sp-hint">
      目前 Agent 的联网能力由「搜索」页的 Tavily 提供——可以查资料，但不能打开并操作网页。
    </p>
  </div>
</template>

<style scoped>
.badge {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 10.5px;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 12px;
  border-left: 2px solid var(--border-strong);
}

.plan-list strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.plan-list span {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-muted);
}
</style>
