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

> **状态更新（2026-10-17）：本档已实施并补了口径漏洞。** 落地为 `composables/useFoodPhoto.ts`（EfficientDet-Lite0 / float16 6.9 MB，端侧 CPU）+ `services/foodComposition.ts`（57 条参考值，全部 `verified: false` 并标注"未与权威成分表逐项核对"；另含 22 种混合菜名单）+ MealsView 的"拍照 / 选图识别"面板 + 设置里的"显示热量粗估"（默认关）。实测：一张苹果+香蕉的照片被正确识别为香蕉 78% / 苹果 71%，加入后落库带 `source: 'photo'`，粗估显示为区间。
> 口径修正：`mealRules.buildLimitations(hasEstimate)` 改为按本次是否真出数生成免责清单——原来无论开没开都写"没有热量估算（hasNutritionEstimate = false）"，和 `store` 把它置 `true` 自相矛盾；混合菜一律不参与估算、类别标"待确认"。MealsView 顶部说明与"是否含营养估算：否"的固定文案同步改为随实际状态。**第二档（云端）仍未开始。**

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
   - 容量边界：单个 `twopoles_state` key 装的是整个状态，浏览器配额约 5 MB。按现有记录体积估算，1 万条训练/餐食会顶到上限，所以接后端前必须先把状态**按类别拆 key**（`sessions`、`meals`、`plans`、`profile`…），并在写入捕获 `QuotaExceededError`：提示"导出后再清理"，绝不静默丢数据。设计文档 §2.4(2) 的 1 万条/P95 指标只适用于服务端接口。
2. **契约先行**。先用 mock 适配器把接口形状钉死，再写真服务端；前端不允许直接读 `fetch` 散落在组件里。
3. **服务端是最终事实源**。`id` 由服务端生成；本地 `newId()` 只作为离线临时 id（`clientId`）。
4. **摄像头画面不出设备**。姿态识别继续留在端侧（MediaPipe），服务端只接收结构化结果（关键点序列默认**不**上报）。
5. **口径统一**。规则版本由服务端下发并落库，历史记录带当时的版本号，前端不再各自算。当前前端在用的版本号：`diet-rules-v2`、`report-rules-v2`、`plan-rules-v3`、`food-catalog-v2`、`exercise-catalog-v1`（文档 §5.1"分析与规则"落到这些 key 上）。

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

1. ~~姿态识别 → 计数未联动~~ **已完成（2026-10-17）**：`composables/useRepCounter.ts` 落地带迟滞与最短阶段时长的 `起始→运动→返回→count++` 状态机，含 3 帧平滑、可见度遮挡门控、停滞重置、抖动不计入，以及机位校准（阈值随用户起始姿势偏移）。跟练页实时摄像头分支已改由状态机驱动计数，演示回放保留预设时间线；手工修正后状态机不再回写本组次数，`manualCorrections` 与模型计数分别落库。**未做**：真机验证与 §3.4.3 的隔离测试集实测。
2. 计划调整的版本落地：本机已实现（`store.acceptAdjustment` 写新版本、旧版本进 `planHistory`、锁定项保持不变，B3 的前端可验收标准已在 localStorage 上达成）；服务端侧仍需 B3 的 `If-Match` 版本校验与 409 处理。
3. ~~推荐口径未按档案计算~~ **已完成（2026-10-17）**：`services/exercises.ts`（27 条动作，含 1 条停用）+ `planRules.buildDayPlan` 按器材、场地、时长与"需要避开的"过滤；约束无解时返回逐条冲突原因；未满 18 岁或勾选孕期/伤病限制时 `auto=false`，只留记录与手工录入。
4. 无障碍未做 WCAG AA 逐项核对；部分自绘控件低于 44px（日历格子、chip、tab）。本轮新增控件已按 44px 写（锁定/完成、校准、替换候选、切换确认按钮），但整体仍未逐项核对。
5. 自动化测试：新增 `npm run selfcheck`（esbuild 打包 + Node 断言，66 项，覆盖 F04 过滤、负荷缺失口径、类别推断与混合菜、计数状态机、计划版本与模式切换确认）。**仍缺**：Playwright e2e（"建档→跟练→反馈→周报"）与服务端 pytest。
6. 真摄像头下的骨架对齐、关节角数值与计数准确率未经实测（开发环境无可用设备）；状态机阈值目前是动作库默认值 + 机位校准偏移，未按标注样本调参。
7. 记录摩擦（第一因子）：饮食侧基线已改造并复测（2026-10-16 第十轮）——表单改为就地展开在触发它的卡片内、拍照面板默认折叠、名称框 autofocus、回车即存。实测位移 +568px→−26px，从触发点到"保存"的整屏滚动 1 次→0 次，表单顶到第一个输入框 266px→91px，可交互控件 11→10。
   - ~~待做：一行速记（名称即落库 + 类别推断标"待确认"）~~ **已完成**：`suggestCategory()` 命中目录即改写类别（用户手动改过就不再动），未命中或混合菜落"其他"并进 `unknownItems`。
   - 待做：份量/单位降级为可选展开、"最近吃过"芯片（本机历史，重复记录可压到 1 tap）。
   - ~~已知数据缺陷：手输"苹果"会以 `苹果/谷薯类` 入库~~ **已修**：新行默认类别改为"其他（待确认）"，由名称推断赋值；自检查 `suggestCategory('苹果') === '水果类'`。
   - 训练侧与建档侧的同类基线尚未测量。
