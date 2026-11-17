<script setup lang="ts">
import { t } from '../i18n'
import { computed, watch } from 'vue'
import { useRemoteStore } from '../stores/remote'

const props = defineProps<{ active: boolean }>()

const remote = useRemoteStore()

const environment = computed(() => remote.environment)
const wslAvailable = computed(() => environment.value?.wsl.available ?? false)
const sshAvailable = computed(() => environment.value?.ssh.available ?? false)
const form = computed(() => remote.form)

const wslDistros = computed(() => remote.wslDistros)

// 每次切到本视图都刷新环境探测与目标列表（WSL 发行版可能刚装好）
watch(
  () => props.active,
  (active) => {
    if (active) void remote.initialize()
  },
  { immediate: true }
)

function kindLabel(kind: 'wsl' | 'ssh'): string {
  return kind === 'wsl' ? 'WSL' : 'SSH'
}

function authLabel(authType: 'agent' | 'key' | 'password' | undefined): string {
  if (authType === 'password') return t('密码')
  if (authType === 'agent') return 'ssh-agent'
  return t('私钥')
}

function statusText(targetId: string): string {
  const connection = remote.connection
  if (connection?.targetId !== targetId) return ''
  if (connection.status === 'connected') return t('已连接')
  if (connection.status === 'connecting') return t('连接中…')
  if (connection.status === 'error') return t('连接失败')
  return ''
}

function formTitle(): string {
  if (!form.value) return ''
  return form.value.id ? t('编辑远程目标') : t('新建远程目标')
}

async function submit(): Promise<void> {
  await remote.save()
}

// 供模板里做非空断言，避免 v-if 与可选链混杂
function authTypeOf(): 'agent' | 'key' | 'password' {
  return form.value?.authType ?? 'key'
}

const formAuthType = computed(authTypeOf)
</script>

