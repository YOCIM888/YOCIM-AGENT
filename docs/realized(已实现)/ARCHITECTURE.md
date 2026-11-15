# YOCIM AGENT — 架构设计（ARCHITECTURE）

> 本文档是架构事实来源。任何偏离本文档的实现，必须先在本文档记录理由，再改代码。

## 1. 设计原则

1. **安全边界优先**：renderer 不可信；所有文件系统、命令、数据库操作只在主进程发生。
2. **进程最小暴露**：preload 只暴露显式白名单 API，不暴露 `ipcRenderer`、`require`、`process`。
3. **引擎与 UI 解耦**：Agent 引擎是纯 TypeScript 模块，不 import Electron，可单测、可迁移。
4. **类型与校验双保险**：IPC 与工具参数在 TS 类型之外，运行时再用 zod 校验。
5. **小步可回滚**：每阶段独立提交，核心模块先接口后实现。

## 2. 进程与分层（文字版架构图）

```
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (Vue 3 + Pinia + Monaco)                                   │
│  views: SessionList | ChatPanel | CodeEditor | FileTree | StatusBar  │
│  stores: workspace | session | chat | settings                      │
│  通过 window.yocim.* 调用（preload 注入），禁止 Node / fs / child_process │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ contextBridge（白名单 API）
┌───────────────────────────────▼─────────────────────────────────────┐
│ Preload (最小、类型安全)                                             │
│  - invoke 封装：request/response                                      │
│  - on 封装：订阅主进程推送事件（带 runId / seq）                      │
│  - 共享 types + zod schema（从 src/shared 引入，构建期内联）           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ ipcMain.handle / webContents.send
┌───────────────────────────────▼─────────────────────────────────────┐
│ Main Process                                                        │
│  ipc/        参数 zod 校验、错误映射、通道注册                        │
│  workspace/  工作区选择、路径守卫、文件树、文件读写                   │
│  agent/      Agent 循环、上下文组装、流式事件、取消                   │
│  providers/  OpenAI-compatible / mock                                │
│  tools/      list_dir、read_file、search_files、write_file、run_command│
│  approval/   审批队列（挂起 Promise，等待 renderer 决策）             │
│  audit/      审计日志写入与查询                                       │
│  db/         node:sqlite、迁移、CRUD                              │
│  command/    命令执行器（cwd 锁定、超时、输出截断）                    │
│  settings/   模型配置、安全存储密钥读取                                │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
   工作区文件系统          SQLite (userData)         模型 HTTP API
   （受限访问）            sessions/messages/...     （OpenAI-compatible）
```

## 3. 目录结构（目标结构，阶段 1 落地）

```
YOCIM-AGENT/
├─ docs/                     # PLAN / ARCHITECTURE / ACCEPTANCE / SECURITY
├─ public/image/yocim.png    # 应用图标（阶段 3 使用）
├─ build/                    # 打包资源（图标等）
├─ src/
│  ├─ main/
│  │  ├─ index.ts            # app 生命周期、窗口创建
│  │  ├─ ipc/                # 通道注册与 zod 校验
│  │  ├─ workspace/          # 工作区、路径守卫、文件树
│  │  ├─ agent/              # Agent 循环（纯 TS）
│  │  ├─ providers/          # openai-compatible、mock
│  │  ├─ tools/              # 工具实现与注册表
│  │  ├─ approval/           # 审批队列
│  │  ├─ audit/              # 审计日志
│  │  ├─ command/            # 命令执行器
│  │  ├─ db/                 # sqlite 初始化、迁移、仓储
│  │  └─ settings/           # 配置与密钥读取
│  ├─ preload/
│  │  └─ index.ts            # contextBridge 白名单 API
│  ├─ renderer/
│  │  ├─ src/
│  │  │  ├─ views/           # Layout、Chat、Editor、Files
│  │  │  ├─ components/      # 对话、审批卡片、文件树节点
│  │  │  ├─ stores/          # workspace/session/chat/settings
│  │  │  ├─ router/
│  │  │  └─ main.ts
│  │  └─ index.html
│  └─ shared/                # 跨进程共享：类型、zod schema、常量、事件协议
├─ tests/
│  ├─ unit/                  # Vitest
│  └─ e2e/                   # Playwright Electron
├─ package.json
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ electron.vite.config.ts（或等价）
├─ electron-builder.yml
├─ eslint.config.js / .prettierrc
└─ README.md
```

## 4. 关键设计

### 4.1 路径安全守卫（workspace/pathGuard.ts）

- 所有文件 API 的入参路径必须先在守卫中解析：
  1. 拒绝包含空字节、绝对盘符越权、`..` 逃逸的输入；
  2. 与工作区根路径拼接后 `path.resolve`，再 `fs.realpath`（存在的路径）；
  3. 比较 `realpath` 是否以 `realpath(workspaceRoot) + path.sep` 开头（根目录本身允许）；
  4. 符号链接解析后仍必须在工作区内，否则抛 `E_PATH_ESCAPE`。
