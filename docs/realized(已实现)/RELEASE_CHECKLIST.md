# YOCIM AGENT 发布检查清单

## 1. 版本与元数据

- [ ] `package.json` 的 `version` 已更新
- [ ] `src/shared/app.ts` 的 `APP_VERSION` 与上者一致
- [ ] `electron-builder.yml` 的 `appId` / `productName` / `shortcutName` 正确
- [ ] `build/icon.png` 已更新（≥256×256，当前由 `public/image/yocim.png` 复制）

## 2. 自动化验证

```powershell
npm install
npm run format:check
npm run typecheck
npm run lint
npm run test
npm run build
npx playwright test
```

- [ ] 全部通过，且 e2e 为 3 passed（shell/取消、选工作区+工具+重启、配置错误恢复）

## 3. 打包

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run package
```

- [ ] `release/<version>/*-setup.exe` 存在
- [ ] `release/<version>/win-unpacked/YOCIM AGENT.exe` 可启动
- [ ] 安装包可安装、可从开始菜单/桌面启动

## 4. 手动冒烟（安装包或 win-unpacked）

- [ ] 启动后显示 logo 与 YOCIM AGENT 标题
- [ ] 选择工作区 → 文件树显示 → Monaco 打开文件
- [ ] 新建会话 → 发送消息 → 流式回复完成
- [ ] 发送 `/tool read <file>` → 返回文件内容
- [ ] 发送 `/tool write <file>` → 审批卡片 → 批准后文件写入
- [ ] 再次写文件 → 拒绝 → 文件未写入、审计显示已拒绝
- [ ] 生成中点击取消 → 停止输出，可继续发送
- [ ] 审批挂起时取消 → 审批消失、文件未写入
- [ ] 打开审计面板 → 记录完整（时间/工具/审批/结果）
- [ ] 重命名会话；重启应用 → 工作区、会话、消息、审计恢复
- [ ] 设置中切换到 OpenAI-compatible 且不填 Key → 发送提示配置错误；切回 Mock 恢复
- [ ] 填写真实 Base URL/模型/Key（如条件允许）→ 完成一次真实流式回复

## 5. 安全与隐私

- [ ] 数据库无明文 API Key（仅 `apiKeyEncrypted` 或环境变量）
- [ ] 日志不包含 API Key / 文件全文
- [ ] 越权路径（`..`、绝对路径、符号链接）被拒绝
- [ ] 危险命令（`rm -rf`、`mkfs`、`curl | sh` 等）被拦截
- [ ] renderer 无 `require` / `process` 暴露

## 6. 发布产物与说明

- [ ] 记录安装包路径、版本号、Electron/Node 版本
- [ ] README 中安装、模型配置、安全说明与实际一致
- [ ] 明确告知用户：当前未签名，SmartScreen 可能提示
- [ ] 保留上一版本产物以便回滚

## 7. 已知非阻塞项

- 未配置 Windows 代码签名 / macOS 公证
- Monaco 全量语言包导致安装包体积偏大
- `node:sqlite` 为实验性 API
- 真实模型未使用生产端点做长时压测
