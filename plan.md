# 两仪·TwoPoles 后续规划

> 记录时间 2026-10-16，2026-10-17 晚按当前代码重写过一次：已完成的设计稿全部删除，未开工的保留并补上本轮讨论出的拓展项。
> 基线（2026-10-17 22:20 实测）：`UI/src` 39 文件 / 6,318 行，7 个页面全部有实际界面，`npm run build` / `typecheck` / `selfcheck`（92 项）全通过，产物 36 个文件 raw 792 kB / gzip 183.2 kB（其中 MediaPipe 运行时 `vision_bundle` 45.7 kB gzipped、姿态推理 worker 147 kB raw）；另需 `npm run camera:assets` 生成的 39 MB 端侧推理资产。
> 这份文件写的是"下一步做什么、按什么顺序、怎么算做完"（§4）、"决定暂不做的事 + 恢复时怎么做"（§1）、"后端怎么和前端接上"（§2），以及"现在还欠着什么"（§5）。当前阶段只做前端，§2 整章是后端计划，不在本轮实施范围。

---

## 1. 拍照识别食物：端侧第一档已落地，剩云端类别与份量

### 1.1 仍然成立的三条边界

1. **单目照片给不出"有多少"**。同一盘饭 300 与 700 kcal 在一张 RGB 照片上信息量相同——这是缺信息，不是模型不够强。带参照物的体积估计文献误差约 20–30%，自由拍摄更差；再乘成分表本身的 ±25%，复合误差到 40–50%。所以热量永远只能是**区间 + 来源 + 默认关闭**，界面上不能出现一个大号单值。
2. **没有后端就没有安全的云端识别**。任何云端视觉 API 的 key 打进前端 bundle 等于公开，谁都能抓走刷账单；而识别率与覆盖度真正好的只有云端。第一档选端侧就是这个原因。
3. **端侧现成模型覆盖不了中餐**。COCO 类别里只有 9 种食物（苹果/香蕉/橙子/西兰花/胡萝卜/披萨/热狗/甜甜圈/蛋糕）。已落地的 `foodComposition.ts`（56 条目录 + 22 种混合菜，全部 `verified: false`）解决的是"认出名字之后有多少热量可查"，不解决"中餐认不出来"。

### 1.2 第二档：云端开源 VLM 认类别（未开工）

前提同样是 §2 的最小代理层先落地；端侧 COCO 那条路保留为离线兜底，不能被替换掉。

| 环节 | 做法 | 边界 |
|---|---|---|
| 模型 | 自托管或第三方 API 的开源视觉大模型（Qwen-VL / InternVL / MiniCPM-V 一档），prompt + JSON schema 约束输出 | key 只在服务端；上传的是**这一张照片**，与摄像头实时画面是两件事，文案要分开写 |
| 输出 | `{ name, category, confidence, portions: [{ anchor, count }] }`，逐条映射到本机 `foodComposition` 目录 | 目录未命中 → 类别"其他（待确认）"并进 `unknownItems`，与现在 `suggestCategory()` 同一口径，绝不"猜" |
| 确认 | 结果一律是候选，用户点"加入"才落库（沿用 `source: 'photo'` 与 `confirmed`） | 照片不留存、不进对象存储，除非另开同意开关并写清留存策略 |
| 自训 | 泛化不足时：用 VLM 批量给自采图打标 → 人工抽检 → 微调一个**小分类器**，只解决"中餐类别"这一个问题 | 不自训重量回归；Food-101 对中餐覆盖差，别指望它 |

### 1.3 份量：先做"份数"，不做"克数"（未开工）

- **锚定参照物**：拍摄引导里放手掌 / 拳头 / 标准盘 / 一枚硬币，或固定机位距离；输出"约 1.5 拳米饭"这类**可纠正的份数**，由用户点确认或改，而不是直接给克数。
- **没有参照物就不估**：延续现在"份量没填 → 不显示，而不是给 0"的做法；`estimateRefs.basis` 里必须写明"图像估计，误差 ±X%"。
- **份数↔克数交给本机口径**：复用已落地的单位↔克数换算（按 `食物|单位` 记忆、可撤销），VLM 只报份数，克数由本机算，误差来源可追溯、可被用户改。
- **热量继续默认关闭** + 区间 + 来源，界面文案不得让它长得像计算结果。

### 1.4 云端上传的前置条件

只有在 §2 的最小代理层落地后才允许开始，且必须先补齐：图片上传的用户同意开关与留存策略、后端持有的 key、频率与体积限制、"画面/照片会上传"的界面文案与文档改写。**在这之前，"摄像头原始画面默认不上传"这句话不能被削弱。**

---

## 2. 后端与前端如何对接

### 2.1 六条原则

