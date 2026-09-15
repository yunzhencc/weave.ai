# 模型接入

参考 [OpenStory](https://github.com/openstory-so/openstory/tree/bdcf8ef9240101bfcbfeea7fadc41ad461d4a9b8) 的 TanStack AI 接入方式：文本走 OpenRouter，图片和视频走 fal；按模型映射参数，任务保存实际渠道 `via`、端点及供应商任务 ID，查询不重新选路。

## 代码结构

按 OpenStory 的 `models`、`stills`、`studio` 职责组织，HTTP 与模型服务、请求组装、存储分离：

| 模块 | 职责 |
| --- | --- |
| `src/models/models.ts` | 客户端可用的模型目录、比例和时长能力 |
| `src/models/generation.ts`、`errors.ts` | 请求校验、任务类型、领域错误；不依赖 HTTP |
| `src/models/server/api-keys.ts` | 按渠道解析服务端密钥及配置状态 |
| `src/models/server/create-adapter.ts` | 创建文本渠道适配器 |
| `src/models/server/llm-client.ts` | 文本调用、取消和超时、输出事件流 |
| `src/models/server/fal-deadline-fetch.ts` | fal 请求时限和付费提交重试保护 |
| `src/models/server/db/generated-assets.ts` | SQLite 读写、幂等预占、终态保护 |
| `src/stills/build-image-request.ts` | 无副作用的图片参数组装 |
| `src/stills/server/image-generation.ts` | 图片 SDK 调用 |
| `src/studio/text-to-video.ts` | 无副作用的视频参数组装 |
| `src/studio/server/studio-video-generation.ts` | 视频提交、按已保存渠道查询结果 |
| `src/studio/server/generation-service.ts` | 协调预占、生成、状态和结果持久化，返回普通任务记录 |
| `src/server/ai.ts`、`src/routes/api.ai.$.ts` | HTTP 鉴权、请求读取、调用服务、SSE/JSON 响应和错误状态码 |

调用关系：HTTP → 请求校验 → 生成服务 → 图片/视频服务 → 参数组装与 SDK；生成服务独立调用存储模块。文本通过 `create-adapter` → `llm-client` 返回事件，由 HTTP 层编码为 SSE。未来 Agent 可直接调用生成服务，不必调用本机 HTTP 接口。

对齐的是职责与目录边界，没有复制 OpenStory 的全部基础设施：本项目保留环境变量密钥、SQLite、由请求推进的任务流程；尚无团队 BYOK、多渠道自动选择、Cloudflare Workflows、素材转存与计费。现有 API 路径、请求结构及 SQLite 表结构保持兼容，已有任务仍可查询。

## 启动

需要 Node 24 和持久磁盘。复制 `.env.example` 为 `.env`，填写 `AI_API_TOKEN`、`OPENROUTER_API_KEY`、`FAL_KEY`，运行 `pnpm dev`。不要把密钥放进 `VITE_*`。开发环境由 TanStack Start/Vite 加载 `.env`；部署时在服务端设置环境变量。

当前接口供可信服务端/本地开发调用，共享 `AI_API_TOKEN` 不是面向公众的用户登录机制。浏览器产品接入时应先接用户会话和按用户的任务权限，不要向所有用户分发这个令牌。

## 接口

所有接口要求 `Authorization: Bearer <AI_API_TOKEN>`，响应禁止缓存。JSON 请求上限 64 KiB，prompt 上限 10000 字符。GET `/api/ai/models` 返回模型与密钥是否配置；`configured` 不代表已验证余额或模型权限。

| 接口 | 请求内容 | 返回 |
| --- | --- | --- |
| POST `/api/ai/text` | `model`, `prompt` | TanStack AI/AG-UI SSE 事件，包括 `TEXT_MESSAGE_CONTENT`、`RUN_ERROR` |
| POST `/api/ai/images` | UUID v4 `id`, `model`, `prompt`, 可选 `aspectRatio` | 保存后的图片结果 |
| POST `/api/ai/videos` | 同图片，可选 `duration` | 202，任务记录 |
| GET `/api/ai/jobs/{id}` | 无 | 已保存记录；视频未完成时查询供应商并保存新状态 |

| model | 渠道 | 能力 |
| --- | --- | --- |
| `gpt-5-mini` | OpenRouter `openai/gpt-5-mini` | 文本，输出最多 4096 tokens |
| `claude-sonnet-4.6` | OpenRouter `anthropic/claude-sonnet-4.6` | 文本，输出最多 4096 tokens |
| `flux-schnell` | fal `fal-ai/flux/schnell` | 文生图，单张 PNG |
| `gpt-image-2.5` | fal `openai/gpt-image-2.5/flare/text-to-image` | OpenAI 文生图，单张 PNG，high 质量 |
| `kling-2.6` | fal `fal-ai/kling-video/v2.6/pro/text-to-video` | 文生视频，5/10 秒，无音频 |

图片/视频比例支持 `1:1`、`16:9`、`9:16`，默认 `16:9`。视频默认 5 秒。拒绝任意供应商端点、未知模型及未知参数，避免前端绕过模型能力限制。

OpenAI 生图对齐 OpenStory 的 [`gpt_image_2` 模型条目](https://github.com/openstory-so/openstory/blob/bdcf8ef9240101bfcbfeea7fadc41ad461d4a9b8/src/models/models.ts#L189)（该上游内部键目前指向 GPT Image 2.5），以及其 [`quality: high`、`sync_mode: false` 参数](https://github.com/openstory-so/openstory/blob/bdcf8ef9240101bfcbfeea7fadc41ad461d4a9b8/src/stills/build-image-request.ts#L323)。使用 `FAL_KEY`，没有走 OpenRouter 图片接口。参考版本的视频模型目录未接入 Sora，本项目也未添加 Sora。

```json
{
  "id": "54147a3a-6775-44a1-886b-bc797ed21476",
  "model": "gpt-image-2.5",
  "prompt": "一座湖边木屋，清晨自然光，电影画面",
  "aspectRatio": "16:9"
}
```

将以上请求发送至 `POST /api/ai/images`，返回格式与 FLUX 相同。模型端点参数已对照 [fal 官方文档](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api) 核对；当前仅接入文生图，尚未加入 OpenStory 的参考图编辑端点。

```sh
# 此处 AI_API_TOKEN 是调用方环境变量；不要把真实令牌提交到源码。
curl http://localhost:3000/api/ai/models \
  -H "Authorization: Bearer $AI_API_TOKEN"

curl -N http://localhost:3000/api/ai/text \
  -H "Authorization: Bearer $AI_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5-mini","prompt":"写一个十秒钟的电影分镜"}'

curl http://localhost:3000/api/ai/videos \
  -H "Authorization: Bearer $AI_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"74147a3a-6775-44a1-886b-bc797ed21476","model":"kling-2.6","prompt":"Slow camera movement across a mountain lake","duration":5}'

curl http://localhost:3000/api/ai/jobs/74147a3a-6775-44a1-886b-bc797ed21476 \
  -H "Authorization: Bearer $AI_API_TOKEN"
```

每次新生成用新 UUID（浏览器 `crypto.randomUUID()`）；重试同一次请求必须复用 ID 和内容。相同 ID 不重新提交，内容不同返回 409。视频可每 5 秒查询，终态停止；页面重开后使用已保存 ID 查询。

## 持久化和失败边界

- `.data/ai/generations.sqlite` 保存请求、实际渠道、任务 ID 和结果元数据。它需要持久磁盘；当前为单 Node 主机，扩展多副本前改用共享数据库。没有自动后台轮询，状态由 GET 查询推进。
- 保存的是供应商 URL/元数据，没有转存图片或视频文件；URL 可能过期。素材库接入时应独立实现文件转存，转存失败只重试下载，不重新生成。
- 提交前先落库。供应商超时或通信失败保存 `unknown`，不会自动重试付费提交。进程在提交途中退出可能留下 `submitting`；两种情况都需要按记录与供应商后台核对后决定后续动作，不能当作生成失败直接重跑。
- 图片 SDK 内部等待生成结果，限时 120 秒；当前图片在中途断连时无法取得 SDK 内部任务 ID。视频提交限时 30 秒，成功取得 ID 后支持后续查询。供应商是否已经收费仍以其记录为准。
- API 不包含工作流引擎、计费、多租户授权、图生图/图生视频或 Google/xAI/BytePlus 直连。TanStack AI 视频接口仍为实验性 API，升级 SDK 时重新验证协议测试。

## 验证

`pnpm test` 使用 Node 内置测试器和真实 SDK，模拟上游 HTTP，验证鉴权、参数映射、流式错误脱敏、幂等、结果持久化与付费提交不重试；不会产生模型费用。另运行 `pnpm typecheck` 和 `pnpm build`。上线前仍需使用实际密钥验证所选模型的权限、生成效果及配额。

参数依据：[FLUX Schnell API](https://fal.ai/models/fal-ai/flux/schnell/api)、[Kling 2.6 API](https://fal.ai/models/fal-ai/kling-video/v2.6/pro/text-to-video/api)。
