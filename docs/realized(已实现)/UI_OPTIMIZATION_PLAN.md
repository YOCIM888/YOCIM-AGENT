# YOCIM AGRNT UI 重构计划（DeepSeek Harness 风格）

> 状态：**已完成** — UI-0 设计基线、UI-1 项目化会话数据、UI-2 右侧工作区面板、UI-3 中间会话区、UI-4 步骤时间线与内联审批、UI-5 视觉与交互打磨、UI-6 回归与交付全部完成（2026-11-15）。
> 增量优化（2026-11-15）：移除顶部栏，改为无边框自绘标题栏（左上 `应用` / `编辑`，右上最小化/最大化/关闭）；品牌 Logo 移至左栏顶部；会话与项目操作改为右键菜单。实现细节见 [UI_IMPLEMENTATION.md](UI_IMPLEMENTATION.md) 的 2.1 / 2.2 节。
> 目标：在保留现有 Agent / 工具 / 持久化能力的前提下，将 UI 重构为「左侧项目化会话列表 + 中间纯会话区 + 右侧工作区面板」，视觉语言参考 DeepSeek Harness 桌面端。
> 已实现阶段文档已归档到 `docs/realized(已实现)/`。

## 1. 调研结论

### 1.1 DeepSeek Harness 桌面端（DSH）

结合官网、公开体验文章与两张桌面端截图，DSH 的 UI 特征可以归纳为：

| 维度       | 观察                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整体气质   | 极简、浅色、低对比、大留白；接近「空白画布 + 悬浮输入卡」                                                                                                     |
| 色彩       | 白 / 浅灰背景（#fff、#f7f7f8），浅灰细边框，深灰正文；单一蓝色强调（发送按钮、选中态）                                                                        |
| 字体与排版 | 系统字体，13–14px 正文，欢迎页大标题；行高宽松（1.6–1.8）                                                                                                     |
| 形状       | 卡片 12–18px 圆角，输入框接近 18px；阴影极轻                                                                                                                  |
| 左侧栏     | 品牌区（deepseek HARNESS）、「新会话」主按钮、功能导航（插件/自动化任务/更多）、「工作区」分组与刷新/导出/新建图标、底部用户区                                |
| 中间区     | 空会话时展示品牌 Hero「探索未至之境」+ 预览版徽标；下方为上下文 chips（默认工作区、标准模式）与大输入框；输入框内包含附件、工作区修改模式、模型选择、发送按钮 |
| 右侧栏     | 当前截图为「开始」工具面板：工作区文件（Ctrl+P）、新建终端、浏览器、更多工具；可折叠/展开                                                                     |
| 交互特征   | 会话可置顶/归档/搜索；工作区可切换；Agent 执行过程可控制展示程度；大量快捷键；窗口关闭后后台任务继续                                                          |

参考来源：

