# 反馈回头改计划 + 记录报告

## 1. 问题陈述

当前计划只看档案与时间冲突：

- `services/planRules.ts` 不读取 `sessions`、`rpe`、`completionReason`；训练后的 RPE、完成状态、不适与原因只进入展示和导出，从不回流到计划。
- 唯一的调整规则在 `views/PlanView.vue` 的视图内计算；无法被 selfcheck、周报或后续后端复用。
- 计划页的跟练只传动作名，计划项的组数/次数/保持秒数/目标分钟不会影响跟练页。

当前报告只有周：

- `/report` 只有自然周窗口；没有滚动近四周、自然月月报和长期趋势。
- 用户无法回答“训练负荷是否持续走高”“这个月比上个月多还是少”。

这次把两件事一起做，让“训练 → 反馈 → 计划 → 跟练”闭合成环，并让记录有一个跨周、跨月的查看窗口。

## 2. 方案概述

1. **反馈调整**：新增纯函数规则服务，读取训练反馈，产出待确认的计划调整建议；计划页顶部用一张“待确认调整”卡合并“时间冲突”和“反馈调整”两类建议。用户逐条接受/暂不调整；接受后才通过现有 `store.acceptAdjustment` 生成新计划版本。反馈只使用训练侧数据，不包含饮食；不自动改计划。
2. **跟练联动**：计划项增加保持秒数/目标分钟字段；计划页每个未完成项都有独立“跟练”入口，把该条的 sets/reps/hold/minutes 传进跟练页；跟练页按这些值启动，并把 `planItemId` 写回训练记录。
3. **记录报告**：`/report` 改名为“记录报告”，增加 **本周 / 近四周 / 本月 / 长期** 四个时间窗。周报保持现有内容；近四周与月报沿用“训练 + 餐食”的报告结构；长期趋势只展示训练负荷与训练天数。所有缺失数据继续遵守“未记录 ≠ 0”。

## 3. 用户故事

### A. 反馈调整

1. 当同一动作最近两次**记了 RPE**的训练都在最近 21 天内，且两次 RPE 都 ≥ 8，打开计划页时应看到一条反馈调整建议，显示触发日期、两次 RPE，以及建议的组数/次数/保持时长变化。
2. 当同一动作最近两次有效反馈都 ≤ 3，且两次 `completionStatus` 都是 `completed`，应看到升量建议。
3. 两次有效反馈一高一低，或不足两次，或两次不都在最近 21 天内，不产生反馈建议。
4. 中间夹着未记 RPE 的场次时，该场次跳过、不打断连续；`rpe === null` 永远不当作 0。
5. 任一触发场次有 `discomfort === true` 或非空 `completionReason` 时，只显示安全事实卡，不生成数字改动；即使同时满足高 RPE 降量条件，也只提示、不自动改数字。
6. 安全事实卡提供“去手动调整”入口；不提供“接受自动调整”按钮。
7. 12–17 岁或档案命中 `GATE_RESTRICTIONS` 时，不生成数字调整建议，只显示事实/手动处理提示。
8. 建议目标是**当前周该动作下一次未完成、未锁定**的计划项；跳过已完成与已锁定项。
9. 当前周没有目标项时，卡片显示“生成下周计划并调整”；用户点击后才创建下周计划，再按新计划里的同动作条目应用；若下周计划没有该动作，明确说明，不伪造目标。
10. 计划页进入时沿用既有的“本周计划自动落盘”watcher；反馈卡不会静默创建下周计划。当前周无计划的分支只作防御，正常路径下本周计划已由页面确保存在。
11. 建议按“动作 + 两次 session + 目标计划项”去重；接受或“暂不调整”后记录已处理，相同证据不重复出现；出现新的训练反馈后重新计算。接受后目标值会变化，不能因为原值/新值变化再弹一条。
12. 接受建议后：目标计划项的字段改变，`planHistory` 保留旧版本，计划页和跟练页都按新值生效。
13. 暂不调整不修改计划，只记录该证据已处理。
14. 卡片与现有“时间冲突调整”合并为一张待确认列表；两类建议可分别接受/暂不调整；接受一条不会自动接受其他条。
15. 反馈建议的文案使用“按你最近两次反馈调整”，不使用“AI / 智能推荐”。
16. 每条建议可展开看到触发它的具体日期与 RPE；安全事实卡显示“有不适”或“未完成原因”。
17. 计划页每个可跟练的未完成计划项都有“跟练”按钮；不可跟练的动作显示禁用与原因。
18. 从计划项启动跟练时，跟练页使用该条的 sets/reps/保持秒数/目标分钟；没有覆盖参数时仍使用动作库默认值。
19. 跟练结束写入的训练记录带上 `planItemId`（从计划项启动时）；反馈规则仍按 `exerciseName` 精确匹配动作。
20. 时间冲突规则从 `PlanView` 移到纯函数服务，行为保持：某天总时长超过档案最大可用时间块时，建议把该天第一个未锁定、未完成项原样移到次日。