8. 视觉三档已完成两档半：
   - ② 单一强调色 + 语义色重标（第十一轮，取值依据 `UI/research/界面偏好调研.md` P0-1/P0-2 与 `ui-directions.html`）：强调色收敛为 `#0f766e` 一种，指标卡去渐变改白卡 + 1px 描边 + 单层阴影且只在真达成时着色，语义色只留 success(=强调色)/caution/danger/neutral 并用点形/条形做非颜色冗余，装饰渐变只保留品牌位。实测 7 条路由 281 个文本节点 0 项 AA 失败，并修掉 `--color-on-accent` 拼错名与 muted 3.75:1 不达 AA 两个真 bug。
   - ③ 环改条 + 洞察卡可收起（第十二轮）：概览餐次圆环删除，改三段条（实心=完整、半填+caution 描边=部分、空心=未记录），`aria-label` 逐条播报；三处解释卡统一为 `InsightCard`，收起状态写入 localStorage 并实测刷新后保持；新按钮触控目标从 68×32 提到 68×44。
   - 第九轮的表面与排版档（`--font-display`、标题字距、分层阴影）保留，但当时加的 4 层环境光与 .035 颗粒已降为 1 层与 .018，页标题渐变裁切文字已改为纯墨色。
   - ④ 常驻动画改按需已完成（第十二/十三轮）：概览基线 4 个常驻无限动画（`pulse@mode-dot`、`sheenSweep::after@mini-progress`、`gradientShift@hero`、`spin::before@hero-orb`）与跟练页 13 个全部删除，37 处行内 `animation-delay` 入场错位取消；仅保留两处"操作进行中"才存在的循环（演示回放扫光、休息徽标呼吸）。复测：6 页常驻无限动画 0、跟练页 1。`animations.css` 233→105 行，`index.css` 20.07→18.70 kB（gzip 4.97）。
   - 仍未做：图表入场动画（本来就没有）、真实关键点驱动的骨架动画；调研 P1-7 双主题 + 跟随系统；侧栏/Toast/跟练舞台的 `backdrop-filter` 毛玻璃尚未逐处降级。
   - 调研 P1-4 已完成（第十五轮）：移动端底栏由 5 项并为 4 项（今日 / 记录 / 图表 / 我的），计划与跟练归入"今日"名下（仍从首屏按钮与抽屉进入），档案升进"我的"（设置页本就有档案行）。实测 4 项触控目标 64×57px、`aria-current="page"` 在 `/plan` 上也落在"今日"、393px 无横向溢出。
   - ②③④ 三步的做法与数字见 `UI/交付说明.md` 第十一至十三轮；其中记录了我自己造成的一次破坏与恢复（`sed /pattern/d` 删规则时删掉了 DashboardView 整行主样式，随后从 HEAD 取回该行、在该行内用 `s///` 完成原本要做的删除并复测选择器完整性）。
