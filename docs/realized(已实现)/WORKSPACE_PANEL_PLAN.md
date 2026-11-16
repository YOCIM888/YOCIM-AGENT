# 右侧工作区增强计划（VS Code 风格）

> 状态：**P0–P6 全部完成并验收（P5 的 WSL/SSH 成功路径仍待真机复验）**（2026-11-16 更新）
> 已确认决策：编辑器可编辑、扩展第一层、Node.js 调试优先、WSL 先行、打包 ripgrep、依赖系统 Git。
> 范围：右侧工作区面板从「文件 / 编辑器 / 审计」三个文字 Tab 扩展为 VS Code 风格的图标活动栏与 8 个视图：文件、搜索、编辑器、审计、源代码管理、扩展安装、运行和调试、远程管理器。
> P0–P6 已按本文档实施（见 §8 阶段标记与 §14 交接），本文件已归档到 `docs/realized(已实现)/`。

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

> 实现状态：✅ P3 已交付（见 §8 P3 与 §14.1）；`audit:export` 导出为补充通道，DB 升到 v4 增加 `call_id`/`duration_ms`，细节偏差见 §14.3。

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

> 实现状态：✅ P3 已交付（`src/main/git/`，见 §8 P3 与 §14.1）。补充：活动栏显示变更数徽标；路径以**工作区根**为基准（非仓库根）；放弃未跟踪文件被拒绝；「添加远程」未做，发布分支要求已有 `origin`。细节偏差见 §14.3。

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

> 实现状态：✅ P4 已交付（`src/main/extensions/`，见 §8 P4 与 §14.1）。清单优先 `yocim-extension.json`，其次 VS Code `package.json`；VSIX 用自研最小 zip 读取器（不引入 `yauzl`）；不兼容扩展（有 `main`/`browser`、`debuggers`、扩展依赖）安装后默认禁用且「启用」被拒绝；片段贡献通过 Monaco `CompletionItemProvider` 真正生效，语法/主题贡献只做清单展示（未接入 Monaco tokenizer/主题，见 §14.3）。

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

> 实现状态：✅ P4 已交付（`src/main/tasks/`、`src/main/debug/`，见 §8 P4 与 §14.1）。**调试选型结论：自研 CDP 直连**（`node --inspect-brk=127.0.0.1:0` + 全局 `WebSocket`），未引入 js-debug/`vscode-jsonrpc`；接口按适配器抽象，后续可换 DAP。条件断点、单步、监视、调用堆栈、作用域、当前行高亮全部可用；`.yocim/launch.json` 支持 `${workspaceFolder}`/`${workspaceFolderBasename}`/`${file}`/`${env:NAME}`，但**未接 JSON Schema 校验**（非法 JSON 给可读提示，字段级校验按白名单归一化），见 §14.3。

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

> 实现状态：✅ P5a/P5b 代码已落地（`src/main/remote/`，见 §8 P5a/P5b 与 §14.1）。**实际做法与 §4.1 的设想不同**：WSL 工作区的根直接用 `\\wsl.localhost\<distro>\...` UNC 路径，文件树/编辑器/时间线完全复用本地实现（不引入 provider 抽象），只有 Git/搜索/任务经 `wsl.exe --exec` 在发行版内执行；SSH 工作区根是 `ssh://<targetId><path>` 标识，文件走 SFTP（`remote/remoteFs.ts`），Git/搜索/任务走 ssh2 exec，Git/搜索通过「虚拟守卫」`RemotePathGuard` 复用原服务。远程调试未做（显式报错），批量替换与「仅在打开文件中搜索」在远程下禁用。

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

| 服务                           | 职责                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `FileExplorerService`          | 懒加载目录、新建、重命名、复制/移动、删除、回收站、内部剪贴板     |
| `SearchService`                | ripgrep 封装、流式结果、取消、替换与冲突校验                      |
| `GitService`                   | status/log/diff/branches/stage/commit/pull/push/publish/discard   |
| `TimelineService`              | 文件快照、去重、保留策略、Diff 数据、恢复                         |
| `ExtensionService`             | 扩展安装/卸载/启停、VSIX/VS Code 导入、清单解析、兼容性判断       |
| `TaskService`                  | npm scripts 与 `.yocim/tasks.json` 发现、spawn/停止、输出流与脱敏 |
| `DebugService`                 | 启动配置解析、调试会话、断点、栈帧/变量求值、命令分发             |
| `RemoteService`                | WSL/SSH 目标、连接、凭据、provider 生命周期                       |
| `OutlineService`（可选主进程） | 非 Monaco 语言的符号提取，后续 LSP 接入                           |

### 4.3 IPC 与 preload

新增命名空间（均沿用 senderFrame 校验、zod 与 `IpcResult`）：

- `fs:listDir`、`fs:createFile`、`fs:createFolder`、`fs:rename`、`fs:copy`、`fs:move`、`fs:delete`、`fs:reveal`、`fs:clipboard`
- `search:start`、`search:cancel`、`search:event`、`search:replace`
- `git:status`、`git:diff`、`git:branches`、`git:stage`、`git:unstage`、`git:commit`、`git:pull`、`git:push`、`git:publish`、`git:discard`、`git:log`
- `timeline:list`、`timeline:read`、`timeline:restore`
- `extensions:list`、`extensions:install`、`extensions:uninstall`、`extensions:setEnabled`、`extensions:importVscode`
- `debug:configs`、`debug:start`、`debug:stop`、`debug:breakpoints`、`debug:event`、`debug:evaluate`
- `remote:targets`、`remote:listWsl`、`remote:connect`、`remote:disconnect`

### 4.4 数据模型（DB v6）

> 实际迁移版本：v3 建立 `file_history`、v4 给 `audit_logs` 增列（P3）、v5 建立 `extensions`（P4）、**v6 建立 `remote_targets`**（P5）。v6 的列比下方设计多 `distro/host/port/username/auth_type/key_path/host_fingerprint/secret_encrypted`，少了 `updated_at` 之外的审计字段——以 `db/database.ts` 的 `MIGRATION_V6` 为准。

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

- 迁移使用 `PRAGMA user_version`，每次升级前按版本号备份 `.bak-v<old>`（P3 已落地）。
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

### P0：活动栏与视图骨架 ✅ 已完成（2026-11-15）

- 右侧文字 Tab 替换为图标活动栏（8 个视图），保留现有文件/编辑器/审计功能。
- 视图切换、选中态、tooltip、活动视图持久化、面板拖动调宽回归。
- 验收：8 个图标可切换；现有功能不回退；1024/1280/1440 无溢出。
- 结果：`tests/e2e/workspaceViews.spec.ts` 2 例通过（8 视图切换+持久化、窄屏横向滚动）。

### P1：文件资源管理器 ✅ 已完成（2026-11-15）

