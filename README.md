# weave.ai

## Qwen 官方文本模型

通过阿里云百炼 DashScope 的 OpenAI 兼容接口调用 `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash`，支持流式文本输出。

### 配置与启动

需要 Node.js 24+ 和 pnpm。将 `.env.example` 复制为 `.env`，填写：

```dotenv
AI_API_TOKEN=设置一个随机的本地接口访问令牌
DASHSCOPE_API_KEY=填写百炼API密钥
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

`AI_API_TOKEN` 用于保护现有生成和查询接口；配置管理入口不使用此令牌。它与百炼密钥不同。仅测试 Qwen 时，可留空 `OPENROUTER_API_KEY`、`FAL_KEY`。

默认地址属于北京地域。首次初始化前，其他地域或业务空间请覆盖 `DASHSCOPE_BASE_URL`，例如北京业务空间专属地址 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。API Key 必须与地址所在地域一致，模型也需在该地域对账号开放。

```sh
pnpm install
pnpm dev
```

开发服务会读取 `.env`；修改环境变量后重启服务。模型目录首次初始化后，渠道地址需在 `/settings/models` 修改，重启不会用环境变量覆盖已保存地址。生产运行时需由部署环境注入这些变量。密钥仅在服务端使用，不要添加 `VITE_` 前缀。

### 验证接入

在另一个终端中，将下方令牌替换为 `.env` 中的 `AI_API_TOKEN`。

```sh
curl --fail-with-body http://localhost:3000/api/ai/models \
  -H 'Authorization: Bearer 你的本地接口访问令牌'

curl --fail-with-body --no-buffer http://localhost:3000/api/ai/text \
  -H 'Authorization: Bearer 你的本地接口访问令牌' \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.8-flash","prompt":"只回复 OK"}'
```

第二条命令会真实调用百炼，可能产生费用。模型列表中的 `configured: true` 仅代表凭据可解析；文本请求收到 `TEXT_MESSAGE_CONTENT` 和 `RUN_FINISHED`、且没有 `RUN_ERROR`，才表明本次模型调用成功。HTTP 200 本身不足以确认流式调用成功。

未配置密钥返回 503，接口令牌错误返回 401；上游鉴权、权限或网络错误通过 `RUN_ERROR` 返回。

```sh
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` 使用 Vitest 在 Node 环境运行 `src/**/*.test.{ts,tsx}`。现有测试使用真实 SDK、临时 SQLite 和模拟网络，覆盖模型选择、官方地址、参数、流式响应、错误脱敏、任务幂等与付费请求重试保护，无需真实供应商密钥，不产生模型费用，也不证明真实账号权限或额度可用。测试组织与隔离规则见 [架构说明](docs/architecture.md#测试与文档维护)。

参考：[百炼接口与地域配置](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[官方模型目录](https://help.aliyun.com/zh/model-studio/models)、[TanStack 兼容适配器](https://tanstack.com/ai/latest/docs/adapters/openai-compatible)。


## Qwen 图片生成与编辑

支持 `qwen-image-3.0`、`qwen-image-2.0`、`qwen-image-2.0-pro`，初始配置复用 `DASHSCOPE_API_KEY`，使用所选绑定渠道的地域地址。通过 `POST /api/ai/images` 提交，例如：

```json
{
  "id": "74147a3a-6775-44a1-886b-bc797ed21476",
  "model": "qwen-image-3.0",
  "prompt": "将参考图的背景改为雪山，保留主体",
  "aspectRatio": "16:9",
  "referenceImages": ["https://example.com/reference.png"]
}
```

调用时携带 `Authorization: Bearer <AI_API_TOKEN>`，并将示例地址替换为供应商可访问的真实图片 URL。省略 `referenceImages` 即为文生图；编辑最多接受 3 张参考图。每次新生成使用新的 UUID v4，同一次请求重试复用 ID 和内容。

成功结果位于 `result.images[].url`。请求会产生供应商费用，百炼返回的图片链接仅保留 24 小时；本项目尚未转存文件。当前 `/image` 页面已支持文生图，参考图编辑可通过服务端 API 调用。参数和失败处理见 [模型接入](docs/model-integration.md)。

## 模型接入管理

启动后打开 `/settings/models`，可新增渠道、配置密钥、管理文本／图片／视频模型与绑定、选择默认绑定，以及检查连接和发现候选。点击“导入并启用”才将候选写入可用目录；保存、发现和检查不会执行付费生成。设置页面不需要登录或 `AI_API_TOKEN`，面向可信部署环境，不提供用户、角色或多租户隔离。

已支持协议的文本模型可动态登记；fal 和 DashScope 图片仍限制在代码已实现的媒体请求模板。生成接口支持可选 `bindingId`，不传时使用显式默认绑定，不自动切换渠道。

配置和任务共用 `${AI_DATA_DIR}/generations.sqlite`，种子只初始化一次。页面保存 API Key 前需设置 `MODEL_ENCRYPTION_KEY`：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

将输出保存在服务端环境变量中；数据库和主密钥须分别备份，不能直接更换主密钥。页面密钥轮换会保留历史加密凭据，让旧任务继续查询；环境变量引用不会保留旧值，未结束任务期间须保持原账号可用。

自定义渠道默认仅允许公网 HTTPS，禁止携带密钥重定向。若确需本机模型服务，由部署配置精确允许地址，例如 `MODEL_ALLOWED_HOSTS=localhost:11434`；此设置允许对应本地 HTTP／私网连接，页面不能自行解除网络限制。接口、凭据和发现边界详见[模型接入](docs/model-integration.md)。

配置测试使用临时 SQLite、模拟供应商或本地测试 HTTP 服务，覆盖凭据轮换、revision 冲突、导入、地址策略和历史任务幂等；仍需分别报告浏览器验证与真实供应商调用结果，不能由测试通过推断生产账号可用。

## 图片工作台

打开 `/image`（首页“图片生成”），先在模型设置中配置并启用 DashScope 等图片渠道。输入提示词，在输入框左下角选择模型渠道和图片比例，然后点击“生成图片”。页面通过可信部署的服务端函数调用生成服务，无需输入 `AI_API_TOKEN`，供应商密钥只保留在服务端；原 HTTP API 的令牌要求不变。

当前页面支持单张文生图和模型已声明的 `1:1 / 16:9 / 9:16` 比例，未开放画质、分辨率档位和参考图上传。生成过程复用 `ImageGeneration`；结果保留原比例，并提供原图链接。URL 保存任务 ID，刷新可查看已保存结果；异常时只查询原任务，不自动重提。不确定结果需到供应商后台核对。

浏览器流程已使用本机模拟百炼服务验证，不等于阿里账号真实生成验证。真实点击生成会调用所选供应商，可能产生费用。
