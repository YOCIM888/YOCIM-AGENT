# YOCIM AGRNT — 验收清单（ACCEPTANCE）

> 验收原则：每条验收项必须有可复现的验证方式（命令、测试用例或操作步骤），并保存真实输出。未验证项一律标记为未通过。

## 1. 阶段验收门禁

### 阶段 0：环境与需求基线

- [ ] 仓库结构与环境已检查并记录（Node/npm 版本、已有文件）
- [ ] `docs/PLAN.md` 存在，含 MVP 范围、非目标、阶段计划、风险清单
- [ ] `docs/ARCHITECTURE.md` 存在，含文字版架构图、目录结构、IPC 与事件协议草案
- [ ] `docs/ACCEPTANCE.md` 存在（本文件）
- [ ] `docs/SECURITY.md` 存在，含安全边界与威胁应对

### 阶段 1：工程脚手架

- [x] `npm install` 成功（无未处理 peer 冲突）
- [x] `npm run dev` 能启动 Electron 窗口
- [x] `npm run typecheck` 通过
- [x] `npm run lint` 通过
- [x] `npm run test` 通过（至少 1 个有效单测）
- [x] `npm run build` 通过
- [x] 三端目录结构、路径别名、脚本链齐全
- [x] Playwright Electron 启动冒烟通过（preload 桥可用、无 Node 泄露）

### 阶段 2：安全 IPC 与工作区

- [x] renderer 仅能通过 `window.yocim.*` 访问主进程能力
- [x] 所有 IPC 入参经 zod 校验，非法入参返回 `{ ok: false, error }`
- [x] 可选择工作区并持久化当前工作区
- [x] 文件树与文件读取可用
- [x] 路径穿越（`..`、绝对路径、符号链接逃逸）被拒绝且有单测覆盖
- [x] e2e 冒烟覆盖工作区恢复、文件树渲染与文件预览

### 阶段 3：UI 骨架

- [x] Codex 类布局：左侧会话、中间编辑器、右侧文件树、底部状态栏
- [x] 应用图标使用 `public/image/yocim.png`
- [x] Monaco 可打开工作区文件（只读/编辑状态明确）
- [x] Pinia 四个 store 建立且职责清晰
- [x] 可看到对话界面与消息列表
- [x] renderer 无 Node API 调用（构建产物与源码双检查）
- [x] e2e 覆盖布局区域、Monaco 渲染、文件打开与对话消息

### 阶段 4：Agent 引擎

- [x] Provider 抽象完成，OpenAI-compatible 与 mock 两种实现
- [x] mock provider 下完成一次端到端流式对话
- [x] 取消生成生效（无后续事件、终态唯一）
- [x] 核心循环、工具调用编排有单元测试
- [x] 错误路径（provider 失败、工具失败、超时）有测试或明确记录
- [x] e2e 覆盖 mock 流式回复与生成结束状态

### 阶段 5：工具系统与审批

- [x] 五个工具可用：list_dir、read_file、search_files、write_file/patch、run_command
- [x] 读工具直接执行；写工具与命令必须审批
- [x] 拒绝审批后不执行，且模型收到拒绝结果
- [x] 审计记录包含时间、工具、参数摘要、结果、审批状态，并可在 UI 查看
- [x] 危险命令与路径逃逸测试通过
- [x] 命令执行有超时与输出截断
- [x] e2e 覆盖读工具、写工具审批通过/拒绝与审计面板

### 阶段 6：会话与持久化

- [x] SQLite schema 与迁移可重复执行（幂等）
- [x] 会话、消息、工具调用 CRUD 正常
- [x] 重启应用后会话与消息恢复
- [x] 会话重命名、删除、导出可用
- [x] 设置持久化可用；数据库内无明文 API Key
- [x] 数据库单测通过
- [x] e2e 覆盖会话重命名与重启后消息/审计恢复

### 阶段 7：端到端联调

