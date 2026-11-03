# TwoPoles API（§2）

Node 24 + 内置 `node:sqlite` + 原生 HTTP，后端无额外依赖。已接通 B0–B4 的账号、档案、训练、餐食、计划版本、周报、导出与清除主链路；§2 中仍待实现的内容见末尾，不能把它视为整章全部完成。

## 运行

```bash
cd UI
npm run server          # http://127.0.0.1:8787/api/v1
npm run test:api        # 18 项端到端测试（内存 SQLite）
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
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `CORS_ORIGINS` | 本地 5173 | 逗号分隔的精确白名单 |

## 接口

- `POST /auth/device|register|login|refresh|logout`、`POST /auth/delete-account`（二次确认令牌）
- `GET/PUT /profile`
- `GET/POST /sessions`、`PATCH /sessions/:id/feedback`、`DELETE /sessions/:id`
- `GET/POST /meals`、`PATCH/DELETE /meals/:id`
- `GET /plans/current`、`POST /plans`、`POST /plans/adjustments`（body 带 planId，也支持 `/plans/:id/adjustments`）、`POST /plans/adjustments/:id/accept`
- `GET /reports/weekly`
- `GET /sync?since=`
- `GET/PUT /settings/privacy`
- `GET/POST /export`、`GET /export/:id`、`GET /export/:id/download`
- `POST /data/wipe`（二次确认令牌）
- `GET /health`

约定：统一错误包体 `{ code, message, detail? }`；训练/餐食/计划/调整创建支持 `Idempotency-Key`；access 只在内存，refresh 只在 HttpOnly cookie。普通资源按用户隔离；训练/餐食删除为软删并出现在 `/sync.deleted`。

计划写入示例：`If-Match: "2"`。已有周计划的新版本写入、创建调整、接受调整都读取此头；缺失返回 428，header 与 body.baseVersion 不一致返回 400。接受调整在同一个 `BEGIN IMMEDIATE` 事务中检查最新版本并生成下一版；过期返回 `409 conflict` + `detail.latest`。已接受建议的重放返回原结果。锁定与已完成项保持不变，旧版本不就地覆盖。设置页可比较本机与最新计划，用户主动采用服务端版本后再重新调整。

导出 `POST /export` 立即返回 `202 {jobId, format, status:'pending'}`；单独 worker 从 SQLite 读快照生成文件，GET 查询后下载。作业持久化，服务重启后继续 pending 作业。CSV 带 UTF-8 BOM，并转义单元格；RPE 缺失保留 null / 未记录。清数据保留账号和登录会话；删号会撤销会话并清除账号。两者都需要五分钟内有效、只能使用一次的确认令牌。

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
npm run selfcheck   # 358 项：领域逻辑、outbox、迁移配额恢复
npm run test:sync   # 5 项：MSW、401、重试、并发编辑、离线恢复、计划 v1→v5
npm run test:api    # 18 项：认证、幂等、If-Match、并发409、隔离、周报、导出、清除
npm run build
```

2026-11-03 浏览器复验：真实 API 的档案/餐食上传、清空 localStorage 后 cookie 恢复并拉回记录、异步 CSV 下载；MSW Service Worker 拦截并完成设备登录。

## 部署边界与剩余工作

这是需要持久磁盘的 Node 服务，不能直接作为当前 ESA 边缘函数入口发布。ESA 仍负责静态站点和 `/api/llm/*`；`/api/v1/*` 需要转发到另行运行的 Node 24 服务，详情见 [DEPLOY-ESA.md](../DEPLOY-ESA.md)。生产设置独立随机 AUTH_SECRET、COOKIE_SECURE=true 和精确 CORS_ORIGINS。推荐同源反向代理；仅配置 CORS 并不能让 SameSite=Lax refresh cookie 在任意跨站域名之间工作。

尚未实现：B5 的 `/meals/recognize` 独立 VLM 接口及其同意/留存/配额前置条件，B6 的 `/assistant/*` 与 `/plans/generate`；现有 `/api/llm/*` 不能算这些接口已完成。服务端目前保存并校验本机生成的计划，没有迁入完整排课规则/目录发布。设备账号可升级为一个新正式账号，但尚无向既有账号合并的事务。列表 cursor 分页、`/sync` 中计划/模式历史的增量化、保留期自动作业与备份轮换也未实现。大数据量性能指标和线上部署尚未验收。
