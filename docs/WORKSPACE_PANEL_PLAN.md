# 右侧工作区增强计划（VS Code 风格）

> 状态：**范围已确认，待实施**（2026-11-15）
> 已确认决策：编辑器可编辑、扩展第一层、Node.js 调试优先、WSL 先行、打包 ripgrep、依赖系统 Git。
> 范围：右侧工作区面板从「文件 / 编辑器 / 审计」三个文字 Tab 扩展为 VS Code 风格的图标活动栏与 8 个视图：文件、搜索、编辑器、审计、源代码管理、扩展安装、运行和调试、远程管理器。
> 本文档只描述设计与实施计划，本轮不改动代码。

## 1. 现状与目标

### 1.1 现状

- `WorkspacePanel.vue` 顶部是文字 Tab：文件 / 编辑器 / 审计，当前视图存 `localStorage`。
- 文件树由 `fs:tree` 一次性返回深度 3 的树，目录默认展开；只有读取文件，没有新建、重命名、复制、删除、回收站等操作。
- Monaco 为只读预览，单文件打开，无保存、多标签、Diff、右键菜单。
- 审计面板只有「当前会话 / 全部」筛选与刷新，最多 50 条。
- 没有搜索替换、Git、扩展、运行调试、远程工作区。
- 工作区为本地单根目录，路径守卫为 `WorkspacePathGuard`，IPC 统一 `runIpcHandler` + zod + senderFrame 校验。
- 右侧面板已支持拖动调宽（220–420px）与折叠。

### 1.2 目标

1. 顶栏改为纯图标活动栏，从左到右：文件｜搜索｜编辑器｜审计｜源代码管理｜扩展安装｜运行和调试｜远程管理器。
2. 每个视图具备可用的一期功能，而不是占位空面板。
3. 文件、Git、搜索、调试、远程统一走主进程服务与受限 IPC，保持现有安全边界。
4. 新增「对话上下文附件」能力，支撑文件 / 编辑器选区「添加到对话」。

## 2. 总体布局

