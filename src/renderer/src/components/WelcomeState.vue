<script setup lang="ts">
import { t } from '../i18n'
</script>

<template>
  <section class="welcome" data-testid="welcome-state">
    <img class="welcome-logo" src="/image/yocim.png" alt="YOCIM" />
    <h1>{{ t('YOCIM AGENT 让想法落地') }}</h1>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.welcome-logo {
  width: 46px;
  height: 46px;
  margin-bottom: 14px;
  padding: 3px;
  border-radius: 14px;
  background: #ffffff;
  object-fit: contain;
}

.welcome h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.3px;
}

.subtitle {
  margin: 12px 0 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}
</style>
