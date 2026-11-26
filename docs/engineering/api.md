# TwoPoles API（§2）

Node 24 + 内置 `node:sqlite` + 原生 HTTP，后端无额外依赖。已接通 B0–B4 的账号、档案、训练、餐食、计划版本、周报、导出与清除主链路；§2 中仍待实现的内容见末尾，不能把它视为整章全部完成。

## 运行

```bash
cd UI
npm run server          # http://127.0.0.1:8787/api/v1
npm run test:api        # 36 项端到端测试（内存 SQLite）
```

前端默认仍是纯本机模式。要启用账号与同步：

```bash
VITE_API_BASE_URL=same-origin npm run dev
```

`same-origin` 让浏览器请求同源 `/api/v1`，Vite 已把它代理到 `127.0.0.1:8787`。也可以直接填 `http://127.0.0.1:8787`，此时服务端按 `CORS_ORIGINS` 放行并带 `credentials`。

PowerShell 使用 `$env:VITE_API_BASE_URL='same-origin'` 后再运行 `npm run dev`。服务端启动脚本读取 `UI/.env`，已有进程环境变量优先。`VITE_*` 是构建期变量，修改后需重启开发服务或重新构建。

无需启动后端的 MSW 联调：只设 `VITE_API_MOCK=true` 再运行 `npm run dev`。这是单账号内存假服务，刷新会重置，不校验真实密码；仅用于开发。worker 脚本由 Vite 开发中间件提供，生产产物不包含 MSW 代码或 worker。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | 监听地址 |
| `TWOPOLES_DB` | `./server/data/twopoles.sqlite` | SQLite 文件；测试用 `:memory:` |
| `AUTH_SECRET` | 开发默认值 | access token HMAC；生产必须替换 |
| `IDENTIFIER_SECRET` | 跟随 `AUTH_SECRET` | 账号标识哈希的盐。建议单独设置并长期不变：之后轮换 `AUTH_SECRET` 只让 token 失效，不会让全员无法登录 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `CORS_ORIGINS` | 本地 5173 | 逗号分隔的精确白名单 |
| `TRUSTED_CLIENT_IP_HEADER` | 空 | 边缘/反代写入的可信客户端 IP 头（如 `ESA-Client-IP`）。设置后只认这个头，不再回退到客户端可伪造的 `X-Forwarded-For` |
| `TWOPOLES_TIMEZONE` | 系统时区 | 周界默认值与 CSV 时间列使用的 IANA 时区（如 `Asia/Shanghai`）；部署在 UTC 机器上时建议设置 |

## 接口

- `POST /auth/device|register|login|refresh|logout`、`POST /auth/delete-account`（二次确认令牌）
- `GET/PUT /profile`
- `GET/POST /sessions`、`PATCH /sessions/:id/feedback`、`DELETE /sessions/:id`
- `GET/POST /meals`、`PATCH/DELETE /meals/:id`、`GET /meals/:id/thumb`（缩略图单独取）
- `GET /plans/current`、`POST /plans`、`POST /plans/adjustments`（body 带 planId，也支持 `/plans/:id/adjustments`）、`POST /plans/adjustments/:id/accept`
- `GET /reports/weekly`
- `GET /sync?since=`
- `GET/PUT /settings/privacy`
- `PUT /adjustment-resolutions`（body：`{ key, status, updatedAt }`；按 updatedAt 做 last-write-wins，重复同一时间戳是幂等的）
- `GET/POST /export`、`GET /export/:id`、`GET /export/:id/download`
- `POST /data/wipe`（二次确认令牌）
- `GET /health`

约定：统一错误包体 `{ code, message, detail? }`；训练/餐食/计划/调整创建支持 `Idempotency-Key`（同一个 key 换了方法或路径视为新请求，不会回放上一个接口的响应）；access 只在内存，refresh 只在 HttpOnly cookie。普通资源按用户隔离；训练/餐食删除为软删并出现在 `/sync.deleted`，软删过的 clientId 不能重建，重试会拿到 `409 conflict` 而不是假成功。

`PATCH /sessions/:id/feedback`、`PATCH /meals/:id` 与 `PATCH /analyses/:id` 都只写请求体里真正出现的字段：没带的字段保持原值，显式传 `null` 才是清空（分析记录的 `sessionId` 省略即保持绑定）。登录按账号统计**失败次数**：连续 10 次密码错误后 60 秒内返回 429，成功登录会清零，所以正常反复登录不会被锁。

