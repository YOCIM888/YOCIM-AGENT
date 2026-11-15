# 多模型 Provider 接入方案

> 状态：**已完成**（2026-11-15）
> 目标：在设置中添加多家模型服务商，并在中间会话区输入卡右下角快速切换模型；保留 Mock、离线可用与既有安全边界。

## 1. 调研结论

### 1.1 Provider 协议与端点

| Provider            | 协议                   | 默认 Base URL                                       | 说明                                   |
| ------------------- | ---------------------- | --------------------------------------------------- | -------------------------------------- |
| Mock                | 内置                   | -                                                   | 离线演示与 e2e，默认启用               |
| DeepSeek            | OpenAI-compatible      | `https://api.deepseek.com/v1`                       | `deepseek-chat` / `deepseek-reasoner`  |
| Qwen（通义千问）    | OpenAI-compatible      | `https://dashscope.aliyuncs.com/compatible-mode/v1` | DashScope 兼容模式                     |
| BigModel（智谱）    | OpenAI-compatible      | `https://open.bigmodel.cn/api/paas/v4`              | GLM 系列                               |
| Kimi（Moonshot）    | OpenAI-compatible      | `https://api.moonshot.cn/v1`                        | Moonshot/Kimi 系列                     |
| MiniMax             | OpenAI-compatible      | `https://api.minimaxi.com/v1`                       | 国内站；国际站为 `api.minimax.io`      |
| 腾讯云（混元）      | OpenAI-compatible      | `https://api.hunyuan.cloud.tencent.com/v1`          | 混元 OpenAI 兼容接口                   |
| 阿里云（百炼）      | OpenAI-compatible      | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 与 Qwen 同端点，模型清单不同           |
| 硅基流动            | OpenAI-compatible      | `https://api.siliconflow.cn/v1`                     | 聚合模型                               |
| 火山引擎（方舟）    | OpenAI-compatible      | `https://ark.cn-beijing.volces.com/api/v3`          | 模型名/Endpoint ID 以控制台为准        |
| Claude（Anthropic） | Anthropic Messages     | `https://api.anthropic.com/v1`                      | `x-api-key` + `anthropic-version`      |
| Gemini（Google）    | Gemini GenerateContent | `https://generativelanguage.googleapis.com/v1beta`  | SSE：`streamGenerateContent?alt=sse`   |
| Grok（xAI）         | OpenAI-compatible      | `https://api.x.ai/v1`                               | OpenAI 兼容                            |
| 本地 Ollama         | OpenAI-compatible      | `http://localhost:11434/v1`                         | 无需 API Key                           |
| 自定义              | 三选一                 | 用户填写                                            | `openai` / `anthropic` / `gemini` 协议 |

### 1.2 协议差异

- **OpenAI-compatible**：`POST /chat/completions`，`Authorization: Bearer`，SSE `data:` 增量；工具调用为 `tool_calls` 增量数组。现有实现可直接复用。
- **Anthropic Messages**：`POST /v1/messages`；`system` 独立字段；`tool_use` / `tool_result` 内容块；SSE 事件为 `content_block_start` / `content_block_delta` / `message_delta`。
- **Gemini**：`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`；`systemInstruction`、`contents.parts`、`functionCall` / `functionResponse`；SSE 每条 `data:` 为完整候选片段。
- **Ollama**：`/v1` 提供 OpenAI 兼容层，可作为 OpenAI-compatible 处理；模型名由本地 `ollama list` 决定。

## 2. 数据模型

### 2.1 共享类型

```ts
type ProviderProtocol = 'openai' | 'anthropic' | 'gemini'
type ProviderPresetId =
  | 'mock'
  | 'deepseek'
  | 'qwen'
  | 'bigmodel'
  | 'kimi'
  | 'minimax'
  | 'tencent'
  | 'aliyun'
  | 'siliconflow'
  | 'volcano'
  | 'claude'
  | 'gemini'
  | 'grok'
  | 'ollama'
  | 'custom'

interface ProviderPreset {
  id: ProviderPresetId
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: string[]
  requiresApiKey: boolean
  description: string
}

interface ProviderConfig {
  id: string // mock / preset id / custom-<uuid>
  presetId: ProviderPresetId
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string // 最近一次选择的模型
  models: string[] // 可选模型清单
}
```

`PublicProvider` 额外暴露 `hasApiKey`，绝不返回 key 明文。

### 2.2 存储与迁移

复用 `settings` key-value 表，无需 DB schema 升级：

- `providers`：`ProviderConfig[]` JSON；
- `activeProviderId`、`activeModel`；
- `providerApiKey:<providerId>`：`safeStorage` 加密后的 key；
- 兼容迁移：若不存在 `providers` 且存在旧 `provider/baseUrl/model/apiKeyEncrypted`，自动生成一个 `custom` Provider 并设为当前；旧 key 迁移到 `providerApiKey:custom`。
- 默认内置 `mock`，不可删除；其余 Provider 由用户在设置中添加。

### 2.3 环境变量回退