### B. 记录报告

1. 页面 `/report` 的标题、导航和文档口径改为“记录报告”；导航短标签为“报告”；路由不变。
2. 页面顶部时间窗为 **本周 / 近四周 / 本月 / 长期**，默认本周；本周视图保持现有结构、数据与交互。
3. **本周**：继续使用现有 `buildWeeklyReport` 的统计、每日负荷图、餐食类别矩阵、训练记录表与数据质量说明；只改页面外壳和标题，不改周报口径。
4. **近四周**：窗口为以今天为终点往前 28 天，切成 4 个 7 天块；展示训练统计、4 块负荷图、4 块摘要表、餐食类别矩阵与数据质量。
5. **本月**：窗口为自然月 1 日到月末；当前月只统计到今天；支持上一月/下一月/回到本月；从 1 日起切成 4–5 个 7 天块（1–7、8–14、15–21、22–28、29–月末/今天）。
6. **长期**：窗口为最近 6 个自然月（含当前月），按月聚合；只展示训练负荷与有记录的训练天数；当前月标记为部分月份。
7. 长期趋势中，没有训练记录的月份在图上显示“未记录/空白”，不画成 0；有训练但缺 RPE 的月份，负荷标记为不完整（斜纹/部分样式），不补 0。
8. 月报和近四周的负荷图：某块内只要有任一场次缺 RPE，该块负荷标为不完整；图中保留可计算的负荷值，同时用斜纹/“不完整”标注，不能把它当成完整总量。
9. 餐食报告只统计记录天数、完整/部分记录与 8 类出现次数；不推断份量、热量或营养摄入；缺失餐次仍为“未记录”。
10. 没有计划安排的月份/近四周，完成率显示“—”，不计算 0/0。
11. 报告中的数据质量说明按窗口生成：缺 RPE 的条目、负荷覆盖天数、未记录天数、餐食未记录天数、当前月截止日期。
12. 长期图点击某个月可打开该月的月报；当前月同样可点。
13. 报告页在 393px、768px、1024px、1440px 下无横向溢出；时间窗切换和月份切换可用键盘操作，具备 `role="tablist"`/`role="tab"`/`aria-selected` 或等价语义。
14. 空状态：没有记录时显示“还没有记录”，不画成 0；加载/空/错误三种状态不与“未记录”混淆（本页无异步加载，至少保证空与有数据的区分）。

## 4. 已定决策

