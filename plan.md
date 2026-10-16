# 两仪·TwoPoles 后续规划

> 记录时间 2026-10-16。基线：`UI/src` 34 文件 / 4,735 行，7 个页面全部有实际界面，`npm run build` 与 `typecheck` 通过，JS+CSS 产物 312.7 KB gzipped（另需 `npm run camera:assets` 生成的约 39 MB 端侧推理资产）。
> 这份文件写的是"决定暂不做的事 + 恢复时怎么做"和"后端怎么和前端接上"，不是待办清单的替代品。

---

## 1. 暂缓：拍照识别食物与卡路里

### 1.1 决策

**暂不做。** 三条理由，按分量排序：

1. **数字不可信且会被当成可信**。照片能给出"这是什么"，给不出"有多少"。同一盘饭 300 与 700 kcal 在单目照片上无法区分，文献里单图热量估计误差普遍 >30%。而本产品现有的整套口径是克制的：`hasNutritionEstimate = false`、"未记录 ≠ 未摄入"、"不输出姿势安全结论"。界面上出现一个大号热量数，等于把这条原则推平。
2. **没有后端，就没有安全的云端识别**。任何云端视觉 API 的 key 打进前端 bundle 等于公开，谁都能抓走刷账单；而识别率与覆盖度真正好的只有云端。
3. **端侧现成模型覆盖不了中餐**。COCO 类别里只有 9 种食物（苹果/香蕉/橙子/西兰花/胡萝卜/披萨/热狗/甜甜圈/蛋糕），自训菜品分类器需要采数据—标注—验证，是另一个量级的项目。

### 1.2 恢复实施时的第一档设计（端侧、不承诺营养）

> **状态更新（2026-10-16）：本档已实施。** 落地为 `composables/useFoodPhoto.ts`（EfficientDet-Lite0 / float16 6.9 MB，端侧 CPU）+ `services/foodComposition.ts`（36 条参考值，全部标注"未与权威成分表核对"）+ MealsView 的"拍照 / 选图识别"面板 + 设置里的"显示热量粗估"（默认关）。实测：一张苹果+香蕉的照片被正确识别为香蕉 78% / 苹果 71%，加入后落库带 `source: 'photo'`，粗估显示为区间。**第二档（云端）仍未开始。**

前提：只做"拍照辅助录入"，不做"热量计算"的宣传。

| 环节 | 做法 | 边界 |
|---|---|---|
| 识别 | 复用 `usePoseCamera` 的模式，新增 `useFoodCamera`：MediaPipe `ObjectDetector`（EfficientDet-Lite0 / COCO，约 4 MB，端侧） | 只映射 9 个食物类；未命中即落 `其他` + `unknownItems`，绝不"猜" |
| 候选条目 | 检测结果 → 生成 `MealItem` 草稿（`foodName` = 类别映射名、`category` 人工绑定、`confidence`、`source: 'photo'`） | 必须由用户确认后才写入，沿用现有 `confirmed` 字段 |
| 份量 | 仍由用户填；不填 → `completeness: 'partial'` | 不做体积/深度估计 |
| 热量 | 可选开关：`store.privacy.showEnergyEstimate`（默认 off）。开启后显示**区间 + 来源**，例：`约 80–120 kcal · 依据《中国食物成分表》第 6 版 苹果 可食部 100 g · 未计入烹调油` | `MealAnalysis.hasNutritionEstimate` 从恒 `false` 改为按次标记，并强制随结果渲染来源与免责文案 |
| 参考表 | 自建 `src/services/foodComposition.ts`，字段：`name / ediblePortionPer100g / energyKcalPer100g / source / revisedAt`，**每条必须带出处**，条目数从 20 起步 | 未收录的食物不显示热量，只显示"待查" |

数据结构改动（向后兼容）：`MealItem.source?: 'manual' | 'photo'`、`MealItem.photoConfidence?: number`、`MealAnalysis.estimateRefs?: { foodName: string; range: [number, number]; source: string }[]`。

### 1.3 第二档（云端识别）的前置条件

只有在 §2 的最小代理层落地后才允许开始，且必须先补齐：图片上传的用户同意开关与留存策略、后端持有的 key、频率与体积限制、"画面/照片会上传"的界面文案与文档改写。**在这之前，"摄像头原始画面默认不上传"这句话不能被削弱。**

---

## 2. 后端与前端如何对接

### 2.1 五条原则