- [DeepSeek Harness 官网](https://www.deepseek.com/en/harness/)
- [36氪：DeepSeek Harness 桌面版来了](https://36kr.com/p/4005374745563268)
- [dsh-workbench-plugin（三栏工作台布局说明）](https://www.npmjs.com/package/dsh-workbench-plugin)
- 用户提供的两张 DSH 桌面端截图（浅色空态 / 三栏工作台）

### 1.2 与本项目目标的差异

用户本轮明确要求的布局与 DSH 截图并不完全相同，需以用户要求为准：

| 区域 | DSH 截图                   | 本项目目标                                                                                 |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------ |
| 左侧 | 会话/功能导航 + 工作区列表 | **项目化会话列表**（项目分组可展开/折叠、单项目多会话、搜索/置顶/归档/跨项目迁移），可折叠 |
| 中间 | 会话（空态 Hero + 输入框） | **纯会话区**（欢迎态、消息流、流式工作状态、输入框），可占满                               |
| 右侧 | 「开始」快捷工具面板       | **工作区面板**（项目信息、文件树、编辑器、审计），Tab 切换，可折叠                         |

因此本项目采用 **「DSH 视觉语言 + 自定义三栏布局」**：不复制 DSH 的功能结构（插件、终端、浏览器、账号体系不做），只借鉴其留白、浅色、卡片、输入框与步骤展示方式。

### 1.3 现有实现盘点（重构基线）

- 布局：[MainView.vue](../src/renderer/src/views/MainView.vue)、[TopBar.vue](../src/renderer/src/components/TopBar.vue)、[SessionSidebar.vue](../src/renderer/src/components/SessionSidebar.vue)、[EditorPane.vue](../src/renderer/src/components/EditorPane.vue)、[FileTreePanel.vue](../src/renderer/src/components/FileTreePanel.vue)、[ChatPanel.vue](../src/renderer/src/components/ChatPanel.vue)、[StatusBar.vue](../src/renderer/src/components/StatusBar.vue)、[AuditPanel.vue](../src/renderer/src/components/AuditPanel.vue)
- Stores：workspace / session / chat / settings（Pinia）
- 数据：SQLite `sessions`（含 `workspace_root`，无项目表）、`messages`、`tool_calls`、`settings`、`audit_logs`
- 会话与工作区：会话列表扁平；工作区只有一个当前值；文件树在右、编辑器在中、对话在底部横条
- 流式表现：`tool:call` / `tool:result` 以系统消息追加到聊天记录，缺少步骤聚合与运行状态
- 主题：仅深色（`#0b0d12`），与 DSH 的浅色留白风格差异较大

主要问题：

1. 对话被压缩在底部 260px，编辑器占据主视觉，与「AI 会话产品」定位不符；
2. 会话扁平列表无法表达「项目 → 多会话」；
3. 工具调用以文本系统消息堆叠，缺少可折叠的执行时间线；
4. 深色重边框风格与目标参考差距大。

## 2. 目标布局

### 2.1 三栏线框

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 顶栏 40px：LOGO / 工作区名 / 当前会话 / 模型 chip / 主题切换 / 设置           │
├────────────────┬────────────────────────────────────────┬────────────────────┤
│ 左：会话列表     │ 中：会话区（主视觉）                    │ 右：工作区           │
│ 300px，可折叠    │ 自适应，最小 560px                     │ 280px，可折叠        │
│                │                                        │                    │
│ 搜索 + 新建会话  │ 会话头：标题 · 状态 · 停止              │ 工作区名 / 路径      │
│ ★ 置顶          │                                        │ [切换] [折叠]        │
│ 项目 A ▼  [+新]  │ 消息流（用户 / 助手 / 步骤时间线）      │ ┌ 文件 ┐编辑器┐审计┐ │
│   ├ 会话 1      │                                        │ │ 文件树         │ │
│   ├ 会话 2      │ 流式状态条：思考中 / 工具执行 / 审批中   │ │ 或 Monaco      │ │
│ 项目 B ▶        │                                        │ │ 或 审计        │ │
│   └ 会话 3      │ 输入卡：上下文 chips + 多行输入 + 发送   │ └───────────────┘ │
├────────────────┴────────────────────────────────────────┴────────────────────┤
│ 状态栏（默认 22px 折叠）：版本 · 工作区 · 运行状态 · 主题/模型 · [展开]        │
│ 展开后（约 56px）：额外显示当前文件、Electron/Node、平台、审计条数            │
└──────────────────────────────────────────────────────────────────────────────┘
```

折叠态：

- 左栏折叠为 46px 图标轨（会话 / 新建 / 展开），折叠时不卸载会话数据；
- 右栏折叠为 46px 图标轨（文件 / 编辑器 / 审计 / 展开），折叠时保留当前 tab 图标高亮；
- 中栏始终存在，折叠两侧后最大宽度约 960px，消息与输入框居中；
- 状态栏默认折叠为 22px 单行摘要，点击展开为多信息行；展开状态持久化。

### 2.2 视觉令牌

默认 **浅色**，支持切换到 **深色（纯黑）**；通过 `<html data-theme="light|dark">` + CSS 变量切换，选择持久化到本地 UI 偏好。

| Token               | Light                                                   | Dark（纯黑） | 用途             |
| ------------------- | ------------------------------------------------------- | ------------ | ---------------- |
| `--bg`              | `#ffffff`                                               | `#000000`    | 主背景           |
| `--bg-subtle`       | `#f7f7f8`                                               | `#0a0a0a`    | 侧栏、输入卡背景 |
| `--bg-elevated`     | `#ffffff`                                               | `#111111`    | 卡片、弹层       |
| `--bg-hover`        | `#f0f1f3`                                               | `#1a1a1a`    | hover            |
| `--border`          | `#e7e7e9`                                               | `#222222`    | 分隔线、卡片描边 |
| `--text`            | `#202124`                                               | `#ededed`    | 正文             |
| `--text-muted`      | `#8a8f99`                                               | `#8a8a8a`    | 次要信息         |
| `--accent`          | `#4d6bfe`                                               | `#6b83ff`    | 发送、选中、链接 |
| `--accent-soft`     | `#eef1ff`                                               | `#141a33`    | 选中背景         |
| `--success`         | `#1f9d63`                                               | `#3fbf82`    | 成功/完成        |
| `--warning`         | `#c47a12`                                               | `#e0a04a`    | 审批/警告        |
| `--danger`          | `#d64545`                                               | `#ff6b6b`    | 错误/拒绝        |
| `--radius-sm/md/lg` | 8 / 12 / 18px                                           | 同左         | 按钮/卡片/输入框 |
| 字体                | system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei" | 同左         | 全局             |
| 字号                | 13px 正文 / 12px 辅助 / 28px 欢迎标题                   | 同左         | —                |
| 动效                | 150ms ease-out；流式光标 1s 闪烁                        | 同左         | —                |

主题切换入口：顶栏图标按钮 + 设置面板；不强制跟随系统（默认浅色），后续可加「跟随系统」选项。

## 3. 区域设计

### 3.1 右侧：工作区面板

- 顶部：工作区图标 + 名称（悬浮显示完整路径）+「切换工作区」+ 折叠按钮；
- Tab（**已确认**）：`文件` / `编辑器` / `审计`；
  - 文件：保留现有文件树与刷新，深度 3；点击文件自动切到「编辑器」；
  - 编辑器：Monaco 只读，标签栏显示当前文件与大小/截断状态；
  - 审计：复用现有审计列表，按当前会话过滤（可切换全部）；
- 空态：未选择工作区时显示引导按钮；
- 折叠态只显示图标轨，点击图标恢复并切换对应 tab；
- 不新增终端/插件等 DSH 功能。

### 3.2 中间：纯会话区

- 无会话内容时：DSH 风格欢迎态
  - 品牌图形 + 「探索未至之境」类文案（最终文案待定）；
  - 上下文 chips：当前工作区、模式（标准）；
  - 大输入卡：多行自动增高、附件按钮（首版禁用/占位）、模型 chip、发送按钮；
- 有消息时：
  - 顶部会话头：标题、项目名、运行状态（思考中 / 工具执行中 / 等待审批 / 已完成 / 已取消 / 失败）、停止按钮；
  - 消息流最大宽度 820px，用户消息右对齐浅色气泡，助手消息左对齐无气泡（DSH 风格）；
  - **助手消息支持 Markdown 渲染**（已确认）：标题、列表、表格、引用、代码块与行内代码；代码块支持语言标识与横向滚动；
  - 助手消息内的工具执行改为「步骤时间线」：默认折叠为一行「已执行 3 个步骤 · 12s」，展开显示 `思考 → tool:call → tool:result → 审批`；审批卡片内联在时间线内；
  - 运行错误显示为可重试的错误卡片，而不是普通系统消息；
- 输入区固定底部：Enter 发送 / Shift+Enter 换行；发送中变为「停止」；草稿按会话保存。

### 3.3 左侧：项目化会话列表

- 顶部：搜索框（按标题过滤，`Ctrl+K` 聚焦）+「新建会话」+ 折叠；
- **置顶区**（已确认）：
  - 顶部独立「★ 置顶」区，跨项目汇总所有置顶会话；
  - 取消置顶后回到所属项目分组；置顶状态持久化（`pinned_at`）。
- **项目分组**：
  - 组头：折叠箭头、文件夹图标、项目名、会话数量、hover 操作（新建会话 / 打开工作区 / 重命名）；
  - 展开后列出会话：标题、更新时间、运行状态点；hover 操作（重命名 / 导出 / 删除 / 置顶 / 归档 / 移动到项目…）；
  - 会话点击切换；「新建会话」自动绑定该项目；
  - 项目展开/折叠状态持久化到本地 UI 偏好。
- **搜索**（已确认）：
  - 输入即过滤，跨项目展示匹配会话；空结果显示提示；
  - 默认不搜索归档会话，提供「包含已归档」开关。
- **归档**（已确认）：
  - 归档会话从项目列表隐藏；通过「显示归档」筛选查看；
  - 支持取消归档；归档当前会话时自动切到下一个可见会话。
- **跨项目迁移**（已确认）：
  - 「移动到项目…」弹出项目选择器；迁移后更新 `project_id` 与 `workspace_root`；
  - 迁移不会自动切换当前工作区；下次打开该会话时按项目根切换工作区（见 4.4）。
- 空态：无项目时引导「选择工作区」；有项目无会话时显示「新建第一个会话」；
- 折叠态：图标轨，保留新建按钮。

### 3.4 底部状态栏

- 默认折叠为 22px 单行：`v0.1.0 · 工作区名 · 运行状态 · 模型/主题 · [展开]`；
- 展开后约 56px：追加当前文件、Electron/Node 版本、平台、审计条数；
- 展开/折叠状态与高度持久化到本地 UI 偏好；
- 运行状态与中栏会话头共享同一状态源（idle/thinking/tool/approval/error）。

## 4. 数据与状态改造

### 4.1 数据模型

当前 `sessions.workspace_root` 已能表达归属，但无法表达「空项目」、项目重命名、置顶/归档。新增 `projects` 表并扩展 `sessions`：

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE sessions ADD COLUMN project_id TEXT;
ALTER TABLE sessions ADD COLUMN pinned_at INTEGER;
ALTER TABLE sessions ADD COLUMN archived_at INTEGER;

CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at);
CREATE INDEX idx_sessions_pinned ON sessions(pinned_at);
CREATE INDEX idx_sessions_archived ON sessions(archived_at);
```

迁移 v2：

1. 创建 `projects`；
2. 将现有会话按 `workspace_root` 去重插入项目（NULL/空归入「默认工作区」）；
3. 回填 `sessions.project_id`；
4. 保留 `workspace_root` 作为导出/展示兼容字段；
5. 迁移前自动备份 `yocim.db` 到 `yocim.db.bak-v1`（一次）。

### 4.2 IPC / shared

新增或调整：

| 通道               | 说明                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `project:list`     | 返回项目 + 会话数量 + 最近会话时间                                                       |
| `project:rename`   | 项目重命名                                                                               |
| `session:list`     | 支持 `projectId`、`includeArchived` 过滤，返回含 `projectId` / `pinnedAt` / `archivedAt` |
| `session:create`   | 入参增加 `projectId`；不传则使用当前工作区项目                                           |
| `session:pin`      | `{ sessionId, pinned }`                                                                  |
| `session:archive`  | `{ sessionId, archived }`                                                                |
| `session:move`     | `{ sessionId, projectId }`，同步 `workspace_root`                                        |
| `workspace:select` | 选定工作区后自动 ensure 项目                                                             |

`SessionSummary` 增加 `projectId`、`pinnedAt`、`archivedAt`；新增 `ProjectSummary`。

### 4.3 渲染层 Stores

- 新增 `projects` store：项目列表、选中项目、展开状态（持久化到 `localStorage` UI 偏好）；
- `session` store：分组 computed（置顶区 / 项目区 / 归档筛选）、搜索关键词、置顶/归档/迁移动作；
- `workspace` store：继续持有当前工作区、文件树、当前文件；选择工作区后刷新项目；
- `chat` store：新增 `runStatus`（idle/thinking/tool/approval/error）与 `steps: AgentStep[]`，把现有 `tool:call`/`tool:result` 系统消息迁移为结构化步骤；消息按 session 保留；
- `settings` store：新增 `theme: 'light' | 'dark'`，应用到 `<html data-theme>`；持久化到本地 UI 偏好；
- UI 偏好（栏宽、左右折叠状态、状态栏折叠、项目展开状态）存 `localStorage`，不进数据库。

### 4.4 工作区与会话联动

- 选择项目或会话时，工作区切换到该会话所属项目的根目录，右侧文件树/编辑器随之刷新；
- 工具执行仍使用当前工作区守卫，因此「当前工作区 = 当前会话所属项目」必须保持一致；
- 跨项目迁移只修改会话归属，不切换工作区；打开该会话时再切换；
- 新建会话继承当前活动的项目与工作区；无项目时先引导选择工作区。

### 4.5 组件拆分（建议）

新增：

- `layout/AppShell.vue`：三栏 + 折叠 + 顶栏 + 状态栏；
- `layout/WorkspacePanel.vue`：右栏容器 + tabs；
- `layout/ConversationView.vue`：中栏容器；
- `layout/SessionPanel.vue`：左栏容器；
- `session/ProjectGroup.vue`、`session/SessionItem.vue`、`session/PinnedSection.vue`、`session/MoveSessionDialog.vue`；
- `chat/WelcomeState.vue`、`chat/Composer.vue`、`chat/MessageList.vue`、`chat/MarkdownMessage.vue`、`chat/StepTimeline.vue`、`chat/ApprovalCard.vue`、`chat/RunStatusBar.vue`；
- `ui/IconButton.vue`、`ui/PanelRail.vue`、`ui/ThemeToggle.vue` 等小组件。

改造/移除：

- `MainView.vue` 只负责 AppShell 组合与初始化；
- `TopBar.vue` 精简为浅色/深色顶栏（LOGO、标题、模型 chip、主题切换、设置）；
- `SessionSidebar.vue` 由左栏新组件替代（逻辑迁移）；
- `ChatPanel.vue` 拆分为中栏对话组件（逻辑迁移）；
- `EditorPane.vue`、`FileTreePanel.vue`、`AuditPanel.vue` 移入右栏 tabs；
- `StatusBar.vue` 改为可折叠单行/展开两种形态。

### 4.6 Markdown 渲染

- 新增依赖：`marked`（解析）+ `dompurify`（净化），均为轻量库，仅 renderer 使用；
- 渲染管线：Markdown → HTML → DOMPurify 白名单净化 → `v-html`；禁止直接渲染未净化 HTML；
- 代码块样式、表格、引用、链接（外链安全打开）纳入 UI-5 视觉打磨；
- 流式过程中按节流（约 60ms）重渲染，避免每个 token 全量解析；
- 单测覆盖 XSS 输入（`<script>`、`onerror`、`javascript:` 链接）与基础 Markdown 输出。

## 5. 分阶段实施计划

> 每阶段独立可回滚；实现从 UI-0 开始。

### UI-0：设计基线

- 落地浅/深色 token、字体、基础 UI 组件、主题切换；
- 建立三栏 AppShell 与折叠状态、可折叠状态栏（先用现有组件占位）；
- 验收：1024/1280/1440 三档无横向溢出；浅/深色切换正常；折叠/展开与状态栏折叠持久化；现有功能不回退。

### UI-1：项目化会话数据

- DB 迁移 v2（projects、project_id、pinned_at、archived_at）+ 仓储 + IPC + preload；
- 左栏项目分组、置顶区、搜索、归档筛选、跨项目迁移、会话重命名/删除/导出；
- 验收：单项目多会话；置顶/归档/搜索/迁移可用；重启恢复；旧数据迁移成功。

### UI-2：右侧工作区面板

- 文件/编辑器/审计 Tab；文件点击自动切编辑器；折叠图标轨；
- 移除居中的编辑器与旧文件树位置；
- 验收：Monaco 不重复初始化；切换 tab 保留模型；文件树/审计可用；会话切换时工作区同步。

### UI-3：中间会话区（已完成）

- 欢迎态、上下文 chips、输入卡、消息流、会话头与运行状态、停止/取消；
- Markdown 渲染与安全净化；
- 移除底部对话横条；
- 验收：mock 流式对话、取消、审批通过/拒绝、错误提示全部在新布局可用；Markdown/XSS 单测通过。

实现备注：`lib/markdown.ts`（marked + DOMPurify，FORBID `style/form/input/button`）、`MarkdownMessage.vue`（60ms 流式节流、链接外开）、`WelcomeState.vue`、`ChatComposer.vue`（自动增高、chips、模型、发送/停止，欢迎态隐藏上下文 chips）、`ChatPanel.vue`（会话头状态 就绪/生成中/等待审批、用户气泡、系统消息、审批卡）；新增 `tests/unit/markdown.test.ts` 与 e2e Markdown/XSS 断言。

### UI-4：步骤时间线与内联审批（已完成）

- `AgentStep` 状态机：thinking / tool_call / tool_result / approval / error；
- 折叠摘要 + 展开时间线；审批卡片内联；错误卡可重试；
- 验收：读工具、写审批、拒绝、取消、审计步骤展示完整且不重复。

实现备注：`lib/agentSteps.ts` 纯状态机（`upsertToolStep` 按 callId 去重、`resolveToolStep`、`attachStepApproval`、`resolveStepApproval`、`closePendingApprovals`、`settleRunningSteps`）；`AgentTimeline.vue` 折叠显示「已执行 N 个步骤 · Xs」，展开为步骤时间线，审批卡内联并在待审批时自动展开；`chat.ts` 按 runId 归档步骤、错误挂载到助手消息并提供 `retry()`；`ChatPanel.vue` 用可重试错误卡替代普通系统消息；新增 `tests/unit/agentSteps.test.ts`，e2e 覆盖时间线展开、内联审批通过/拒绝、审批挂起取消与错误重试。

### UI-5：视觉与交互打磨（已完成）

- 空态、hover、focus、动画、滚动到底、代码块/表格样式；
- 快捷键：`Ctrl+B` 左栏、`Ctrl+Shift+B` 右栏、`Ctrl+N` 新建会话、`Ctrl+K` 搜索会话、`Ctrl+J` 状态栏；
- 响应式：<1200 自动收窄、<1024 强制折叠一侧；
- 深色模式细节校正（纯黑背景、边框对比、Monaco `vs-dark`）；
- 验收：视觉走查通过；键盘可达；无布局抖动；浅/深色对比度均 ≥ 4.5:1。

实现备注：`MainView.vue` 注册全局快捷键并在跨入 <1024px 时自动折叠工作区（窗口 `minWidth` 调整为 900）；侧栏/工作区在 <1200px 收窄；`ChatPanel.vue` 增加粘底滚动（距底 80px 内跟随流式内容）与消息入场动画；`MarkdownMessage.vue` 表格横向滚动；`main.css` 校正浅/深色文字、强调、警告、危险色，关键色对对比度均 ≥ 4.5:1，并支持 `prefers-reduced-motion`；e2e 覆盖全部快捷键、窄窗口自动折叠与 Ctrl+N 欢迎态。

### UI-6：回归与交付（已完成）

- 更新 e2e 选择器与流程（选项目 → 新建会话 → 工具审批 → 置顶/归档/搜索 → 重启恢复）；
- 全量 typecheck/lint/test/build/e2e；
- 更新 README 截图与使用说明；新增 `docs/UI_IMPLEMENTATION.md`（实现后）。
- 验收：全部自动化通过；手动清单通过；旧数据升级无丢失。

实现备注：新增全流程 e2e 用例；README 增加界面预览（欢迎态、深色时间线、Markdown、工作区编辑器）与快捷键说明；新增 [UI_IMPLEMENTATION.md](UI_IMPLEMENTATION.md) 记录组件、状态、时间线、主题、测试与限制；format/typecheck/lint/79 单测/build/5 e2e 全部通过；数据库 v1→v2 迁移与旧会话回填单测通过。

## 6. 验收标准

### 功能

- [x] 三栏布局：左会话列表、中会话区、右工作区面板；
- [x] 左右栏均可折叠/展开，状态在重启后保留；
- [x] 左栏项目分组可展开/折叠，单项目可创建多个会话；
- [x] 会话搜索、置顶、归档/取消归档、跨项目迁移可用；
- [x] 会话切换、重命名、删除、导出在新布局可用；
- [x] 中栏流式回复、停止生成、失败提示、审批通过/拒绝可用；
- [x] 工具执行以步骤时间线展示，可展开查看详情；
- [x] 助手消息 Markdown 渲染，代码块/表格/链接正常且已净化；
- [x] 右栏可浏览文件树、用 Monaco 打开文件、查看审计；
- [x] 状态栏默认折叠为单行，可展开并持久化；
- [x] 浅色默认、可切换纯黑深色，重启后保留；
- [x] 重启后工作区、项目、会话、消息、审计、置顶/归档状态恢复。

### 视觉

- [x] 浅色、低对比、细边框、大留白与 DSH 参考一致；
- [x] 深色为纯黑背景，层级通过边框与浅灰面板区分；
- [x] 欢迎态包含品牌、上下文 chips、大输入卡；
- [x] 1024 / 1280 / 1440 宽度无溢出、无遮挡；
- [x] 折叠动画 ≤200ms，无 Monaco 重排闪烁。

### 回归

- [x] `npm run typecheck` / `lint` / `test` / `build` / `npx playwright test` 全通过；
- [x] renderer 仍无 Node 直连；
- [x] 既有安全边界（路径守卫、审批、命令白名单）不受 UI 重构影响。

## 7. 风险与对策

| 风险                       | 影响             | 对策                                                                          |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| DB v2 迁移影响既有会话     | 数据丢失         | 迁移前备份；单测覆盖空库/旧库/重复迁移；e2e 重启验证                          |
| e2e 选择器大面积变化       | 回归成本         | 分阶段替换，保留关键 `data-testid`；UI-6 统一更新                             |
| 多项目会话与全局工作区冲突 | 工具操作错误目录 | 会话选择即切换工作区；迁移后打开会话再切换（4.4）；e2e 覆盖跨项目迁移         |
| 置顶/归档/搜索状态复杂     | 列表错乱         | 会话列表单一数据源 + computed 分组；状态字段入库；单测覆盖排序与筛选          |
| Monaco 放入窄面板          | 布局抖动/性能    | 保持编辑器实例与 model 缓存；ResizeObserver + `automaticLayout`；折叠时不销毁 |
| 流式步骤状态机复杂         | 状态错乱         | 复用现有 `runId + seq` 事件；步骤按消息聚合；单测覆盖取消/错误/审批           |
| 双主题对比度不足           | 可读性           | 统一 token；正文对比度 ≥ 4.5:1；深色模式单独走查                              |
| Markdown 渲染引入 XSS      | 安全             | `marked` + DOMPurify 白名单；禁止裸 `v-html`；XSS 单测；新增依赖需说明        |
| 范围蔓延（插件/终端/账号） | 延期             | 明确非目标：不做 DSH 插件系统、账号、终端、浏览器面板                         |

## 8. 非目标

- 不实现 DSH 的插件市场、Creator mode、账号/余额；
- 不实现内置终端、浏览器、Office 预览；
- 不做多窗口、多工作区并行（同一时间仅一个活动工作区）；
- 不改动 Agent 循环、工具安全策略与审批语义（仅展示层重构）。

## 9. 已确认决策（2026-11-15）

1. **主题**：默认浅色，支持切换深色（纯黑背景）；切换状态持久化。
2. **右侧布局**：文件树 / 编辑器 / 审计采用 Tab。
3. **左栏范围**：首版包含会话搜索、置顶、归档、跨项目迁移。
4. **项目定义**：一个工作区文件夹 = 一个项目；同一项目可创建多个会话。
5. **状态栏**：保留；默认折叠为单行摘要，可展开查看详细信息，展开状态持久化。
6. **Markdown**：助手消息需要 Markdown 渲染，并做 XSS 净化。

## 10. 参考

- [DeepSeek Harness 官网](https://www.deepseek.com/en/harness/)
- [36氪：DeepSeek Harness桌面版来了](https://36kr.com/p/4005374745563268)
- [dsh-workbench-plugin（npm）](https://www.npmjs.com/package/dsh-workbench-plugin)
- [dsh-session-manager（npm，会话/工作区管理参考）](https://www.pkgstats.com/pkg:dsh-session-manager)
- 用户提供的 DSH 桌面端截图（浅色空态与三栏工作台）
- 归档的既有实现文档：[PLAN](realized%28已实现%29/PLAN.md)、[ARCHITECTURE](realized%28已实现%29/ARCHITECTURE.md)、[ACCEPTANCE](realized%28已实现%29/ACCEPTANCE.md)、[SECURITY](realized%28已实现%29/SECURITY.md)