- **反馈只来自训练**：RPE、完成状态、`discomfort`、`completionReason`。饮食只进报告和同期对照，不参与改计划。
- **只在计划页触发**：反馈建议出现在计划页顶部的“待确认调整”卡；不做跟练结束弹窗、不在周报里单独生成调整。
- **合并卡片**：时间冲突调整与反馈调整在同一张卡里分组/逐条展示，逐条接受或暂不调整。
- **全量规则**：高 RPE 降量、低 RPE + 全部完成升量、不适/原因只提示；不做单次触发。
- **幅度**：有多组时 sets ±1（最低 1 组）；只有单组时 reps ±2（最低 5 次）、保持时长 ±5 秒（最低 10 秒）、计步目标 ±5 分钟（最低 10 分钟）。
- **目标**：当前周该动作下一次未完成、未锁定项；没有时显式生成下周计划再调整；不静默创建下周计划。当前周计划沿用计划页既有 watcher 自动落盘，反馈不再额外创建。
- **去重**：按触发证据 + 目标项；接受或暂不调整都记录已处理；新反馈再评估。不把原值/新值放进 key，否则接受后目标值变化会再次触发同一证据。
- **安全优先**：不适/非空原因优先于高 RPE；只提示事实，不自动改数字。12–17 岁或 `GATE_RESTRICTIONS` 同样不生成数字调整。
- **不自动应用**：任何调整都必须用户接受；见 `docs/adr/0001-feedback-adjustments-require-confirmation.md`。
- **跟练联动**：接受后计划页与跟练页都生效；计划项增加 `plannedHoldSeconds` / `plannedTargetMinutes`；每个未完成项有独立跟练入口。
- **报告归属**：月报与长期放在 `/report`，不放进计划页；计划页的“四周周期”保持原义。
- **近四周**：滚动 28 天，4 个 7 天块，固定窗口，不前后翻页。
- **本月**：自然月；当前月到今天；前后翻月。
- **长期**：最近 6 个自然月，按月聚合；训练负荷 + 有记录训练天数；不做饮食长期图。
- **月报内容**：训练 + 餐食；不做训练×饮食同期差（该内容已在首页/协同弹层）。
- **报告页命名**：页面标题“记录报告”，导航短标签“报告”，路由 `/report` 不变。
- **不引入图表库**：沿用现有 CSS/SVG 与 token 体系。

## 5. 接缝与数据形状

### 5.1 纯函数接缝

新增 `src/services/adjustmentRules.ts`（或等价命名，保持纯函数、无 DOM/Vue 依赖）：

```ts
type FeedbackDirection = 'down' | 'up' | 'safety'

interface FeedbackEvidence {
  sessionId: string
  date: string
  rpe: number | null
  completionStatus: TrainingSession['completionStatus']
  discomfort: boolean
  completionReason?: string
}

interface FeedbackIntent {
  key: string
  exerciseName: string
  direction: FeedbackDirection
  evidence: FeedbackEvidence[] // 最近两次有效反馈；safety 时为触发项
  reason: string
}

interface AdjustmentSuggestion {
  key: string
  source: 'time-conflict' | 'feedback'
  planId: string
  itemId: string
  date: string
  exerciseName: string
  title: string
  from: string
  to: string
  reason: string
  changes: PlanChange[]
  safetyOnly: boolean
  needsPlan?: 'current-week' | 'next-week'
}
```

建议的纯函数：

- `buildFeedbackIntents(sessions, now, options?): FeedbackIntent[]`
  - 同一 `exerciseName` 精确匹配；按 `date`/`createdAt` 排序。
  - 取最近两次 `rpe !== null` 且 `date <= today` 的场次；两次日期都需在 `today - 21 天` 内；未记 RPE 场次跳过。
  - `discomfort` 或非空 `completionReason` → `safety`；优先于高/低规则。
  - 两次都 ≥ 8 → `down`；两次都 ≤ 3 且两次都 completed → `up`；否则无。
  - 年龄 < 18 或 `gateReason(profile)` 命中 → 不产出数字方向，只保留 safety/fact（若要显示）。该判断可以由调用方传入 `allowNumeric`。
- `findNextPlanItem(plan, exerciseName, today): PlanItem | null`
  - `date >= today`、`!completed`、`!locked`，按日期/顺序取第一条。
- `applyFeedbackMagnitude(item, exerciseMode, direction): Partial<PlanItem>`
  - mode 由动作库/demo 动作推断；`plannedHoldSeconds` / `plannedTargetMinutes` 缺失时用动作库默认值。
  - sets > 1 → sets ±1；sets === 1 → reps/hold/target 按已定幅度。
  - 同步更新 `plannedDuration`，让计划页时长与时间冲突规则看到变化；具体比例在实现中固定并写 selfcheck。
- `buildTimeConflictSuggestion(plan, profile, selectedDate): AdjustmentSuggestion | null`
  - 复刻现有规则：选中日总时长 > 最大可用时间块；取第一个未锁定、未完成项；`newValue.date` 改为次日。