餐食缩略图不随 `/sync`、列表和导出下发（单张最大 120KB 的 base64，会让首屏同步变成几十 MB）；需要时用 `GET /meals/:id/thumb` 单独取，客户端展示前按需拉一次并写回本机。列表接口（`GET /sessions`、`GET /meals`、`GET /analyses`）支持 `limit` 与 `offset`：默认 200 条、最多 500 条，响应里带 `nextOffset`（`null` 表示没有更多）。`/sync` 的 `plans` 也按 `since` 增量返回，只带这一轮变化过的计划版本；`since` 是服务端 `serverTime`，客户端直接回传即可。

保留期清理在启动时与每 6 小时运行一次：过期的 refresh token（撤销后保留 7 天）、30 天前的幂等键、180 天前的审计日志、30 天前已完成的导出作业，以及 30 天前没有任何数据的匿名设备账号。`GET /export/:id` 在内容被新导出清空后返回 `downloadUrl: null`。

计划写入示例：`If-Match: "2"`。已有周计划的新版本写入、创建调整、接受调整都读取此头；缺失返回 428，header 与 body.baseVersion 不一致返回 400。接受调整在同一个 `BEGIN IMMEDIATE` 事务中检查最新版本并生成下一版；过期返回 `409 conflict` + `detail.latest`。已接受建议的重放返回原结果。锁定与已完成项保持不变，旧版本不就地覆盖。设置页可比较本机与最新计划，用户主动采用服务端版本后再重新调整。

导出 `POST /export` 立即返回 `202 {jobId, format, status:'pending'}`；单独 worker 从 SQLite 读快照生成文件，GET 查询后下载。作业持久化，服务重启后继续 pending 作业；单个作业超过 60 秒会被终止并标记 failed，不会卡住整个队列。为避免主库和备份被历史快照撑大，新建导出时会清空该用户此前完成的导出内容（只保留最新一份）。CSV 带 UTF-8 BOM，并转义单元格；RPE 缺失保留 null / 未记录。清数据保留账号和登录会话；删号会撤销会话并清除账号。两者都需要五分钟内有效、只能使用一次的确认令牌。

## 前端落点

- `src/services/api/http.ts`：超时、token 注入、401 单次 refresh、`ApiError`
- `src/services/api/*.ts`：profile / sessions / meals / plans / reports / settings / sync
- `src/services/outbox.ts`：同一 clientId 的创建/反馈/更新合并
- `src/services/sync.ts`：首次登录全量补传、后续只传 pending、增量拉取、冲突标记
- `src/services/storage.ts`：`twopoles.v1.*` 分类 key + 旧 `twopoles_state` 迁移
- `src/mocks/*`：仅开发使用的 MSW 契约适配器
- `src/stores/app.ts`：现有 Pinia 签名不变，内部写本地 → 入队 → 乐观更新
- `src/views/SettingsView.vue`：登录/设备账号、同步状态、冲突提示、服务端导出与清除/删号

## 验收脚本

```bash
npm run typecheck
npm run selfcheck   # 678 项：领域逻辑、存储、迁移、跟练计数
npm run test:sync   # 11 项：MSW、401、重试、并发编辑、离线恢复、计划 v1→v5、换账号隔离、冲突恢复
npm run test:api    # 36 项：认证、幂等、If-Match、并发409、隔离、周报、导出、清除、分页、保留期、缩略图
npm run build
```

2026-11-03 浏览器复验：真实 API 的档案/餐食上传、清空 localStorage 后 cookie 恢复并拉回记录、异步 CSV 下载；MSW Service Worker 拦截并完成设备登录。

## 部署边界与剩余工作

这是需要持久磁盘的 Node 服务，不能直接作为当前 ESA 边缘函数入口发布。ESA 仍负责静态站点和 `/api/llm/*`；`/api/v1/*` 需要转发到另行运行的 Node 24 服务，详情见 [DEPLOY-ESA.md](../DEPLOY-ESA.md)。生产设置独立随机 AUTH_SECRET、COOKIE_SECURE=true 和精确 CORS_ORIGINS。推荐同源反向代理；仅配置 CORS 并不能让 SameSite=Lax refresh cookie 在任意跨站域名之间工作。

尚未实现：B5 的 `/meals/recognize` 独立 VLM 接口及其同意/留存/配额前置条件，B6 的 `/assistant/*` 与 `/plans/generate`；现有 `/api/llm/*` 不能算这些接口已完成。服务端目前保存并校验本机生成的计划，没有迁入完整排课规则/目录发布。设备账号可升级为一个新正式账号，但尚无向既有账号合并的事务。列表分页目前是 `limit/offset`（没有 keyset cursor）；`/sync` 只对计划做了增量，`planHistory` 仍需客户端按 weeks 聚合；备份轮换由部署侧的每日 `VACUUM INTO` 脚本负责，服务本身不做。大数据量性能指标和线上部署尚未验收。
