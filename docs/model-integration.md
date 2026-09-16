# 模型接入

修改模型目录、供应商配置、请求参数或 AI 接口前阅读本文。目录职责见 [架构说明](architecture.md)，图片和视频的任务状态、幂等与恢复见 [生成任务生命周期](generation-lifecycle.md)。

页面配置、统一模型池和模型发现的设计依据见 [模型接入配置与发现技术方案](design/model-management.md)。本文描述当前实现与限制。

## 当前能力

运行时目录来自 SQLite 的渠道、模型和绑定表，安全类型见 [`catalog.ts`](../src/models/catalog.ts)，存储见 [`server/db/catalog.ts`](../src/models/server/db/catalog.ts)。[`models.ts`](../src/models/models.ts) 只提供首次初始化数据和已有媒体请求模板；重启不会覆盖已保存配置。下表是初始目录，不保证账号具有相应模型权限。

| 模型 ID | 渠道 | 供应商端点 / 模型名 |
| --- | --- | --- |
| `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash` | DashScope 文本 | 与模型 ID 相同 |
| `qwen-image-3.0`、`qwen-image-2.0`、`qwen-image-2.0-pro` | DashScope 图片（文生图、参考图编辑） | 与模型 ID 相同 |
| `gpt-5-mini` | OpenRouter 文本 | `openai/gpt-5-mini` |
| `claude-sonnet-4.6` | OpenRouter 文本 | `anthropic/claude-sonnet-4.6` |
| `flux-schnell` | fal 图片 | `fal-ai/flux/schnell` |
| `gpt-image-2.5` | fal 图片 | `openai/gpt-image-2.5/flare/text-to-image` |
| `kling-2.6` | fal 视频 | `fal-ai/kling-video/v2.6/pro/text-to-video` |

文本输出上限为 4096 tokens。图片单次生成一张 PNG；GPT Image 额外使用 `quality: high`、`sync_mode: false`，走 fal，不走 OpenRouter。图片和视频支持 `1:1`、`16:9`、`9:16`，默认 `16:9`；视频支持 5 / 10 秒，默认 5 秒，关闭音频生成。

目前接入文本、文生图、Qwen 参考图编辑和文生视频。没有图生视频、自动渠道选择、团队自带密钥或计费系统；借鉴 OpenStory 的职责划分不代表已经具备其完整功能。

## 模型厂商与调用渠道

沿用 OpenStory 的字段语义：`vendor` 表示模型研发厂商（Alibaba、OpenAI、Anthropic、Black Forest Labs、Kling），`via` 表示实际调用渠道（dashscope、openrouter、fal），`endpoint` 表示该渠道使用的端点或模型名。厂商名称与 OpenStory 保持一致。

`GET /api/ai/models` 保留 `id / kind / vendor / via / endpoint`，其中 `via / endpoint` 对应默认绑定；另返回安全绑定摘要、`configured` 和 `available`。`configured` 表示凭据可解析，`available` 还要求模型、绑定和渠道启用；两者均不证明余额或模型权限。绑定摘要不含地址或凭据。生成可传 `bindingId`，否则必须使用显式默认绑定；不可用时返回错误，不做自动切换。

## 图片模型与统一生成流程

输入统一使用 `model`、`prompt`、`aspectRatio` 和可选的 `referenceImages`。模型目录的 `maxReferenceImages` 声明当前接入支持的参考图数量：三个 Qwen 图片模型为 3；现有 fal 模型仍为 0，传参考图会在调用供应商前返回 400。这个值描述本项目已接入能力，不代表供应商模型的全部能力。

参考图保持输入顺序，只接受不含用户名和密码的 HTTP(S) URL，需能被供应商公网访问。本项目不下载或上传参考图，不接收 Base64、文件路径或浏览器 blob URL；图片格式、大小和可访问性由供应商检查。空数组等同于未传参考图；非空参考图及其顺序参与任务幂等比较。

- **模型目录与校验**：确定能力、渠道、模型端点，拒绝不支持的输入。
- **纯请求构造**：`buildImageRequest` 将统一输入转换成渠道参数，不读取密钥或发网络请求。
- **供应商调用**：`generateImageWithProvider` 分发渠道请求，并返回统一的 `ImageGenerationResult`（包含 `images[].url`）。
- **生成编排**：继续复用同一套预留记录、幂等、保存结果和失败处理；不按具体模型分支。

初始三个 Qwen 模型共用百炼原生同步接口 `/api/v1/services/aigc/multimodal-generation/generation`，有参考图时在消息内容中加入 `image`，无参考图时仅传 `text`。使用绑定执行快照中 Base URL 的域名，替换其路径为原生 API 路径，适用于默认北京、新加坡及业务空间域名；自建代理也需要支持该路径。