<template>
  <div class="remote" data-testid="remote-panel">
    <div class="head">
      <span class="title">{{ t('远程管理器') }}</span>
      <span class="count">{{ remote.targets.length }}</span>
      <button
        type="button"
        class="icon"
        :title="t('刷新')"
        data-testid="remote-refresh"
        :disabled="remote.loading || remote.probing"
        @click="remote.initialize()"
      >
        ↻
      </button>
    </div>

    <div v-if="remote.error" class="error" data-testid="remote-error">{{ t(remote.error) }}</div>
    <div v-if="remote.notice" class="notice" data-testid="remote-notice">
      {{ t(remote.notice) }}
    </div>

    <div class="env" data-testid="remote-env">
      <div class="env-row">
        <span class="env-key">WSL</span>
        <span v-if="wslAvailable" class="env-ok">
          {{ t('可用 ·') }} {{ environment?.wsl.distros.length ?? 0 }} {{ t('个发行版') }}
        </span>
        <span v-else class="env-bad">{{ environment?.wsl.error ?? t('不可用') }}</span>
      </div>
      <div v-if="wslAvailable && environment?.wsl.defaultDistro" class="env-hint">
        {{ t('默认发行版：') }}{{ environment.wsl.defaultDistro }}
      </div>
      <div class="env-row">
        <span class="env-key">SSH</span>
        <span v-if="sshAvailable" class="env-ok">{{ t('内置 ssh2 客户端可用') }}</span>
        <span v-else class="env-bad">{{ environment?.ssh.error ?? t('不可用') }}</span>
      </div>
    </div>

    <div v-if="remote.connected" class="connection" data-testid="remote-connection">
      <div class="connection-line">
        <span class="dot on" />
        <span class="connection-label" data-testid="remote-connection-label">
          {{ remote.connection?.label }}
        </span>
        <button
          type="button"
          class="action"
          data-testid="remote-disconnect"
          :disabled="remote.busyId !== null"
          @click="remote.disconnect()"
        >
          {{ t('断开') }}
        </button>
      </div>
      <div class="connection-path">{{ remote.connection?.displayRoot }}</div>
    </div>

    <div v-if="remote.pendingFingerprint" class="fingerprint" data-testid="remote-fingerprint">
      <div class="fingerprint-title">{{ t('首次连接该主机，请核对指纹') }}</div>
      <code data-testid="remote-fingerprint-value">{{
        remote.pendingFingerprint.fingerprint
      }}</code>
      <div class="fingerprint-actions">
        <button
          type="button"
          class="action primary"
          data-testid="remote-trust"
          @click="remote.trustAndConnect()"
        >
          {{ t('信任并连接') }}
        </button>
        <button
          type="button"
          class="action"
          data-testid="remote-trust-cancel"
          @click="remote.disconnect()"
        >
          {{ t('取消') }}
        </button>
      </div>
    </div>

    <div class="body">
      <div v-if="!remote.targets.length" class="empty" data-testid="remote-empty">
        {{
          t(
            '暂无远程目标。可添加 WSL 发行版或 SSH 主机，连接后直接在当前面板浏览、编辑、搜索与执行 Git。'
          )
        }}
      </div>
      <ul v-else class="targets" data-testid="remote-list">
        <li
          v-for="target in remote.targets"
          :key="target.id"
          class="target"
          :data-testid="`remote-target-${target.id}`"
        >
          <div class="target-head">
            <span class="badge">{{ kindLabel(target.kind) }}</span>
            <span class="target-name" :title="target.name">{{ target.name }}</span>
            <span
              v-if="statusText(target.id)"
              class="status"
              :class="{
                on:
                  remote.connection?.status === 'connected' &&
                  remote.connection.targetId === target.id
              }"
              :data-testid="`remote-target-status-${target.id}`"
            >
              {{ statusText(target.id) }}
            </span>
          </div>
          <div class="target-meta">
            {{
              target.kind === 'wsl'
                ? `${target.distro ?? ''} · ${target.rootPath}`
                : `${target.username ?? ''}@${target.host ?? ''}:${target.port ?? 22} · ${target.rootPath}`
            }}
          </div>
          <div v-if="target.kind === 'ssh'" class="target-meta sub">
            {{ t('认证：') }}{{ authLabel(target.authType)
            }}{{ target.hasSecret ? t(' · 已保存口令') : ''
            }}{{ target.hostFingerprint ? t(' · 指纹已信任') : '' }}
          </div>
          <div
            v-if="target.lastError && remote.error !== target.lastError"
            class="target-error"
            :data-testid="`remote-target-error-${target.id}`"
          >
            {{ target.lastError }}
          </div>
          <div class="target-actions">
            <button
              type="button"
              class="action primary"
              :data-testid="`remote-connect-${target.id}`"
              :disabled="remote.busyId !== null"
              @click="remote.connect(target.id)"
            >
              {{ target.connected ? t('重新连接') : t('连接') }}
            </button>
            <button
              type="button"
              class="action"
              :data-testid="`remote-edit-${target.id}`"
              @click="remote.startEdit(target)"
            >
              {{ t('编辑') }}
            </button>
            <button
              type="button"
              class="action danger"
              :data-testid="`remote-delete-${target.id}`"
              :disabled="remote.busyId !== null"
              @click="remote.remove(target.id)"
            >
              {{ t('删除') }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <form v-if="form" class="form" data-testid="remote-form" @submit.prevent="submit">
      <div class="form-title">{{ formTitle() }}</div>
      <div class="kind-switch">
        <button
          type="button"
          class="kind"
          :class="{ on: form.kind === 'wsl' }"
          data-testid="remote-kind-wsl"
          @click="form.kind = 'wsl'"
        >
          WSL
        </button>
        <button
          type="button"
          class="kind"
          :class="{ on: form.kind === 'ssh' }"
          data-testid="remote-kind-ssh"
          @click="form.kind = 'ssh'"
        >
          SSH
        </button>
      </div>

      <label class="field">
        <span>{{ t('名称（可选）') }}</span>
        <input
          v-model="form.name"
          type="text"
          data-testid="remote-form-name"
          :placeholder="t('例如 后端 WSL')"
        />
      </label>

      <template v-if="form.kind === 'wsl'">
        <label class="field">
          <span>{{ t('发行版') }}</span>
          <input
            v-model="form.distro"
            list="remote-wsl-distros"
            type="text"
            data-testid="remote-form-distro"
            :placeholder="
              wslDistros.length ? t('选择或输入发行版') : t('未探测到发行版，可直接输入名称')
            "
          />
          <datalist id="remote-wsl-distros">
            <option v-for="distro in wslDistros" :key="distro" :value="distro" />
          </datalist>
        </label>
      </template>

      <template v-else>
        <label class="field">
          <span>{{ t('主机') }}</span>
          <input
            v-model="form.host"
            type="text"
            data-testid="remote-form-host"
            placeholder="example.com"
          />
        </label>
        <div class="field-row">
          <label class="field">
            <span>{{ t('端口') }}</span>
            <input v-model="form.port" type="text" data-testid="remote-form-port" />
          </label>
          <label class="field">
            <span>{{ t('用户名') }}</span>
            <input v-model="form.username" type="text" data-testid="remote-form-username" />
          </label>
        </div>
        <label class="field">
          <span>{{ t('认证方式') }}</span>
          <select v-model="form.authType" data-testid="remote-form-auth">
            <option value="key">{{ t('私钥') }}</option>
            <option value="password">{{ t('密码') }}</option>
            <option value="agent">ssh-agent</option>
          </select>
        </label>
        <label v-if="formAuthType === 'key'" class="field">
          <span>{{ t('私钥路径') }}</span>
          <input
            v-model="form.keyPath"
            type="text"
            data-testid="remote-form-key"
            placeholder="C:\\Users\\me\\.ssh\\id_ed25519"
          />
        </label>
        <label v-if="formAuthType === 'key' || formAuthType === 'password'" class="field">
          <span>{{ formAuthType === 'key' ? t('私钥口令（可选）') : t('密码') }}</span>
          <input
            v-model="form.secret"
            type="password"
            data-testid="remote-form-secret"
            :placeholder="t('保存后不再回显')"
          />
        </label>
      </template>

      <label class="field">
        <span>{{ form.kind === 'wsl' ? t('Linux 路径') : t('远端路径') }}</span>
        <input
          v-model="form.rootPath"
          type="text"
          data-testid="remote-form-root"
          placeholder="/home/me/project"
        />
      </label>

      <div class="form-actions">
        <button
          type="submit"
          class="action primary"
          data-testid="remote-save"
          :disabled="remote.saving"
        >
          {{ t('保存') }}
        </button>
        <button
          type="button"
          class="action"
          data-testid="remote-cancel"
          @click="remote.cancelForm()"
        >
          {{ t('取消') }}
        </button>
      </div>
    </form>

    <div v-else class="footer">
      <button
        type="button"
        class="action"
        data-testid="remote-add-wsl"
        @click="remote.startCreate('wsl')"
      >
        + WSL
      </button>
      <button
        type="button"
        class="action"
        data-testid="remote-add-ssh"
        @click="remote.startCreate('ssh')"
      >
        + SSH
      </button>
    </div>
  </div>
</template>

<style scoped>
.remote {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px 12px;
  /* 面板窄且内容多（环境 + 目标 + 表单），整体滚动比内部分区滚动更稳 */
  overflow-x: hidden;
  overflow-y: auto;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
}

.title {
  font-size: 12px;
  font-weight: 600;
}

.count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
}

.icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.icon:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.error,
.notice {
  margin-bottom: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: 10.5px;
  line-height: 1.5;
}

.error {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.notice {
  background: var(--bg-hover);
  color: var(--text-muted);
}

.env {
  flex: none;
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  font-size: 10.5px;
  line-height: 1.6;
}

.env-row {
  display: flex;
  gap: 6px;
}

.env-key {
  flex: none;
  width: 30px;
  color: var(--text-muted);
  font-weight: 600;
}

.env-ok {
  color: var(--text);
}

.env-bad {
  color: var(--danger);
}

.env-hint {
  padding-left: 36px;
  color: var(--text-muted);
}

.connection {
  flex: none;
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
}

.connection-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.dot.on {
  background: var(--success, #3fb950);
}

.connection-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-path {
  margin-top: 2px;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fingerprint {
  flex: none;
  margin-bottom: 8px;
  padding: 6px 8px;
  border: 1px solid var(--warning, #d29922);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warning, #d29922) 12%, transparent);
  font-size: 10.5px;
}

.fingerprint-title {
  margin-bottom: 4px;
  font-weight: 600;
}

.fingerprint code {
  display: block;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 10px;
}

.fingerprint-actions {
  display: flex;
  gap: 6px;
}

.body {
  flex: none;
}

.empty {
  padding: 12px 4px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}

.targets {
  margin: 0;
  padding: 0;
  list-style: none;
}

.target {
  padding: 6px 0;
  border-top: 1px solid var(--border);
}

.target:first-child {
  border-top: 0;
}

.target-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge {
  flex: none;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 9.5px;
  font-weight: 600;
}

.target-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
}

.status.on {
  color: var(--accent);
}

.target-meta {
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-meta.sub {
  font-family: inherit;
}

.target-error {
  margin-top: 2px;
  color: var(--danger);
  font-size: 10px;
  line-height: 1.4;
}

.target-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.action {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.action:hover {
  background: var(--bg-hover);
}

.action.primary {
  border-color: var(--accent);
  color: var(--accent);
}

.action.danger {
  color: var(--danger);
}

.action:disabled {
  opacity: 0.5;
  cursor: default;
}

.form {
  flex: none;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  overflow: auto;
}

.form-title {
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
}

.kind-switch {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}

.kind {
  flex: 1;
  padding: 3px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.kind.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.field {
  display: block;
  margin-bottom: 6px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.field span {
  display: block;
  margin-bottom: 2px;
}

.field input,
.field select {
  width: 100%;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.field-row {
  display: flex;
  gap: 6px;
}

.field-row .field {
  flex: 1;
}

.form-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.footer {
  display: flex;
  flex: none;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
</style>
