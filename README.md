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

`AI_API_TOKEN` 用于保护本项目接口，与百炼密钥不同。仅测试 Qwen 时，可留空 `OPENROUTER_API_KEY`、`FAL_KEY`。

默认地址属于北京地域。其他地域或业务空间请覆盖 `DASHSCOPE_BASE_URL`，例如北京业务空间专属地址 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。API Key 必须与地址所在地域一致，模型也需在该地域对账号开放。

```sh
pnpm install
pnpm dev
```

开发服务会读取 `.env`；修改配置后重启服务。生产运行时需由部署环境注入这些变量。密钥仅在服务端使用，不要添加 `VITE_` 前缀。

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

第二条命令会真实调用百炼，可能产生费用。模型列表中的 `configured: true` 仅代表已配置密钥；文本请求收到 `TEXT_MESSAGE_CONTENT` 和 `RUN_FINISHED`、且没有 `RUN_ERROR`，才表明本次模型调用成功。HTTP 200 本身不足以确认流式调用成功。

未配置密钥返回 503，接口令牌错误返回 401；上游鉴权、权限或网络错误通过 `RUN_ERROR` 返回。

```sh
pnpm test
pnpm typecheck
pnpm build
```

自动化测试模拟网络，覆盖模型选择、官方地址、参数、流式响应与错误脱敏，不证明真实密钥、账号权限或额度可用。

参考：[百炼接口与地域配置](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[官方模型目录](https://help.aliyun.com/zh/model-studio/models)、[TanStack 兼容适配器](https://tanstack.com/ai/latest/docs/adapters/openai-compatible)。