每次请求 `n: 1`，比例映射采用百炼推荐尺寸：`1:1 → 2048*2048`、`16:9 → 2688*1536`、`9:16 → 1536*2688`；横竖屏尺寸是供应商推荐的近似比例。提示词改写等未暴露参数沿用供应商默认值。图片请求沿用现有 120 秒上限；百炼使用单次 HTTP 请求，不自动重试或跟随重定向。超时、网络错误或无有效图片结果都由统一流程保存为 `unknown`。

接口依据：[Qwen 3.0](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、[Qwen 文生图](https://help.aliyun.com/zh/model-studio/qwen-image-api)、[Qwen 图片编辑](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)。百炼图片 URL 有效期为 24 小时，当前只保存 URL，尚未转存文件。

## 服务端配置

需要 Node.js 24+。配置模板见 [`.env.example`](../.env.example)，启动和 Qwen 调用示例见 [README](../README.md)。

| 变量 | 用途 |
| --- | --- |
| `AI_API_TOKEN` | 现有模型查询、生成与任务接口的共享访问令牌；配置管理接口不使用此令牌 |
| `DASHSCOPE_API_KEY` | Qwen 官方文本和图片共用密钥 |
| `DASHSCOPE_BASE_URL` | 首次初始化 DashScope 渠道地址，之后在配置页面修改；默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `OPENROUTER_API_KEY` | OpenRouter 文本密钥 |
| `FAL_KEY` | fal 图片、视频密钥 |
| `AI_DATA_DIR` | 模型配置、凭据与生成任务共用的 SQLite 目录，默认 `.data/ai` |
| `MODEL_ENCRYPTION_KEY` | Base64 编码的 32 字节 AES-256-GCM 主密钥，保存页面密钥时必需 |
| `MODEL_ALLOWED_HOSTS` | 由部署显式允许的 `host:port`，逗号分隔；用于本地 HTTP 或私网模型服务 |

只需配置实际使用渠道的密钥。开发服务读取 `.env`，部署时由服务端注入环境变量；密钥不能使用 `VITE_` 前缀。DashScope 地址与密钥需属于同一地域，地址覆盖仅来自服务端环境配置，不接受客户端传入。

共享令牌不是用户登录机制。配置页面及管理接口面向可信部署环境，不要求登录或应用令牌；本版本没有用户、角色或多租户隔离。不要将共享令牌打包进前端。

## HTTP 接口

入口为 [`src/routes/api.ai.$.ts`](../src/routes/api.ai.$.ts)，处理器为 [`src/server/ai.ts`](../src/server/ai.ts)。以下原有接口要求 `Authorization: Bearer <AI_API_TOKEN>`，响应禁止缓存；管理接口独立说明如下。JSON 请求上限 64 KiB，prompt 须为非空字符串且不超过 10000 字符；未知字段、未知模型及能力不匹配会被拒绝。

| 方法与路径 | 输入 | 输出 |
| --- | --- | --- |
| `GET /api/ai/models` | 无 | 模型目录及各渠道的 `configured` 状态 |
| `POST /api/ai/text` | `model`、`prompt`，可选 `bindingId` | TanStack AI / AG-UI SSE 事件流 |
| `POST /api/ai/images` | UUID v4 `id`、`model`、`prompt`，可选 `bindingId`、`aspectRatio`、`referenceImages` | 已完成记录返回 200，其余已有记录返回 202 |
| `POST /api/ai/videos` | 同图片，可选 `duration` | 提交后返回 202；复用已完成记录时返回 200 |
| `GET /api/ai/jobs/{id}` | 无 | 图片已保存记录，或查询并更新后的视频记录 |

`configured: true` 只代表绑定渠道的凭据可解析。文本流的 HTTP 200 也不代表生成成功，调用方需处理 `TEXT_MESSAGE_CONTENT`、`RUN_FINISHED` 和 `RUN_ERROR`；流内错误会隐藏上游细节。文本不创建可查询的生成任务记录。

常见错误码：输入无效 400、令牌错误 401、请求过大 413、记录不存在 404、ID 冲突 409、配置缺失 503、供应商或其他服务错误 502。流已经开始后的文本错误通过 `RUN_ERROR` 返回。

## 配置管理与模型发现

页面入口为 `/settings/models`，业务组件在 [`models/ui/model-settings.tsx`](../src/models/ui/model-settings.tsx)。支持渠道地址与凭据、模型名称与类别、绑定能力与默认绑定的编辑及停用；写入携带读取时的 `revision`，版本冲突返回 409。默认绑定必须属于当前模型。使用停用代替删除，保留历史任务引用。

管理 HTTP 入口在原有共享令牌检查之前处理，不增加登录系统：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/ai/admin/catalog` | 查询配置安全 DTO，不返回密钥明文 |
| `POST /api/ai/admin/providers` | 新增或更新渠道及凭据 |
| `POST /api/ai/admin/models` | 新增或更新模型、默认绑定 |
| `POST /api/ai/admin/bindings` | 新增或更新渠道绑定及能力 |
| `POST /api/ai/admin/providers/{id}/discover` | 获取候选目录，不自动写入模型池 |
| `POST /api/ai/admin/providers/{id}/check` | 非生成接口检查；fal 仅检查配置 |
| `POST /api/ai/admin/import` | 原子导入模型、绑定和默认选择；输入包含显式 `enabled` |

OpenRouter 使用 `/models` 发现文本候选，`/auth/key` 检查连接。兼容渠道和 DashScope 尝试 `/models`；缺少可靠能力元数据时，仅接受已接入的已知文本 ID，其他可手动登记。fal 返回已有内置图片／视频模板，不将其当作远程同步成功。远程失败不会切换数据源，也不会修改现有配置。候选不会自动启用，页面通过“导入并启用”显式提交启用选择；重复导入保留已有编辑。

目录读取和非生成检查各限制 15 秒、响应正文 2 MiB，不自动分页或重试；这些上限只约束配置请求，防止异常上游长期占用管理请求，超限返回脱敏错误并保留原配置。检查成功不证明具体模型权限、余额或生成成功；保存、发现、导入和检查不执行付费生成。

### 凭据与网络边界

页面 API Key 使用 AES-256-GCM 加密后保存；每次轮换创建新凭据，旧任务继续引用旧记录。主密钥不存入数据库，缺失时禁止保存加密密钥，仍可使用允许的 `FAL_KEY / OPENROUTER_API_KEY / DASHSCOPE_API_KEY` 环境变量引用。环境变量不会冻结值，未结束任务期间更改同名变量的账号可能破坏旧任务查询。

备份须同时保留 SQLite 和主密钥；直接替换或丢失主密钥会使旧凭据无法解密。配置 DTO 只返回来源、掩码与状态。修改目标 origin 且沿用凭据时必须显式确认，或同时提供新凭据。

Base URL 默认只允许 HTTPS，拒绝用户名密码、查询串和片段；解析与实际连接均检查地址，固定连接至已检查的 DNS 结果，禁止重定向携带凭据。默认拒绝回环、私网、链路本地等非公网地址；只有部署环境的 `MODEL_ALLOWED_HOSTS` 可按精确 `host:port` 允许本地 HTTP／私网服务，页面不能解除该限制。fal 固定 `https://fal.run`，OpenRouter 固定 `https://openrouter.ai/api/v1`。

## 修改入口与扩展步骤

已支持协议的渠道和文本模型可直接从页面配置，无须改静态目录。文本统一使用 TanStack `openaiCompatibleText` 的动态模型入口，支持 OpenRouter、DashScope 和 OpenAI-compatible；各渠道均设置 `maxRetries: 0`。DashScope 和通用兼容渠道使用 `max_tokens`，OpenRouter 使用 `max_completion_tokens`。

媒体绑定必须匹配代码已有模板，能力经 Zod 校验；不能用任意新端点绕过参数契约。新增媒体协议时修改 [`build-image-request.ts`](../src/stills/build-image-request.ts)、[`image-generation.ts`](../src/stills/server/image-generation.ts) 或视频对应模块，再扩展模板、绑定校验及测试。SQL 继续留在 `models/server/db/`，使用 Node `node:sqlite`，未引入 Drizzle 运行时迁移。

## 验证边界与参考

`pnpm test` 运行 Vitest，使用真实 SDK / HTTP 适配代码并模拟上游 HTTP。[通用协议测试](../src/server/ai.test.ts) 覆盖参数映射、幂等、持久化与 fal 付费提交保护；[Qwen 协议测试](../src/server/qwen.test.ts) 覆盖三个文本模型、地址覆盖、流式输出、错误脱敏和禁止 SDK 重试。[Qwen 图片测试](../src/server/qwen-image.test.ts) 覆盖三个图片模型的文生图、参考图编辑、能力校验、参数映射、幂等、错误脱敏和禁止重新提交。测试不产生模型费用，也不证明实际账号权限、余额、端点可用性或生成效果；真实调用需单独记录结果。

配置回归见 [目录与凭据测试](../src/models/server/db/catalog.test.ts)、[管理接口测试](../src/server/model-management.test.ts)、[发现测试](../src/models/server/discovery.test.ts)和[网络策略测试](../src/models/server/provider-network.test.ts)。这些检查不代替浏览器交互验证，也不证明真实付费供应商调用。

历史选型依据保留在 [模型供应商接入调研](research/2026-09-15-model-provider-integration.md)，启动和官方文档入口见 [README](../README.md)。历史调研不覆盖当前代码与本文的现状说明。

TanStack fal SDK 内部使用全局 client。本项目通过 `withFalCredential` 的 `AsyncLocalStorage` 上下文和 `falFetch` 在发送时覆写认证头，隔离并发账号；新增 fal 调用必须同时使用这两者，缺少凭据上下文会拒绝发送。