1. **本地优先（local-first）**。前端继续把 localStorage 当缓存与离线兜底；网络不可用时整套界面照常可用（这是现在的能力，不能退化）。
   - 容量边界：单个 `twopoles_state` key 装的是整个状态，浏览器配额约 5 MB。按现有记录体积估算，1 万条训练/餐食会顶到上限，所以接后端前必须先把状态**按类别拆 key**（`sessions`、`meals`、`plans`、`profile`…），并在写入捕获 `QuotaExceededError`：提示"导出后再清理"，绝不静默丢数据。设计文档 §2.4(2) 的 1 万条/P95 指标只适用于服务端接口。
2. **契约先行**。先用 mock 适配器把接口形状钉死，再写真服务端；前端不允许直接读 `fetch` 散落在组件里。
3. **服务端是最终事实源**。`id` 由服务端生成；本地 `newId()` 只作为离线临时 id（`clientId`）。
4. **摄像头画面不出设备**。姿态识别继续留在端侧（MediaPipe），服务端只接收结构化结果（关键点序列默认**不**上报）。
5. **口径统一**。规则版本由服务端下发并落库，历史记录带当时的版本号，前端不再各自算。当前前端在用的版本号：`diet-rules-v2`、`report-rules-v2`、`plan-rules-v3`、`food-catalog-v2`、`exercise-catalog-v1`（文档 §5.1"分析与规则"落到这些 key 上）。
6. **模型只做选择题**。任何 LLM/VLM 端点都不允许自由生成处方内容：输入是已校验的结构化档案，输出必须逐条命中 `exercise-catalog-v1` / `food-catalog-v2` 的 id，服务端复校不过就整体拒绝，前端回落到本机 `planRules.buildDayPlan`。锁定项、`GATE_RESTRICTIONS`、12–17 岁不自动推荐这三条硬约束由规则引擎守住，不经模型。

### 2.2 API 面（v1）

Base：`/api/v1`，全部 JSON。除 `auth/*` 外都要 `Authorization: Bearer <access>`。

| 方法 | 路径 | 用途 | 关键请求 / 响应 |
|---|---|---|---|
| POST | `/auth/register` `/auth/login` | 邮箱或手机号 + 密码；未登录可 `POST /auth/device` 换匿名设备账号 | → `{ userId, accessToken, refreshToken, expiresIn }` |
| POST | `/auth/refresh` | 用 refresh 换 access | 幂等，返回新 token 对 |
| GET/PUT | `/profile` | 读写档案（对应 `UserProfile`） | PUT 为部分更新语义 |
| GET | `/plans/current?week=2026-10-12` | 取某周计划（`planRules` 的服务端版本） | → `{ planId, version, items: PlanItem[] }` |
| POST | `/plans/adjustments` | 提交调整建议 | → `{ adjustmentId, changes: PlanChange[] }` |
| POST | `/plans/adjustments/:id/accept` | **接受调整并生成新版本**（本机已由 `store.acceptAdjustment` 落地，这一步是把同一语义搬到服务端） | → `{ newVersion, lockedPreserved: true }` |
| GET/POST | `/sessions`（`?from&to`） | 列 / 新建训练记录 | POST 带 `Idempotency-Key: <clientId>` |
| PATCH | `/sessions/:id/feedback` | RPE / 不适 / 原因 / 备注（对应 `SessionFeedback`） | 缺 RPE 存 `null`，不接受 0 代替 |
| DELETE | `/sessions/:id` | 软删（`deletedAt`） | |
| GET/POST | `/meals`（`?date`） | 列 / 记一餐 | POST 幂等键同上 |
| DELETE | `/meals/:id` | 软删 | |
| GET | `/reports/weekly?start=2026-10-12` | 服务端算好的 `WeeklyReport` | 含 `dataQuality[]`、`ruleVersion` |
| POST | `/assistant/explain` | 解释某版计划为什么这样排、回答追问（§4.9 的解释层） | 入参是**已生成的结构化计划**；返回只用于展示，不回写任何计划字段 |
| POST | `/assistant/parse` | 自由文本主诉 → 结构化约束（`restrictions` / `availableTimes` / 器材） | 只返回现有枚举值，命中不了的项原样回`未识别`，不新造类别 |
| POST | `/plans/generate` | LLM 在已校验动作库内选题（§4.9 的生成层，最后一档） | → `{ items: [{ exerciseId, sets, reps, date }], reason }`；任一 `exerciseId` 不在目录内 → `validation_failed`，前端回落本机规则 |
| POST | `/meals/recognize` | 开源 VLM 认食物类别与份数（§1.2/§1.3） | multipart 或预签名 URL；→ `{ name, category, portions[], confidence }`，图片不落盘，单次体积与频率设上限 |
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
匿名账号的边界要写进文档口径，否则"所有个人数据接口校验记录归属"（设计文档 §2.4(4)）说不通：匿名数据只归属该设备标识，服务端按 `user_id` 隔离，不跨设备可读；账号合并是**单向、用户主动触发**的一次性操作，合并前必须在界面上说明"本机匿名期间的 N 条记录将并入该账号"；被合并的匿名标识随即失效，不可再写。注册/登录仍是 F01 的必须项，匿名只是降低首次演示门槛，不能替代它。

### 2.4 ID 与幂等

