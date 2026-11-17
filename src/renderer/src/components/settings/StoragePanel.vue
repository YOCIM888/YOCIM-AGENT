<script setup lang="ts">
import { t } from '../../i18n'
import { computed, onMounted, ref } from 'vue'
import { useAppSettingsStore } from '../../stores/appSettings'

const store = useAppSettingsStore()

const customDir = ref('')
const saving = ref(false)
const saved = ref(false)

const info = computed(() => store.storageInfo)
const pending = computed(() => Boolean(info.value?.pendingRestart))

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

async function browse(): Promise<void> {
  const picked = await store.pickStorageDirectory()
  if (picked) customDir.value = picked
}

async function apply(dir: string): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    const ok = await store.setStorage({ dataDir: dir })
    if (!ok) return
    customDir.value = dir
    saved.value = true
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await store.refresh()
  await store.refreshStorageInfo()
  customDir.value = store.storage.dataDir
})
</script>

<template>
  <div class="sp-panel">
    <section class="sp-section">
      <div class="sp-section-head">
        <h3 class="sp-section-title">{{ t('数据目录') }}</h3>
        <button
          type="button"
          class="sp-btn sm"
          data-testid="storage-open"
          @click="store.openStorageDirectory()"
        >
          {{ t('打开目录') }}
        </button>
      </div>
      <p class="sp-section-sub">
        {{ t('数据库、日志、时间线快照与扩展都放在这个目录下。换目录后需要重启应用才会生效。') }}
      </p>

      <label class="sp-field">
        <span>{{ t('当前生效目录') }}</span>
        <input :value="info?.dataDir ?? '—'" readonly data-testid="storage-current-dir" />
      </label>

      <label class="sp-field">
        <span>{{ t('自定义目录（留空表示使用系统默认）') }}</span>
        <input
          v-model="customDir"
          :placeholder="t('例如 D:\\\\YOCIM-Data')"
          data-testid="storage-custom-dir"
        />
      </label>

      <div class="sp-row">
        <button type="button" class="sp-btn" data-testid="storage-browse" @click="browse">
          {{ t('浏览…') }}
        </button>
        <button
          type="button"
          class="sp-btn"
          data-testid="storage-reset"
          :disabled="!customDir"
          @click="apply('')"
        >
          {{ t('恢复默认') }}
        </button>
        <button
          type="button"
          class="sp-btn primary"
          :disabled="saving"
          data-testid="storage-save"
          @click="apply(customDir.trim())"
        >
          {{ t('保存目录') }}
        </button>
      </div>

      <p v-if="pending" class="sp-hint pending">
        {{ t('目标目录已记录，重启应用后生效。当前会话的数据仍留在原目录。') }}
      </p>
      <p v-else-if="saved" class="sp-notice">{{ t('已保存') }}</p>
    </section>

    <section class="sp-section">
      <h3 class="sp-section-title">{{ t('空间占用') }}</h3>
      <table class="sp-table">
        <thead>
          <tr>
            <th>{{ t('项目') }}</th>
            <th class="num">{{ t('大小') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ t('数据库（会话 / 工具记录 / 用量）') }}</td>
            <td class="num">{{ formatBytes(info?.databaseBytes ?? 0) }}</td>
          </tr>
          <tr v-for="entry in info?.entries ?? []" :key="entry.name">
            <td>{{ entry.name }}</td>
            <td class="num">{{ formatBytes(entry.bytes) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="sp-hint">{{ t('系统默认目录：') }}{{ info?.defaultDir ?? '—' }}</p>
    </section>

    <p v-if="store.error" class="sp-error">{{ t(store.error) }}</p>
  </div>
</template>

<style scoped>
.pending {
  color: var(--warning);
}
</style>
