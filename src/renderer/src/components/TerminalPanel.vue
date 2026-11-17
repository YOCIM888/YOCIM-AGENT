<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent, TerminalState } from '@shared/terminal'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const ui = useUiStore()

const host = ref<HTMLDivElement | null>(null)
const state = ref<TerminalState | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let observer: ResizeObserver | null = null
let unsubscribe: (() => void) | null = null
let line = ''
let running = false
let activeRunId: string | null = null
const history: string[] = []
let historyIndex = 0
/** IPC 事件可能早于 invoke 结果到达，先按 runId 暂存 */
const pendingEvents = new Map<string, TerminalEvent[]>()

const BASE_THEME: Record<'light' | 'dark', ITheme> = {
  light: {
    background: '#ffffff',
    foreground: '#202124',
    cursor: '#3d5afe',
    cursorAccent: '#ffffff',
    selectionBackground: '#dfe4ff',
    black: '#3f3f46',
    red: '#c53030',
    green: '#17845a',
    yellow: '#a4610a',
    blue: '#3d5afe',
    magenta: '#8b5cf6',
    cyan: '#0f766e',
    white: '#e4e4e7',
    brightBlack: '#71717a',
    brightRed: '#e05353',
    brightGreen: '#2fa36b',
    brightYellow: '#c98a1b',
    brightBlue: '#5c78ff',
    brightMagenta: '#a67cf8',
    brightCyan: '#22a39f',
    brightWhite: '#ffffff'
  },
  dark: {
    background: '#1c1c1f',
    foreground: '#ededf0',
    cursor: '#7c92ff',
    cursorAccent: '#1c1c1f',
    selectionBackground: '#353a5c',
    black: '#1c1c1f',
    red: '#ff6b6b',
    green: '#3fbf82',
    yellow: '#e8ab55',
    blue: '#7c92ff',
    magenta: '#c792ea',
    cyan: '#56c8d8',
    white: '#d4d4d8',
    brightBlack: '#71717a',
    brightRed: '#ff9090',
    brightGreen: '#6ed6a2',
    brightYellow: '#f2c77e',
    brightBlue: '#9eadff',
    brightMagenta: '#d9b6ff',
    brightCyan: '#8adcea',
    brightWhite: '#ffffff'
  }
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function themeFor(mode: 'light' | 'dark'): ITheme {
  const base = BASE_THEME[mode]
  return {
    ...base,
    background: cssVar('--bg', base.background ?? ''),
    foreground: cssVar('--text', base.foreground ?? ''),
    cursor: cssVar('--accent', base.cursor ?? ''),
    selectionBackground: cssVar('--accent-soft', base.selectionBackground ?? '')
  }
}

function colorSequence(value: string): string {
  const hex = value.trim().replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return '38;5;244'
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `38;2;${r};${g};${b}`
}

function writePrompt(nextState?: TerminalState): void {
  if (!terminal) return
  const target = nextState ?? state.value
  const path = target?.cwd ?? ''
  const accent = colorSequence(cssVar('--accent', '#3d5afe'))
  const muted = colorSequence(cssVar('--text-muted', '#667085'))
  terminal.write(`\x1b[${muted}m${path}\x1b[${accent}m ❯ \x1b[0m`)
}

function applyEvent(event: TerminalEvent): void {
  if (!terminal) return
  if (event.type === 'output') {
    terminal.write(event.text)
    return
  }
  if (event.type === 'message') {
    terminal.write(`\x1b[33m${event.text}\x1b[0m`)
    return
  }
  running = false
  activeRunId = null
  state.value = event.state
  writePrompt()
}

function handleEvent(event: TerminalEvent): void {
  if (!terminal) return
  if (event.runId === activeRunId) {
    applyEvent(event)
    return
  }
  // cd 是主进程内建命令，没有对应 invoke 结果；其余事件等 runId 就绪后再消费
  if (event.type === 'message' && event.runId === 'cd') {
    applyEvent(event)
    return
  }
  const queued = pendingEvents.get(event.runId) ?? []
  if (queued.length < 100) queued.push(event)
  pendingEvents.set(event.runId, queued)
  if (pendingEvents.size > 20) pendingEvents.delete(pendingEvents.keys().next().value ?? '')
}

async function runCommand(command: string): Promise<void> {
  if (!terminal) return
  if (running) {
    terminal.write('\x1b[31m上一条命令仍在运行，按 Ctrl+C 取消。\x1b[0m\n')
    writePrompt()
    return
  }
  if (command === 'clear' || command === 'cls') {
    terminal.clear()
    writePrompt()
    return
  }
  if (command === 'exit') {
    ui.closeTerminal()
    return
  }

  const result = await window.yocim.terminal.run({ command })
  if (!result.ok) {
    terminal.write(`\x1b[31m${result.error.message}\x1b[0m\n`)
    writePrompt()
    return
  }
  running = true
  activeRunId = result.data.runId
  state.value = { cwd: result.data.cwd, root: result.data.root }
  const queued = pendingEvents.get(activeRunId) ?? []
  pendingEvents.delete(activeRunId)
  for (const event of queued) applyEvent(event)
}

function handleData(data: string): void {
  if (!terminal) return
  if (data === '\r') {
    const command = line.trim()
    line = ''
    terminal.write('\n')
    if (!command) {
      writePrompt()
      return
    }
    if (history[history.length - 1] !== command) history.push(command)
    historyIndex = history.length
    void runCommand(command)
    return
  }
  if (data === '\u007f') {
    if (!line.length) return
    line = line.slice(0, -1)
    terminal.write('\b \b')
    return
  }
  if (data === '\u0003') {
    terminal.write('^C\n')
    line = ''
    if (running) void window.yocim.terminal.cancel()
    else writePrompt()
    return
  }
  if (data === '\u001b[A' || data === '\u001b[B') {
    if (!history.length) return
    historyIndex = Math.min(
      history.length,
      Math.max(0, historyIndex + (data === '\u001b[A' ? -1 : 1))
    )
    const next = history[historyIndex] ?? ''
    terminal.write('\b \b'.repeat(line.length))
    line = next
    terminal.write(line)
    return
  }
  if (data === '\t' || data.startsWith('\u001b')) return
  if (line.length >= 4000) return
  line += data
  terminal.write(data)
}

onMounted(() => {
  if (!host.value) return
  terminal = new Terminal({
    fontFamily: cssVar('--font-mono', 'Consolas, monospace'),
    fontSize: 12,
    lineHeight: 1.35,
    cursorBlink: true,
    convertEol: true,
    scrollback: 1000,
    theme: themeFor(settings.theme)
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(host.value)
  terminal.onData(handleData)
  unsubscribe = window.yocim.terminal.onEvent(handleEvent)

  void window.yocim.terminal.state().then((result) => {
    if (!result.ok || !terminal) return
    state.value = result.data
    if (!result.data.root) {
      terminal.write('\x1b[33m未打开项目，终端已切换到用户主目录。\x1b[0m\n')
    }
    writePrompt()
    terminal.focus()
  })

  observer = new ResizeObserver(() => {
    try {
      fitAddon?.fit()
    } catch {
      // 容器尚未布局完成时忽略
    }
  })
  observer.observe(host.value)
  requestAnimationFrame(() => {
    try {
      fitAddon?.fit()
    } catch {
      // 同上
    }
  })
})

watch(
  () => settings.theme,
  (theme) => {
    if (terminal) terminal.options.theme = themeFor(theme)
  }
)

onBeforeUnmount(() => {
  if (running) void window.yocim.terminal.cancel()
  unsubscribe?.()
  observer?.disconnect()
  terminal?.dispose()
  terminal = null
})
</script>

<template>
  <section class="terminal-panel" data-testid="terminal-panel">
    <header class="terminal-header">
      <span class="terminal-title">终端</span>
      <span class="terminal-cwd" data-testid="terminal-cwd" :title="state?.cwd ?? ''">{{
        state?.cwd ?? '终端'
      }}</span>
      <button
        type="button"
        class="terminal-close"
        data-testid="terminal-close"
        title="关闭终端"
        aria-label="关闭终端"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>
    <div ref="host" class="terminal-host" data-testid="terminal-host"></div>
  </section>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  height: 40%;
  min-height: 180px;
  max-height: 65%;
  border-top: 1px solid var(--border-strong);
  background: var(--bg);
}

.terminal-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 11px;
}

.terminal-title {
  color: var(--text);
  font-weight: 600;
}

.terminal-cwd {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.terminal-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.terminal-host {
  flex: 1;
  min-height: 0;
  padding: 6px 10px;
  overflow: hidden;
}
</style>
