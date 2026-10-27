# 部署到阿里云 ESA「函数和 Pages」：模型密钥与 `/api/llm/*`

> 注意：这里用的是**阿里云边缘安全加速 ESA**，不是腾讯 EdgeOne。
> ESA 的函数不是 `/functions` 目录路由，而是一个**单入口 `entry` 边缘函数**；
> 之前在 `functions/` 下写的多文件路由不会被识别。

## 结构

```
esa.jsonc                     # 根目录：entry / 安装 / 构建 / 静态资源
UI/dist/                      # Vite 构建产物，静态托管
UI/server/llm.js              # 唯一的边缘函数入口
UI/src/services/llm.ts        # 前端调用 /api/llm/*
```

`UI/server/llm.js` 用 ESA 的运行时签名：

```js
export default {
  async fetch(request, context, env) {
    // env.LLM_DEFAULT_* 是「函数变量」，不是 Pages 的构建环境变量
  }
}
```

它处理三个路由，其余 HTML 导航回退到 `index.html`：

- `GET /api/llm/status` → `{ available, model }`，不返回 key
- `GET /api/llm/ping` → 部署自检
- `POST /api/llm/chat` → OpenAI 兼容转发

## esa.jsonc

根目录的 [esa.jsonc](../esa.jsonc)：

```jsonc
{
  "entry": "./UI/server/llm.js",
  "installCommand": "cd UI && npm install --include=dev",
  "buildCommand": "cd UI && npm install --include=dev && npm run build",
  "assets": {
    "directory": "./UI/dist",
    "notFoundStrategy": "singlePageApplication"
  }
}
```

说明：

- `esa.jsonc` 的优先级**高于控制台**；改了它要重新推到 GitHub 才会生效。
- 构建命令里必须带 `--include=dev`，否则 ESA 按 production 安装，`vue-tsc`/`vite` 不在，构建会报
  `vue-tsc: command not found`。
- 静态资源目录是 `./UI/dist`；不要写成 `./dist`，根目录是仓库根时那是错的路径。

## 控制台对应配置

| 字段 | 值 |
|---|---|
| 生产分支 | `main` |
| 根目录 | `/` |
| 安装命令 | `cd UI && npm install --include=dev` |
| 构建命令 | `cd UI && npm install --include=dev && npm run build` |
| 静态资源目录 | `UI/dist` |
| 函数文件路径 | `UI/server/llm.js` |
| Node.js 版本 | 22.x |

`esa.jsonc` 存在时以文件为准；控制台里的函数文件路径也应填 `UI/server/llm.js`，不要填 `functions`（那是目录，不是入口文件）。

## 模型密钥：函数变量，不是构建环境变量

在 ESA 控制台：

**边缘计算和 AI → 函数和 Pages → 你的项目 → 函数 → 基本信息 → 函数变量**

切到「生产环境」，添加：

| 键 | 值 | 加密存储 |
|---|---|---|
| `LLM_DEFAULT_BASE_URL` | `https://api.minimax.cn/v1` | 否 |
| `LLM_DEFAULT_API_KEY` | 你的 MiniMax API Key | **是** |
| `LLM_DEFAULT_MODEL` | `MiniMax-M3.1-Flash` | 否 |

- 必须在**函数变量**里配；Pages 构建信息里的「环境变量」只用于构建期，函数运行时读不到。
- 变量修改后要**重新生成版本并部署**才生效。
- 不要把 `.env` 提交到 GitHub；本地 `.env` 只给 Vite 开发用。
- 其他 OpenAI 兼容服务也可以：base URL 末尾不要带 `/chat/completions`，代码会自己拼；
  照片识别要求模型支持 `image_url`。

## 部署与验收

1. 推送改动到 `main`，触发构建；构建日志应显示 `vue-tsc` / `vite build` 成功。
2. 函数入口生效后，访问：

```text
https://你的域名/api/llm/ping
```

期望：

```json
{ "ok": true, "runtime": "aliyun-esa-pages-function", "hasBaseUrl": true, "hasModel": true, "hasApiKey": true }
```

3. 再看状态：

```text
https://你的域名/api/llm/status
```

期望：

```json
{ "available": true, "model": "MiniMax-M3.1-Flash" }
```

4. 回应用点「测试连接」或「用模型规划」，验证 `/api/llm/chat`。
5. 直接打开 `/plan`、`/execution` 等前端路由，确认 SPA 回退没有被函数入口破坏。

如果 `/api/llm/ping` 仍返回 HTML：说明函数入口没有生效。检查：
- `esa.jsonc` 的 `entry` 是否是 `./UI/server/llm.js`；
- 控制台函数文件路径是否也是这个文件（不是 `functions` 目录）；
- 这次构建是否包含该文件、函数是否发布了新版本；
- 域名是否绑定到当前 Pages 项目。

## 限制与安全

- ESA 函数单次响应上限 120 秒；网关 10 秒内收不到任何数据会 504。入口会先发一个空格保持连接，
  前端 `res.json()` 能正常解析；模型本身仍可能超时或限流。
- 函数代码包上限 4 MB；本入口很小。一次函数最多 4 个子请求；chat 只用 1 个。
- 请求体上限按 6 MB 处理；照片会先在浏览器压到 1024px。
- 默认不开放任意自定义 `baseUrl`：需要用户自带接口时，才在函数变量设
  `ALLOW_CUSTOM_LLM_PROXY=true`，同时给 `/api/llm/chat` 加 WAF/频率限制和预算。
- 服务端 key 只在函数变量中，浏览器只能通过 `/api/llm/status` 拿到 `{available, model}`。

参考：

- [Pages 构建与路由（esa.jsonc / entry）](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)
- [函数变量与 env](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/function-variable)
- [边缘函数 fetch 入口示例](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/return-to-1-html-page)
- [函数和 Pages 限制](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages)