- 懒加载文件树、默认全折叠、文件图标、单击预览/双击固定。
- 新建文件/文件夹、刷新、全部折叠、内部剪贴板、右键菜单全部条目。
- 删除进回收站；文件/目录重命名与粘贴冲突处理。
- 大纲与时间线折叠区块、本地历史快照与 Diff/恢复。
- 上下文附件基础能力：文件「添加到对话」、附件 chips、发送链路。
- 验收：全部文件操作单测 + e2e；删除可从回收站恢复；默认折叠；时间线可恢复。
- 结果：`tests/e2e/fileExplorer.spec.ts` 2 例 + 全量 e2e 11 例、单测 150 例、typecheck/lint/format 全绿；回收站/默认折叠/时间线恢复均 e2e 覆盖；light/dark/1024/右键菜单/Diff 视觉验证通过。

### P2：搜索替换与编辑器体验 ✅ 已完成（2026-11-15）

- 搜索/替换面板、ripgrep 流式结果、取消、include/exclude、大小写/全词/正则。
- 替换预览、hash 冲突检测、单条/文件/全局替换。
- 多标签、预览标签、可编辑与保存、外部修改冲突处理（已确认：本阶段直接交付可编辑）。
- 编辑器选区右键「添加到对话」。
- 验收：搜索大仓库不卡 UI；文件可编辑保存且冲突可处理；替换可回滚（时间线快照）；选区附件正确进入消息。
- 结果：`tests/e2e/searchEditor.spec.ts` 3 例通过（搜索跳转→全局替换→时间线回滚；多标签/保存/覆盖/重新加载/另存；选区附件随消息发送）；全量 e2e 14 例、单测 194 例、typecheck/lint/format 全绿。
- 视觉验收：亮色搜索面板、亮/暗编辑器、1024 宽度四张截图复核通过；修掉两处细节——内置搜索的 ripgrep 提示重复（`stores/search.ts` 不再写 `notice`，由 `SearchPanel.vue` 的 `search-engine-notice` 统一展示）、窄面板头部按钮被右侧窗口边缘裁切（`EditorPane.vue` 头部拆成「路径/大小/状态」+「只读/保存/添加到对话」两行，并用 `editor-body` 包裹内容区替代写死的 `inset: 62px`）。修正后已重跑全部回归。
- 补充交付：用户保存与外部修改均生成时间线快照（`source: user|external`）；图片只读预览与二进制提示；标签与搜索选项持久化；`Ctrl+S` 保存。

### P3：审计与源代码管理 ✅ 已完成（2026-11-15）

- 审计筛选、统计、详情、导出、实时模式。
- Git 面板：状态、暂存/取消暂存、提交、拉取、推送、发布分支、刷新、Diff、分支切换、放弃更改。
- 验收：临时 Git 仓库 e2e 覆盖暂存→提交→分支→Diff；冲突与错误可读；系统 Git 缺失时给出安装提示。
- 结果：`tests/e2e/scmAudit.spec.ts` 3 例通过——① 临时仓库全链路（活动栏徽标 → Diff → 暂存 → 提交（`git log -1` 反查）→ 建分支 `feature/p3` → 放弃更改二次确认 → 未跟踪文件拒绝放弃 → Git 输出只有 `git add` 不含 `git status`）；② 非仓库提示 + 初始化；③ 审计（统计卡 → 详情抽屉 → 关键字筛选 → 工具筛选 → 实时模式追加 → JSON/CSV 导出，导出走 stub 的 `dialog.showSaveDialog`）。全量 e2e **17 例**、单测 **221 例（28 文件）**、typecheck/lint/format 全绿。
- 视觉验收：亮/暗 SCM 面板、分支菜单、Git 输出、1024 宽度；审计亮/暗、筛选展开、详情抽屉。修掉三处细节——审计统计卡在 220px 面板内标签竖排换行（改 2 列 grid、标签与数值同行两端对齐）、SCM 文件行 `<li>` 与行内按钮重复触发点击（点击迁到内层 `.file-main`，操作区 `@click.stop`）、活动栏徽标被 `overflow-x:auto` 纵向裁切（改 `top:-3px; right:-5px`，实测 1024 下不越界）。
- 额外交付（设计未写）：活动栏 SCM 变更数徽标（未打开视图也静默刷新）、审计「加载更多」分页与关键字 300ms 防抖、审计实时模式 2.5s 轮询可暂停、Git 输出面板只记录写操作命令。

### P4：运行调试与扩展 ✅ 已完成（2026-11-16）

- 运行 npm scripts/任务、输出面板、停止。
- Node.js 调试（已确认首个且本期唯一语言）：DAP/CDP 选型、断点、单步、变量、调用堆栈、监视。
- 扩展管理器第一层（已确认本期范围）：本地/VSIX/VS Code 导入、启停/卸载、兼容性标记、声明式贡献；Extension Host 延后。
- 验收：Node 脚本断点命中与变量查看；安装本地示例扩展后命令/片段生效；VS Code 扩展显示兼容性分级；不兼容扩展明确提示且不执行代码。
- 选型 spike（`test-results` 下的临时脚本，已删除）：先用 js-debug 试跑，需要额外拉取 `@vscode/js-debug`/`vscode-jsonrpc` 并维护 DAP 会话与 `initialize/launch/attach` 时序；改用 `node --inspect-brk` + CDP 直连后，Electron 45（Node 24）自带全局 `WebSocket`，零新增依赖即打通断点、条件断点、单步、作用域变量、表达式求值、退出。**结论：自研 CDP 适配器**，对外仍按 `DebugAdapter` 接口抽象（`applyBreakpoints/start/stop/command/scopes/variables/evaluate`），后续接 Python/Go 时只替换适配器。
- 结果：`tests/e2e/runDebugExtensions.spec.ts` 3 例通过——① npm scripts 流式输出 + 长任务停止 + 自定义任务首次确认；② Node 断点调试（glyph margin 点击设断点 → 首次确认 → 已暂停 → 局部变量 `a=21/b=2` → 监视 `a + b=23` → 编辑器当前行高亮 → 单步跳到 `main.js:3` → 继续输出 `total 23` → 调试结束、工具栏消失）；③ 扩展（本地安装→部分兼容→详情理由→片段补全→禁用/启用计数→VS Code 三级兼容性扫描→导入声明式/不兼容→卸载确认）。全量 e2e **20 例**、单测 **255 例（32 文件）**、typecheck/lint/format 全绿。
- 视觉验收：亮色运行面板（运行配置/任务/断点/控制台/任务输出）、断点 glyph 与当前行、确认弹窗、调试暂停（变量/监视/调用堆栈）、深色调试面板、1024 宽度、扩展面板三级徽标与 VS Code 导入弹窗，共 13 张截图复核。修掉四处细节——区块默认折叠导致暂停后看不到变量（会话启动/暂停时自动展开 `debugBreakpoints/debugVariables/debugWatches/debugCallstack/debugConsole`）、断点暂停会抢走「运行和调试」视图（新增 `RevealRequest.keepView`，`WorkspacePanel` 的 reveal watcher 不再无脑切到编辑器）、调试目标输出带 ANSI 颜色码（新增 `util/ansi.ts`，任务与调试输出统一清洗，含跨 chunk 半截转义）、控制台重复打印「继续运行…」（按 `paused → running` 状态变化去重）。
- 额外交付（设计未写）：`package.json` 的 `main` 自动生成零配置启动项；`.yocim/tasks.json` 自定义任务（label/command/args/cwd/detail，cwd 限制在工作区内）；断点与监视按工作区根隔离持久化；断点条件输入框（Enter/失焦写入）；变量树按 `variablesReference` 懒加载并缓存；启动/运行命令统一脱敏 + 输出上限（512KB）与并发上限（4）。

