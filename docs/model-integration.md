# 模型接入

修改模型目录、供应商配置、请求参数或 AI 接口前阅读本文。目录职责见 [架构说明](architecture.md)，图片和视频的任务状态、幂等与恢复见 [生成任务生命周期](generation-lifecycle.md)。

## 当前能力

模型白名单以 [`src/models/models.ts`](../src/models/models.ts) 为准；下表描述本项目当前配置，不保证账号具有相应模型权限。

| 模型 ID | 渠道 | 供应商端点 / 模型名 |
| --- | --- | --- |
| `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` | DashScope 文本 | 与模型 ID 相同 |
| `gpt-5-mini` | OpenRouter 文本 | `openai/gpt-5-mini` |
| `claude-sonnet-4.6` | OpenRouter 文本 | `anthropic/claude-sonnet-4.6` |
| `flux-schnell` | fal 图片 | `fal-ai/flux/schnell` |
| `gpt-image-2.5` | fal 图片 | `openai/gpt-image-2.5/flare/text-to-image` |
| `kling-2.6` | fal 视频 | `fal-ai/kling-video/v2.6/pro/text-to-video` |

文本输出上限为 4096 tokens。图片单次生成一张 PNG；GPT Image 额外使用 `quality: high`、`sync_mode: false`，走 fal，不走 OpenRouter。图片和视频支持 `1:1`、`16:9`、`9:16`，默认 `16:9`；视频支持 5 / 10 秒，默认 5 秒，关闭音频生成。

目前仅接入文本、文生图和文生视频。没有参考图编辑、图生视频、自动渠道选择、团队自带密钥或计费系统；借鉴 OpenStory 的职责划分不代表已经具备其完整功能。

## 服务端配置

需要 Node.js 24+。配置模板见 [`.env.example`](../.env.example)，启动和 Qwen 调用示例见 [README](../README.md)。

| 变量 | 用途 |
| --- | --- |
| `AI_API_TOKEN` | 本项目所有 AI 接口的共享访问令牌 |
| `DASHSCOPE_API_KEY` | Qwen 官方文本密钥 |
| `DASHSCOPE_BASE_URL` | 可选；默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `OPENROUTER_API_KEY` | OpenRouter 文本密钥 |
| `FAL_KEY` | fal 图片、视频密钥 |
| `AI_DATA_DIR` | 图片、视频任务数据库目录，默认 `.data/ai` |

只需配置实际使用渠道的密钥。开发服务读取 `.env`，部署时由服务端注入环境变量；密钥不能使用 `VITE_` 前缀。DashScope 地址与密钥需属于同一地域，地址覆盖仅来自服务端环境配置，不接受客户端传入。

共享令牌用于可信服务端或本地开发调用，不是用户登录机制。面向多个用户开放浏览器调用前，需要接入用户会话和任务访问权限，不能向所有用户分发该令牌。

## HTTP 接口

入口为 [`src/routes/api.ai.$.ts`](../src/routes/api.ai.$.ts)，处理器为 [`src/server/ai.ts`](../src/server/ai.ts)。所有接口要求 `Authorization: Bearer <AI_API_TOKEN>`，响应禁止缓存。JSON 请求上限 64 KiB，prompt 须为非空字符串且不超过 10000 字符；未知字段、未知模型及能力不匹配会被拒绝。

| 方法与路径 | 输入 | 输出 |
| --- | --- | --- |
| `GET /api/ai/models` | 无 | 模型目录及各渠道的 `configured` 状态 |
| `POST /api/ai/text` | `model`、`prompt` | TanStack AI / AG-UI SSE 事件流 |
| `POST /api/ai/images` | UUID v4 `id`、`model`、`prompt`，可选 `aspectRatio` | 已完成记录返回 200，其余已有记录返回 202 |
| `POST /api/ai/videos` | 同图片，可选 `duration` | 提交后返回 202；复用已完成记录时返回 200 |
| `GET /api/ai/jobs/{id}` | 无 | 图片已保存记录，或查询并更新后的视频记录 |

`configured: true` 只代表环境变量中存在密钥。文本流的 HTTP 200 也不代表生成成功，调用方需处理 `TEXT_MESSAGE_CONTENT`、`RUN_FINISHED` 和 `RUN_ERROR`；流内错误会隐藏上游细节。文本不创建可查询的生成任务记录。

常见错误码：输入无效 400、令牌错误 401、请求过大 413、记录不存在 404、ID 冲突 409、配置缺失 503、供应商或其他服务错误 502。流已经开始后的文本错误通过 `RUN_ERROR` 返回。

## 修改入口与扩展步骤

1. 在 [`models.ts`](../src/models/models.ts) 登记模型 ID、能力、渠道和端点，保持端点由服务端白名单决定。请求校验位于 [`generation.ts`](../src/models/generation.ts)，新增参数时同步修改校验和类型。
2. 文本渠道适配在 [`create-adapter.ts`](../src/models/server/create-adapter.ts)，密钥解析在 [`api-keys.ts`](../src/models/server/api-keys.ts)。[`llm-client.ts`](../src/models/server/llm-client.ts) 负责调用与事件流；DashScope 使用 `max_tokens`，OpenRouter 使用 `maxCompletionTokens`，不要假设兼容接口参数完全一致。
3. 图片参数在 [`build-image-request.ts`](../src/stills/build-image-request.ts)，SDK 调用在 [`image-generation.ts`](../src/stills/server/image-generation.ts)；视频对应 [`text-to-video.ts`](../src/studio/text-to-video.ts) 和 [`studio-video-generation.ts`](../src/studio/server/studio-video-generation.ts)。新增供应商需同步检查任务类型、保存渠道和查询逻辑，不能只增加目录条目。
4. 复用 [`generation-service.ts`](../src/studio/server/generation-service.ts) 的任务入口，保留付费提交保护；HTTP 编码继续留在 `src/server/ai.ts`。纯参数组装函数不读取密钥或发请求。
5. 在现有协议测试中补充模型名、认证头、参数和错误脱敏断言，再运行 `pnpm test`、`pnpm typecheck`；涉及依赖、服务端打包或路由时加跑 `pnpm build`。

## 验证边界与参考

`pnpm test` 运行 Vitest，使用真实 SDK 并模拟上游 HTTP。[通用协议测试](../src/server/ai.test.ts) 覆盖参数映射、幂等、持久化与 fal 付费提交保护；[Qwen 协议测试](../src/server/qwen.test.ts) 覆盖三个模型、地址覆盖、流式输出、错误脱敏和禁止 SDK 重试。测试不产生模型费用，也不证明实际账号权限、余额、端点可用性或生成效果；真实调用需单独记录结果。

历史选型依据保留在 [模型供应商接入调研](research/2026-09-15-model-provider-integration.md)，启动和官方文档入口见 [README](../README.md)。历史调研不覆盖当前代码与本文的现状说明。
