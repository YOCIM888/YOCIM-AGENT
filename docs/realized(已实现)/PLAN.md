# YOCIM AGENT — MVP 计划（PLAN）

> 项目定位：本地优先（local-first）的桌面 AI 编程助手，形态对标 Codex 类工具。
> 本文档记录 MVP 范围、非目标、阶段计划、风险与决策基线。阶段推进中如变更范围，必须在本文件追加变更记录。

## 1. 项目目标

YOCIM AGENT 是一个 Electron 桌面应用：

- 用户选择一个本地工作区（workspace），在应用内与模型对话；
- 模型可通过工具读取 / 搜索 / 编辑工作区文件，并在审批后执行受控命令；
- 所有写文件与命令执行都必须经过用户审批，并有可查询的审计记录；
- 支持流式输出、会话持久化、取消生成与基础错误恢复；
- 模型接入采用 OpenAI-compatible 抽象，支持 mock provider 离线测试。

## 2. MVP 范围（In Scope）

| 编号 | 能力           | 说明                                                                              |
| ---- | -------------- | --------------------------------------------------------------------------------- |
| S1   | 工程脚手架     | Electron + Vite + Vue 3 + TS，main / preload / renderer 三端结构，完整脚本链      |
| S2   | 安全 IPC       | preload 暴露最小类型安全 API；主进程用 zod 校验入参；路径守卫阻止越权             |
| S3   | 工作区与文件树 | 选择工作区、读取文件树、读取/打开文件（Monaco）                                   |
| S4   | 对话 UI        | Codex 类布局（会话列表 / 编辑器 / 文件树 / 状态栏），消息列表、流式渲染           |
| S5   | Agent 引擎     | Provider 抽象、流式事件、Agent 循环、上下文组装、取消、错误处理                   |
| S6   | 工具系统       | list_dir、read_file、search_files、write_file/patch、run_command                  |
| S7   | 审批与审计     | 写文件/命令必须审批；审计日志记录时间、工具、参数摘要、结果、审批状态             |
| S8   | 持久化         | SQLite（`node:sqlite`）：sessions、messages、tool_calls、settings；重启恢复、导出 |
| S9   | 端到端联调     | Playwright 冒烟：启动、选工作区、发消息、审批写文件、重启恢复                     |
| S10  | 打包交付       | electron-builder（Windows 优先，兼容 macOS/Linux 配置）、README、发布检查清单     |

## 3. 非目标（Out of Scope / MVP 不做）

- 多用户、账号体系、权限分级；
- 云端同步、远程会话、团队协作；
- 插件市场 / 第三方扩展体系；
- 多模态（图片、音频、视频输入输出）；
- 自动 git 提交 / PR 创建；
- 自动执行高危命令（如 `rm -rf`、格式化磁盘、网络上传类命令默认拒绝）；
- 完整的代码索引 / LSP / 语义检索（MVP 仅做文本级搜索）；
- 移动端、Web 端在线版本。

## 4. 技术栈基线

| 层       | 选型                               | 备注                                             |
| -------- | ---------------------------------- | ------------------------------------------------ |
| 桌面容器 | Electron                           | main / preload / renderer 三端隔离               |
| 构建     | Vite（+ electron-vite 或等价方案） | 阶段 1 定稿，确保 dev/build 一致                 |
| 前端     | Vue 3 + TypeScript                 | Composition API                                  |
| 状态     | Pinia                              | workspace / session / chat / settings 四个 store |
| 路由     | Vue Router                         | 单窗口多视图                                     |
| 编辑器   | Monaco Editor                      | 只读优先，编辑能力受审批约束                     |
| 持久化   | node:sqlite（Electron/Node 内置）  | 同步 API、主进程独占；无需原生编译与 ABI rebuild |
| 校验     | zod                                | IPC 入参、工具参数、持久化结构                   |
| 单测     | Vitest                             | 覆盖 Agent 循环、路径守卫、工具、DB              |
| E2E      | Playwright                         | Electron 冒烟                                    |
| 打包     | electron-builder                   | Windows 优先（当前开发环境为 Windows）           |
| 规范     | ESLint + Prettier                  | 统一风格与静态检查                               |

## 5. 阶段计划（与工程文档一致）

| 阶段 | 名称              | 核心产出                                                      | 验收门禁                                        |
| ---- | ----------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| 0    | 环境与需求基线    | 本目录四份文档、仓库与环境检查结论                            | 文档存在且含范围/架构/验收/安全                 |
| 1    | 工程脚手架        | 三端结构、脚本链、ESLint/Prettier/Vitest/Playwright/builder   | install、dev、typecheck、lint、test、build 通过 |
| 2    | 安全 IPC 与工作区 | preload 契约、zod 校验、工作区选择、文件树/文件读取、路径守卫 | 越权路径被拒绝且有测试                          |
| 3    | UI 骨架           | Codex 类布局、Monaco、四个 Pinia store、对话 UI               | 可打开工作区/文件、无 renderer Node 调用        |
| 4    | Agent 引擎        | Provider 抽象、流式事件、Agent 循环、取消、mock provider      | mock 下完成流式对话，单测覆盖核心循环           |
| 5    | 工具系统与审批    | 五个工具、审批 UI、审计日志、命令超时与截断                   | 读免审批、写/命令需审批、危险命令被拒           |
| 6    | 会话与持久化      | SQLite schema、迁移、CRUD、恢复、导出、设置持久化             | 重启恢复、导出可用、DB 测试通过                 |
| 7    | 端到端联调        | 全链路打通、Playwright 冒烟、跨进程问题修复                   | e2e 冒烟通过、错误可恢复                        |
| 8    | 打包与交付        | electron-builder 安装包、日志/崩溃处理、README、发布清单      | package 成功、安装包可启动、README 完整         |