- [x] Playwright 冒烟：启动 → 选工作区 → 发消息 → 审批写文件 → 重启恢复
- [x] 流式输出、工具调用状态、审批、取消、错误提示全链路可用
- [x] e2e 结果可复现（命令与输出留存）
- [x] 附加覆盖：生成中取消、审批挂起时取消、Provider 配置错误提示与恢复

### 阶段 8：打包与交付

- [x] `npm run package` 成功产出安装包（NSIS，120.18MB）
- [x] 安装包可启动并能完成一次基础对话（静默安装 → 启动 → 卸载验证；对话链路由同构建产物 e2e 覆盖）
- [x] 日志与崩溃处理可用，版本信息正确（`userData/logs/main.log` + 状态栏 v0.1.0）
- [x] README 覆盖安装、开发、模型配置、安全说明
- [x] 发布检查清单完成（[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)）

## 2. MVP 总验收（最终门禁）

- [x] `npm install && npm run dev` 可启动 YOCIM AGRNT 桌面窗口
- [x] 可选择工作区、浏览文件树、用 Monaco 打开文件
- [ ] 可配置 OpenAI-compatible 模型并流式对话（配置/SSE 解析已覆盖；待真实端点实测）
- [x] Agent 可调用读/搜索/写/命令工具
- [x] 写文件与命令执行必须审批，拒绝后不执行
- [x] 审计日志可查看
- [x] 会话重启后恢复
- [x] 取消生成有效
- [x] `typecheck`、`lint`、`unit test`、`e2e smoke`、`build` 通过
- [x] renderer 无 Node 直连，无密钥泄露，路径穿越被阻止
- [x] 至少打出一个平台安装包（Windows NSIS）

## 3. 验证命令基线（随阶段启用）

| 目的     | 命令                |
| -------- | ------------------- |
| 安装依赖 | `npm install`       |
| 开发启动 | `npm run dev`       |
| 类型检查 | `npm run typecheck` |
| 静态检查 | `npm run lint`      |
| 单元测试 | `npm run test`      |
| 端到端   | `npm run e2e`       |
| 构建     | `npm run build`     |
| 打包     | `npm run package`   |

## 4. 验收记录

| 阶段 | 日期       | 结果 | 备注                                                                                                                     |
| ---- | ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 0    | 2026-11-15 | 通过 | 四份文档创建完成，仓库为空、Node v24.15.0 / npm 11.12.1                                                                  |
| 1    | 2026-11-15 | 通过 | typecheck / lint / test / build 全通过；dev 窗口标题 YOCIM AGRNT；Playwright 冒烟 1 passed；Electron 45 二进制需镜像下载 |
| 2    | 2026-11-15 | 通过 | 25 个单测通过（含 junction 逃逸）；e2e 2 passed（工作区恢复 + 文件树 + 预览）；dev 窗口正常                              |
| 3    | 2026-11-15 | 通过 | Codex 布局 + Monaco（本地 worker）+ 四 store + 对话面板；e2e 2 passed，含 Monaco 文本断言；renderer 无 Node              |
| 4    | 2026-11-15 | 通过 | Agent 引擎 + mock/OpenAI SSE provider + chat IPC；37 单测（引擎/取消/SSE）；e2e 2 passed（流式 mock 回复）               |
| 5    | 2026-11-15 | 通过 | 5 工具 + 审批队列 + 审计；55 单测（工具/审批/危险命令/超时）；e2e 覆盖读、写批/拒与审计面板                              |
| 6    | 2026-11-15 | 通过 | node:sqlite 持久化 + 会话/设置 IPC；69 单测（迁移/CRUD/加密/导出）；e2e 重启恢复会话、消息与审计                         |
| 7    | 2026-11-15 | 通过 | IPC sender 校验 + 取消竞态修复；e2e 3 passed（真实选工作区、取消生成、审批取消、配置错误恢复、重启恢复）                 |
| 8    | 2026-11-15 | 通过 | NSIS 安装包 120.18MB；静默安装→启动→卸载通过；日志/版本/README/发布检查清单完成                                          |