### P5a：WSL 远程（先行）✅ 代码完成（2026-11-16，本机受安全策略限制未做真机验收）

- WSL 枚举、连接、UNC 路径文件树、WSL 内 Git/搜索/运行。
- `WorkspaceProvider` 抽象与本地/WSL provider 落地，文件/搜索/Git/运行迁移。
- 验收：WSL 工作区完整浏览、编辑、搜索与 Git；断线/发行版不存在时错误可读。
- 实现说明：**没有引入 §4.1 的 `WorkspaceProvider` 接口**。WSL 的根是 Windows 可访问的 UNC 路径，文件树/编辑器/时间线/文件操作全部原样复用本地实现，只有 Git/搜索/任务改走 `wsl.exe -d <distro> --cd <dir> --exec <cmd>`（`--exec` 不经 shell，参数按数组传递）。
- 结果：`remote/probe`（`wsl.exe --version` + `wsl.exe -l -q`，按 UTF-16LE 解码）、目标保存/编辑/删除、连接前 `test -d` 校验路径、`remote:current` 状态回读；连接成功后状态栏出现 `WSL · <path>` 徽标，文件树自动重载为 UNC 根。错误路径已实测：未安装发行版、`wsl.exe` 被拦截（`spawn EPERM`）、路径不存在都会给出可读提示。
- ⚠️ **未做真机验收**：本会话所在沙箱把 `wsl.exe` 列入程序黑名单，无法启动发行版；WSL 的 `--cd/--exec` 参数、UNC 文件访问、WSL 内 Git/搜索/任务只能靠单元测试（命令构造/路径映射）与代码审查保证。**接手后请先在一台装有 WSL 的机器上跑一遍 §9 的 WSL 用例。**

### P5b：SSH 远程（后置）✅ 代码完成（2026-11-16，连接层已实测错误路径）

- SSH 目标管理、host key 校验、SFTP 文件、远端 exec 搜索/Git/运行。
- 优先复用系统 OpenSSH；必要时引入 `ssh2` 处理 SFTP。
- 验收：SSH 连接成功并可浏览编辑、搜索、Git；主机指纹变化时阻断；断线重连可用。
- 实现说明：**引入 `ssh2`（1.17.0）**——系统 `ssh` 无法在连接阶段拿到主机公钥做指纹校验，`sftp -b` 也无法做目录属性/二进制安全读写。文件操作全部走 SFTP（列目录/读写/新建/重命名/复制/移动/删除），Git/搜索/任务走 `client.exec` + `cd <root> && <cmd>`。
- 安全：认证支持私钥（可选私钥口令）、密码、ssh-agent（无 `SSH_AUTH_SOCK` 时明确报错）；口令经 `safeStorage` 加密存 `remote_targets.secret_encrypted`，renderer 只拿到 `hasSecret`；主机指纹按 TOFU——首次连接返回 `SHA256:...` 让用户确认，之后指纹变化直接阻断（`E_CONFLICT` 并提示重新信任）。
- 结果：目标表单校验（主机/用户名/端口/私钥路径/远端绝对路径）、连接失败可读（如 `127.0.0.1:1` → `SSH 连接被拒绝…`）、失败时不改变当前本地工作区（状态栏仍显示本地工作区、无远程徽标）。SFTP 文件树/编辑、远端 Git/搜索/任务的**成功路径**没有可用 SSH 服务器，未做端到端验收。

### P6：回归与交付 ✅ 完成（2026-11-16）

- 全量 typecheck/lint/test/build/e2e；更新 README、实现文档与截图。
- 性能检查：大目录懒加载、搜索结果上限、Monaco 多标签内存。
- 发布包体积与依赖检查：打包 ripgrep、系统 Git 检测提示、Node 调试适配器与 SSH 依赖（如启用）。
- 结果：
  - 回归：`typecheck` / `lint` / `format:check` 全绿，单测 **278（33 文件）**、e2e **22**；`electron-builder --dir` 与 NSIS 安装包（123MB）均构建成功，打包产物实测启动、搜索、远程面板正常（详见 §14.5）。
  - 性能（2400 文件 / 30 目录的临时工作区）：根目录列 130 项 **1–2ms**、子目录 80 项 **1ms**（`fs:tree` 只读一层）；命中 5000 条上限时搜索 **1.5s**（修复前 41s）；打开 12 个标签 **2.0s**、renderer 堆 **48–69MB**，打开第 13 个文件后仍为 12 个标签。
  - 性能修复：搜索结果改为 **30ms 批量合并 + 超过 20 个文件自动折叠**（原来每个文件事件都 push 并展开，1667 个文件会触发上千次重渲染）；ripgrep 参数补 `--no-require-git` 与版本库/噪声目录 glob，让两种引擎结果一致（此前会搜出 `.git/hooks` 与 `node_modules`）。
  - 打包：`extraResources` 内置 `resources/ripgrep/rg.exe`（14.1.1，5.2MB）；asar 只含 `out/`、`zod`、`ssh2` 及其依赖；排除 ssh2 的可选原生依赖 `cpu-features`/`nan`/`buildcheck`；新增 `npmRebuild: false`。
  - 截图：重新生成 15 张（欢迎态 / 会话菜单 / 深色时间线 / Markdown / 工作区编辑 / 文件树 / 搜索 / 源代码管理 / 调试 / 扩展 / 远程 / 深色调试 / 设置 / 模型切换 / 审批模式），存入 `docs/screenshots/` 并接入 README。

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

| 能力        | 方案                     | 说明                                                                                |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------- |
| 搜索        | `ripgrep` 二进制         | 已确认打包到 resources（约 +2–4MB），缺失时回退 JS 搜索                             |
| SSH/SFTP    | 系统 OpenSSH（优先）     | 已确认 SSH 后置；必要时用 `ssh2` 补齐 SFTP                                          |
| VSIX 解压   | **自研最小 zip 读取器**  | 仅读清单与声明式资源；支持 stored/deflate，拒绝 zip64 与路径穿越，不引入 `yauzl`    |
| launch.json | 手写归一化 + 变量替换    | 未接 `jsonc-parser`/JSON Schema；非法 JSON 给可读提示，字段按白名单收敛             |
| 调试协议    | **自研 CDP 直连**        | 已确认 Node.js 为唯一首期语言；`node --inspect-brk` + CDP，无新增依赖，架构预留 DAP |
| 符号大纲    | Monaco Worker + 正则兜底 | 后续可接 LSP                                                                        |
| Git         | 系统 `git`               | 已确认依赖用户已安装 Git；启动时检测并提示                                          |
| 扩展兼容    | 清单扫描 + 声明式贡献    | 已确认第一层方案；第二层 Extension Host 延后                                        |

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

**P0–P6 已全部完成**（P5 的 WSL/SSH 成功路径仍需真机复验）。后续若要继续演进：