```text
┌ 工作区面板（宽度可拖动 220–420px）──────────────────────────────┐
│ ▤  ⌕  ⌨  ◎  │  ⎇  ⧉  ▷  ⛁          ← 图标活动栏（纯图标 + tooltip）│
├───────────────────────────────────────────────────────────────┤
│ 当前视图内容                                                    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- 活动栏高 36px，图标按钮 26×26，hover 显示 tooltip 与名称；分隔线位于「审计」与「源代码管理」之间。
- 选中图标使用 `accent-soft` 背景 + 底部 2px 强调线；源代码管理显示变更数 badge，运行和调试显示运行状态点。
- 面板宽度不足时活动栏横向滚动，不换行、不压缩图标。
- 当前视图写入 `localStorage`，重启恢复；打开文件时自动切到「编辑器」，但用户手动切走后不再强制跳转。
- 每个视图保留独立滚动位置与折叠状态。

## 3. 视图详细设计

### 3.1 文件

#### 3.1.1 文件树

- 默认全部折叠，只显示工作区根目录的直接子项；点击目录按需加载子项（懒加载），带 loading 占位。
- 目录展开时显示缩进参考线、chevron；文件按「目录在前、名称升序」排序。
- 文件图标按扩展名区分（ts/js/vue/json/md/css/html/image/git 等），使用内置 SVG 或 codicon，不依赖网络。
- 单击文件 = 预览打开（编辑器标签为斜体预览态）；双击 = 固定标签；再次单击其他文件替换预览标签。
- hover 行显示轻量操作：新建文件、新建文件夹（仅目录）、更多（打开右键菜单）。
- 目录/文件拖拽移动（第二阶段）：拖到目录内移动，拖到编辑器区打开；拖拽冲突按移动处理，带确认。

#### 3.1.2 工具栏

- 新建文件、新建文件夹、刷新、全部折叠。
- 刷新保留已展开目录集合；被删除的目录自动从展开集合移除。
- 新建时在树内显示内联输入框，Enter 创建、Esc 取消；名称校验非法字符、空名、重名。

#### 3.1.3 右键菜单

文件/目录右键：

| 菜单项                 | 行为                                                 |
| ---------------------- | ---------------------------------------------------- |
| 剪切                   | 写入内部文件剪贴板，粘贴后移动                       |
| 复制                   | 写入内部文件剪贴板，粘贴后复制                       |
| 粘贴                   | 粘贴到当前目录；重名时提供「保留两者 / 替换 / 跳过」 |
| 重命名                 | 内联重命名，保留扩展名选中                           |
| 添加到对话             | 把文件作为上下文附件加入输入卡                       |
| 在文件资源管理器中显示 | `shell.showItemInFolder`（远程工作区禁用并提示）     |
| 复制路径               | 写入系统剪贴板，绝对路径                             |
| 复制相对路径           | 写入系统剪贴板，工作区相对路径（正斜杠）             |
| 删除                   | 二次确认后移入系统回收站（`shell.trashItem`）        |

空白区域右键：新建文件、新建文件夹、刷新、全部折叠、粘贴。

#### 3.1.4 文件剪贴板

- 内部剪贴板保存在主进程，记录 `mode: cut|copy`、源绝对路径、工作区根、时间戳。
- 切换工作区或远程目标时清空；剪切后源项显示半透明；粘贴成功后剪切状态清除。
- 路径全部经过 `WorkspacePathGuard`，阻止 `..`、符号链接逃逸与跨工作区移动。
- 禁止把目录粘贴到自身或子目录；删除默认走回收站，不提供永久删除快捷项。

#### 3.1.5 大纲

- 文件视图内可折叠区块「大纲」，位于文件树下方，默认折叠。
- 数据来源：
  - TS/JS：Monaco TypeScript Worker 的导航树（类、接口、函数、变量）；
  - Markdown：标题层级；
  - JSON：顶层键；
  - CSS/SCSS：选择器；
  - 其他语言：正则兜底或后续 LSP。
- 点击条目跳转到编辑器对应行并高亮；光标移动时高亮当前符号。
- 无活动编辑器时显示「打开文件后显示大纲」。

#### 3.1.6 时间线

- 文件视图内可折叠区块「时间线」，默认折叠，展示当前文件历史。
- 本地历史：用户保存、Agent 写入、外部修改检测时生成快照；按内容 hash 去重，单文件保留最近 50 条 / 30 天。
- 条目显示来源（用户 / Agent / 外部）、时间、大小；点击打开与当前文件的 Diff，可「恢复此版本」（恢复前二次确认并生成新快照）。
- Git 历史（第二阶段）：`git log -n 20 --follow -- <path>` 展示提交记录，点击查看提交 Diff。

### 3.2 搜索

- VS Code 风格搜索面板：
  - 搜索框 + 替换框；Aa 大小写、ab 全词、.* 正则、include/exclude glob、仅在打开文件中搜索。
  - 搜索范围默认工作区，遵守 `.gitignore`；可勾选「包含忽略文件」。
- 结果按文件分组，显示文件名、相对路径、命中数；展开显示行号、上下文片段、命中高亮；点击跳转编辑器并选中。
- 替换：
  - 单条替换、文件内全部替换、全局全部替换；
  - 替换前展示变更预览与文件数/命中数；应用前检查文件 mtime/hash，避免覆盖搜索后发生的修改；
  - 保留大小写选项；跳过二进制与超大文件。
- 交互：输入 300ms 防抖，结果流式返回（`searchId + seq`），可取消；上限默认 5000 条，超出提示收窄条件。
- 实现：主进程优先 `ripgrep --json`；未安装时回退内置递归搜索（慢，提示安装 rg）。`-g` 处理 include/exclude，`--max-filesize` 限制。

### 3.3 编辑器

> 已确认：P2 直接交付可编辑、保存与冲突处理，不只做只读预览。

- 多标签：预览标签（斜体）与固定标签；关闭、全部关闭、未保存标记；重启恢复打开的标签（可选）。
- 可编辑：只读开关、Ctrl+S 保存、脏状态、编码 UTF-8、保留原换行符；保存前校验文件未被外部修改，冲突时提示「覆盖 / 重新加载 / 另存」。
- Monaco：
  - 支持语言、主题、字体大小、wordWrap、minimap 设置（复用现有设置项）；
  - 右侧/顶部显示文件路径、大小、只读/可编辑状态；
  - 图片文件提供只读预览（png/jpg/svg/webp），二进制文件提示不可编辑。
- 右键菜单新增「添加到对话」：
  - 有选区：附带文件相对路径、起止行列与选中文本；
  - 无选区：附带当前文件；
  - 加入输入卡上下文 chips，可移除；发送时作为上下文附件传给主进程。
- Git 与时间线使用 Monaco DiffEditor 打开只读 Diff 标签。
- 文件被删除/重命名时标签同步更新或提示关闭。

### 3.4 审计

- 顶部统计卡：总调用数、成功/失败、审批通过/拒绝、时间范围。
- 筛选：
  - 范围：当前会话 / 全部；
  - 工具、结果（成功/失败）、审批状态（免审批/已批准/已拒绝）、关键字；
  - 时间范围（今天/7 天/自定义）；
  - 分页或无限滚动，默认 50 条/页。
- 列表：时间、工具、审批、结果摘要、会话；失败与拒绝使用危险色。
- 点击条目打开详情抽屉：完整参数摘要、结果、runId、callId、会话、耗时；支持复制。
- 实时模式：运行中自动追加新审计条目；可暂停。
- 导出当前筛选结果为 JSON / CSV。
- 主进程增加 `audit:query`（筛选、分页）与 `audit:stats`，现有 `audit:list` 保留兼容。

### 3.5 源代码管理

- 依赖系统 `git`；未安装时面板提示安装并禁用操作。
- 顶部：
  - 当前分支选择器（切换/新建分支）；
  - 提交信息输入框 +「提交」按钮（提交已暂存变更）；
  - 「全部暂存并提交」次级操作；
  - ahead/behind 状态。
- 变更区：
  - 已暂存 / 未暂存 / 未跟踪分组；
  - 文件操作：暂存、取消暂存、放弃更改（二次确认）、打开 Diff、在资源管理器中显示；
  - 冲突文件标记与「打开合并视图」（第一阶段只读展示冲突，后续提供接受当前/传入）。
- 底部操作栏：刷新、拉取、推送、发布分支、更多（初始化仓库、添加远程、查看输出）。
- 拉取默认 `--ff-only`；推送不提供 force；发布分支 = `push -u origin <branch>`。
- Git 输出面板显示最近命令与错误，敏感信息不打印。
- 全部操作经主进程 `GitService`，参数数组调用 `spawn('git', args)`，不经过 shell，不使用 `--no-verify`。
- 凭据交给系统 Git Credential Manager；应用不保存 Git token。

### 3.6 扩展安装

> 已确认：第一阶段按「第一层」交付；Extension Host 第二层延后，不在本次实施范围。

分两层能力，避免承诺无法实现的「完整 VS Code 扩展兼容」：

#### 第一层（本期目标）

- 原生扩展包：`yocim-extension.json` 清单，支持声明式贡献：命令、菜单、快捷键、语言、语法高亮、代码片段、主题变量。
- 安装来源：
  - 本地文件夹；
  - `.vsix` 包（解压读取 `package.json` 贡献）；
  - 从 VS Code 扩展目录导入（默认 `%USERPROFILE%\.vscode\extensions`）。
- 扩展列表：名称、版本、发布者、启用/禁用、卸载、详情、兼容性标记。
- VS Code 扩展按清单扫描结果标记：
  - 「仅声明式」：只有 languages/snippets/themes/grammars，可导入；
  - 「部分兼容」：包含命令/菜单等可映射贡献；
  - 「不兼容」：依赖 `main`/`browser` 运行时代码或未支持的 API。
- 不执行未受信任扩展的 Node 代码。

#### 第二层（后续，本期不实施）

- 独立 Extension Host 子进程 + 受限 `vscode` API 兼容层（commands、window、workspace.fs、StatusBarItem 等白名单）。
- 仅允许签名或用户显式信任的扩展运行代码。
- 不实现完整 VS Code API、调试扩展、语言服务器自动安装。

### 3.7 运行和调试

> 已确认：首个调试语言只做 Node.js；DAP 架构预留 Python/Go 等后续适配器。

- 视图包含：运行配置、任务、调试工具栏、变量、监视、调用堆栈、断点、输出/调试控制台。
- 配置文件：工作区 `.yocim/launch.json` 与 `.yocim/tasks.json`，JSON Schema 校验；支持变量 `${workspaceFolder}`、`${file}`、`${env:NAME}`。
- 第一阶段运行：
  - 执行 `package.json` scripts（npm/pnpm/yarn 自动识别）；
  - 自定义 shell 任务（需首次确认命令）；
  - 输出流式写入面板，可停止。
- 第一阶段调试：
  - Node.js：DAP 客户端 + js-debug 适配器（或自研 CDP 适配器，实施前做一次技术选型 spike）；
  - 断点在 Monaco glyph margin 设置，支持条件断点；
  - 调试控制：继续、暂停、单步跳过/进入/跳出、重启、停止；
  - 变量树、监视表达式、调用堆栈、作用域；
  - 当前执行行在编辑器中高亮。
- 后续通过 DAP 接入 Python（debugpy）、Go（dlv）等，避免为每种语言重写 UI。
- 安全：启动配置可执行任意程序，首次运行展示完整命令并要求确认；不把环境变量密钥写入日志。

### 3.8 远程管理器

> 已确认：WSL 先行，SSH 后置；WSL 作为第一个可用远程 provider，SSH 在 P5b 交付。

- 目标列表：WSL 发行版、SSH 主机、最近连接的工作区；显示连接状态与最后错误。
- 新增/编辑目标：
  - WSL：发行版 + 路径；
  - SSH：host、port、user、认证方式（ssh-agent / 私钥 / 密码）、远端路径；
  - 密码/私钥口令经 `safeStorage` 加密，renderer 不可读取。
- WSL（优先实现）：
  - `wsl.exe -l -q` 枚举发行版；
  - 文件访问使用 `\\wsl.localhost\<distro>\<path>` UNC 路径；
  - 命令通过 `wsl.exe -d <distro> --cd <path> -- <command>`；
  - Git/搜索/运行优先使用 WSL 内工具链。
- SSH（第二阶段）：
  - 优先复用系统 OpenSSH（agent/key/known_hosts），或使用 `ssh2` 实现 SFTP + exec；
  - 首次连接展示 host key 指纹并要求确认；
  - 文件读写/列目录走 SFTP；搜索、Git、运行命令走远端 exec；
  - 可选部署轻量 `yocim-agent` 以获得流式搜索与文件监听；
  - 远程调试/扩展安装放到后续阶段。
- 远程工作区抽象为 `WorkspaceProvider`，文件、搜索、Git、运行、Agent 工具逐步迁移；第一阶段远程仅支持浏览、编辑、搜索、Git 与运行，Agent 工具仍限定本地工作区，并在 UI 明确提示。

## 4. 后端架构

### 4.1 WorkspaceProvider（远程前置改造）

```ts
interface WorkspaceProvider {
  id: string
  kind: 'local' | 'wsl' | 'ssh'
  root: string
  displayName: string
  listDir(relativePath: string): Promise<FsEntry[]>
  readFile(relativePath: string): Promise<FileReadResult>
  writeFile(relativePath: string, content: string): Promise<void>
  mkdir(relativePath: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  delete(relativePath: string, options: { trash: boolean }): Promise<void>
  search(query: SearchQuery): AsyncIterable<SearchEvent>
  git(args: string[]): Promise<GitResult>
  exec(command: string, options: ExecOptions): Promise<ExecResult>
}
```

- 现有 `WorkspaceService` / `WorkspacePathGuard` 包装为 `LocalWorkspaceProvider`，保持现有安全校验。
- Agent 工具通过 provider 访问工作区；远程 provider 完成后，Agent 才可操作远程文件。

### 4.2 新增主进程服务

| 服务                           | 职责                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `FileExplorerService`          | 懒加载目录、新建、重命名、复制/移动、删除、回收站、内部剪贴板   |
| `SearchService`                | ripgrep 封装、流式结果、取消、替换与冲突校验                    |
| `GitService`                   | status/log/diff/branches/stage/commit/pull/push/publish/discard |
| `TimelineService`              | 文件快照、去重、保留策略、Diff 数据、恢复                       |
| `ExtensionService`             | 扩展安装/卸载/启停、VSIX/VS Code 导入、清单解析、兼容性判断     |
| `DebugService`                 | 启动配置、任务执行、DAP 客户端、断点与调试会话                  |
| `RemoteService`                | WSL/SSH 目标、连接、凭据、provider 生命周期                     |
| `OutlineService`（可选主进程） | 非 Monaco 语言的符号提取，后续 LSP 接入                         |

### 4.3 IPC 与 preload

新增命名空间（均沿用 senderFrame 校验、zod 与 `IpcResult`）：

- `fs:listDir`、`fs:createFile`、`fs:createFolder`、`fs:rename`、`fs:copy`、`fs:move`、`fs:delete`、`fs:reveal`、`fs:clipboard`
- `search:start`、`search:cancel`、`search:event`、`search:replace`
- `git:status`、`git:diff`、`git:branches`、`git:stage`、`git:unstage`、`git:commit`、`git:pull`、`git:push`、`git:publish`、`git:discard`、`git:log`
- `timeline:list`、`timeline:read`、`timeline:restore`
- `extensions:list`、`extensions:install`、`extensions:uninstall`、`extensions:setEnabled`、`extensions:importVscode`
- `debug:configs`、`debug:start`、`debug:stop`、`debug:breakpoints`、`debug:event`、`debug:evaluate`
- `remote:targets`、`remote:listWsl`、`remote:connect`、`remote:disconnect`

### 4.4 数据模型（DB v3）

```sql
CREATE TABLE file_history (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  source TEXT NOT NULL,          -- user | agent | external
  snapshot_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_file_history_path ON file_history(workspace_root, relative_path, created_at);

CREATE TABLE remote_targets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- wsl | ssh
  name TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  auth_type TEXT,
  secret_encrypted TEXT,
  workspace_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE extensions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- local | vsix | vscode
  manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  compatible INTEGER NOT NULL,
  installed_at INTEGER NOT NULL
);
```

- 迁移使用 `PRAGMA user_version`，v2 → v3 前备份 `.bak-v2`。
- 文件快照内容存 `userData/timeline/<workspaceHash>/<pathHash>/<id>.txt`，DB 只存元数据。
- 扩展二进制/语言包存 `userData/extensions/<id>/`。

## 5. 对话上下文附件（支撑「添加到对话」）

```ts
interface ContextAttachment {
  id: string
  type: 'file' | 'selection'
  relativePath: string
  content: string
  language?: string
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  truncated?: boolean
}
```

- 输入卡上方显示上下文 chips（文件名 + 行号），可单独移除、全部清除。
- `chat.send` 增加 `attachments` 字段（max 10，单文件 64KB，总 200KB，超出截断并标记）。
- 主进程把附件拼入本轮用户消息的上下文区，不改变历史消息存储结构；消息持久化仍只存用户原始文本 + 附件摘要。
- 文件树「添加到对话」与编辑器选区右键共用同一套附件模型。

## 6. 安全边界

- 所有文件路径经 provider/pathGuard 校验；删除默认进回收站；批量删除显示明确数量。
- Git 不使用 shell、不提供 force push、不跳过 hooks；放弃更改/删除分支需二次确认。
- Git 凭据交给系统凭据管理器；远程密码/口令用 `safeStorage`，renderer 仅拿 `hasSecret`。
- SSH 首次连接验证 host key；已知主机指纹变化时阻断并提示。
- 扩展默认不执行代码；第二层 Extension Host 使用独立子进程与白名单 API。
- 调试启动配置可执行任意程序，首次运行显示完整命令并要求确认；不记录密钥环境变量。
- 搜索/替换应用前校验文件 hash，避免覆盖并发修改。
- 远程工作区中 Agent 工具暂不开放，避免审批/路径语义不清。

## 7. 状态持久化

| Key                          | 内容                         |
| ---------------------------- | ---------------------------- |
| `yocim.ui.workspaceView`     | 当前活动视图（8 选 1）       |
| `yocim.ui.workspaceSections` | 大纲/时间线折叠状态          |
| `yocim.ui.editorTabs`        | 打开的标签与激活文件（可选） |
| `yocim.ui.searchOptions`     | 搜索选项                     |
| `yocim.ui.gitPanel`          | 分组折叠状态                 |
| `yocim.ui.remoteTarget`      | 最近连接目标                 |

## 8. 实施阶段

### P0：活动栏与视图骨架

- 右侧文字 Tab 替换为图标活动栏（8 个视图），保留现有文件/编辑器/审计功能。
- 视图切换、选中态、tooltip、活动视图持久化、面板拖动调宽回归。
- 验收：8 个图标可切换；现有功能不回退；1024/1280/1440 无溢出。

### P1：文件资源管理器

- 懒加载文件树、默认全折叠、文件图标、单击预览/双击固定。
- 新建文件/文件夹、刷新、全部折叠、内部剪贴板、右键菜单全部条目。
- 删除进回收站；文件/目录重命名与粘贴冲突处理。
- 大纲与时间线折叠区块、本地历史快照与 Diff/恢复。
- 上下文附件基础能力：文件「添加到对话」、附件 chips、发送链路。
- 验收：全部文件操作单测 + e2e；删除可从回收站恢复；默认折叠；时间线可恢复。

### P2：搜索替换与编辑器体验

- 搜索/替换面板、ripgrep 流式结果、取消、include/exclude、大小写/全词/正则。
- 替换预览、hash 冲突检测、单条/文件/全局替换。
- 多标签、预览标签、可编辑与保存、外部修改冲突处理（已确认：本阶段直接交付可编辑）。
- 编辑器选区右键「添加到对话」。
- 验收：搜索大仓库不卡 UI；文件可编辑保存且冲突可处理；替换可回滚（时间线快照）；选区附件正确进入消息。

### P3：审计与源代码管理

- 审计筛选、统计、详情、导出、实时模式。
- Git 面板：状态、暂存/取消暂存、提交、拉取、推送、发布分支、刷新、Diff、分支切换、放弃更改。
- 验收：临时 Git 仓库 e2e 覆盖暂存→提交→分支→Diff；冲突与错误可读；系统 Git 缺失时给出安装提示。

### P4：运行调试与扩展

- 运行 npm scripts/任务、输出面板、停止。
- Node.js 调试（已确认首个且本期唯一语言）：DAP/CDP 选型、断点、单步、变量、调用堆栈、监视。
- 扩展管理器第一层（已确认本期范围）：本地/VSIX/VS Code 导入、启停/卸载、兼容性标记、声明式贡献；Extension Host 延后。
- 验收：Node 脚本断点命中与变量查看；安装本地示例扩展后命令/片段生效；VS Code 扩展显示兼容性分级；不兼容扩展明确提示且不执行代码。

### P5a：WSL 远程（先行）

- WSL 枚举、连接、UNC 路径文件树、WSL 内 Git/搜索/运行。
- `WorkspaceProvider` 抽象与本地/WSL provider 落地，文件/搜索/Git/运行迁移。
- 验收：WSL 工作区完整浏览、编辑、搜索与 Git；断线/发行版不存在时错误可读。

### P5b：SSH 远程（后置）

- SSH 目标管理、host key 校验、SFTP 文件、远端 exec 搜索/Git/运行。
- 优先复用系统 OpenSSH；必要时引入 `ssh2` 处理 SFTP。
- 验收：SSH 连接成功并可浏览编辑、搜索、Git；主机指纹变化时阻断；断线重连可用。

### P6：回归与交付

- 全量 typecheck/lint/test/build/e2e；更新 README、实现文档与截图。
- 性能检查：大目录懒加载、搜索结果上限、Monaco 多标签内存。
- 发布包体积与依赖检查：打包 ripgrep、系统 Git 检测提示、Node 调试适配器与 SSH 依赖（如启用）。

## 9. 测试计划

- 单测：
  - 文件操作路径守卫、复制/移动冲突、内部剪贴板；
  - 搜索参数构造、ripgrep JSON 解析、替换冲突；
  - Git porcelain v2 解析、错误映射、危险操作保护；
  - 时间线去重/保留策略/Diff；
  - 扩展清单解析与 VS Code 兼容性判断；
  - 调试配置 schema、DAP 消息序列；
  - WSL/SSH provider mock（路径映射、exec 参数、断线）。
- e2e：
  - 活动栏 8 视图切换与持久化；
  - 文件树默认折叠、新建/重命名/复制/粘贴/删除/添加到对话；
  - 搜索替换命中、跳转、全局替换；
  - 编辑器多标签、保存、选区添加对话；
  - 审计筛选与详情；
  - 临时 Git 仓库完整流程；
  - Node 运行与断点调试；
  - 本地示例扩展安装与启用；
  - WSL（Windows 环境存在时）连接与文件浏览。

## 10. 依赖与技术选型

| 能力        | 方案                     | 说明                                                    |
| ----------- | ------------------------ | ------------------------------------------------------- |
| 搜索        | `ripgrep` 二进制         | 已确认打包到 resources（约 +2–4MB），缺失时回退 JS 搜索 |
| SSH/SFTP    | 系统 OpenSSH（优先）     | 已确认 SSH 后置；必要时用 `ssh2` 补齐 SFTP              |
| VSIX 解压   | `yauzl`                  | 仅读取清单与声明式资源                                  |
| launch.json | `jsonc-parser`           | 支持注释与错误定位                                      |
| 调试协议    | DAP + `vscode-jsonrpc`   | 已确认 Node.js 为唯一首期语言，架构预留 Python/Go       |
| 符号大纲    | Monaco Worker + 正则兜底 | 后续可接 LSP                                            |
| Git         | 系统 `git`               | 已确认依赖用户已安装 Git；启动时检测并提示              |
| 扩展兼容    | 清单扫描 + 声明式贡献    | 已确认第一层方案；第二层 Extension Host 延后            |

## 11. 风险与对策

| 风险                     | 影响                   | 对策                                             |
| ------------------------ | ---------------------- | ------------------------------------------------ |
| 范围过大                 | 长期无法交付           | 按 P0–P6 分阶段，每阶段独立可用                  |
| VS Code 扩展兼容预期过高 | 用户认为「装了就能用」 | 明确兼容性分级，第一层只支持声明式贡献           |
| 远程 SSH 复杂度          | 连接/凭据/断线问题     | WSL 先行；SSH 复用系统 OpenSSH；限定第一阶段能力 |
| 删除/覆盖造成数据丢失    | 用户文件损失           | 回收站、二次确认、时间线快照、替换前 hash 校验   |
| Git 破坏性操作           | 代码丢失               | 不提供 force push；放弃更改二次确认；操作日志    |
| 大仓库搜索卡顿           | UI 假死                | 流式结果 + 上限 + 取消 + 主进程执行              |
| 调试适配器分发/许可      | 无法内置               | 实施前做 js-debug / CDP 选型 spike               |
| 面板 8 图标拥挤          | 可用性差               | 26px 图标、横向滚动、tooltip、快捷键             |
| Monaco 多标签内存        | 性能下降               | 限制标签数、按需销毁 model、复用 worker          |

## 12. 非目标（本计划内）

- 不实现完整 VS Code Extension API 与扩展市场在线安装；
- 不内置终端面板（运行输出先使用只读输出面板）；
- 不实现多根工作区与多窗口；
- 不实现远程调试、远程扩展安装（后续阶段）；
- 不实现 Git 图形化合并编辑器（第一阶段只读冲突展示）；
- 不改变 Agent 工具的安全语义，也不在远程工作区开放 Agent 工具。

## 13. 已确认决策（2026-11-15）

| 决策     | 结论                 | 落地影响                                                                      |
| -------- | -------------------- | ----------------------------------------------------------------------------- |
| 编辑器   | **是**               | P2 直接交付可编辑、保存、脏状态、外部修改冲突处理与多标签                     |
| 扩展兼容 | **是，第一层**       | 本期只做本地/VSIX/VS Code 导入 + 声明式贡献 + 兼容性分级；Extension Host 延后 |
| 调试语言 | **是，仅 Node.js**   | P4 只交付 Node.js 调试；DAP 架构预留 Python/Go                                |
| 远程顺序 | **是，WSL 先行**     | P5a WSL，P5b SSH；`WorkspaceProvider` 先本地/WSL，再 SSH                      |
| 搜索依赖 | **是，打包 ripgrep** | 安装包增加约 2–4MB；保留 JS 回退                                              |
| Git 依赖 | **是，系统 Git**     | 启动检测 `git --version`；缺失时禁用 Git 视图并提示安装                       |

### 下一步

从 **P0：活动栏与视图骨架** 开始实施：

1. 右侧文字 Tab 改为 8 图标活动栏；
2. 视图路由、选中态、tooltip、持久化；
3. 保留现有文件/编辑器/审计功能与面板拖动调宽；
4. 完成后按阶段验收再进入 P1。