1. **本地优先（local-first）**。前端继续把 localStorage 当缓存与离线兜底；网络不可用时整套界面照常可用（这是现在的能力，不能退化）。
2. **契约先行**。先用 mock 适配器把接口形状钉死，再写真服务端；前端不允许直接读 `fetch` 散落在组件里。
3. **服务端是最终事实源**。`id` 由服务端生成；本地 `newId()` 只作为离线临时 id（`clientId`）。
4. **摄像头画面不出设备**。姿态识别继续留在端侧（MediaPipe），服务端只接收结构化结果（关键点序列默认**不**上报）。
5. **口径统一**。规则版本（`diet-rules-v1`、`report-rules-v1`）由服务端下发并落库，历史记录带当时的版本号，前端不再各自算。

### 2.2 API 面（v1）

Base：`/api/v1`，全部 JSON。除 `auth/*` 外都要 `Authorization: Bearer <access>`。

| 方法 | 路径 | 用途 | 关键请求 / 响应 |
|---|---|---|---|
| POST | `/auth/register` `/auth/login` | 邮箱或手机号 + 密码；未登录可 `POST /auth/device` 换匿名设备账号 | → `{ userId, accessToken, refreshToken, expiresIn }` |
| POST | `/auth/refresh` | 用 refresh 换 access | 幂等，返回新 token 对 |
| GET/PUT | `/profile` | 读写档案（对应 `UserProfile`） | PUT 为部分更新语义 |
| GET | `/plans/current?week=2026-10-12` | 取某周计划（`planRules` 的服务端版本） | → `{ planId, version, items: PlanItem[] }` |
| POST | `/plans/adjustments` | 提交调整建议 | → `{ adjustmentId, changes: PlanChange[] }` |
| POST | `/plans/adjustments/:id/accept` | **接受调整并生成新版本**（当前前端只是界面态，这一步才落地） | → `{ newVersion, lockedPreserved: true }` |
| GET/POST | `/sessions`（`?from&to`） | 列 / 新建训练记录 | POST 带 `Idempotency-Key: <clientId>` |
| PATCH | `/sessions/:id/feedback` | RPE / 不适 / 原因 / 备注（对应 `SessionFeedback`） | 缺 RPE 存 `null`，不接受 0 代替 |
| DELETE | `/sessions/:id` | 软删（`deletedAt`） | |
| GET/POST | `/meals`（`?date`） | 列 / 记一餐 | POST 幂等键同上 |
| DELETE | `/meals/:id` | 软删 | |
| GET | `/reports/weekly?start=2026-10-12` | 服务端算好的 `WeeklyReport` | 含 `dataQuality[]`、`ruleVersion` |
| GET/PUT | `/settings/privacy` | `PrivacySettings` | 与服务端保留策略互相独立，二者取更严 |
| GET/POST | `/export` `/export/:jobId` | 异步导出（数据量大时不占请求） | → `{ status, downloadUrl }` |
| POST | `/auth/delete-account` `/data/wipe` | 清除全部数据（对应现在 `clearAllData()`） | 需要二次确认令牌 `confirmToken` |

约定：分页用 `?cursor`；时间一律 ISO 8601 + `Z`；日期类业务字段用 `YYYY-MM-DD` 字符串（沿用前端现状）；错误统一 §2.6 的包体。

### 2.3 认证与令牌放哪

| 方案 | 结论 |
|---|---|
| `localStorage` 存 JWT | **不要**。XSS 一发就丢；现在前端大量 `v-html`-free 不代表永远安全 |
| 内存 + `httpOnly` cookie 承载 refresh | **推荐**。refresh 走 `Set-Cookie; HttpOnly; SameSite=Lax; Secure`，access 存内存并由拦截器自动带 `Authorization`；刷新页面时用 refresh 静默续期 |
| 完全依赖 cookie 会话 | 可选简化版，但 `SameSite` 要为 `Lax`，且要额外 CSRF token |

未登录（匿名设备账号）也允许写数据，`userType: 'anonymous'`；绑定时服务端做账号合并，前端只需在 `auth/login` 成功后重新拉一次快照。

### 2.4 ID 与幂等

- 每个资源三件套：`id`（服务端 UUID）、`clientId`（前端 `newId()` 生成）、`updatedAt`、`deletedAt`。
- 所有"新建"请求带 `Idempotency-Key: <clientId>`；服务端重复收到就返回首次结果。这样离线补传不会写出两条训练记录（本项目最容易出的脏数据）。
- 前端本地未同步项：`_sync: 'pending' | 'synced' | 'conflict'`（仅存本机，不上行）。

### 2.5 同步与冲突