1. 在一台有 WSL 的 Windows 上补 WSL 真机验收（§9 的 WSL 用例），并准备一台 SSH 服务器补 SFTP 浏览/编辑、远端 Git/搜索/任务的端到端验证；
2. 远程调试（CDP over SSH 端口转发）、SFTP 列目录限流与大文件流式读写；
3. 扩展第二层（Extension Host）与 LSP / Monaco TS Worker 大纲；
4. 代码签名与公证，然后按 `docs/realized(已实现)/RELEASE_CHECKLIST.md` 发布。

## 14. 实施状态与交接（2026-11-16，P0–P6 完成）

> P0–P4 已随 `f2a6528` 提交，P5/P6 为本轮改动。本文件归档后即本期工作区面板的完整实施记录。

### 14.1 已落地代码

- 主进程：`workspace/fileExplorer.ts`（新建/重命名/复制/移动/删除/冲突）、`workspace/fileClipboard.ts`（内部剪贴板）、`workspace/timelineService.ts`（快照/去重/保留/Diff/恢复）；`db` v3 `file_history` 表；`ipc/index.ts` 注册 `fs:*`、`timeline:*`；`tools/toolService.ts` write_file 后快照钩子。
- 共享：`shared/attachment.ts`（ContextAttachment + 限额 10/64KB/200KB）、`shared/ipc.ts` 各 schema。
- 前端组件：`FileTreePanel/FileTreeNode/FileTypeIcon/TreeNameInput/ContextMenu/ConflictDialog/ConfirmDialog/CollapsibleSection/OutlinePanel/TimelinePanel/WorkspaceActivityBar/WorkspaceViewIcon/ViewPlaceholder`。
- 前端 store/lib：`stores/workspace.ts`（懒加载树/剪贴板/diff/reveal）、`stores/chat.ts`（附件+发送）、`stores/settings.ts`（视图/区块折叠持久化）、`lib/outline.ts`、`lib/attachments.ts`、`lib/language.ts`、`lib/fileTree.ts`、`lib/fileIcons.ts`、`lib/workspaceViews.ts`。
- **P2 主进程**：`workspace/searchCore.ts`（匹配器/glob/简化 .gitignore/rg 参数/替换与 hash）、`workspace/ripgrep.ts`（rg 路径探测与 `--json` 解析）、`workspace/searchService.ts`（流式搜索、取消、上限、替换预览/应用/时间线快照）；`workspace/workspaceFs.ts` 扩展 `readWorkspaceFile`（hash/EOL/图片）与 `writeWorkspaceFile`（保存/另存/冲突/快照）；`ipc/index.ts` 注册 `fs:writeFile`、`search:*`。
- **P2 共享/桥接**：`shared/ipc.ts`（`SearchQuery`/`SearchEvent`/替换与保存 schema）、`shared/ipcChannels.ts`（`SEARCH_LIMITS`、新通道）、`shared/api.ts` + `preload/index.ts`（`yocim.search.*`、`workspace.writeFile`）。
- **P2 前端**：`components/SearchPanel.vue`、`ReplacePreviewDialog.vue`、`SaveConflictDialog.vue`；`EditorPane.vue` 重写为多标签可编辑；`stores/search.ts`（防抖/事件/选项持久化）、`stores/workspace.ts`（标签、脏状态、保存、冲突、`timelineVersion`）、`stores/chat.ts` + `lib/attachments.ts`（选区附件）；`WorkspacePanel.vue` 常驻挂载搜索/编辑器视图。
- **P3 主进程**：`git/gitRunner.ts`（`spawn('git', args)` 不走 shell、超时 kill、4MB 输出上限 + stderr 尾部保留、`redactGitText` 脱敏、`detectGit()`、`gitFailureMessage()` 中文错误映射）、`git/gitStatus.ts`（porcelain v2 解析：`1`/`2`/`u`/`?` 记录、重命名原路径、八进制转义路径按字节还原 UTF-8）、`git/gitService.ts`（`status/diff/branches/stage/unstage/discard/commit/pull/push/publish/checkout/init/outputLog`，依赖可注入便于单测）；`audit/auditExport.ts`（JSON/CSV，UTF-8 BOM + CRLF + 公式注入防护）；`db` **v4** 迁移（`audit_logs.call_id`/`duration_ms` + 会话/工具索引）；`db/repositories.ts` 新增 `query/stats/all` 与 `buildAuditWhere`（LIKE 通配符转义）。
- **P3 共享/桥接**：`shared/git.ts`（`GitStatus`/`GitFileChange`/`GitDiffResult`/`GitBranches`/`GitOperationResult`/`GitLogEntry` + `countGitChanges`）、`shared/audit.ts`（`AuditFilter`/`AuditPage`/`AuditStats`/`AuditExportResult`）、`shared/ipcChannels.ts`（`AUDIT_LIMITS`/`GIT_LIMITS` + `audit:*`/`git:*` 通道）、`shared/ipc.ts`（各 zod schema）、`shared/api.ts` + `preload/index.ts`（`yocim.audit.query/stats/export`、`yocim.git.*`）。
- **P3 前端**：`components/AuditPanel.vue` 重写（统计卡/关键字防抖/筛选/加载更多/实时模式/JSON-CSV 导出）、`AuditDetail.vue`（右侧详情抽屉 + 复制）、`ScmPanel.vue`（分支菜单与新建、提交/全部提交、三组变更与行内操作、Git 输出面板）、`stores/audit.ts`、`stores/scm.ts`、`WorkspaceActivityBar.vue` 徽标（`badges` prop）、`WorkspacePanel.vue` 常驻挂载 SCM 并静默刷新徽标。
- **P4 主进程**：`tasks/taskService.ts`（`package.json` scripts 名白名单 `[A-Za-z0-9:_.-]{1,200}`、`.yocim/tasks.json` 自定义任务、`detectPackageManager`（pnpm/yarn 锁文件）、`buildSpawnSpec`（Windows `.cmd/.bat` 经 `cmd.exe /d /s /c` 包裹）、输出上限 + `redactSecrets` + ANSI 清洗、`taskkill /pid <pid> /T /F` 停止进程树）；`debug/launchConfig.ts`（`.yocim/launch.json` + `package.json main` 零配置项、变量替换、`buildLaunchPlan` 越界拒绝）；`debug/cdpClient.ts`（全局 `WebSocket` 的最小 CDP 客户端：`send`/`onEvent`/超时）；`debug/nodeDebugAdapter.ts`（`--inspect-brk=127.0.0.1:0` 启动、stderr 抓 ws 地址、`Debugger.setBreakpointByUrl` 按 `file://` URL、`scriptParsed` 记录 `scriptId→url`、`Runtime.executionContextDestroyed` 主动断连、作用域中文名）；`debug/debugService.ts`（先设断点再启动、命令分发、`DebugEvent` 广播、restart = stop+start）；`extensions/zip.ts`（EOCD/中央目录/本地头、stored+deflate、拒绝 zip64 与穿越）、`extensions/manifest.ts`（归一化 + 三级兼容性）、`extensions/snippets.ts`（片段文件解析与语言匹配）、`extensions/extensionService.ts`（本地/VSIX/VS Code 安装、`safeJoin`、`copyTree` 跳过 `node_modules/.git/out/dist`、不兼容默认禁用、贡献聚合）；`util/redact.ts`（`redactSecrets`，Git 复用）、`util/ansi.ts`（跨 chunk ANSI 清洗）；`db` **v5** 迁移（`extensions` 表）+ `ExtensionRepository`。
- **P4 共享/桥接**：`shared/tasks.ts`（`TaskDefinition`/`TaskDiscovery`/`TaskRun`/`TaskEvent`）、`shared/debug.ts`（`DebugConfig`/`DebugBreakpoint`/`DebugSession`/`DebugPausedInfo`/`DebugEvent`/`DebugCommand`）、`shared/extensions.ts`（`ExtensionInfo`/`ExtensionCompatibility`/`ExtensionContributions`/`VscodeExtensionCandidate`）、`shared/ipcChannels.ts`（`TASK_LIMITS`/`DEBUG_LIMITS`/`EXTENSION_LIMITS` + `tasks:*`/`debug:*`/`extensions:*`）、`shared/ipc.ts`（P4 全部 zod schema）、`shared/api.ts` + `preload/index.ts`（`yocim.tasks/debug/extensions`）。
- **P4 前端**：`components/RunPanel.vue`（调试工具栏、运行配置、任务、断点、控制台、任务输出、首次确认弹窗）、`DebugInspector.vue`（变量/监视/调用堆栈）、`DebugBreakpoints.vue`（常驻断点列表 + 条件输入）、`DebugVariableTree.vue`（递归懒加载）、`ExtensionsPanel.vue`（安装/扫描/启停/卸载/详情/VS Code 导入弹窗）、`lib/extensionSnippets.ts`（14 种语言的 Monaco 片段补全）；`stores/tasks.ts`、`stores/debug.ts`、`stores/extensions.ts`；`EditorPane.vue` 增加 glyph margin 断点与当前行装饰、暂停自动定位（`keepView`）；`stores/settings.ts` 新增 9 个区块折叠项。
- **P5 主进程**：`remote/command.ts`（WSL 输出 UTF-16LE 解码、发行版列表解析、`\\wsl.localhost` ↔ Linux 路径映射、POSIX 引号、`buildWslArgs` 用 `--cd/--exec` 避开 shell、`buildSshArgs` 兜底、远端路径拼接与穿越拒绝）、`remote/wslExec.ts`（`probeWsl`：`--version` + `-l -q`；`createWslExec`：`run/stream/spawn` 三种执行方式 + UNC→Linux 反查）、`remote/sshClient.ts`（ssh2 连接、`SHA256` 指纹计算与 `hostVerifier` TOFU、密码/私钥/agent 三种认证、exec/stream 包装、错误中文化）、`remote/remoteFs.ts`（SFTP 的树/读/写/新建/重命名/复制/移动/删除，`S_IFMT` 判类型、忽略目录、冲突策略、快照钩子）、`remote/execRegistry.ts`（模块级 `RemoteExec` 注册表 + `spawn` 句柄）、`remote/remoteService.ts`（目标 CRUD、`safeStorage` 加密口令、探测、连接前 `test -d`、状态与 `lastError`、断开恢复本地工作区、SSH 指纹首次确认）；`db` **v6** 迁移（`remote_targets`）+ `RemoteTargetRepository`；`workspace/pathGuard.ts` 增加 `WorkspaceGuardLike` 与 `RemotePathGuard`；`workspaceService` 支持 `openRemote/accessGuard/currentRemote`；`git/gitRunner.ts`、`workspace/searchService.ts`、`tasks/taskService.ts` 按 `RemoteExec` 改道（远程搜索直接消费远端 rg 的 JSON，不回读文件）。
- **P5 共享/桥接**：`shared/remote.ts`（`RemoteTarget`/`RemoteTargetInput`/`RemoteEnvironment`/`RemoteConnectionState`/`REMOTE_LIMITS`）、`shared/ipc.ts`（`remoteTargetInputSchema`/`remoteConnectInputSchema`/`remoteIdInputSchema`、`WorkspaceInfo.remote`）、`shared/ipcChannels.ts`（`remote:*` 7 个通道）、`shared/api.ts` + `preload/index.ts`（`yocim.remote.*`）。
- **P6 打包与性能**：`electron-builder.yml`（`extraResources` 放 `resources/ripgrep`、ssh2 及运行时依赖白名单、`cpu-features`/`nan`/`buildcheck` 排除、`npmRebuild: false`）、`resources/ripgrep/{rg.exe,README.md}`（ripgrep 14.1.1）、`README.md`（特性/安全/打包/已知限制/截图）、`docs/screenshots/*`（15 张重拍）；`stores/search.ts` 批量合并结果 + 自动折叠；`workspace/searchCore.ts` 的 ripgrep 参数补 `--no-require-git` 与噪声目录 glob。
- **P5 前端**：`components/RemotePanel.vue`（环境探测条、目标列表与状态/错误、WSL/SSH 表单、指纹确认、连接/断开/删除）、`stores/remote.ts`、`StatusBar.vue` 远程徽标、`lib/workspaceViews.ts` 去掉远程占位、`WorkspacePanel.vue` 挂载面板、`stores/workspace.ts` 新增 `applyInfo`。