- 每个资源三件套：`id`（服务端 UUID）、`clientId`（前端 `newId()` 生成）、`updatedAt`、`deletedAt`。
- 所有"新建"请求带 `Idempotency-Key: <clientId>`；服务端重复收到就返回首次结果。这样离线补传不会写出两条训练记录（本项目最容易出的脏数据）。
- 前端本地未同步项：`_sync: 'pending' | 'synced' | 'conflict'`（仅存本机，不上行）。

### 2.5 同步与冲突

1. 启动：`init()` → 读 localStorage 立即渲染（现有行为）→ 后台 `GET /sync?since=<lastSyncAt>` 增量拉取 → 覆盖同 id、保留 `pending` 的本地项 → 写回缓存。
2. 提交：`addSession/addMeal/applyFeedback/removeMeal/updateProfile/updatePrivacy` 先写本地，再入队 `outbox`（localStorage 里的一个数组），后台串行 POST/PATCH；成功回填服务端 id。
3. 冲突：**业务档案与偏好**用 last-write-wins by `updatedAt`；**计划是例外**——写请求带 `If-Match: <baseVersion>`，服务端比对当前版本，不一致返回 `409 conflict` 并附最新版本，前端刷新后重新比较变更再让用户决定（与设计文档 §3.4.2"同一事务中校验旧版本"、§7"版本不一致则拒绝覆盖"一致；不接受静默覆盖）。`sessions` 与 `meals` 只增改不覆盖删除，冲突记为 `conflict` 并在设置页给一条可见提示。不引 CRDT，课程规模不值当。
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

### 2.7 服务端数据模型（SQLite 方言，与前端类型一一对应）

设计文档 §1.5/§3.4.2 定的是 SQLite + SQLAlchemy，所以这里**不能用 `jsonb`、`enum`、数组列**：SQLite 只有 `TEXT`/`INTEGER`/`REAL`/`NUMERIC`/`BLOB`。约定如下，列类型一律按此写迁移：

- 多值与结构字段存 `TEXT` + JSON 文本（读用 JSON1 `json_each`/`->>`），列名以 `_json` 结尾；建表时用 `CHECK (json_valid(col))` 兜格式。
- 枚举存 `TEXT` + `CHECK (col IN (...))`。
- 布尔存 `INTEGER NOT NULL DEFAULT 0` + `CHECK (col IN (0,1))`。
- 时间：UTC ISO 8601 文本（`...Z`）存 `TEXT`；业务日期 `YYYY-MM-DD` 存 `TEXT`。

