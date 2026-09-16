# 文件存储

项目使用 FlyDrive 2，服务端入口为 `src/platform/server/storage.ts` 的 `createStorage()`。返回原生 `Disk`，直接使用 `put`、`getBytes`、`getStream`、`delete` 和云端 `getSignedUrl`，不额外定义驱动接口。仅服务端允许导入。

## 配置

默认 `STORAGE_DRIVER=fs`，文件位于 `.data/uploads`，可通过 `STORAGE_FS_ROOT` 修改。相对路径按进程启动目录解析，部署需保留或挂载此目录。它与 SQLite 任务目录独立。

云端设置 `STORAGE_DRIVER=s3`，填写 `.env.example` 中的地域、桶、密钥；S3 兼容服务还需填写 endpoint。官方驱动使用 AWS SDK。默认不发送 ACL，桶策略必须保持私有；路径形式默认关闭。更改配置不会搬迁已有文件。

国内厂商的 S3 兼容能力需要实际联调，不能因支持配置 endpoint 就宣称已适配。原生 SDK 驱动按需实现 FlyDrive `DriverContract`，不让业务代码判断厂商。

## HTTP 接口

接口复用 `AI_API_TOKEN` Bearer 鉴权，仅面向可信调用方；没有用户级素材权限。不得将共享令牌写进浏览器代码。

- `POST /api/ai/files`：请求体为原始文件字节（不是 multipart），返回 201 和 `{ key, downloadPath }`。服务器生成 UUID，不接受用户指定文件路径。最多 10 MiB，按流读取时检查，超限返回 413，空文件返回 400。此限制用于当前参考图上传场景，不适用于大视频；暂时缓冲完整文件，后续视频上传应另行设计流式/直传流程。
- `GET /api/ai/files/<UUID>`：鉴权后下载文件；不存在返回 404。使用附件响应与 `application/octet-stream`，不把用户内容作为网页执行。

```sh
curl http://localhost:3000/api/ai/files \
  -H "Authorization: Bearer $AI_API_TOKEN" \
  --data-binary @reference.png
```

`downloadPath` 需要鉴权，不能直接作为模型参考图 URL。本次接入提供文件上传、下载与服务端存取；尚未连接上传 UI、生成结果自动归档或本地参考图转换。当前生成接口继续接受原有公网参考图 URL。

后续模型适配层按厂商要求选择读取字节转 Base64、生成云端签名 URL 或上传到厂商临时存储。存储模块不决定模型请求格式，也不强制依赖 fal。

## 验证范围

Vitest 验证真实本地文件读写、HTTP 鉴权、上传限制、下载及 S3 endpoint 签名配置；S3 签名测试不访问云端，不证明任何云厂商上传链路已通过。