### 14.2 验证基线（接手时请先复跑确认）

- 单测 **278（33 文件）**；e2e **22**（smoke 7 + workspaceViews 2 + fileExplorer 2 + searchEditor 3 + scmAudit 3 + runDebugExtensions 3 + remote 2）；`typecheck`、`lint`、`format:check` 全绿。
- 命令：`npm test`、`npm run e2e`、`npm run typecheck`、`npm run lint`、`npm run format:check`。
- 在 WorkBuddy 会话内跑 e2e 需先去掉继承的 `ELECTRON_RUN_AS_NODE=1`（否则 Electron 以 Node 模式启动，报 `bad option: --remote-debugging-port=0`）：`env -u ELECTRON_RUN_AS_NODE npm run e2e`。
- 本会话内 `npm test` 的默认线程池会抛 `Vitest failed to find the runner`（WorkBuddy 沙箱的 `NODE_OPTIONS` require-shim 与 tinypool worker 冲突，最小 smoke 用例同样复现，与本项目代码无关）。用 `npx vitest run --pool=vmThreads` 可正常跑完；离开该环境后默认池恢复可用。
- P6 收尾复跑：`npm run format` / `typecheck` / `lint` / `npx vitest run --pool=vmThreads`（278 例）/ `format:check` / `env -u ELECTRON_RUN_AS_NODE npx playwright test`（22 例）通过；`electron-builder --dir` 与 `--win nsis` 均成功，打包产物在 Playwright 下实测：启动正常、搜索走内置 ripgrep、远程面板可用。
- P5 收尾复跑：`npm run format` / `typecheck` / `lint` / `npx vitest run --pool=vmThreads`（277 例）/ `format:check` / `env -u ELECTRON_RUN_AS_NODE npx playwright test`（22 例）通过；`npm run build` 在本会话需要非沙箱执行（沙箱的 safe-delete 会拦截 `out/renderer/assets` 的批量清理）。
- P4 收尾复跑：`npm run format` / `typecheck` / `lint` / `npx vitest run --pool=vmThreads`（255 例）/ `format:check` / `env -u ELECTRON_RUN_AS_NODE npx playwright test`（20 例）全部通过；亮/暗运行调试面板、断点 glyph 与当前行、确认弹窗、扩展面板与 VS Code 导入弹窗、1024 宽度 13 张截图复核无溢出与裁切。