- 写操作额外限制：禁止写入 `.git/`、`node_modules/`（可配置忽略名单）。
- 守卫为纯函数 + 有限 fs 依赖，便于单测（含 symlink 用例）。

### 4.2 IPC 契约（阶段 2 定稿）

统一响应包络：

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
```

MVP 通道（草案）：

| 通道                                       | 方向          | 入参（zod）                           | 返回                                  |
| ------------------------------------------ | ------------- | ------------------------------------- | ------------------------------------- |
| `workspace:select`                         | invoke        | 无                                    | `{ root, name }`                      |
| `workspace:current`                        | invoke        | 无                                    | `{ root, name } \| null`              |
| `fs:tree`                                  | invoke        | `{ relativePath?, depth? }`           | 节点数组（目录/文件、大小、忽略标记） |
| `fs:readFile`                              | invoke        | `{ relativePath }`                    | `{ content, truncated, encoding }`    |
| `chat:send`                                | invoke        | `{ sessionId, text }`                 | `{ runId }`                           |
| `chat:cancel`                              | invoke        | `{ runId }`                           | `{ cancelled }`                       |
| `chat:event`                               | main→renderer | —                                     | 事件流（见 4.3）                      |
| `approval:respond`                         | invoke        | `{ approvalId, decision, remember? }` | `{ accepted }`                        |
| `approval:request`                         | main→renderer | —                                     | 审批请求（工具、参数摘要、风险等级）  |
| `session:list/create/rename/delete/export` | invoke        | zod 校验                              | 对应数据                              |
| `settings:get/set`                         | invoke        | zod 校验                              | 配置（密钥脱敏）                      |
| `audit:list`                               | invoke        | `{ sessionId?, limit? }`              | 审计条目                              |

约束：

- 所有通道名与 schema 定义在 `src/shared/ipc.ts`，主进程与 preload 共同引用；
- 所有 IPC handler 校验 `senderFrame.url`：开发态匹配 `ELECTRON_RENDERER_URL`，生产态必须是 `file://` 且位于 `out/renderer/`；非法来源返回 `E_FORBIDDEN`；
- preload 运行在 sandbox 中，只能引入纯常量与类型：通道常量放在 `src/shared/ipcChannels.ts`，禁止让 preload 触达含运行时依赖（如 zod）的模块；
- 未注册通道一律拒绝；handler 内部捕获异常并映射为 `{ ok: false }`；
- 日志中不得出现 API Key 与完整文件内容。

### 4.3 Agent 事件流协议（阶段 4 定稿）

事件均为 `ChatEvent`，公共字段 `{ runId, seq, ts }`，`seq` 单调递增：

| 事件                | 载荷                                                | 说明             |
| ------------------- | --------------------------------------------------- | ---------------- |
| `run:start`         | `{ sessionId }`                                     | 一次生成开始     |
| `message:delta`     | `{ messageId, text }`                               | 文本增量         |
| `message:done`      | `{ messageId, content }`                            | 文本完成         |
| `tool:call`         | `{ callId, name, argsSummary }`                     | 模型请求调用工具 |
| `tool:result`       | `{ callId, ok, summary }`                           | 工具执行结果     |
| `approval:required` | `{ approvalId, callId, tool, risk, argsSummary }`   | 需要审批         |
| `run:error`         | `{ code, message }`                                 | 错误终态         |
| `run:done`          | `{ reason: 'completed' \| 'cancelled' \| 'error' }` | 唯一终态事件     |

阶段 4 已实现：`run:start`、`message:delta`、`message:done`、`tool:call`、`run:error`、`run:done`；`tool:result` 与 `approval:required` 在阶段 5 启用。`seq` 在单次 run 内单调递增，终态只发一次。

Agent 循环：

```
组装上下文(messages + 工具定义 + 系统提示)
  → provider.stream() 逐块产出
  → 有 tool_calls ? 逐个执行（写/命令先审批）→ 结果回填 → 回到 provider
  → 无 tool_calls ? 结束
  → 任意阶段收到 cancel / 超限 / 错误 → 发 run:done 终态
```

### 4.4 工具权限矩阵（阶段 5 落地）

| 工具               | 读/写 | 审批 | 备注                                                           |
| ------------------ | ----- | ---- | -------------------------------------------------------------- |
| list_dir           | 读    | 否   | 深度与条目上限                                                 |
| read_file          | 读    | 否   | 大小上限、二进制拒绝                                           |
| search_files       | 读    | 否   | 结果上限、文件扫描上限                                         |
| write_file / patch | 写    | 是   | 支持整文件写入与 oldText/newText 补丁；路径守卫 + 忽略目录保护 |
| run_command        | 执行  | 是   | 白名单 + 危险模式拒绝、超时、输出截断                          |

