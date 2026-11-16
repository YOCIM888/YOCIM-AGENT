# YOCIM AGENT

[English](README.md) | [中文](README.zh-CN.md)

A local-first desktop AI coding assistant (Electron + Vue 3 + TypeScript). Pick a local workspace, chat with a model, and let it read/modify files and run controlled commands after your approval.

## Features

- **Multi-model support**: DeepSeek, Qwen, BigModel, Kimi, MiniMax, Tencent Cloud, Alibaba Cloud, SiliconFlow, Volcano Engine, ChatGPT, Claude, Gemini, Grok, local Ollama, and custom endpoints. Add them in Settings and switch from the bottom-right of the composer (grouped by provider, model name only, selected item marked with a green filled circle).
- **Tabbed settings**: Billing, Models, Search, Image Generation, Appearance, Storage, and Browser. Approval mode (Manual / Auto / Open) is toggled at the bottom-left of the composer and persisted.
- **Three-pane workspace**: project-based session list on the left, a pure chat area in the middle, and an 8-view icon activity bar on the right (Files / Search / Editor / Audit / Source Control / Extensions / Debug / Remote). Side panels can be collapsed and resized by dragging, with state persisted across restarts.
- **Workspace-wide search & replace**: streaming results, cancellation, include/exclude, case/whole-word/regex options, replace preview with hash-conflict checks, and timeline rollback (ripgrep first, falling back to the built-in search engine).
- **Monaco multi-tab editor**: preview/pinned tabs, `Ctrl+S` saving, dirty state, external-change conflicts (overwrite / reload / save as), image preview, and "Add to chat" from a selection.
- **Projects & sessions**: one workspace = one project, with multiple sessions per project; search, pin, archive/unarchive, and move across projects. Session and project actions live in context menus.
- **Assistant messages**: Markdown rendering (marked + DOMPurify); tool calls shown as expandable step timelines, with approval cards inline. Light theme by default plus a pure-black dark theme; the status bar collapses to a single line by default and can be expanded.
- **Approval experience**: write-file approval cards include a syntax-highlighted diff preview (all hunks of an `edit_file` patch at once). "Allow in session / Allow in project" rules skip future identical approvals (allowlisted and dangerous commands cannot be bypassed by rules; the rule name is recorded in the audit log). Files are re-checked for external modification before execution.
- **Task planning**: the agent maintains a plan card above the chat via `update_plan` (todo / in progress / done + progress bar). Reaching the round limit automatically pauses the run and it can be resumed with one click. Round limits are adaptive (6 read-only / 20 single-file / 60 multi-file).
- **Context management**: a usage ring to the left of the model button (hover for used/window, click to compact manually). Old content is automatically compacted into a structured summary at 80% of the window (hard trim beyond 95%). The window defaults to 200K and is adjustable from 200K to 1000K in the model menu; reasoning effort is also adjustable (default / low / medium / high, mapped per protocol). Model-side conversation streams (including tool calls and results) are persisted to SQLite and fully replayed across rounds — compaction only affects what is sent to the model, never the chat history. Read-only tools run concurrently (up to 4), while write tools and commands run serially.
- **Project rules & structure injection**: `AGENTS.md` / `.yocim/rules.md` take precedence over default habits, and a lightweight repo map helps the model understand the directory layout on the first turn. The currently open and unsaved files are injected with each request.
- **Tools**: `list_dir` (glob filtering + file size/line count), `read_file` (line numbers + offset/limit paging), `search_files` (ripgrep, regex / include / exclude / context lines), `write_file`, `edit_file` (atomic multi-hunk patches with indentation tolerance), `run_command` (allowlist + `.yocim/commands.json` extensions, streaming output), `run_tests` (auto-detects vitest/jest/pytest/go), `run_typecheck` / `run_lint` (compact file:line:col format), `get_git_diff`, `update_plan` (structured plan fed back to the model each round).
- **Audit panel**: statistics cards (total / failed / approved / denied calls), filters by tool / result / approval / time range / keyword, detail drawer, live mode, and JSON/CSV export (persisted in SQLite, DB v4).
- **Source control**: system Git detection (with an install hint if missing), staged / changed / untracked groups, stage and commit, branch switch/create, pull (`--ff-only`) / push / publish, diff viewer, second confirmation for discarding changes, redacted Git output, and a change-count badge.
- **Graphical commit graph**: vertical lanes with status dots (hollow for merge commits, glow for HEAD), branch / remote / tag capsules attached to their commits, and conventional-prefix coloring. Click a commit to expand its changed-file list with insertion/deletion counts; click again to collapse.
- **Run tasks**: auto-detects npm / pnpm / yarn and lists `package.json` scripts; `.yocim/tasks.json` can define custom commands. Output streams incrementally, tasks can be stopped (killing the process tree), and a custom command must be confirmed in full on first run.
- **Node.js debugging**: zero-config launch from `.yocim/launch.json` (with `${workspaceFolder}` / `${file}` / `${env:NAME}` variables) or `package.json` `main`. Breakpoints and conditional breakpoints in the editor glyph margin, continue / pause / step over / into / out / restart / stop, variable tree, watch expressions, call stack, debug console, and current-line highlighting. The full command must be confirmed on first launch; output is redacted.
- **Remote workspaces (WSL / SSH)**: manage targets and probe environments, then browse / edit / search / use Git / run tasks directly in the right panel. WSL uses `\\wsl.localhost` UNC paths plus `wsl.exe --exec`; SSH uses the built-in `ssh2` (SFTP + exec), with TOFU host fingerprint verification and passwords encrypted via `safeStorage`.
- **Extensions (first layer)**: no extension code is executed. Import from local directories / `.vsix` / the VS Code extensions directory, enable/disable, uninstall, and view details. Compatibility is graded as "declarative only / partial / incompatible", with incompatible extensions disabled by default. Declarative snippet contributions are registered as editor completions.
- **Persistence**: sessions / messages / settings / project state survive restarts; sessions can be renamed, deleted, and exported to Markdown. Main-process file logging and crash handling.

