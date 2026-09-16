# 生成任务生命周期

修改图片、视频的提交、查询、重试或存储前阅读本文。模型配置和 HTTP 输入见 [模型接入](model-integration.md)。本文描述当前请求驱动的实现，不包含后台任务引擎。

## 调用与存储

```text
POST /api/ai/images 或 /api/ai/videos
  → 校验并规范化请求
  → generation-service.generate
  → 解析渠道密钥，SQLite 预占 ID
  → 图片等待生成结果 / 视频提交供应商任务
  → 保存记录并响应

GET /api/ai/jobs/{id}
  → 读取记录
  → 视频 pending / processing 且有供应商任务 ID 时查询供应商
  → 保存新状态并响应
```

[`generation-service.ts`](../src/studio/server/generation-service.ts) 编排流程；[`generated-assets.ts`](../src/models/server/db/generated-assets.ts) 负责 SQLite 访问。数据库位于 `${AI_DATA_DIR}/generations.sqlite`，默认 `.data/ai/generations.sqlite`，保存规范化请求、状态、时间、实际 `via` / `endpoint`、供应商任务 ID 和结果元数据。

当前部署要求单 Node 主机和持久磁盘；多副本前需要共享数据库。没有自动后台轮询，视频状态由 GET 查询推进。视频查询使用记录中的渠道、端点和供应商任务 ID，不根据当前模型目录重新选路。

图片和视频文件没有转存，记录保存的是供应商 URL 及元数据，URL 可能过期。未来增加素材转存时，下载或转存失败应重试该步骤，不能重新生成。

## 状态含义

| 状态 | 当前含义与处理 |
| --- | --- |
| `submitting` | 已预占 ID，供应商提交或图片生成尚未返回；进程中断可能使记录停留在此状态 |
| `pending` | 视频已取得供应商任务 ID，等待处理 |
| `processing` | 视频查询返回正在处理 |
| `completed` | 图片生成成功，或视频状态与结果 URL 均已取得 |
| `failed` | 视频查询取得供应商明确的失败结果 |
| `unknown` | 提交或图片生成期间发生异常，不能确定供应商是否接受请求或已经收费 |

图片通常从 `submitting` 进入 `completed` 或 `unknown`；视频提交成功进入 `pending`，随后由查询推进。`completed`、`failed` 是受保护的终态，并发更新不能使其倒退。GET 对图片、无供应商任务 ID 的记录及非 `pending` / `processing` 状态只返回已保存记录。

## 幂等与重试

每次新生成使用新的 UUID v4，例如 `crypto.randomUUID()`；同一次操作的网络重试必须复用 ID 与请求内容。

- 数据库用主键和 `INSERT OR IGNORE` 预占 ID，再比较规范化后的请求。相同 ID 和请求返回已有记录，不发起第二次生成；内容不同返回 409。
- 规范化包括 ID 小写、prompt 去除两端空白、补齐默认比例与时长，以及解析渠道和端点。修改模型目录可能使同一模型 ID 的新请求与旧记录冲突；查询旧任务应使用 GET。
- `generate` 在检查已有记录前解析渠道密钥，因此重复 POST 仍要求配置该密钥。仅查看已完成记录可使用 GET。
- `unknown`、长期 `submitting` 需要结合已保存记录与供应商后台核对，不应直接换 ID 重跑。当前没有自动对账或修复接口。
- 视频状态查询或结果 URL 获取失败时，HTTP 返回 502，已有状态保持不变；可以重试 GET，不必重新提交视频。

前端可间隔查询视频记录，在终态停止；`unknown` 和无法推进的 `submitting` 应展示待核对状态，不能自动映射为“失败并重新生成”。

## 时限与异常边界

| 操作 | 当前配置 |
| --- | --- |
| 文本流 | 120 秒后触发取消，同时关联客户端请求取消信号 |
| 图片 SDK 调用 | 120 秒超时参数 |
| 视频提交 | 30 秒超时参数 |
| 每次 fal HTTP 请求 | 30 秒超时信号，并与 SDK 自身信号合并 |

超时只说明本地没有取得确定结果，不代表供应商已经取消或没有收费。图片 SDK 内部等待结果，当前应用不持久化其内部任务 ID，中断后不能通过本项目 GET 恢复查询。视频取得并保存任务 ID 后可继续查询。图片和视频生成服务没有关联客户端 HTTP 取消信号，不应假设关闭页面会取消供应商任务。

[`fal-deadline-fetch.ts`](../src/models/server/fal-deadline-fetch.ts) 将 fal POST 的非成功响应和通信错误转换为不确定结果，阻止 SDK 自动重复付费提交。DashScope 适配器另外设置 `maxRetries: 0`；不能据此推断所有文本渠道都禁用了 SDK 重试。

提交后的异常会尝试保存 `unknown` 并返回含生成 ID 的 502；进程退出或数据库写入失败可能留下 `submitting` 或其他旧状态。提交记录与供应商执行不在同一个事务中，因此 SQLite 幂等不等于跨供应商的恰好执行一次保证。

## 验证入口

运行 `pnpm test`，对应 [AI 协议测试](../src/server/ai.test.ts)：验证重复请求只提交一次、内容冲突、保存渠道与结果、结果读取失败后可继续查询，以及 fal 提交错误不重试。测试使用临时 SQLite 与模拟 HTTP，不覆盖真实供应商收费、进程崩溃恢复或持久磁盘部署效果。
