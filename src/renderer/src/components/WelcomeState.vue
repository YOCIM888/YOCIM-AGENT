<template>
  <section class="welcome" data-testid="welcome-state">
    <img class="welcome-logo" src="/image/yocim.png" alt="YOCIM" />
    <h1>YOCIM AGENT 让想法落地</h1>
    <span class="badge">测试版</span>
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

.badge {
  margin-top: 6px;
  padding: 1px 8px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  color: var(--accent);
  font-size: 10px;
}

.subtitle {
  margin: 12px 0 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-muted);
}
</style>