- `buildAdjustmentSuggestions({ plan, plans, profile, selectedDate, resolutions, now }): AdjustmentSuggestion[]`
  - 合并时间冲突 + 反馈建议；过滤已处理的 key；标注 `needsPlan`。

### 5.2 计划与执行数据

- `PlanItem` 新增可选字段：
  - `plannedHoldSeconds?: number`（time 模式每组保持秒数）
  - `plannedTargetMinutes?: number`（steps 模式目标分钟）
- `planRules.toPlanItem` 生成计划时从动作库带入这两个字段；旧计划缺失时由跟练/调整逻辑回退到动作库默认值，不强制迁移。
- `PlanChange.newValue` 可携带上述字段。
- `ExecutionView` 接受查询参数（或等价的状态传递）：`exercise`、`planItemId`、`sets`、`reps`、`hold`、`minutes`；对 demo 动作做不可变覆盖：
  - reps：覆盖 `sets` / `repsPerSet`，重建该组的演示时间线与 `setDuration`；
  - time：覆盖 `sets` / `holdSeconds`；
  - steps：覆盖 `targetMinutes`；
  - 无参数时行为与现在完全一致；非法/越界值忽略并回到默认。
- 从计划项启动时，`summarizeSession` 写入 `planItemId`；现有 `TrainingSession.planItemId` 已存在。
- 计划页每项“跟练”按钮：仅对 `demoExercises` 中存在的动作启用；不可跟练时禁用并说明原因。

### 5.3 持久化

- `store.adjustmentResolutions`（或等价字段）：记录已接受/已暂不调整的建议 key 与状态；随 `twopoles_state` 持久化；`clearAllData()` 清空。
- 不新增服务端；所有数据仍只在本机。
- 旧状态没有该字段时按空处理。

### 5.4 报告接缝

新增 `src/services/reportRules.ts`（或等价命名，纯函数）：

```ts
interface ReportBlock {
  start: string
  end: string
  label: string
  load: number | null
  loadCompleteness: 'complete' | 'incomplete' | 'none'
  trainingDays: number
  sessions: number
  minutes: number
  plannedDays: number
  mealDays: number
  completeMeals: number
  partialMeals: number
}

interface PeriodReport {
  start: string
  end: string
  blocks: ReportBlock[]
  totalLoad: number | null
  loadDays: number
  unloadedDays: number
  trainingDays: number
  totalSessions: number
  totalMinutes: number
  plannedDays: number
  completionRate: number | null
  mealDays: number
  totalMeals: number
  completeMeals: number
  partialMeals: number
  categoryCoverage: Record<FoodCategory, number>
  dataQuality: string[]
  ruleVersion: string
}

interface LongTermPoint {
  month: string // YYYY-MM
  label: string
  load: number | null
  loadCompleteness: 'complete' | 'incomplete' | 'none'
  trainingDays: number
  hasSession: boolean
  partialMonth: boolean
}
```

- `buildPeriodReport(sessions, meals, start, end, ctx, blockMode): PeriodReport`
  - blockMode：`'month-1st-7d'`（1 日起 7 天块）或 `'rolling-28d'`（近四周 4 块）。
  - 负荷按“日”优先：某日有任一缺 RPE 的场次，该日负荷不计入完整总量；块/期间完整度按是否所有有记录日都完整判断。
  - 计划天数复用 `isPlanDay`；没有计划时 `completionRate = null`。
  - 类别覆盖复用 `FOOD_CATEGORIES`；只统计出现次数。
- `buildLongTermTrend(sessions, now, months=6): LongTermPoint[]`
  - 含当前月与之前 5 个自然月；当前月截至今天。
  - 负荷与训练天数按上述口径；无记录月份 `load=null`、`trainingDays=0`，显示层标“未记录”。
- 周报保留 `weekRules.buildWeeklyReport`；若重构内部共享 helper，必须保留现有字段与 selfcheck 行为。

### 5.5 UI 接缝

