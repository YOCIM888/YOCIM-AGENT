<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppCommands } from '../composables/useAppCommands'
import type { ContextMenuItem } from '../lib/menu'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import AboutDialog from './AboutDialog.vue'
import CommandsDialog from './CommandsDialog.vue'
import ContextMenu from './ContextMenu.vue'
import SettingsDialog from './SettingsDialog.vue'

type MenuKind = 'app' | 'edit'
type WindowAction = 'minimize' | 'maximize' | 'close'

const settings = useSettingsStore()
const ui = useUiStore()
const commands = useAppCommands()
const menu = ref<{ kind: MenuKind; x: number; y: number } | null>(null)
const showAbout = ref(false)
const showCommands = ref(false)

const appItems = computed<ContextMenuItem[]>(() => [
  {
    id: 'theme',
    label: settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
    testid: 'theme-toggle'
  },
  {
    id: 'commands',
    label: '命令管理…',
    testid: 'commands-open',
    separatorBefore: true
  },
  { id: 'settings', label: '设置…', testid: 'settings-open' }
])

const editItems = computed<ContextMenuItem[]>(() => [
  { id: 'open-folder', label: '打开文件夹…', testid: 'menu-open-folder' },
  { id: 'new-session', label: '新建会话', testid: 'menu-new-session', separatorBefore: true },
  { id: 'search-session', label: '搜索会话', testid: 'menu-search-session' },
  {
    id: 'toggle-workspace',
    label: settings.workspaceCollapsed ? '展开工作区' : '折叠工作区',
    testid: 'menu-toggle-workspace',
    separatorBefore: true
  },
  {
    id: 'toggle-status',
    label: settings.statusExpanded ? '收起状态栏' : '展开状态栏',
    testid: 'menu-toggle-status'
  }
])

const menuItems = computed(() => (menu.value?.kind === 'edit' ? editItems.value : appItems.value))

function toggleMenu(kind: MenuKind, event: MouseEvent): void {
  event.stopPropagation()
  if (menu.value?.kind === kind) {
    menu.value = null
    return
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = { kind, x: rect.left, y: rect.bottom + 4 }
}

function selectMenu(id: string): void {
  menu.value = null
  if (id === 'open-folder') {
    void commands.switchWorkspace()
  } else if (id === 'theme') {
    settings.toggleTheme()
  } else if (id === 'settings') {
    ui.openSettings()
  } else if (id === 'commands') {
    showCommands.value = true
  } else if (id === 'new-session') {
    void commands.createSession()
  } else if (id === 'search-session') {
    void commands.focusSessionSearch()
  } else if (id === 'toggle-workspace') {
    commands.toggleWorkspace()
  } else if (id === 'toggle-status') {
    commands.toggleStatus()
  }
}

function openAbout(): void {
  menu.value = null
  showAbout.value = true
}

function controlWindow(action: WindowAction): void {
  void window.yocim.window.control({ action })
}

function toggleMaximize(): void {
  controlWindow('maximize')
}
</script>

<template>
  <header class="titlebar" data-testid="titlebar" @dblclick="toggleMaximize">
    <div class="titlebar-left no-drag" @dblclick.stop>
      <button
        type="button"
        class="title-button icon"
        :data-testid="settings.sessionCollapsed ? 'session-expand' : 'session-collapse'"
        :title="`${settings.sessionCollapsed ? '展开' : '收起'}会话列表 (Ctrl+B)`"
        :aria-label="settings.sessionCollapsed ? '展开会话列表' : '收起会话列表'"
        @click="commands.toggleSession()"
      >
        ◫
      </button>
      <button
        type="button"
        class="title-button"
        data-testid="menu-app"
        :class="{ open: menu?.kind === 'app' }"
        @click="toggleMenu('app', $event)"
      >
        应用
      </button>
      <button
        type="button"
        class="title-button"
        data-testid="menu-edit"
        :class="{ open: menu?.kind === 'edit' }"
        @click="toggleMenu('edit', $event)"
      >
        编辑
      </button>
      <button type="button" class="title-button" data-testid="menu-about" @click="openAbout">
        关于
      </button>
    </div>

    <div class="drag-space" title="双击最大化/还原"></div>

    <div class="window-controls no-drag" @dblclick.stop>
      <button
        type="button"
        class="window-button"
        data-testid="window-minimize"
        title="最小化"
        aria-label="最小化"
        @click="controlWindow('minimize')"
      >
        ─
      </button>
      <button
        type="button"
        class="window-button"
        data-testid="window-maximize"
        title="最大化/还原"
        aria-label="最大化或还原"
        @click="controlWindow('maximize')"
      >
        □
      </button>
      <button
        type="button"
        class="window-button close"
        data-testid="window-close"
        title="关闭"
        aria-label="关闭"
        @click="controlWindow('close')"
      >
        ✕
      </button>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="selectMenu"
      @close="menu = null"
    />
  </header>

  <!-- 必须放在标题栏拖动区之外，否则真实鼠标事件会被 -webkit-app-region: drag 吞掉 -->
  <SettingsDialog v-if="ui.settingsOpen" @close="ui.closeSettings()" />
  <AboutDialog v-if="showAbout" @close="showAbout = false" />
  <CommandsDialog v-if="showCommands" @close="showCommands = false" />
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  height: 36px;
  flex: none;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  padding-left: 6px;
}

.title-button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.title-button.icon {
  width: 28px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}

.title-button:hover,
.title-button.open {
  background: var(--bg-hover);
  color: var(--text);
}

.drag-space {
  flex: 1;
  height: 100%;
}

.window-controls {
  display: flex;
  height: 100%;
}

.window-button {
  width: 44px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.window-button:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.window-button.close:hover {
  background: #e81123;
  color: #ffffff;
}
</style>