```
users(id TEXT PK, type TEXT NOT NULL CHECK(type IN ('anonymous','registered')),
      identifier_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)
profiles(user_id INTEGER PK REFERENCES users, nickname TEXT, age INTEGER NOT NULL CHECK(age >= 12 AND age <= 90),
      auto_recommend INTEGER NOT NULL DEFAULT 1,           -- 服务端按年龄与限制复算，不只信前端
      goal TEXT, experience TEXT, available_times_json TEXT, equipment_json TEXT,
      available_venues_json TEXT, restrictions_json TEXT,   -- 含 GATE_RESTRICTIONS：孕期或产后、伤病或遵医嘱限制
      discipline TEXT, cycle_phase TEXT, cycle_start TEXT, cycle_end TEXT, target_event TEXT,
      weight_kg REAL, updated_at TEXT NOT NULL)
mode_changes(id INTEGER PK, user_id INTEGER REFERENCES users, from_mode TEXT CHECK(from_mode IN ('public','athlete')),
      to_mode TEXT CHECK(to_mode IN ('public','athlete')), at TEXT NOT NULL, open_plan_count INTEGER)
                                             -- F02"保留历史模式快照"落在这里；本机对应 store.modeLog

exercises(id TEXT PK, name TEXT NOT NULL, type TEXT NOT NULL, equipment_json TEXT, venues_json TEXT,
      minutes INTEGER NOT NULL, sets INTEGER, reps INTEGER, intensity TEXT CHECK(intensity IN ('低','中','高')),
      jump_free INTEGER, knee_friendly INTEGER, spine_friendly INTEGER,
      howto TEXT, reason TEXT, camera_json TEXT,        -- 关节、起始位、行程末端、最短阶段时长
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
      source TEXT NOT NULL, catalog_version TEXT NOT NULL)
templates(id TEXT PK, mode TEXT, name TEXT, note TEXT, created_at TEXT)
template_items(template_id TEXT REFERENCES templates, exercise_id TEXT REFERENCES exercises,
      day_offset INTEGER, order_index INTEGER, planned_minutes INTEGER,
      PRIMARY KEY (template_id, exercise_id, order_index))      -- 文档 §5.2 "模板可引用多个动作"

plans(id TEXT PK, user_id INTEGER REFERENCES users, version INTEGER NOT NULL, mode TEXT,
      week_start TEXT NOT NULL, week_end TEXT, reason TEXT NOT NULL,
      rules_version TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (user_id, week_start, mode, version))   -- 版本号唯一，接受调整即写新版本；旧行不改写
plan_items(id TEXT PK, plan_id TEXT REFERENCES plans, date TEXT, exercise_id TEXT NULL REFERENCES exercises,
      exercise_name TEXT NOT NULL, type TEXT, note TEXT,
      planned_duration INTEGER, planned_distance INTEGER,   -- 分钟 / 米，与前端一致
      planned_sets INTEGER, planned_reps INTEGER, locked INTEGER, completed INTEGER,
      alternatives_json TEXT)                                -- 跑步项允许 exercise_id 为空
plan_adjustments(id TEXT PK, plan_id TEXT REFERENCES plans, base_version INTEGER NOT NULL,
      created_at TEXT, reason TEXT, status TEXT CHECK(status IN ('pending','accepted','rejected')),
      changes_json TEXT)      -- base_version 就是 If-Match 的落点：接受时服务端比对，不一致拒绝

training_sessions(id TEXT PK, client_id TEXT NOT NULL, user_id INTEGER REFERENCES users, date TEXT,
      exercise_name TEXT, type TEXT, actual_duration INTEGER, actual_distance INTEGER,
      actual_sets INTEGER, actual_reps INTEGER, completion_status TEXT, completion_reason TEXT,
      rpe INTEGER CHECK(rpe BETWEEN 0 AND 10 OR rpe IS NULL),   -- 0～10，缺就是 NULL，绝不默认 0
      discomfort INTEGER, notes TEXT, camera_used INTEGER,
      manual_corrections INTEGER, counted_reps INTEGER,        -- 模型计数与人工修正分别保留（文档 §5.2）
      avg_confidence REAL, calibrated_neutral INTEGER,         -- 机位校准结果，便于复现阈值
      created_at TEXT, updated_at TEXT, deleted_at TEXT,
      UNIQUE (user_id, client_id))                             -- 幂等兜底
meal_records(id TEXT PK, client_id TEXT, user_id INTEGER, date TEXT, meal_type TEXT
      CHECK(meal_type IN ('breakfast','lunch','dinner','snack')), time TEXT,
      completeness TEXT CHECK(completeness IN ('complete','partial','unknown')), analyzed INTEGER,
      created_at TEXT, updated_at TEXT, deleted_at TEXT, UNIQUE (user_id, client_id))
meal_items(id TEXT PK, meal_record_id TEXT REFERENCES meal_records, food_name TEXT, category TEXT,
      portion_size REAL NULL, portion_unit TEXT, confirmed INTEGER,
      source TEXT DEFAULT 'manual' CHECK(source IN ('manual','photo')), photo_confidence REAL NULL)
foods(id TEXT PK, name TEXT NOT NULL, category TEXT NOT NULL, energy_kcal_per_100g REAL,
      note TEXT,                  -- 口径：熟重 / 生重 / 可食部，界面必须同屏显示
      verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
      revised_at TEXT)            -- verified=0 时前端只允许以区间粗估显示
mixed_foods(name TEXT PK, note TEXT)     -- 混合菜名单：不参与营养估算，类别待确认

rule_versions(id TEXT PK, kind TEXT CHECK(kind IN ('diet','report','plan','food','exercise')),
      version TEXT NOT NULL, published_at TEXT, notes_json TEXT,
      UNIQUE (kind, version))                      -- 文档 §5.2 RuleVersion；停用条目不可用于新推荐
analysis_records(id TEXT PK, kind TEXT, input_hash TEXT, rule_version TEXT REFERENCES rule_versions,
      result_json TEXT, created_at TEXT)          -- 输入变了 input_hash 就变，旧结论自动失效
meal_analyses(id TEXT PK, meal_record_id TEXT, category_coverage_json TEXT, missing_categories_json TEXT,
      unknown_items_json TEXT, has_nutrition_estimate INTEGER, estimate_refs_json TEXT NULL,
      rule_version TEXT, limitations_json TEXT, created_at TEXT)

privacy_settings(user_id INTEGER PK REFERENCES users, camera_enabled INTEGER, save_video_locally INTEGER,
      retention_days INTEGER CHECK(retention_days BETWEEN 7 AND 3650), export_format TEXT,
      show_energy_estimate INTEGER DEFAULT 0, updated_at TEXT)
sync_state(user_id INTEGER PK REFERENCES users, last_sync_at TEXT)
audit_events(id INTEGER PK, user_id INTEGER NULL, actor_role TEXT CHECK(actor_role IN ('user','admin','system')),
      action TEXT NOT NULL, target_type TEXT, target_id TEXT, event_code TEXT, created_at TEXT)
      -- 文档 §5.2/§7：记录操作者与动作，不存密码、令牌和敏感正文
```

要点：`rpe` 必须 nullable 且无默认 0（0 是合法量表值，缺才是 NULL——前端已按 0～10 出量表，服务端不能把两者混起来）；`(user_id, client_id)` 唯一索引兜住幂等；`deleted_at` 软删；`exercises`/`foods` 的 `source` 必填但允许如实标注"未与权威成分表逐项核对"，`verified` 决定前端能不能出数。

