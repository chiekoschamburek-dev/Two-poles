# 部署到 EdgeOne Pages（ESA）：模型密钥与 `/api/llm/*`

这个项目是纯静态 Vue SPA。**只在 ESA 控制台添加环境变量并不会自动产生 `/api/llm/chat`**：
浏览器不能读取环境变量，模型密钥也不能打进前端 bundle。线上需要一段服务端代码来转发请求；
这里用 EdgeOne Pages Functions 承载，本地开发仍用 `vite.config.ts` 的中间件。

当前仓库已经包含两份完全相同的函数，兼容 Pages 项目根目录的两种设置：

```
UI/functions/api/llm/chat.js       # Pages 根目录 = UI 时生效
UI/functions/api/llm/status.js
functions/api/llm/chat.js          # Pages 根目录 = 仓库根时生效
functions/api/llm/status.js
```

Pages Functions 的目录约定和 `onRequest` 写法见
[EdgeOne Pages Functions 文档](https://edgeone.cloud.tencent.com/pages/document/162936866445025280)。

---

## 1. 在 ESA 控制台添加三个环境变量

打开你的 Pages 项目 → **设置 / 环境变量**，点「添加变量」，逐个添加：

| 变量键 | 值 | 加密存储 | 环境 |
|---|---|---|---|
| `LLM_DEFAULT_BASE_URL` | 例如 `https://api.deepseek.com/v1` | 否 | 生产环境（需要预览就再勾测试环境） |
| `LLM_DEFAULT_API_KEY` | 你的模型 API Key（`sk-...`） | **是** | 生产环境 |
| `LLM_DEFAULT_MODEL` | 例如 `deepseek-chat` | 否 | 生产环境 |

注意：

- 变量名必须完全一致；也兼容 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 作为别名。
- **不要**加 `VITE_` 前缀。`VITE_*` 会被 Vite 打进浏览器 bundle，等于公开密钥。
- `LLM_DEFAULT_BASE_URL` 填 OpenAI 兼容接口的根地址，末尾不要带 `/chat/completions`：
  代码会拼成 `${baseUrl}/chat/completions`。
- 如果站点是「生产环境」，务必勾选生产环境；只勾测试环境时线上读不到。
- 保存环境变量后**重新部署一次**，让 Functions 拿到新的运行时变量。

## 2. Pages 项目根目录怎么选

先看 Pages 项目设置里的「根目录 / Root Directory」：

- **推荐：根目录 = `UI`**
  - 构建命令：`npm ci && npm run build`
  - 输出目录：`dist`
  - 函数目录：`UI/functions`（已包含）
  - `UI/esa.jsonc` 里的 `assets.directory` 已经是 `./dist`
- **如果根目录 = 仓库根**
  - 构建命令：`cd UI && npm ci && npm run build`
  - 输出目录：`UI/dist`（根 `esa.jsonc` 的 `assets.directory` 需要改成 `./UI/dist`，或按你的构建脚本复制）
  - 函数目录：仓库根的 `functions`（已包含）

两种根目录都放了函数，实际生效的只有 Pages 根目录下那一份。确认后可以删掉不用的那份，但不是必须。

## 3. 部署后验证

打开：

```
https://你的域名/api/llm/status
```

期望返回（不会包含 key / base_url）：

```json
{ "available": true, "model": "deepseek-chat" }
```

如果返回 404、HTML 或 `available:false`：

1. 确认函数文件在**当前 Pages 根目录**下，路径是 `functions/api/llm/status.js`；
2. 确认改完环境变量后重新部署过；
3. 确认勾选的是**生产环境**；
4. 在设置页点「测试连接」或刷新页面，让前端重新读 `/api/llm/status`。

然后测试 `POST /api/llm/chat`：打开「计划」页点「用模型规划」，或在「设置」里点「测试连接」。
照片识别也走同一个代理；模型必须支持 `image_url` 输入。

## 4. 安全边界

- 服务端默认 Key 只从 `context.env.LLM_DEFAULT_*` 读取，`/api/llm/status` 只返回 `{available, model}`。
- 默认**关闭**用户自定义接口的生产代理：`ALLOW_CUSTOM_LLM_PROXY` 不设置或不为 `true` 时，
  带自定义 `baseUrl` 的请求会被 403。原因是 `/api/llm/chat` 是公开地址，开放任意 baseUrl 会变成开放代理；
  如果确实要让用户在设置页填自己的接口，再把它设为 `true`，并同时限制入口频率和预算。
- 建议在 EdgeOne 的 WAF / 频控里给 `/api/llm/chat` 加频率限制，并给默认 Key 配低额度。
  没有账号体系时，服务端 Key 的额度最终是公开可消耗的。
- 请求体上限是 6,000,000 字节，与本地 Vite 代理一致；EdgeOne 自身可能有更低的函数请求体/执行时间限制。
  照片识别失败时，应用仍会回落到本机 EfficientDet 9 类或手动补录；原图不上传。
- 模型计划生成可能超过 EdgeOne 的函数执行时间上限；遇到 504 时换更快的模型，或把计划生成拆成更短的请求。
  当前代理是 `stream: false`，没有做流式返回。

## 5. 本地调试

本地不需要 Pages Function，`npm run dev` / `npm run preview` 仍由 `vite.config.ts` 的
`/api/llm/*` 中间件处理，读取 `.env.local` 或系统环境里的同一组 `LLM_DEFAULT_*`。
不要直连模型厂商（浏览器会被 CORS 拦掉），也不要双击打开 `dist/index.html`。
