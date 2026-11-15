# 项目长期约定（YOCIM-AGENT）

- **文档策略**：`docs/WORKSPACE_PANEL_PLAN.md` 是用户自己维护的阶段计划。用户明确要求「不用另起文档」——阶段状态、验收结果、偏差说明、交接坑位一律就地更新该文档，不要另建计划/交接文档。README 有过期 UI 描述时同步修正。
- **验证基线**：`npm test`（单测）、`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run e2e`。在 WorkBuddy 会话里跑 e2e 必须去掉继承的 `ELECTRON_RUN_AS_NODE=1`：`env -u ELECTRON_RUN_AS_NODE npm run e2e`，否则 Electron 以 Node 模式启动并报 `bad option: --remote-debugging-port=0`。同一环境里 `npm test` 默认线程池会抛 `Vitest failed to find the runner`（沙箱 `NODE_OPTIONS` shim 与 tinypool 冲突，与本项目无关），改用 `npx vitest run --pool=vmThreads`。
- **IPC 铁律**：传给 `window.yocim.*` invoke 的参数必须是纯数据，不能是 Vue reactive Proxy（`ref.value` 里的对象/数组），否则 invoke reject 表现为「主进程无响应」；P1、P2 各踩过一次。
- **阶段进度**：P0–P4 已完成并验收（P4 = 任务运行 + Node.js CDP 调试 + 扩展第一层），下一阶段 P5a「WSL 远程」；P0–P4 均为未提交的工作区改动。
- **未落地偏差**：大纲仍用正则提取（未接 Monaco TS Worker）、无 fs watcher（靠保存/切换标签时 hash 比对）、ripgrep 二进制未打包（留到 P6 `electron-builder.yml` extraResources）、`.gitignore` 与 glob 为简化实现、Git 路径基准是工作区根而非仓库根、放弃更改拒绝未跟踪文件；调试是自研 CDP 而非 DAP/js-debug（只支持 Node launch，无 attach）、`launch.json` 无 JSON Schema 校验、VSIX 用自研最小 zip、扩展语法/主题贡献只展示不生效。详见计划文档 §14.3。
- **调试铁律**：在 Electron 主进程里 spawn 调试目标必须注入 `ELECTRON_RUN_AS_NODE=1`（`process.execPath` 是 electron.exe），否则目标被当 Electron 应用启动、永不命中用户断点；`DebugService.start` 必须先 `setBreakpoints` 再 `start()`；`executionContextDestroyed` 后要主动 `cdp.close()` 否则子进程不退出。