### 2.8 错误与状态约定

统一包体：`{ code: string, message: string, detail?: unknown }`，`code ∈ { validation_failed, unauthorized, forbidden, not_found, conflict, rate_limited, rule_version_mismatch, network, timeout }`。

前端三态强制：加载 / 空 / 错误各自有独立界面（本项目已有空状态范式：餐食"未记录"、计划"休息日"、周报"空白而不是 0"，照抄）。**"空"与"加载失败"绝不能长一样**——否则用户会把没网当成没数据，这在本产品语义里是实打实的伤害。

### 2.9 安全与合规清单

- [ ] key、密钥、内部 URL 只存在于服务端配置；CI 加 secret 扫描
- [ ] CORS 精确白名单，带 `credentials` 时禁止 `*`
- [ ] 所有输入服务端复校（年龄范围 12–90、`auto_recommend` 只允许 18 岁以上且未命中 `GATE_RESTRICTIONS` 时为 1、时间格式 HH:MM、类别枚举、份量单位在 `UNIT_GRAMS` 内、字符串长度）
- [ ] 限流：登录/注册/导出/清除重点设；`/data/wipe` 需 `confirmToken`（先申请、再执行）
- [ ] CSP 基线 + 关掉不需要的 `connect-src`；MediaPipe 的 wasm 走同源
- [ ] 账号删除与保留期落到实际作业。当前界面已如实标注 `retentionDays` 与 `saveVideoLocally` 只是偏好、不触发删除或录制；接后端后要么实现该作业，要么删掉这两个开关别给用户提供它没有的控制权（设计文档 §2.4(4) 的"离线备份最长 30 天轮换"说的是服务端备份保留期，与用户数据保留天数是两件事，界面和文档都要分开表述）
- [ ] 不存摄像头帧、不存生物特征；关键点上报默认关闭且可关
- [ ] 热量/负荷等显示位一律带来源与"参考值"标注
- [ ] **健康类字段单独同意**：`restrictions`（膝/腰/心脏/孕期等）在个保法口径下属敏感个人信息，把它发给第三方大模型需要单独的明示同意与"不用于训练"的合同条款。对这类字段"脱敏"是无效的——"膝关节置换术后"这句话本身就是全部信息。可选做法：只发枚举码、或走自托管模型；两者都不成立就不发。
- [ ] 模型请求与响应的日志不落敏感原文（只留 `clientId` + 命中/回落结果），并给留存上限
- [ ] 模型输出必须过 schema + 目录双重校验，校验失败按 `validation_failed` 走，绝不"取最接近的一个"
- [ ] `/assistant/*` 与 `/meals/recognize` 设频率、单次体积与每日配额上限；超配额返回 `rate_limited` 且前端有可见提示（不是转圈）

### 2.10 里程碑

| 阶段 | 内容 | 前端可验收标准 |
|---|---|---|
| B0 | 契约 + MSW mock + `http.ts`/`sync.ts` 骨架、`VITE_API_BASE_URL` 开关 | 不开后端时一切行为与今天完全一致（回归：本地录入 → 刷新仍在） |
| B1 | 认证 + 档案 + 只读同步（sessions/meals/report 拉取） | 清空 localStorage 后登录能拉回既有数据；断网仍显示本地缓存 |
| B2 | 写路径 + outbox + 幂等 | 离线录一餐→恢复网络自动补传且**只有一条**；重复提交被幂等吸收 |
| B3 | 计划调整与版本落地（`accept` 真改计划） | 接受调整后刷新页面仍是新版本；锁定项未被改写 |
| B4 | 导出作业 + 删除账号/清除数据 | 导出文件可被表格软件打开；清除后服务端与本机都无残留 |
| B5 | （可选）拍照识别云端版：开源 VLM 认类别与份数，需 §1.4 前置全绿 | 文案与隐私说明同步改写，不保留"画面不上传"的误导；认不出仍走手工录入，不猜 |
| B6 | LLM 三档按 §4.9 的顺序（解释层 → 翻译层 → 生成层），全部走 §2.1 第 6 条的选择题约束 | 关掉模型服务时页面照常出计划与解释（回落本机规则）；生成结果任一 id 不在目录即整体拒绝 |

---

## 3. 跟练端侧改造（本轮）