- `ReportView.vue`：页面壳 + 时间窗 tabs + 子视图。建议拆出 `WeekReport` / `PeriodReport` / `LongTermReport` 组件，但不得改变周报的现有内容与行为。
- 计划页：顶部新增“待确认调整”区；底部保留“本机计划历史”；旧的时间冲突预览卡被合并后的列表取代。
- 报告页标题/导航：`router` meta title → “记录报告”；`SidebarNav` 短标签“报告”、全称“记录报告”；`MobileNav` “报告”；`SettingsView` 中“周报页”文案改为“记录报告页”。
- 不引入新依赖；图表用 CSS/SVG，颜色/间距沿用 tokens。

## 6. 测试决策

### 6.1 selfcheck（纯逻辑，必须）

在 `scripts/selfcheck.ts` 增加章节，覆盖：

**反馈规则**
- 两次高 RPE 才降；单次不降。
- 两次低 RPE + 都 completed 才升；一次 partial/skipped 不升。
- 一高一低不触发。
- `rpe=null` 跳过且不打断；不足两次不触发。
- 两次超过 21 天不触发。
- discomfort 或非空原因 → safetyOnly，且覆盖高 RPE。
- 12–17/GATE 不产生数字调整。
- 目标选择跳过 locked/completed；当前周无目标时 `needsPlan='next-week'`。
- 幅度：sets>1 时 sets ±1；单组 reps/hold/steps 的上下限。
- 时间冲突规则迁移后与旧行为一致。
- 去重 key 稳定；接受/暂不调整后过滤。

**报告规则**
- 月报 1 日起 7 天块：28/29/30/31 天的月份块数正确；当前月最后一块截止今天。
- 近四周 4 个 7 天块，首尾日期正确。
- 负荷完整/不完整/无记录三态；缺 RPE 不按 0；无记录不画 0。
- 训练天数、餐食天数、完整/部分餐、类别覆盖、计划天数/完成率。
- 长期 6 个月点、当前月 partial、无记录月份。
- 现有周报回归：字段与数值不变。

**执行覆盖**
- `applyPlanOverrides`/等价 helper：无参数不变；reps/time/steps 覆盖；非法值回落；reps 时间线重建后组数/次数正确。

### 6.2 构建与浏览器

- `npm run typecheck`、`npm run selfcheck`、`npm run build` 全通过。
- 用 `npm run dev` 与 `npm run preview` 各验证一次；393/768/1024/1440 宽度无横向溢出；tab 键盘操作；月份切换；长期图空/满数据。
- 计划页：接受/暂不调整；无目标时生成下周；时间冲突与反馈合并卡；每项跟练按覆盖值启动。
- 报告页：本周内容与改造前一致；近四周/本月/长期数据与 selfcheck fixture 对齐；空状态不误显示 0。

## 7. 明确不做

- 不做后端、账号、同步、outbox、服务端报告（plan.md §2 整章）。
- 不做饮食反馈改计划；不做营养处方或因果推断。
- 不自动应用任何调整；不静默创建计划（除用户显式点击生成）。
- 不做 LLM 解释/自由文本解析；不做 AI 月报文案。
- 不做 PWA、30 秒坐站测试、云端 AI 音色等其他 plan.md 未完成项。
- 不改现有周报的指标口径、图表或记录表；只加页面壳与时间窗。
- 不增加图表库或后端依赖。
- 不调整已锁定/已完成项；不修改过去日期的计划项。
- 不在月报里展开完整训练明细表；月报用块摘要，周报保留明细表。
- 不把“近四周”与计划页“四周周期”混用；术语按 CONTEXT.md。

## 8. 迁移与边界

- 旧 `PlanItem` 没有 `plannedHoldSeconds`/`plannedTargetMinutes`：显示与跟练回退到动作库/`demoExercises` 默认；只有接受新调整时才写入。
- 旧 localStorage 没有 `adjustmentResolutions`：按空处理。
- 旧计划没有存储时：反馈建议接受前显式生成当前周/下周计划；生成失败或动作缺失时只提示，不伪造。
- 反馈匹配使用 `exerciseName` 精确匹配；动作改名/不在目录时不会误触发。
- 时间冲突建议维持“当前选中日”的现有范围；反馈建议是计划级，不受选中日影响。
- 目标计划项的 `date >= today`；当天已完成/锁定项跳过。
- 报告所有窗口继续只读本机数据；没有网络请求。