1. 启动：`init()` → 读 localStorage 立即渲染（现有行为）→ 后台 `GET /sync?since=<lastSyncAt>` 增量拉取 → 覆盖同 id、保留 `pending` 的本地项 → 写回缓存。
2. 提交：`addSession/addMeal/applyFeedback/removeMeal/updateProfile/updatePrivacy` 先写本地，再入队 `outbox`（localStorage 里的一个数组），后台串行 POST/PATCH；成功回填服务端 id。
3. 冲突：默认 **last-write-wins by `updatedAt`**，例外是 `sessions` 与 `meals`（只增改不覆盖删除，冲突记为 `conflict` 并在设置页给一条可见提示）。不引 CRDT，课程规模不值当。
4. 失败：区分可重试（网络/5xx，指数退避最多 5 次）与不可重试（4xx，标记 `failed` 并在 UI 里说明）；离线横幅复用现有 `notice` 样式，别只写 console。

### 2.6 前端改造落点

```
UI/src/services/api/
  http.ts          # fetch 封装：baseURL、超时 10s、token 注入、401 单次刷新、错误规范化
  auth.ts          # login/refresh/logout/device
  profile.ts       # 读写档案
  sessions.ts      # 列表、新建（带 Idempotency-Key）、反馈、删除
  meals.ts         # 列表、新增、删除
  plans.ts         # 当前计划、调整建议、接受调整
  reports.ts       # 周报
  settings.ts      # 隐私、导出、清除
UI/src/services/sync.ts   # outbox、增量拉取、冲突标记
```

`http.ts` 关键形状（决定后面所有服务的手感）：