> **状态更新（2026-10-17 晚）：三条已落地，`build` / `typecheck` / `selfcheck`（92 项）通过。** 新增 `composables/poseMath.ts`（几何与帧时间戳，纯函数）、`poseLandmarkerFactory.ts`（GPU 探测 + CPU 回落，worker 与主线程共用）、`poseInference.worker.ts`、`poseEngine.ts`（两种引擎与选择），`usePoseCamera.ts` 的公开返回值签名不变（新增 `delegate` / `runsIn`），`ExecutionView` 只改了状态文案。
> 实测证据（`npm run build && npm run preview`，Chromium）：worker `ready{delegate:"GPU", gpuError:null}`，console 出现 `GL version: 3.0 (WebGL 2.0 …)` 与 `Graph successfully started running`，`createImageBitmap` → transfer → `detectForVideo` 往返正常（空白帧返回 0 个关键点，符合预期）；页面点"实时摄像头"在无摄像头环境下按设计退回演示回放。
> **dev 的边界**：`npm run dev` 下 worker 里的 wasm glue 加载不了——module worker 没有 `importScripts`，而 Vite 不把 `public/` 的文件当模块解析（`/mediapipe/wasm/vision_wasm_internal.js?import` 返回 500），`createPoseEngine` 因此**自动回落主线程推理**（功能与改造前一致，只是不赚线程收益）。要验证 worker 与 GPU，必须走构建产物。
> 顺手修掉的真 bug：可见度原来对 11–27 共 **17** 个关键点的 `visibility` 求和后除以 **6**，结果可达 2.8，使状态机的遮挡门控（`minVisibility: 0.5`）恒成立；改为参与算角的 6 点均值，`selfcheck` 第 8 节有断言。
> 下表保留原设计口径，作为"为什么这么改"的记录。

计数状态机已落地（`composables/useRepCounter.ts`），但取帧与推理这两层还是 2026-10-16 的写法。三条都不改交互，只为准确率与流畅度铺路。

| # | 现状 | 改造 | 验收 |
|---|---|---|---|
| 3.1 | `usePoseCamera.ts` 用 rAF 轮询 + `now !== lastTs` 去重，喂给 `detectForVideo` 的时间戳取 rAF 的 `now` | 改 `video.requestVideoFrameCallback()`：一帧一次回调，用 `metadata.mediaTime` 作真实帧时间戳；RVFC 不可用时回落 rAF + `video.currentTime` 去重 | `stop()` 走 `cancelVideoFrameCallback`；同一帧不被推理两次；状态机的最短阶段时长不再被 rAF 抖动污染 |
| 3.2 | `landmarker.detectForVideo()` 在 rAF 里同步跑，主线程每帧被占十几到几十毫秒 | 推理搬进 `composables/poseInference.worker.ts`：主线程每帧 `createImageBitmap(video)` → transfer 给 worker，worker 推理后回传关键点/关节角/可见度并 `close()` 掉 bitmap；**绘制仍留主线程**（`DrawingUtils` 要的是 DOM canvas 的 2D 上下文与现有 CSS 镜像） | 跟练时滚动与点击不卡；worker 或 `createImageBitmap` 不可用时自动回落主线程推理——实时骨架不能因为这次改造而消失 |
| 3.3 | `baseOptions.delegate` 写死 `'CPU'` | 试 `delegate: 'GPU'`。`VisionTaskOptions.canvas` 注释写明"GPU 处理必须绑定该 canvas，WebGL 上下文初始化失败即抛错"（`node_modules/@mediapipe/tasks-vision/vision.d.ts:2900`），所以要给一块**专用** canvas（worker 内用 `OffscreenCanvas`），不能复用叠加层那块 | GPU 抛错就在 worker 内重建为 CPU；实际生效的 delegate 回传主线程并显示在状态文案（"已就绪 · GPU/CPU"），不谎报 |

**本环境测不到的部分**：没有可用摄像头，`getUserMedia` 一律被拒，RVFC 的取帧分支只能靠代码走查；worker + GPU + `ImageBitmap` 往返已在构建产物里实测（见上面的状态更新），但真机 FPS、骨架对齐、关节角数值与计数准确率仍归 §5.1。

**IMU 计数不在本节**：它需要"计时/计步型课次"这个前置类型，已单独立项为 §4.3。

---

## 4. 功能路线（按优先级；当前阶段只做前端）

> 排序依据：能否在本机自证 × 对"协同助手"这个名字的贡献 × 出错时的伤害面。视觉类排最后不是因为它不重要，而是它在现环境里最贵且最不可验证（无摄像头、无后端、无标注样本）。

### 4.1 反馈回头改计划（最高价值——闭环的最后一断口）

实测现状（2026-10-17 复核，四条都带代码位置）：

- `grep "sessions|rpe" services/planRules.ts` → **零命中**。排课只看档案，从不看训练结果。
- `rpe` 的消费者全是展示与导出（`weekRules.loadOf`、`ReportView:94`、`SettingsView:216`、反馈 toast），没有一处回流到计划。
- `completionReason` **只写不读**（唯一命中是 `stores/app.ts:440` 的赋值）。
- 唯一的调整规则长在视图里：`PlanView:246-248`「当日计划总时长 > 档案最大可用时间块 → 建议搬一天」，它读档案、不读训练。`store.acceptAdjustment`（`app.ts:303`）是纯执行器，只应用外部传入的 `changes`。

做法（纯函数 + 一条文案）：