## Interface & Keyboard Shortcuts

- **Left**: brand and "New Session" at the top, then search, workspace count, pinned section, and project groups. Right-click a session to rename / export / pin / archive / move / delete; right-click a project to create a session / rename.
- **Middle**: empty sessions show a welcome state and a large composer; streaming replies can be stopped; tool steps collapse into "N steps executed · Xs" and expand to show arguments and results; failures show a retryable error card.
- **Right**: the 8 icon views; clicking a file switches to the editor, and a search hit can be jumped to and selected. The divider can be dragged to resize, double-clicked to reset, or nudged with arrow keys when focused.
- **Title bar**: the "Application" menu switches workspace / theme and opens Settings; the "Edit" menu creates/searches sessions, collapses the workspace, and toggles the status bar.

| Shortcut       | Action                           |
| -------------- | -------------------------------- |
| `Ctrl+B`       | Toggle the session sidebar       |
| `Ctrl+Shift+B` | Toggle the workspace panel       |
| `Ctrl+N`       | New session                      |
| `Ctrl+K`       | Focus session search             |
| `Ctrl+J`       | Expand / collapse the status bar |
| `Ctrl+S`       | Save the current editor file     |

> On macOS, use `Cmd` instead of `Ctrl`.

## Approval Modes

| Mode   | Behavior                                                   |
| ------ | ---------------------------------------------------------- |
| Manual | Both file writes and commands require approval (default)    |
| Auto   | File writes are approved automatically; commands still ask  |
| Open   | File writes and commands are auto-approved, no approval card |

Open mode is still constrained by the workspace path guard, command allowlist, and dangerous-command blocking — approval modes never bypass these security boundaries.

## Requirements