每阶段结束默认暂停，等待确认后再进入下一阶段（除非明确要求“连续执行”）。

## 6. 里程碑

- M1（阶段 0–2）：安全底座可用 —— 应用能启动、能安全打开工作区。
- M2（阶段 3–5）：可交互原型 —— 能对话、能调用工具、写操作受审批。
- M3（阶段 6–7）：可用产品 —— 会话可恢复、全链路 e2e 通过。
- M4（阶段 8）：可交付 —— 有安装包与文档。

## 7. 风险清单

| 编号 | 风险                                          | 影响            | 应对                                                                                                           |
| ---- | --------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| R1   | better-sqlite3 原生模块与 Electron ABI 不匹配 | 阶段 6 启动失败 | **已发生**：rebuild 需要 VS Build Tools 且项目路径含空格；按备选切换为 `node:sqlite`（Node/Electron 均已验证） |
| R2   | 路径守卫被符号链接绕过                        | 越权读写        | 统一走 `realpath` + 前缀比对；只读/写白名单；单测覆盖 symlink 场景                                             |
| R3   | 命令执行逃逸工作区或执行破坏性命令            | 数据损坏        | 默认 `cwd` 锁定工作区；命令白名单 + 审批；危险模式黑名单；超时与输出截断                                       |
| R4   | 流式事件与 IPC 竞态（取消/分片/重连）         | UI 状态错乱     | 事件带 `runId` 与单调 `seq`；取消即时置位；终态事件唯一                                                        |
| R5   | 密钥写入日志或数据库明文                      | 泄露            | 密钥仅存安全存储/环境变量；日志脱敏；DB 不落明文密钥                                                           |
| R6   | Monaco 体积与打包体积过大                     | 构建慢/包大     | 阶段 3 已观察：主 chunk 约 7.5MB、ts.worker 约 11.6MB；阶段 8 评估按需语言与 worker 裁剪                       |
| R7   | Playwright 驱动 Electron 在 Windows 上不稳定  | e2e 阻塞        | 阶段 1 先跑通最小启动冒烟；必要时增加重试与显式等待                                                            |
| R8   | 大文件/大目录导致卡死                         | 性能问题        | 文件读取上限、目录条目上限、搜索并发与结果上限                                                                 |
| R9   | 模型输出非结构化导致工具调用解析失败          | Agent 停止      | zod 校验工具参数；失败回传错误给模型并限制重试次数                                                             |
| R10  | 一次性生成过多代码导致回归                    | 质量不可控      | 每阶段 ≤7 项任务，逐项验证，保持可回滚                                                                         |

## 8. 默认决策（无阻塞则采用）

- D1：开发平台以 Windows 为主，打包产物优先 Windows NSIS；macOS/Linux 保留配置但不作为 MVP 验收前置。
- D2：Agent 引擎先作为主进程内独立模块（纯 TS，不依赖 Electron API），接口保持可迁移到 utilityProcess / 子进程。
- D3：IPC 采用 `invoke/handle` + 单向事件通道（`send` 由主进程推送），事件统一带 `runId`。
- D4：数据库文件存放于 Electron `app.getPath('userData')/yocim.db`，不放在工作区内。
- D5：模型配置（baseURL、model、温度等）存库，API Key 不存库明文，走安全存储/环境变量。
- D6：MVP 仅支持单工作区（一个窗口一个工作区），多工作区留待后续。
- D7：版本控制：阶段 1 初始化 git 仓库并以阶段为单位提交，保证可回滚。

## 9. 变更记录

| 日期       | 阶段 | 变更内容                                                    |
| ---------- | ---- | ----------------------------------------------------------- |
| 2026-11-15 | 0    | 初版基线创建                                                |
| 2026-11-15 | 1    | 脚手架落地；R1 的 ABI 验证调整到阶段 6 开始时执行           |
| 2026-11-15 | 6    | better-sqlite3 因环境限制不可用，持久化切换为 `node:sqlite` |

## 10. 环境备注

- 本机：Windows / Node v24.15.0 / npm 11.12.1。
- Electron 45 起运行时不随 `npm install` 自动下载，首次启动才拉取。国内网络失败时先设置镜像再补齐：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

- 原生模块：阶段 6 不用 better-sqlite3（rebuild 需要 VS Build Tools 且项目路径含空格），改用 Electron 内置 `node:sqlite`，无需 ABI rebuild。