1. 把 `PlanView` 那条搬移规则挪进 `planRules`，与排课同源，视图只渲染。
2. 新增 `progression(sessions, planItems)`：同一动作**连续两次** RPE ≥ 8 → 降一组/降次数；连续两次 ≤ 3 且 `completionStatus` 为全部完成 → 升一组；出现 `discomfort` 或非空 `completionReason` → 停止加量、只提事实。采用"两次才动"而不是单次降标。
3. 产出仍是 `PlanChange[]`，走已有的 `acceptAdjustment` → 新版本 → `planHistory`；锁定项与已完成项不动。
4. 界面写"按你最近两次反馈调整"，**不写 AI / 智能推荐**——它是规则。

验收：selfcheck 覆盖"两次高 RPE 才降、单次不降、discomfort 只停不加、锁定项不被改写、降下去还能升回来"；界面上每条调整都能展开触发它的具体日期与 RPE。
边界：`rpe === null` 的 session 不参与判断（不能当 0）；12–17 岁或命中 `GATE_RESTRICTIONS` 者 `auto=false`，只给建议不改计划。

### 4.2 休息页 = 下一动作预显 + 跳过热区分层（成本最低）

现状：`status:'resting'` 与 `restDuration` 已有，休息期只有一句倒计时与徽标，不预告下一动作。
做法：休息卡显示下一组的动作名 / 组数 / 次数与站位提示；"跳过休息"的热区不与预显争点击——预显区域不吞点击，跳过用短按确认或 400ms 长按（沿用"清除数据"的两步确认先例）。
验收：393px 宽下无误触跳过；`prefers-reduced-motion` 下不新增循环动画；读屏能播到"下一个：站姿弯举 2 组 × 10 次"。

### 4.3 计时/计步型课次（IMU 与"计数降级"共同的地基）

现状：跟练只有 reps 模型（`demoExercises` 就坐站与弯举两条），而库里 `ex-easy-run` / `ex-brisk-walk` 是 `minutes:20, sets:1` 无次数、`ex-plank` / `ex-breath` 是 `holdSeconds`——**这些动作根本没有跟练入口**。
这一步开的是课次类型 `reps | time | steps`，落库用已有的 `actualDuration` / `actualDistance` 空位。它同时解锁两件事：

- **IMU 免摄像头**：跑步/快走用 `DeviceMotion` 做垂直加速度过峰检测算步数与步频——这个信号比姿态计数干净得多；
- **姿态计数的降级落点**：可见度低于阈值时"退回时钟推进"目前无处可退，因为计时分支只存在于演示回放里。

配套的产品定位调整（与调研结论一致）：把 `useRepCounter` 从"记账"降级为"节奏提示"——只对大关节低频动作启用；计数始终可一键 ±1 覆盖并标来源（`manualCorrections` 已分别落库）；低可见度时**主动**降级为计时并明说，而不是静默出错。
IMU 的三条硬约束：① 距离靠步幅估算误差 10–20%，按"不出不可信数字"的口径只给步数与时长，距离要么标"估算"要么不给；② iOS 锁屏/切后台会挂起 JS，Android 同理——要么 `navigator.wakeLock` + 明说"屏幕需保持常亮"，要么限定"手机在手/臂包"；③ `DeviceMotionEvent.requestPermission()` 在 iOS 必须用户手势触发且要 HTTPS，权限文案要写"只读运动传感器，不读位置"。
验收：一条"手机放口袋走完 200 步"的手测记录（步数误差 ±5%）；无权限或无传感器时明确降级为手动计时并标注来源。

### 4.4 语音节奏播报（本机音色自选；AI 音色进后端）

现状：全库没有任何 `speechSynthesis` 或音频播放。
第一档（本机、零上传）：只播节奏与计时——"下一组开始""组间剩 5 秒""本组完成"；音色选择器列设备自带中文音色，选择存进偏好并落盘，这已经给到"用户自选音色"的自由度。
**明确不做**：语音纠错播报（误判 + 约 1.2s 延迟，播错了收不回，且与"不输出姿势安全结论"直接冲突）。
第二档（云端 AI 音色）：需要服务端持 key、按字符计费、把动作名与进度文本发出去 → 归 §2，与摄像头同一套同意与留存约束。
无障碍：`speechSynthesis` 与现有 `aria-live` 会双声道打架，需要"播报与读屏互斥"开关，默认关闭。
验收：无中文音色/静音设备上不报错并回落 `aria-live`；开关与音色选择刷新后保持。

### 4.5 运动×饮食交叉分析

产品叫"协同助手"，但 `sessions` 与 `meals` 从不交叉：`weekRules.buildWeeklyReport` 只是把每日负荷与 8 类出现次数并排算完，中间没有任何一条关系。可做：训练日 vs 休息日的类别结构差、"某类出现的当天与次日完成率"、按当日计划强度提示"今晚这餐还缺豆类"。纯本机可算、零新依赖，且把已有的两套规则缝起来。边界：相关不等于因果，界面一律写"同期出现"而不是"有助于"。

### 4.6 30 秒坐站测试（体测口径）