- Node.js >= 22.12 (verified in this repo on Node 24 / npm 11)
- Windows 10+ (primary validation platform), macOS, and Linux
- No native build toolchain required (the database uses Electron/Node's built-in `node:sqlite`)

## Install & Develop

```powershell
npm install
npm run dev
```

If the Electron runtime download fails (common on some networks), fill it in using a mirror:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

| Command               | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `npm run dev`         | Start the dev window (Vite HMR)                                          |
| `npm run typecheck`   | TypeScript / Vue type checking                                           |
| `npm run lint`        | ESLint                                                                   |
| `npm run test`        | Vitest unit tests                                                        |
| `npm run build`       | Build main / preload / renderer                                          |
| `npx playwright test` | Electron e2e smoke tests (build first)                                   |
| `npm run e2e`         | Build + e2e                                                              |
| `npm run package`     | Build an installer for the current platform (`release/<version>/`)       |
| `npm run package:dir` | Build an unpacked directory only (debugging packaging)                   |

## Model Configuration

The **Mock Provider** is used by default and makes no network requests. Demo commands: `/tool read <path>` (no approval), `/tool write <path>` and `/tool command <command>` (trigger approval).

To connect a real model: title bar "Application" → "Settings…" → "Models" → "Add Provider", pick a preset, then fill in the Base URL, model list, and API key. Saving switches to that provider automatically. Use the model button at the bottom-right of the composer to switch providers/models at any time.

Built-in endpoints:

| Provider          | Base URL                                            | Protocol                    |
| ----------------- | --------------------------------------------------- | --------------------------- |
| DeepSeek          | `https://api.deepseek.com/v1`                       | OpenAI-compatible           |
| Qwen (Tongyi)     | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI-compatible           |
| BigModel (Zhipu)  | `https://open.bigmodel.cn/api/paas/v4`              | OpenAI-compatible           |
| Kimi (Moonshot)   | `https://api.moonshot.cn/v1`                        | OpenAI-compatible           |
| MiniMax           | `https://api.minimaxi.com/v1`                       | OpenAI-compatible           |
| Tencent Cloud     | `https://api.hunyuan.cloud.tencent.com/v1`          | OpenAI-compatible           |
| Alibaba Cloud     | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI-compatible           |
| SiliconFlow       | `https://api.siliconflow.cn/v1`                     | OpenAI-compatible           |
| Volcano Engine    | `https://ark.cn-beijing.volces.com/api/v3`          | OpenAI-compatible           |
| ChatGPT (OpenAI)  | `https://api.openai.com/v1`                         | OpenAI-compatible           |
| Claude            | `https://api.anthropic.com/v1`                      | Anthropic Messages          |
| Gemini            | `https://generativelanguage.googleapis.com/v1beta`  | Gemini GenerateContent      |
| Grok              | `https://api.x.ai/v1`                               | OpenAI-compatible           |
| Local Ollama      | `http://localhost:11434/v1`                         | OpenAI-compatible (no key)  |
| Custom            | Enter your own                                      | OpenAI / Anthropic / Gemini |

Settings tabs: Billing (DeepSeek balance + token usage by provider/model with hand-entered unit prices), Models, Search (Tavily key — enables `web_search`; the tool is hidden when no key is set), Image Generation (Zhipu key, free `cogview-3-flash` by default — enables `generate_image`, with a custom OpenAI-image-format endpoint option), Appearance (theme / font size / word wrap / code minimap), Storage (view and change the data directory, effective after restart), and Browser (placeholder).

API key handling: each provider's key is encrypted with Electron `safeStorage` before being stored in `settings` — never in plaintext; the renderer can only read `hasApiKey`. Environment variables are also supported as a fallback (`DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `TAVILY_API_KEY`, `ZHIPU_API_KEY`, etc.).

## Security

- The renderer has no Node/fs/child_process access and can only call the main process through the preload allowlist; IPC handlers validate `senderFrame` and return `E_FORBIDDEN` for non-application pages.
- All file paths go through a realpath guard that blocks `..`, absolute paths, and symlink escapes. File writes and commands require approval, and commands are restricted by an allowlist and dangerous-pattern checks (60s timeout, 64KB output truncation).
- The audit log is append-only, recording time, tool, argument summary, result, and approval status.
- Git operations go through the main-process `GitService` using `spawn('git', args)` with no shell. No force push, no skipping hooks, pull defaults to `--ff-only`, Git output is redacted for URLs/credentials/tokens, and credentials are delegated to the system Git Credential Manager.
- Tasks and debug sessions also use argument-array `spawn` (on Windows, `.cmd`/`.bat` are wrapped with `cmd.exe /d /s /c`). Custom tasks and launch configs must be confirmed in full on first run; `launch.json` `program`/`cwd` may not escape the workspace; output is redacted, capped at 512KB per task, with at most 4 concurrent tasks.
- Remote workspaces: WSL runs via `wsl.exe --exec` with array arguments and no shell. SSH uses the built-in `ssh2` with private key / password / ssh-agent auth; secrets are only saved encrypted with `safeStorage` (the renderer knows only `hasSecret`); host fingerprints are TOFU-verified on first use and blocked if they change; remote paths are checked for `..` traversal. Remote debugging and bulk replace are explicitly disabled in the UI.
- The first extension layer **executes no extension code**: only declarative contributions are parsed. VSIX archives are unpacked with a built-in minimal zip reader that rejects zip64 and path traversal; extensions declaring `main`/`browser`, `debuggers`, or extension dependencies are marked "incompatible" and stay disabled.

## Data Location

Under Electron's `userData` directory (on Windows typically `%APPDATA%\YOCIM AGENT`):

- `yocim.db`: projects, sessions, messages, tool calls, settings, audit, and token usage
- `workspace.json`: the last opened workspace
- `logs/main.log`: main-process log (rotates to `main.old.log` above 2MB)

"Settings → Storage" can point to a custom directory (database, logs, timeline snapshots, and extensions move together); the change takes effect after a restart.

## Packaging

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package
```

- Windows artifacts: `release/0.1.2/YOCIM AGENT-0.1.2-setup.exe` and `release/0.1.2/win-unpacked/`
- Bundled ripgrep: `resources/ripgrep/rg.exe` (14.1.1) placed there via `extraResources`; falls back to `rg` on PATH and the built-in JS search when missing
- Runtime dependencies: `zod` and `ssh2` (with `asn1` / `bcrypt-pbkdf` / `tweetnacl` / `safer-buffer`) are externalized and packed into the asar; `cpu-features` is an optional native accelerator that is neither compiled nor packaged; `npmRebuild: false` avoids node-gyp failures when the project path contains spaces
- App icon: `build/icon.png` (copied from `public/image/yocim.png`). Code signing is not configured yet, so SmartScreen may warn during installation.
