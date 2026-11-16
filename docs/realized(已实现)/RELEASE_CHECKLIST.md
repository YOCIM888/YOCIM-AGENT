# YOCIM AGENT 发布检查清单

## 1. 版本与元数据

- [ ] `package.json` 的 `version` 已更新
- [ ] `src/shared/app.ts` 的 `APP_VERSION` 与上者一致
- [ ] `electron-builder.yml` 的 `appId` / `productName` / `shortcutName` 正确
- [ ] `build/icon.png` 已更新（≥256×256，当前由 `public/image/yocim.png` 复制）
- [ ] `resources/ripgrep/rg.exe` 与 `resources/ripgrep/README.md` 的版本号一致（当前 14.1.1）

## 2. 自动化验证

```powershell
npm install
npm run format:check
npm run typecheck
npm run lint
npm run test          # 278 例 / 33 文件
npm run build
npx playwright test   # 22 例
```

- [ ] 全部通过；e2e 覆盖 smoke / workspaceViews / fileExplorer / searchEditor / scmAudit / runDebugExtensions / remote 七组
- [ ] 在 CI 或干净机器上复跑一次，确认没有本地缓存依赖

## 3. 打包

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package
```

- [ ] `release/<version>/*-setup.exe` 存在（当前约 123MB）
- [ ] `release/<version>/win-unpacked/resources/ripgrep/rg.exe` 存在
- [ ] `npx @electron/asar list release/<version>/win-unpacked/resources/app.asar` 中只有 `out/`、`zod`、`ssh2` 及其依赖（不含 `cpu-features`/`nan`/`buildcheck`）
- [ ] win-unpacked 可直接启动，安装包可安装、可从开始菜单/桌面启动
- [ ] 打包后搜索面板不出现「未检测到 ripgrep」提示

## 4. 手动冒烟（安装包或 win-unpacked）

**基础**

- [ ] 启动后显示 logo 与 YOCIM AGENT 标题
- [ ] 选择工作区 → 文件树显示 → Monaco 打开文件并保存
- [ ] 新建会话 → 发送消息 → 流式回复完成
- [ ] 发送 `/tool read <file>` → 返回文件内容
- [ ] 发送 `/tool write <file>` → 审批卡片 → 批准后文件写入；再写一次并拒绝 → 文件未变
- [ ] 生成中点击取消 → 停止输出，可继续发送；审批挂起时取消 → 审批消失
- [ ] 重命名会话；重启应用 → 工作区、会话、消息、审计恢复

**工作区面板（P0–P6）**

- [ ] 8 个图标视图均可切换，重启后保留上次视图；活动栏在 1024 宽度下横向滚动
- [ ] 文件树：新建/重命名/复制/粘贴/删除（回收站）、拖拽移动、冲突对话框
- [ ] 搜索：命中分组、点击跳转并选中、替换预览 + 应用、时间线回滚
- [ ] 编辑器：多标签（12 上限）、预览/固定、外部修改冲突（覆盖/重载/另存）
- [ ] 源代码管理：暂存/取消、提交、Diff、分支切换、拉取/推送、放弃更改二次确认
- [ ] 审计：筛选、统计、详情抽屉、实时模式、JSON/CSV 导出
- [ ] 运行任务：npm script 与 `.yocim/tasks.json` 任务、流式输出、停止
- [ ] 调试：断点命中、变量/监视/调用堆栈、单步与继续、程序输出正确
- [ ] 扩展：本地/VSIX/VS Code 导入、三级兼容性、不兼容扩展不可启用、片段补全生效
- [ ] 远程：WSL/SSH 目标保存与校验、连接失败提示可读、连接成功后状态栏显示徽标
- [ ] 多模型：设置为真实端点（Base URL/模型/Key）完成一次真实流式回复；错误配置给出可读提示

## 5. 安全与隐私

- [ ] 数据库无明文 API Key / SSH 口令（`apiKeyEncrypted` / `secret_encrypted` 或环境变量）
- [ ] 日志不包含 API Key / 文件全文；任务与调试输出已脱敏、去 ANSI
- [ ] 越权路径（`..`、绝对路径、符号链接、`\\` 网络路径）被拒绝
- [ ] 危险命令（`rm -rf`、`mkfs`、`curl | sh` 等）被拦截
- [ ] renderer 无 `require` / `process` 暴露
- [ ] SSH 主机指纹变化时阻断，并在 UI 提示重新信任

## 6. 发布产物与说明

- [ ] 记录安装包路径、版本号、Electron/Node 版本、包体积
- [ ] README 中安装、模型配置、打包、安全说明与实际一致
- [ ] 明确告知用户：当前未签名，SmartScreen 可能提示
- [ ] 保留上一版本产物以便回滚

## 7. 已知非阻塞项

- 未配置 Windows 代码签名 / macOS 公证
- WSL 与 SSH 的成功路径尚未在真机端到端验收（WSL 需装有发行版的 Windows，SSH 需可连服务器）
- 远程工作区不支持调试、批量替换与「仅在打开文件中搜索」；Agent 工具仍限本地工作区
- 调试只支持 Node.js launch（自研 CDP，无 attach）
- 扩展只有第一层，不执行扩展代码
- Monaco 全量语言包导致安装包偏大（123MB）
- `node:sqlite` 为实验性 API
- 真实模型未使用生产端点做长时压测