`exercises.ts` 里的 `ex-chair-sitstand` 是 2×8 的日常训练，不是计时测试；而"30 秒内坐站次数"本身就是 SPPB 下肢功能项的原始值，人群也对得上（椅子、低冲击、膝友好）。可加：30 秒计时模式（依赖 4.3 的计时型课次）、历史趋势、与年龄参考区间并列。报的是次数不是医学判断，与"不输出姿势安全结论"不冲突。

### 4.7 月报与长期趋势

现在只有周（`weekStart`），跨月对比与"负荷是否持续走高"无处可看。按 4 周滚动复用 `buildWeeklyReport`，缺 RPE 的日子继续画斜纹而不是当 0。

### 4.8 PWA + 本地提醒

无 manifest、无 Service Worker，只能开着网页用；跟练与记录提醒才是"日常使用"的前提。要先定 39 MB 端侧资产的缓存策略（不能每次进跟练重下），并面对 iOS Safari 的通知与后台限制；提醒文案要尊重"未记录 ≠ 没发生"的口径，不能写成"你还没吃饭"。

### 4.9 LLM 三档：解释 → 翻译 → 生成（依赖 §2 的代理层，本阶段不实现）

- 信息量先看清：档案只有 6 个结构化字段，而"按档案排课"已由 `planRules.buildDayPlan` 用规则做完。LLM 的增量不在重新算一遍，而在**解释与追问**（为什么周三排两场、这周为什么减量）与**翻译**（把"最近爬楼膝盖发酸"翻成 `restrictions` 枚举再交给规则引擎）。生成放最后一档。
- 三条硬约束：① 选择题而非填空题（§2.1 第 6 条）；② 同一档案两次生成不同计划会被用户当 bug——按 profile hash 缓存、低温度、只在实质变更时重生成，否则 `plan-rules-v3` 的版本语义会乱；③ 健康类字段的同意与合规见 §2.9。
- 兜底路：Chrome 内置 AI（Gemini Nano / Prompt API）数据完全不出设备，与隐私叙事一致；限制是 Chrome 127+、需下载模型、能力偏弱、国内主流浏览器基本没有——只适合当离线兜底，不是主路。

### 4.10 视觉识别（食物类别 / 份数）——见 §1，排最后

理由不变：认类别必须后端（key 不能进 bundle），估份量受单目尺度限制，而这两件事在现环境里既跑不了也验不了。4.1–4.4 任何一条做完，都比在这里追平 Keep 更接近产品名。

---

## 5. 其余已知缺口（按影响排序）

1. 真机验证：摄像头下的骨架对齐、关节角数值、计数准确率，以及 §3 三条改造后的实际 FPS 全部未实测（开发环境无可用设备）；计数误差指标未在隔离测试集上实测，不作为已达成结论（设计文档 §3.4.3）。状态机阈值目前是动作库默认值 + 机位校准偏移，未按标注样本调参。
2. **文案承诺了不存在的机制**：`ReportView:30` 写"本周有训练报了不适：**自动加量建议已停止**"，但全库没有任何自动加量逻辑。要么按 4.1 把它做出来，要么把这句改成只陈述事实（"本周有不适记录，周报不再给出加量建议"）。按本项目"不写没有的控制权与没有的行为"的口径，这是 bug 不是润色。
3. 规则长在视图里：`PlanView:246-248` 的搬移建议应挪进 `planRules`（见 4.1），否则同一条口径无法被 selfcheck 覆盖，也无法被周报与后端复用。
4. 计划调整的服务端侧：本机 `store.acceptAdjustment` 已写新版本并把旧版本进 `planHistory`，服务端仍需 B3 的 `If-Match: <baseVersion>` 校验与 409 处理。
5. 无障碍：WCAG AA 未逐项核对。本轮新增控件按 44px 写了（锁定/完成、校准、替换候选、切换确认），日历格子、chip、tab 等自绘控件仍可能低于 44px；读屏软件与真实设备未验证。
6. 测试：`npm run selfcheck` 92 项覆盖纯逻辑（第 8 节为姿态几何与帧时间戳），仍缺 Playwright e2e（"建档→跟练→反馈→周报"）与服务端 pytest；`poseEngine` 的 worker/主线程回落本身要 DOM，node 自检覆盖不到，目前只有构建产物里的一次人工实测为证。
7. 记录摩擦：饮食侧基线已改造并复测（第十轮），常吃 / 搜索 / 拍照三个入口与单位↔克数口径已落地（第十七轮）。**待做**：份量/单位仍是常驻一行四列，未降级为可选展开；训练侧与建档侧的同类基线尚未测量。
8. 视觉：侧栏 / Toast / 跟练舞台的 `backdrop-filter` 毛玻璃尚未逐处降级；图表入场动画（本来就没有）与真实关键点驱动的骨架动画未做——演示回放里的骨架仍是按阶段位移的 SVG 示意。
9. 两个诚实标注的"当前无实际效果"的偏好：`saveVideoLocally`（本版本没有录制功能）、`dataRetentionDays`（没有自动清理作业）。接后端后要么实现该作业（§2.9），要么把开关删掉，别给用户一个他没有的控制权。