审批实现：主进程生成 UUID，一次性请求；`approval:request` 推送、`approval:respond` 应答；run 取消时未决审批按拒绝处理。审计与工具调用已持久化到 SQLite，记录时间、工具、参数摘要、结果、审批状态。Mock Provider 支持 `/tool read|write|command` 命令演示完整工具循环。

### 4.5 持久化 schema（阶段 6 落地）

```sql
sessions(id TEXT PK, title TEXT, workspace_root TEXT, created_at INT, updated_at INT)
messages(id TEXT PK, session_id TEXT FK ON DELETE CASCADE, role TEXT,
         content TEXT, created_at INT)
tool_calls(id TEXT PK, session_id TEXT, run_id TEXT, call_id TEXT, tool TEXT,
           args_summary TEXT, result_summary TEXT, approval TEXT, status TEXT,
           created_at INT)
settings(key TEXT PK, value_json TEXT)
audit_logs(id TEXT PK, session_id TEXT, run_id TEXT, tool TEXT, args_summary TEXT,
           result_summary TEXT, approval TEXT, ok INT, ts INT)
```

- 使用 Electron 内置 `node:sqlite`（DatabaseSync），DB 文件位于 `userData/yocim.db`，主进程独占。
- `PRAGMA user_version` 驱动迁移；启动时自动执行，迁移幂等。
- API Key 不存明文：`safeStorage` 加密后写入 `settings.apiKeyEncrypted`，renderer 只能读取 `hasApiKey`；环境变量 `OPENAI_API_KEY` 优先。
- 审计仅追加，仓储层不提供更新/删除接口。

## 5. 状态管理（Pinia）

| Store       | 职责                                                              |
| ----------- | ----------------------------------------------------------------- |
| `workspace` | 工作区根、文件树、当前打开文件、加载状态                          |
| `session`   | 会话列表、当前会话、重命名/删除/导出                              |
| `chat`      | 消息列表、流式片段、runId、审批队列、错误状态                     |
| `settings`  | 编辑器选项；模型配置由主进程 SettingsService 持有（不含明文密钥） |

事件订阅在 `chat` store 初始化时注册一次，按 `runId` 分发，避免重复监听。

## 6. 错误处理策略

- 统一错误码前缀：`E_PATH_ESCAPE`、`E_NOT_IN_WORKSPACE`、`E_TOOL_DENIED`、`E_COMMAND_TIMEOUT`、`E_PROVIDER`、`E_CANCELLED`、`E_DB`。
- 工具执行失败不终止整个 run，错误文本回填给模型，由模型决定下一步（有最大重试次数）。
- Provider 网络错误：指数退避重试（≤2 次），仍失败则 `run:error`。
- 取消：置位后忽略后续 provider chunk，立即发 `run:done(cancelled)`。

## 7. 打包与运行环境

- 开发：`npm run dev` 启动 Electron + Vite HMR。
- 生产：`npm run build` → `npm run package`（electron-builder）。
- 原生模块：阶段 6 改用 Electron 内置 `node:sqlite`，无需 rebuild；better-sqlite3 因本机缺少 VS Build Tools 且路径含空格而弃用。
- 数据目录：`app.getPath('userData')`；日志目录同源下的 `logs/`。

## 8. 决策记录

| 编号 | 决策                               | 理由                                                          |
| ---- | ---------------------------------- | ------------------------------------------------------------- |
| A1   | Agent 引擎纯 TS、不依赖 Electron   | 可测试、可迁移 utilityProcess                                 |
| A2   | IPC 使用 invoke/handle + 事件推送  | 请求响应语义清晰，事件流适合流式                              |
| A3   | SQLite 放主进程独占（node:sqlite） | 避免多进程锁；无需原生 ABI rebuild                            |
| A4   | 所有响应使用 `IpcResult` 包络      | 前端错误处理统一                                              |
| A5   | 路径守卫以 realpath 结果为准       | 防符号链接逃逸                                                |
| A6   | 通道常量与 zod schema 分文件       | 满足 sandbox preload 的零运行时依赖约束                       |
| A7   | Monaco 使用本地打包 worker         | 离线可用；CSP 仅放行 `worker-src 'self' blob:`                |
| A8   | 阶段 4 固定 Mock Provider          | 无密钥配置时保证安全默认值；真实 Provider 在阶段 6 按设置启用 |
| A9   | API Key 用 safeStorage 加密后入库  | 仅密文落库；renderer 只能看到 `hasApiKey`，不接触明文         |
| A10  | IPC handler 校验 senderFrame 来源  | 只接受应用自身渲染页调用；导航与 `window.open` 已在主进程拦截 |