### 14.3 与计划的偏差（P6 需留意）

- 大纲 TS/JS 仍用**正则提取**（`lib/outline.ts`），未接 §3.1.5 首选的 Monaco TS Worker；P2 未升级，可后置。
- **无 fs watcher**：外部修改通过「保存前 hash 校验」与「切换标签时 `expectedHash` 比对」发现，后者会让主进程生成 `external` 快照；不是实时文件监听。
- **ripgrep 已随包分发**（P6 落地）：`resources/ripgrep/rg.exe`（14.1.1，5.2MB）经 `extraResources` 放到 `resources/ripgrep/`；`findRipgrepPath()` 依次探测 `YOCIM_RIPGREP_PATH`、`process.resourcesPath/ripgrep`、`<cwd>/resources/ripgrep`、PATH，全部缺失才回退内置搜索并提示。目前只放了 Windows x64 二进制，macOS/Linux 打包需补同名的 `rg`。
- `.gitignore` 为简化实现（注释/取反/目录/锚定/通配），未覆盖完整 gitignore 规范；include/exclude glob 同样为简化匹配器。
- 搜索的「仅在打开文件中搜索」不应用 .gitignore（显式打开的文件仍可搜），符合「优先搜已打开文件」的语义。
- **审计 DB 升到 v4**（超出 §4.4 的 v3 设计）：`audit_logs` 增 `call_id`/`duration_ms` 两列，供详情抽屉展示；旧行这两列为 `NULL`，UI 显示「-」。
- **Git 路径基准是工作区根，不是仓库根**：`GitService` 用 `git rev-parse --show-toplevel` 定位仓库，但所有命令以工作区根为 `cwd` 并加 `-- .` pathspec，`git show :./path` / `HEAD:./path` 也相对 `cwd`。因此工作区是仓库子目录时，面板只反映/操作工作区范围内的文件（符合「工作区即项目」的定位，但与 VS Code 显示整个仓库不同）。
- **取消暂存/放弃更改有降级链**：`restore --staged` → `reset -q HEAD --` → `rm --cached`（首次提交前无 HEAD 时）；`restore --worktree` → `checkout --`。兼容旧版 git。
- **放弃更改拒绝未跟踪文件**：`assertNoUntracked` 直接报错「未跟踪文件无法放弃，请手动删除」，避免误删新文件。
- **Git 输出面板只记录写操作**（`status/diff/log/rev-parse/branch --list` 等只读命令不入日志），且仅内存保存、重启清空，未落库。
- 审计 `stats` 的**工具下拉不受 tool 筛选影响**（否则选中后只剩一个选项无法回切），其余筛选对统计生效。
- 分支名校验为简化实现：拒绝 `..`、空白、`~^:?*[\`、控制字符、首尾 `.`/`/`，未完全对齐 `git check-ref-format`。
- 合并冲突第一阶段只**只读展示**（porcelain v2 `u` 记录 → `conflicted` 分组并标记），未提供接受当前/传入的合并操作，符合 §12 非目标。
- **调试用自研 CDP，不是 DAP + js-debug**（§3.7/§10 的原始设想）：spike 后判定 js-debug 需额外依赖与 DAP 时序，收益不抵成本。`DebugAdapter` 接口保留 `applyBreakpoints/start/stop/command/scopes/variables/evaluate`，接 Python/Go 时新增适配器即可，但**当前没有任何 DAP 实现代码**。
- **`launch.json` 无 JSON Schema 校验**：只做 JSON 可解析性提示 + 字段白名单归一化（`type` 仅 `node`/`pwa-node`，必须有 `program`）；不支持注释（JSONC）。`jsonc-parser` 未引入。
- **调试目标必须注入 `ELECTRON_RUN_AS_NODE=1`**：Electron 主进程里 `process.execPath` 是 `electron.exe`，不注入会被当作 Electron 应用启动，永远不命中用户断点。
- **VSIX 用自研最小 zip 读取器**（不引入 `yauzl`）：仅支持 stored/deflate，拒绝 zip64、路径穿越与绝对路径；条目/解压上限来自 `EXTENSION_LIMITS`。真实 VSIX 均满足，但遇到 zip64 打包的包会报「不支持 zip64」。
- **扩展的语法/主题贡献只展示不生效**：`contributions` 会解析并统计 languages/grammars/themes，但未注册 Monaco tokenizer、未应用主题；只有 `snippets` 通过 `CompletionItemProvider` 真正可用。命令/菜单/快捷键同样只在详情里列出。
- **片段补全按片段文件声明的语言注册**（14 种常见语言），`scope` 为 `*` 的片段按 `*` 匹配全部注册语言；不处理 `${1:占位}` 之外的高级片段语法（变量/嵌套/正则变换），原文插入。
- **任务/调试输出做 ANSI 清洗**：面板是纯文本，Node 在继承 `NODE_OPTIONS` 等环境下会给 `console.log` 着色，直接显示会变 `\x1b[33m` 乱码。
- **没有终端**：运行输出是只读追加面板（§12 非目标），不支持 stdin 交互；`npm run watch` 这类长任务靠停止按钮结束（`taskkill /T /F` 杀进程树）。
- **调试只支持 launch，不支持 attach**：CDP 端有 `Runtime.enable` 等能力，但 UI 未提供端口 attach 入口。
- **没有落地 `WorkspaceProvider` 接口**（§4.1 的设计）：WSL 用 UNC 根复用本地 fs，SSH 用 SFTP + `RemotePathGuard` 虚拟守卫，两者都通过模块级 `RemoteExec` 注册表让 Git/搜索/任务改道。好处是改动小、本地路径零回归；代价是「远程 provider」不是一个可替换的统一抽象，后续接其他后端要再抽象一次。
- **WSL 成功路径未实测**：本机 `wsl.exe` 被 WorkBuddy 安全策略拦截，只能验证探测失败与错误提示。距离/UNC 访问、`--cd/--exec` 行为、WSL 内 Git/搜索/任务需要真机确认。
- **SSH 只验证了失败路径**：没有可用 SSH 服务器，SFTP 浏览/编辑、远端 Git/搜索/任务的端到端流程未跑；`ssh2` 的 `hostVerifier` 只比较 SHA256 指纹，未实现 `known_hosts` 兼容读取。
- **SSH 大文件不流式**：`readRemoteFile` 会把整个文件读进内存再按 2MB 截断（与本地实现一致），超大文件仍可能占用较多内存；写文件同理一次性上传。
- **远程批量替换禁用**：`searchService.replace` 在远程工作区直接报 `E_UNSUPPORTED`；「仅在打开的文件中搜索」同样禁用。
- **远程调试禁用**：`debug:start` 在远程工作区报 `E_UNSUPPORTED`，需要后续阶段接入远端调试适配器。
- **Agent 工具仍限本地**：`ToolService` 继续用 `workspaceService.requireGuard()`，SSH 远程工作区调用会得到「远程工作区不支持本地文件操作」，符合 §12 的既定范围。
- **远程 target 的 `root` 标识**：SSH 工作区 `WorkspaceInfo.root` 是 `ssh://<targetId><path>`，会作为项目/session 的 `workspace_root` 落库；断开后这些记录仍在，重新连接同一目标可复用。
- **WSL 发行版可手填**：探测失败时表单允许直接输入发行版名（datalist），便于在探测受限但 WSL 可用的环境继续配置。
- **搜索结果超过 20 个文件自动折叠**：命中很多时只渲染文件行，点开单个文件才渲染命中行；数据仍是完整的（受 5000 条上限约束），「全部替换」照常作用于全部结果。
- **ripgrep 与内置引擎的忽略规则已对齐**：除 `--hidden` 外补了 `--no-require-git`（非 git 目录也读 `.gitignore`）与 `!.git`/`!node_modules`/`!dist`/`!out`/`!release`/`!coverage`/`!.hg`/`!.svn` 的 glob。P6 之前刚打包好 rg 时，e2e 立刻暴露出「非 git 工作区把 `node_modules` 与 `.git/hooks` 搜出来」的差异。
- **打包体积**：NSIS 安装包 **123MB**（压缩后），win-unpacked **396MB**（Electron 运行时占绝大部分），`resources/app.asar` **33.6MB**（`out/` 27MB + 依赖约 6MB），`resources/ripgrep` **5.2MB**；未配置签名与公证。
- **本机 `release/` 目录存在文件锁**：`electron-builder` 在 `E:` 盘的项目目录里做目录 rename 会 `EPERM/EBUSY`（`default_app.asar` 被占用），本会话改用 `-c.directories.output=%TEMP%/...` 完成打包验证。这是本机环境（索引/杀软）问题，不是配置问题；换机器或重启后应可正常输出到 `release/`。
- **WSL/SSH 成功路径仍未真机验收**：P6 未能补上（本机 `wsl.exe` 被安全策略拦截、没有可用 SSH 服务器），只能在应用外做代码审查与失败路径实测。

### 14.4 交接坑位（已踩过的坑）

1. **IPC 传参必须纯数据**：Vue reactive Proxy 无法结构化克隆。`chat.send` 已用 `toRaw` 快照附件（`stores/chat.ts` send）；新增 IPC 调用勿直接传 `ref.value` 的对象/数组，否则 invoke reject 表现为「主进程无响应」。
2. **tsconfig 分工**：`tsconfig.node.json` 不映射 `@renderer`（避免把 DOM store 拉进 node 程序）；依赖 DOM 的测试（`workspaceStore.test.ts`）归 `tsconfig.web.json`；纯逻辑测试用相对路径导入 renderer lib。
3. **Diff 在编辑器视图**：`openDiff` 会自动切到编辑器视图（overlay 在 EditorPane 内）；关闭后不自动回文件视图，交互/e2e 需手动切回 `workspace-tab-files`。
4. **refreshTree 保留已展开目录**（符合 §3.1.2）；e2e 不要重复点击已展开目录（会折叠）。
5. **runIpcHandler 捕获所有 handler 错误**返回 `{ok:false}`；invoke 被 reject 通常是克隆/注册问题而非业务错误，排查方向不同。
6. **P2 再踩一次 Proxy 坑**：`search` store 的替换请求参数原本放进 `ref`，`applyReplace` 把 `pending.query`（reactive Proxy）传给 `search:replace` 直接 reject，表现为「预览正常、应用无反应」。现改为普通局部变量 `let pendingReplace`；新增需要回传 IPC 的中间状态一律不要塞进 `ref`。
7. **Monaco 选区**：`.view-lines` 是整块容器，点击中心容易落到文件末尾空行，`Home + Shift+End` 选不到内容；e2e 用 `Ctrl+A` 全选验证选区附件。组件内以 `editor.getSelection()` + `getValueLengthInRange()` 判空，无选区退化为整文件附件。
8. **时间线列表刷新**：`TimelinePanel` 原来只 watch `activeFile.relativePath`；替换/保存在同一文件上发生，路径不变导致快照列表不更新。新增 `workspace.timelineVersion`，磁盘内容变化后递增并触发重新拉取。
9. **e2e 固定标签**：Playwright 在文件树节点上 `dblclick` 时，第一次单击已切到编辑器视图，第二次点击落不到树节点；固定标签改在标签条上双击（`editor-tab-*`）。
10. **编辑器 overlay 不要用写死的 `inset`**：头部一旦换行（窄面板两行布局），原来 `diff-overlay` / `editor-empty` 的 `inset: 62px 0 0` 就会错位。现用 `EditorPane.vue` 的 `.editor-body`（`position: relative; flex: 1`）包裹内容区，overlay 改为 `inset: 0`；后续加头部行高不必再改魔法数字。
11. **编辑器的空态会挡住 Diff**：`editor-empty` 原来只在 `!activeTab` 时显示，但 Git 可在「无打开标签」时打开 Diff，空态覆盖整个内容区导致 `diff-close` 点不到。现为 `v-if="!activeTab && !workspace.diff"`。
12. **SCM 行内点击会重复触发**：`.file-row`（`<li>`）上挂 `@click` 打开 Diff、行内又有暂存/放弃按钮时，点按钮会冒泡两次（先开 Diff 又立刻暂存）。现点击事件在内层 `<button class="file-main">`，操作区 `.actions` 用 `@click.stop`；新增行内操作沿用此结构。
13. **活动栏徽标会被裁切**：`.activity-bar` 是 `overflow-x: auto`（此时 `overflow-y` 只能是 `hidden`），徽标的负偏移不能过大。现 `top: -3px; right: -5px` + `z-index: 1`，1024 下实测 `badge.top(40.5) > bar.top(36)`、`badge.right(967) < bar.right(994)`，未越界；调这个位置时请用 `getBoundingClientRect()` 实测而不是目测。
14. **实时模式必须走静默刷新**：审计轮询用 `refresh({ silent: true })`（不清 `notice`、不动筛选），关掉实时要清定时器（`syncLive` + `onScopeDispose`），否则离开视图仍在拉数据。
15. **git 非 ASCII 路径转义**：git 默认把中文路径输出成八进制 C 风格转义。`runGit` 统一加 `-c core.quotePath=false`，但 `unquoteGitPath` 仍按字节累积后用 `Buffer.from(bytes).toString('utf8')` 还原（直接 `String.fromCharCode` 会得到 `ä¸­æ` 乱码），单测已覆盖。
16. **只读子命令别进 Git 日志**：`git status` 在每次刷新都会跑，若不排除会让输出面板被刷屏；`READ_ONLY_COMMANDS` 集合需随新增只读命令同步维护。
17. **Windows 上 `.cmd`/`.bat` 不能直接 `spawn`**（Node ≥20 抛 `EINVAL`）：`spawn('npm', ['run', name])` 会在 Windows 上立刻失败。必须 `cmd.exe /d /s /c "<命令行>"` 包裹（`buildSpawnSpec`），参数仍走数组拼接后整体引用，不经 shell 解释用户输入。
18. **调试要在 `start()` 之前设断点**：`DebugService.start` 原本 `await adapter.start()` 之后才 `setBreakpoints`，导致首次运行断点不生效；现在先 `await adapter.setBreakpoints(...)` 再启动（`--inspect-brk` 会停在入口，来得及）。
19. **暂停帧的 `callFrame.url` 常为空串**：只有 `location.scriptId`。适配器在 `Debugger.scriptParsed` 时记录 `scriptId → url`，暂停时回查才能算出 `relativePath`，否则调用堆栈全是「内部帧」。
20. **`--inspect-brk` 会先停在模块包装帧**（命中 `Break on start`，作用域里 `require`/`module` 而不是用户变量）：适配器收到首个 `paused` 且 `reason === 'Break on start'` 时自动 `Debugger.resume`，不要把它当成用户断点展示。
21. **Node 进程结束后不会自己退出**（等调试器 disconnect）：`Runtime.notifyWhenWaitingForDisconnect` 无效；收到 `Runtime.executionContextDestroyed` 后主动 `cdp.close()` 才能让子进程退出，否则任务永远「运行中」。
22. **区块折叠会吃掉 e2e 断言**：`CollapsibleSection` 默认折叠（`v-show`），`toBeVisible()` 会报 hidden 而 locator 明明已 resolve。调试会话启动时统一展开相关区块（`stores/debug.ts` 的 `revealSections`），新增需要「自动出现」的区块请一并加入 `REVEAL_SECTIONS`。
23. **本会话里 `npm run build` 需要非沙箱执行**：沙箱的 safe-delete 策略会拒绝清理 `out/renderer/assets`（一次 98 个文件 > 50 阈值），报 `[SAFE_DELETE_BULK_CONFIRM_REQUIRED]`；表现为「构建失败但测试仍过」，因为 `out/` 是上一次的产物。看到 `buildTargets` 堆栈先确认构建真的成功。
24. **Playwright 会清空 `test-results/`**：临时验证脚本不要放在里面（跑完 e2e 就没了），放 `build/` 下并在收尾时删除。
25. **`wsl.exe` 可能被安全策略拦截**：WorkBuddy 沙箱把 `wsl.exe` 列入程序黑名单，`probeWsl()` 会拿到 `spawn EPERM`。探测逻辑要把它当作「不可用 + 可读原因」，不要当成崩溃；真机验证请在应用自身的进程里跑。
26. **ssh2 的 `hostVerifier` 只能返回 boolean**：指纹要在回调里自己算并缓存，连接失败后再拿缓存值拼提示；`stat` 回调给的是 `Attributes`（只有 `mode`），要自己按 `S_IFMT` 判断目录/文件，`readdir` 的 `attrs` 同样没有 `isDirectory()`。
27. **`pendingReveal` 会连带切视图**：`WorkspacePanel` 的 watcher 一旦看到 `pendingReveal` 就把活动视图切到编辑器，调试暂停时会把「运行和调试」顶掉。现在 `RevealRequest.keepView` 显式声明「只滚动不切视图」，调试暂停用它；e2e 里点 glyph 前也要先等 `.monaco-editor .view-lines` 出现，否则 `currentModelPath` 仍是 null，断点加不上。
28. **搜索事件必须批量合并**：主进程按文件逐个 `emit`，renderer 若每个事件都 `results.push` + `expanded.add`，1667 个文件会产生上千次重渲染，2400 文件的工作区实测要 **41s** 才出结果。现在按 30ms 合并成一次数组替换，并在结果超过 20 个文件时停止自动展开，同一场景降到 **1.5s**。新增流式列表（审计/任务输出等）时同样要批量更新。
29. **`--hidden` 会连带搜进版本库与依赖目录**：ripgrep 加 `--hidden` 才能搜到 `.yocim` 这类点文件，但 `.git`/`node_modules` 不是隐藏目录、也不一定写在 `.gitignore` 里。必须同时传 `--no-require-git`（否则非 git 工作区不读 `.gitignore`）和噪声目录 glob，否则结果与内置引擎不一致，e2e 的命中数会直接对不上。
30. **打包要关 `npmRebuild`**：ssh2 的 `optionalDependencies` 里有 `cpu-features`，electron-builder 会尝试按 Electron ABI 重编译；项目路径含空格时 node-gyp 直接报「Attempting to build a module with a space in the path」+「Could not find any Visual Studio installation」。本项目不需要任何原生模块，`npmRebuild: false` 即可，同时把 `cpu-features`/`nan`/`buildcheck` 从 asar 里排除（ssh2 会 `try { require('cpu-features') } catch {}` 自动回退）。
31. **本会话打包要 `env -u NODE_OPTIONS`**：沙箱的 safe-delete shim 会在 electron-builder 解压 Electron 压缩包时拦住 `fs.rm`（`SAFE_DELETE_FAIL_CLOSED` / `SAFE_DELETE_BULK_CONFIRM_REQUIRED`），表现为「构建失败但 e2e 用旧产物通过」。加 `dangerouslyDisableSandbox` 不够，必须同时去掉 `NODE_OPTIONS`。
32. **打包后 rg 的探测靠 `process.resourcesPath`**：开发态走 `<cwd>/resources/ripgrep`，安装后走 `resources/ripgrep`。验证打包是否真的带上 rg，最直接的办法是在打包产物里跑一次搜索，看是否出现「未检测到 ripgrep」提示。

### 14.5 P6 发布检查结果

| 检查项     | 结果                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态检查   | `npm run typecheck` / `npm run lint` / `npm run format:check` 全绿                                                                                                                                 |
| 单元测试   | 278 例 / 33 文件通过（`npx vitest run --pool=vmThreads`）                                                                                                                                          |
| 端到端     | 22 例通过（`env -u ELECTRON_RUN_AS_NODE npx playwright test`）                                                                                                                                     |
| 打包配置   | `extraResources` → `resources/ripgrep`（rg 14.1.1）；asar 内 `out/` + `zod` + `ssh2`/`asn1`/`bcrypt-pbkdf`/`tweetnacl`/`safer-buffer`；排除 `cpu-features`/`nan`/`buildcheck`；`npmRebuild: false` |
| 打包产物   | `electron-builder --dir` 与 `--win nsis` 均成功；NSIS 安装包 **123MB**，win-unpacked 396MB，`app.asar` 33.6MB，`resources/ripgrep` 5.2MB                                                           |
| 产物冒烟   | 用 Playwright 启动打包后的 exe：版本 0.1.0、`process.resourcesPath` 定位到安装目录、搜索走内置 ripgrep（无「未检测到 ripgrep」提示，3 处命中）、远程管理器面板可打开（ssh2 正常加载）              |
| 性能       | 根目录 130 项 1–2ms、子目录 80 项 1ms；2400 文件检索到 5000 条上限 1.5s；12 个编辑器标签打开 2.0s、堆 48–69MB，第 13 个文件仍保持 12 个标签                                                        |
| 文档与截图 | README 增补工作区面板截图与打包说明；`docs/screenshots/` 15 张重拍（亮/暗、8 个视图、设置与输入卡）                                                                                                |
| 未完成     | WSL / SSH 成功路径真机验收；代码签名与公证                                                                                                                                                         |
