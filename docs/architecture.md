# 架构与代码组织

## 当前定位

本项目采用按业务领域组织的全栈应用结构，借鉴 OpenStory 的领域划分与前后端边界。当前实现是 TanStack Start + React 页面、Node.js HTTP 服务、TanStack AI 模型调用和 SQLite 任务记录；没有引入 OpenStory 的 Cloudflare Workflows、团队权限、计费或素材存储系统。

这里只描述当前代码与后续放置规则，不把建议目录当作已实现功能。开发命令和常驻约束见 [AGENTS.md](../AGENTS.md)，模型和任务细节分别见 [模型接入](model-integration.md)、[生成任务生命周期](generation-lifecycle.md)。

## 当前目录职责

| 位置 | 职责与入口 |
| --- | --- |
| `src/routes/` | TanStack 文件路由；[根布局](../src/routes/__root.tsx)组装主题和开发工具，[AI 路由](../src/routes/api.ai.$.ts)转发 HTTP 请求 |
| `src/router.tsx` | 创建路由器并配置导航行为 |
| `src/routeTree.gen.ts` | 自动生成的路由树，不手工维护 |
| `src/components/ui/` | 基于 Base UI 的通用基础组件 |
| `src/components/motion/` | 动效和主题切换组件 |
| `src/components/agents/` | 通过 props 接收状态与回调的通用展示组件，不负责调用供应商 |
| `src/lib/` | `cn`、动效参数等通用工具；通用 hooks 放在 `lib/hooks/` |
| `src/models/` | [模型目录](../src/models/models.ts)、[请求解析和任务类型](../src/models/generation.ts)、领域错误 |
| `src/models/server/` | 密钥解析、文本适配器、文本事件流、fal 请求保护；当前 SQLite 任务存储在其 `db/` 中 |
| `src/stills/` | 纯图片参数构造；其 `server/` 执行图片 SDK 调用 |
| `src/studio/` | 纯视频参数构造；其 `server/` 编排生成、提交和查询视频任务 |
| `src/server/` | [AI HTTP 处理](../src/server/ai.ts)及现有服务端集成测试 |
| `src/styles.css` | 全局主题变量与基础样式 |

当前 `/image` 页面还是工作台占位入口，不能据此宣称浏览器已完成生成、查询和结果展示的闭环。

## 调用链

### 文本

```text
routes/api.ai.$.ts
  → server/ai.ts：鉴权、读取请求、校验、SSE 响应
  → models/server/llm-client.ts：文本事件流、取消、错误脱敏
  → models/server/create-adapter.ts：根据模型选择文本适配器
  → DashScope / OpenRouter
```

文本服务返回事件流，HTTP 层负责将事件编码为 SSE。当前文本请求不写入图片/视频任务表。

### 图片与视频

```text
routes/api.ai.$.ts
  → server/ai.ts：鉴权、请求解析、HTTP 状态码
  → models/generation.ts：验证输入并解析模型能力
  → studio/server/generation-service.ts：预留记录、生成、保存状态
      → models/server/db/generated-assets.ts：SQLite 与幂等
      → stills/server/image-generation.ts：图片生成
      → studio/server/studio-video-generation.ts：视频提交与查询
```

生成服务不依赖 HTTP。后续工作台、Agent 或其他服务端入口可以复用它，不必绕回本机 HTTP。浏览器必须通过服务端入口调用，不能直接导入该服务。

当前 API 使用共享 Bearer 令牌，面向可信调用方。公开工作台接入前，需要明确用户身份及任务访问权限，不能把共享令牌打包进前端。

## 新代码放在哪里

- **工作台业务 UI**：放入 `studio/ui/`，包括表单、请求 hooks、任务状态到展示状态的转换。目录在实际新增代码时创建。
- **通用展示组件**：继续放在 `components/`，只接收展示数据和回调；保留现有目录名称，不为对齐参考项目批量改名。
- **业务纯逻辑**：放所属领域根目录；组件私有 hooks 和工具就近放置，只有真实跨业务复用时才放入 `lib/`。
- **服务端业务**：放所属领域 `server/`。HTTP 鉴权与响应仍由入口层处理，SQL 收敛到 `server/db/`。
- **服务端函数**：需要 TanStack Start RPC 时可以增加 `*.fn.ts`；现有 HTTP/SSE 接口有独立用途，不要求全量替换。新增入口应复用业务服务。

目前 `Generation`、任务校验和生成记录存储位于 `models`，这是现有归属。按职责它们更接近 `studio` 的任务生命周期；涉及相关重构时再一起调整类型、存储、调用方和测试，不维护两份实现，也不把迁移写成已完成。

当前视频能力只由工作台使用，暂留 `studio/server/`。出现第二个业务调用方时，再评估提取 `motion/`。认证、存储等基础设施有真实共享需求后，再引入 `platform/`；不预建空目录或只有一个实现的接口层。

## 依赖约束

领域可以显式调用其他领域的能力，例如 `studio` 调用 `stills` 和 `models`，无需仅为转发增加一层接口。

浏览器可用代码与服务端实现必须分开：供应商密钥、`node:sqlite`、文件系统和供应商调用留在服务端。当前 AI 路由通过 `createServerOnlyFn` 包装请求处理器；`"use client"` 本身不能替代依赖边界检查。

本项目尚未配置 OpenStory 那套自定义 lint 和导入图测试。这里的目录规则是开发约定，不应宣称已被工具全面强制执行。

## 测试与文档维护

现有 [AI 集成测试](../src/server/ai.test.ts)与 [Qwen 测试](../src/server/qwen.test.ts)使用 Vitest，由 `pnpm test` 执行。它们模拟供应商 HTTP，验证真实调用代码，但不证明账号权限、余额或模型线上可用性。

[Vitest 配置](../vitest.config.ts)收集 `src/**/*.test.{ts,tsx}`，使用 Node 环境和 `forks` 进程池。测试保留真实 SDK 和 SQLite，仅模拟供应商网络请求；数据库用例使用独立临时目录。使用 `vi.spyOn` 模拟 fetch、`vi.stubEnv` 设置环境变量，并在 `finally` 中恢复和清理。修改全局状态的同文件用例不使用并发执行。

新增业务测试尽量与实现相邻，路由目录只放路由文件。当前没有 DOM 组件测试；新增时再配置对应测试环境。

`docs/research/` 保留历史调研和参考快照；现行规则维护在本目录的专题文档中。变更事实时更新对应文档，不把历史方案直接当成已交付能力。