```ts
export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public detail?: unknown) { super(message) }
}

export async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1${path}`, {
    ...init,
    credentials: 'include',                     // refresh cookie 走这里
    headers: { 'content-type': 'application/json', ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}) },
    signal: AbortSignal.timeout(10_000)
  })
  if (res.status === 401) { await tryRefreshOnce(); return request(path, init) }
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({})))?.code ?? 'unknown', res.status, '请求失败')
  return res.status === 204 ? (undefined as T) : res.json()
}
```

Pinia 侧保持**现有签名不变**（`addSession` 仍返回 `TrainingSession`、`applyFeedback` 仍收本地 id），内部改成"写本地 → 入队 → 乐观更新"。这样 6 个页面一行都不用动，是这次迁移成本可控的关键。

Mock 与开关：

- `VITE_API_BASE_URL` 未配置 → `services/api/*` 走 `localOnly` 分支（直接返回本地 store 结果）。**今天的纯本地形态是默认形态，不能被后端上线弄坏。**
- 联调阶段用 MSW（`src/mocks/handlers.ts`）在浏览器里假服务端，先钉契约再等服务端；MSW 只进 devDependencies，产物零影响。

### 2.7 服务端数据模型（与前端类型一一对应）

```
users(id, type enum{anonymous,registered}, identifier_hash, created_at)
profiles(user_id, nickname, age, goal, experience, available_times[], equipment[], restrictions[],
         discipline, cycle_phase, cycle_start, cycle_end, target_event, weight_kg, updated_at)
plans(id, user_id, version, mode, week_start, created_at)
plan_items(id, plan_id, date, exercise_name, type, note, planned_duration, planned_sets, planned_reps, locked)
plan_adjustments(id, plan_id, created_at, reason, status enum{pending,accepted,rejected}, changes jsonb)
training_sessions(id, client_id, user_id, date, exercise_name, type, actual_duration, actual_distance,
                  actual_sets, actual_reps, completion_status, completion_reason,
                  rpe smallint null, discomfort bool, notes, camera_used bool,
                  manual_corrections int, avg_confidence numeric(4,3) null,
                  created_at, updated_at, deleted_at)
meal_records(id, client_id, user_id, date, meal_type, time, completeness enum, analyzed bool, created_at, updated_at, deleted_at)
meal_items(id, meal_record_id, food_name, category, portion_size numeric null, portion_unit,
           confirmed bool, source enum{manual,photo} default manual, photo_confidence numeric null)
meal_analyses(id, meal_record_id, category_coverage jsonb, missing_categories jsonb, unknown_items jsonb,
              has_nutrition_estimate bool, estimate_refs jsonb null, rule_version, limitations jsonb, created_at)
privacy_settings(user_id, camera_enabled, save_video_locally, retention_days, export_format, updated_at)
sync_state(user_id, last_sync_at)
```

要点：`rpe` 必须 nullable 且无默认 0（这是前端已经守住的数据语义，服务端不能破坏）；`(user_id, client_id)` 唯一索引兜住幂等；`deleted_at` 软删。

### 2.8 错误与状态约定

统一包体：`{ code: string, message: string, detail?: unknown }`，`code ∈ { validation_failed, unauthorized, forbidden, not_found, conflict, rate_limited, rule_version_mismatch, network, timeout }`。

前端三态强制：加载 / 空 / 错误各自有独立界面（本项目已有空状态范式：餐食"未记录"、计划"休息日"、周报"空白而不是 0"，照抄）。**"空"与"加载失败"绝不能长一样**——否则用户会把没网当成没数据，这在本产品语义里是实打实的伤害。

### 2.9 安全与合规清单

- [ ] key、密钥、内部 URL 只存在于服务端配置；CI 加 secret 扫描
- [ ] CORS 精确白名单，带 `credentials` 时禁止 `*`
- [ ] 所有输入服务端复校（年龄范围、时间格式 HH:MM、类别枚举、字符串长度）
- [ ] 限流：登录/注册/导出/清除重点设；`/data/wipe` 需 `confirmToken`（先申请、再执行）
- [ ] CSP 基线 + 关掉不需要的 `connect-src`；MediaPipe 的 wasm 走同源
- [ ] 账号删除与保留期落到实际作业（现在 `retentionDays` 只是偏好，无自动清理，接了后端必须补齐）
- [ ] 不存摄像头帧、不存生物特征；关键点上报默认关闭且可关
- [ ] 热量/负荷等显示位一律带来源与"参考值"标注

### 2.10 里程碑

| 阶段 | 内容 | 前端可验收标准 |
|---|---|---|
| B0 | 契约 + MSW mock + `http.ts`/`sync.ts` 骨架、`VITE_API_BASE_URL` 开关 | 不开后端时一切行为与今天完全一致（回归：本地录入 → 刷新仍在） |
| B1 | 认证 + 档案 + 只读同步（sessions/meals/report 拉取） | 清空 localStorage 后登录能拉回既有数据；断网仍显示本地缓存 |
| B2 | 写路径 + outbox + 幂等 | 离线录一餐→恢复网络自动补传且**只有一条**；重复提交被幂等吸收 |
| B3 | 计划调整与版本落地（`accept` 真改计划） | 接受调整后刷新页面仍是新版本；锁定项未被改写 |
| B4 | 导出作业 + 删除账号/清除数据 | 导出文件可被表格软件打开；清除后服务端与本机都无残留 |
| B5 | （可选）拍照识别云端版，需 §1.3 前置全绿 | 文案与隐私说明同步改写，不保留"画面不上传"的误导 |

---

## 3. 其余已知缺口（与上面无关，按影响排序）

1. 姿态识别 → 计数未联动：`usePoseCamera` 已给关节角，缺一个带迟滞的 `ready→down→up→count++` 状态机与遮挡门控。
2. 计划调整只在界面层生效（B3 解决）。
3. 推荐口径未按档案计算：`planRules` 是固定周一/三/五，未用 `availableTimes/equipment/restrictions` 过滤。
4. 无障碍未做 WCAG AA 逐项核对；部分自绘控件低于 44px（日历格子、chip、tab）。
5. 没有任何自动化测试：优先补 `mealRules` / `weekRules` / 演示时钟这三个纯逻辑单元 + 一条"建档→跟练→反馈→周报"e2e。
6. 真摄像头下的骨架对齐与关节角数值未经实测（开发环境无可用设备）。
7. 视觉：表面与排版档已完成（2026-10-16 第九轮，见下）；仍未做的是"真实关键点驱动的骨架动画、图表入场"这类依赖识别结果的动效。
   - 已完成：`body` 分层环境光（4 层径向光晕，`background-attachment: fixed`）+ `feTurbulence` 噪点层（`body::before`，z-index -1，实测 opacity .035）；`--font-display` 光学字体栈与标题 -0.035em 字距；`--shadow-card`/`--inner-light` 冷调分层阴影用于卡片、指标卡、按钮、日历；页标题渐变裁切文字；指标卡光斑 + hover 斜向掠光；概览英雄区球体轨道环。
   - 顺带修掉一处失真：`.ring` 进度环原本硬编码 `conic-gradient(... 66%)`，0/3 也显示 66%，现由 `--pct` 按 `recorded/planned` 实时驱动（实测 0 餐 → 0%）。
   - 尝试后回退：想用双层 `box-shadow` 环替换输入框默认聚焦框，但隐藏文档下 `:focus` 不参与匹配、无法验证，且与 scoped 样式层叠纠缠；已恢复 `outline: 2px solid` 原方案，仅保留输入框内凹阴影。
