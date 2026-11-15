# YOCIM AGRNT — 安全设计（SECURITY）

> 核心立场：模型输出不可信、renderer 不可信、工作区之外的任何路径不可信。所有能力都必须经过主进程的显式校验。

## 1. 信任边界

| 区域               | 信任级别     | 约束                                                     |
| ------------------ | ------------ | -------------------------------------------------------- |
| 模型 Provider 输出 | 不可信       | 仅作为数据解析，工具参数必须 zod 校验                    |
| Renderer           | 不可信       | 仅能通过 preload 白名单 API 与主进程通信                 |
| Preload            | 受信但最小化 | 不暴露 `ipcRenderer` 原始对象、不实现业务逻辑            |
| 主进程             | 受信         | 唯一可访问 fs / child_process / DB 的进程                |
| 工作区文件         | 用户数据     | 仅允许在工作区内读写                                     |
| 用户主目录其他文件 | 禁止         | 路径守卫拦截                                             |
| 密钥               | 最高敏感     | 仅主进程读取，不落日志、不入库明文、不回传 renderer 明文 |

## 2. 威胁与应对

### 2.1 路径穿越 / 越权访问

威胁：模型或用户输入 `../../.ssh/id_rsa`、`C:\Windows\System32\...`、符号链接指向工作区外。

应对：

1. 所有路径入参必须是**工作区相对路径**，拒绝绝对路径与盘符；
2. `path.resolve(workspaceRoot, relative)` 后强制 `fs.realpath`；
3. 校验结果必须以 `realpath(workspaceRoot) + path.sep` 开头（根目录本身除外）；
4. 符号链接（含中间目录的 symlink）解析后越界即拒绝，错误码 `E_PATH_ESCAPE`；
5. 写入额外禁止 `.git/`、`node_modules/` 与配置的忽略名单；
6. 守卫单元测试必须覆盖：`..`、绝对路径、UNC 路径、symlink 文件、symlink 目录、大小写差异（Windows）。

### 2.2 命令执行风险

威胁：`rm -rf /`、格式化磁盘、`curl | bash`、外传代码、长时间挂起。

应对：

1. 命令执行必须经过审批 UI，展示完整命令、cwd、风险等级；
2. cwd 固定为工作区内路径，且经过路径守卫；
3. 危险模式黑名单直接拒绝（`rm -rf`、`format`、`mkfs`、`shutdown`、`reg delete`、`diskpart` 等），不可被审批覆盖；
4. 默认命令白名单（node、npm、npx、pnpm、yarn、tsc、vitest，以及 git 的 status/diff/log/show/branch/rev-parse/ls-files），白名单外的命令直接拒绝（审批不可覆盖）；
5. 禁止 shell 内联下载并执行（`curl|bash`、`iwr|iex`）模式；
6. 超时（默认 60s，可配置上限 300s）+ 输出截断（默认 64KB），超时强制 kill 进程树；
7. 环境变量最小化，不注入 API Key 等敏感变量；
8. `node`/`npm` 等白名单命令本身仍具备执行代码的能力，因此审批 UI 必须展示完整命令，且默认记住策略不启用。

### 2.3 审批绕过

威胁：模型伪造审批结果、重复利用旧的“记住”决策、并发调用绕过队列。

应对：

1. 审批 ID 由主进程生成（UUID），renderer 只能对已知 ID 应答；
2. 审批请求与工具调用 `callId` 一一绑定，一次性有效；
3. “记住此命令”必须精确匹配命令串，不匹配任何前缀/通配；
4. 同一 run 内审批串行处理，未决审批阻塞后续写操作；
5. run 取消时，所有未决审批自动置为 `cancelled` 且不执行。

### 2.4 密钥与敏感信息

威胁：API Key 写入日志、数据库、错误上报、renderer 内存泄露。

应对：

1. Key 只从环境变量 `OPENAI_API_KEY` 或系统安全存储（Electron `safeStorage`）读取，仅在主进程构造 Provider 时使用；
2. 使用 safeStorage 时，密文存于 `settings.apiKeyEncrypted`，不落明文；renderer 只能读到 `hasApiKey`；
3. 日志统一脱敏器：匹配 `sk-*`、`Authorization`、`Bearer` 等模式并替换为 `***`；
4. IPC 响应中的 settings 一律脱敏；
5. 禁止把用户文件内容整段写入日志（仅记录路径、大小、摘要）。

### 2.5 渲染进程逃逸

威胁：XSS 或第三方依赖调用 Node API、开启 `nodeIntegration`。

应对：

1. `BrowserWindow` 配置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（preload 受限）；
2. 主进程注册 IPC 时校验 `senderFrame.url`（开发态渲染服务器 / 生产态 `file://…/out/renderer/`），非应用页面调用返回 `E_FORBIDDEN`；
3. `contextBridge` 白名单暴露，只暴露方法，不暴露对象引用；
4. 禁用 `webviewTag`，拦截 `will-navigate` 与 `setWindowOpenHandler`（外链交给系统浏览器）；
5. CSP 禁止 `unsafe-eval`；Monaco 使用本地打包资源，不加载远程脚本；
6. 渲染用户/模型文本统一作为纯文本或受控 Markdown 渲染，禁止直接 `v-html` 注入未净化内容。

### 2.6 数据库与审计完整性

威胁：审计被篡改、DB 被工作区内容污染。

应对：

1. DB 位于 `app.getPath('userData')/yocim.db`，与工作区隔离；工作区文件不可写 DB；
2. 审计日志持久化于 `audit_logs`，只追加（仓储层无更新/删除 API）；
3. 所有工具调用（含读）写入审计；写/命令额外记录审批结果与决策者（本地用户）；
4. 迁移（`PRAGMA user_version`）幂等；迁移失败时阻止应用进入主界面，避免半初始化状态。

## 3. 安全默认配置

| 配置项           | 默认值                                             |
| ---------------- | -------------------------------------------------- |
| contextIsolation | true                                               |
| nodeIntegration  | false                                              |
| sandbox          | true                                               |
| webSecurity      | true                                               |
| 命令超时         | 60s（上限 300s）                                   |
| 命令输出上限     | 64KB                                               |
| 文件读取上限     | 2MB（超出提示并拒绝整段编辑）                      |
| 文件树深度       | 8 层，单目录 500 条                                |
| 搜索命中上限     | 200 条                                             |
| 忽略目录         | `.git`、`node_modules`、`dist`、`out`、`.DS_Store` |

## 4. 审计字段

| 字段             | 说明                                                 |
| ---------------- | ---------------------------------------------------- |
| `ts`             | 毫秒时间戳                                           |
| `session_id`     | 所属会话                                             |
| `tool`           | 工具名                                               |
| `args_summary`   | 参数摘要（路径、命令、搜索词，截断 500 字符，脱敏）  |
| `result_summary` | 结果摘要（成功/失败、耗时、输出截断）                |
| `approval`       | `not_required` / `approved` / `denied` / `cancelled` |

## 5. 安全检查清单（每阶段自检）

- [ ] 新增 IPC 通道是否有 zod schema 与最小权限
- [ ] 新增文件操作是否走路径守卫
- [ ] 新增命令能力是否走审批与白名单
- [ ] 新增日志是否经过脱敏
- [ ] renderer 是否引入 Node/Electron 直接依赖
- [ ] 相关单测/安全用例是否通过