有 key 缺失时按预设读取环境变量（如 `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`XAI_API_KEY` 等）；Ollama 与自定义允许无 key。

## 3. 后端改造

### 3.1 SettingsService

- `getPublic()`：返回 `providers`、`activeProviderId`、`activeModel`。
- `saveProvider(input)`：新增/更新 Provider，可选更新 API Key；返回最新公开设置。
- `deleteProvider(id)`：删除非 mock Provider 及其 key；若删除当前 Provider，回退到 mock。
- `setActive(providerId, model)`：切换当前 Provider/模型，并写入该 Provider 的 `model`。
- `createProvider()`：按当前 Provider 的 `protocol` 实例化：
  - `openai` → `OpenAICompatibleProvider`
  - `anthropic` → `AnthropicProvider`
  - `gemini` → `GeminiProvider`
  - `mock` → `MockProvider`
- 缺 key / Base URL 时抛出可读错误，直接显示在错误卡。

### 3.2 Provider 适配器

- `OpenAICompatibleProvider`：保留现有 SSE 与工具调用实现，增加可定制 headers（为将来预留）。
- 新增 `AnthropicProvider`：
  - AgentMessage → `system` + `messages`，`tool_use` / `tool_result` 转换；
  - 解析 `content_block_delta` 文本与 `input_json_delta` 工具参数；
  - `message_delta.stop_reason` 映射 `tool_use` / `max_tokens` / `end_turn`。
- 新增 `GeminiProvider`：
  - AgentMessage → `systemInstruction` + `contents`，`functionCall` / `functionResponse` 转换；
  - 解析 SSE `candidates[0].content.parts` 的文本与函数调用；
  - `finishReason` 映射 `STOP` / `MAX_TOKENS`。
- 所有适配器遵守 `ChatProvider` 接口，API Key 仅存在实例内，不写日志。

### 3.3 IPC / preload

新增：

- `settings:saveProvider`
- `settings:deleteProvider`
- `settings:setActive`

沿用 senderFrame 校验、zod 校验与 `IpcResult` 包络。`settings:get` 返回新的公开结构。

## 4. 前端改造

### 4.1 Provider store

新增 `stores/providers.ts`：

- `providers`、`activeProviderId`、`activeModel`；
- `refresh()`、`saveProvider()`、`removeProvider()`、`setActive()`；
- SettingsDialog 保存后刷新；ChatComposer 读取。

### 4.2 设置面板

- Provider 列表：名称、协议、Base URL、当前模型、是否已配置 Key；
- 「添加提供商」：从 14 个预设中选择，自动填充协议/Base URL/推荐模型；
- 编辑：名称、Base URL、协议（自定义）、模型列表（逗号/换行分隔）、API Key；
- 删除：非 mock 可删；
- 「设为当前」；保存后立即生效；
- API Key 仍通过系统安全存储加密，输入框留空表示不修改。

### 4.3 输入卡模型切换

- 输入卡右下角由静态模型名改为按钮，点击弹出菜单；
- 菜单按 Provider 分组，展示其模型列表；当前项高亮；
- 选择后调用 `settings:setActive`，更新按钮文案；
- 无可用 Provider 时提示「配置模型」。

## 5. 安全

- 每个 Provider 的 Key 独立加密存储，renderer 只拿 `hasApiKey`；
- 错误信息不包含 Key、Authorization header 或完整请求体；
- 新增 Base URL 仅允许 `http/https`；本地 Ollama 允许 `http://localhost`；
- 工具审批、路径守卫、命令白名单不因 Provider 改变；
- 自定义协议仅允许三种受支持协议，避免任意请求格式。

## 6. 测试

- 单测：
  - Provider 预设完整性（id/name/baseUrl/protocol）；
  - SettingsService：默认 mock、添加/更新/删除 Provider、Key 加密、迁移旧设置、切换当前模型、缺 key 报错；
  - Anthropic/Gemini SSE 解析：文本、工具调用、错误；
  - OpenAI-compatible 现有测试保持通过。
- e2e：
  - 设置中添加 DeepSeek（不填 Key）并切换为当前；
  - 输入卡模型菜单可见并显示模型；
  - 发送时出现可读错误卡；切回 Mock 后恢复对话；
  - 原有 Mock 工具/审批/项目流程全部保持通过。

## 7. 非目标

- 不实现自动拉取远端模型列表（首版内置推荐模型 + 手填，避免每家鉴权差异）；
- 不实现多 Provider 并行对话；
- 不实现 OAuth / 企业签名 / 代理池；
- 不改变 Agent 工具循环与审批语义。

## 8. 实施顺序

1. 共享类型与预设；
2. SettingsService + IPC + 单测；
3. Anthropic / Gemini 适配器 + 单测；
4. Provider store、设置面板、输入卡模型菜单；
5. e2e 更新与全量回归；
6. README / 实现文档更新与截图。

## 9. 实施结果

| 模块                    | 文件                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 预设与共享类型          | `src/shared/providers.ts`                                                                                        |
| Provider 配置存储与迁移 | `src/main/settings/settingsService.ts`                                                                           |
| OpenAI-compatible       | `src/main/agent/providers/openaiProvider.ts`                                                                     |
| Anthropic Messages      | `src/main/agent/providers/anthropicProvider.ts`                                                                  |
| Gemini GenerateContent  | `src/main/agent/providers/geminiProvider.ts`                                                                     |
| IPC / preload           | `src/main/ipc/index.ts`、`src/preload/index.ts`、`src/shared/ipc.ts`                                             |
| Renderer Provider store | `src/renderer/src/stores/providers.ts`                                                                           |
| 设置面板                | `src/renderer/src/components/SettingsDialog.vue`                                                                 |
| 输入卡模型切换          | `src/renderer/src/components/ChatComposer.vue`                                                                   |
| 测试                    | `tests/unit/providers.test.ts`、`settingsService.test.ts`、`providerAdapters.test.ts`、`tests/e2e/smoke.spec.ts` |

- Provider 首次添加使用稳定 id（如 `deepseek`），重复添加同一预设时追加随机后缀。
- 首版不自动拉取远端模型列表，预设内置推荐模型，用户可在设置中编辑模型列表。
- 旧版单 Provider 设置自动迁移为 `custom` Provider，并保留原 API Key。
- 验证：format / typecheck / lint 通过；单测 16 文件 / 91 用例通过；build 通过；Playwright e2e 5 个场景通过（含添加 DeepSeek、缺 Key 错误、输入卡切换 Mock 后恢复、删除 Provider）。
