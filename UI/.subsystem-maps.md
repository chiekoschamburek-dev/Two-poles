# 建档流程（Onboarding）+ 档案规则（profileRules）
## 职责
这是「两仪·TwoPoles」的用户准入与个人档案子系统，负责两件事：(1) 用一个三步向导把用户的身份、训练条件、专项目标采集成 `UserProfile`，写回 Pinia store 并落到 localStorage；(2) 把档案里「可计算」的部分（身体数据区间、成绩解析、当前 PB、周期起止、目标摘要）抽成纯函数，供页面展示与 `scripts/selfcheck.ts` 断言。档案不是只读的展示层，它同时是整个推荐引擎的输入：器材/场地/时长/「需要避开的」四个维度在 `planRules.ts` 里被翻译成动作筛选条件，年龄 <18 或命中「孕期或产后 / 伤病或遵医嘱限制」时整个自动推荐被关掉（降级为只记录 + 手工录入）。建档完成后还会串起两个后续动作：若已配置大模型则先让模型「问几个问题」再生成计划（`store.generatePlanQuestions()`，弹窗挂在 `AppShell` 全局），若是在编辑已有档案则明确重算本周计划（旧版本进 `planHistory`）。因此它是「数据采集 → 规则筛选 → 计划生成」这条链的入口，改版时不能当成纯表单页处理。
## 关键组件
- 页头 page-head（OnboardingView.vue:3-10）：左侧 eyebrow「PROFILE · 第 N / 3 步」+ h1（新建时「先花一分钟，认识一下你」/ 编辑时「更新你的档案」）+ 副标题 stepTitles[step-1]；右侧 dots 三个进度条（i <= step 时高亮）。
- 第 1 步「你想怎么用这个助手？」（OnboardingView.vue:13-30）：两张 choice 卡（大众模式 / 运动员模式），每张含 strong 标题、small 描述、em 附注（大众＝「轻量推荐 · 摄像头计数」，运动员＝「周期计划 · 负荷记录（部分功能开发中）」）；底部 note 说明侧栏可随时切换。
- 第 2 步「基本情况」（OnboardingView.vue:32-110）：两行 grid2 表单（昵称 / 年龄，身高 / 体重）→ body-note 免责说明 → 5 组 chips 多选/单选（主要目标、运动经验、每次能用的时间、可用器材、常训练的场地）+ 2 组 warn 芯片（需要避开的、特殊情况）；特殊情况下方是 blocked 门槛提示或 fine 说明。
- 第 3 步（athlete）「专项信息」（OnboardingView.vue:112-201）：主项 chips（含「其他」+ 自由输入 other-input）→ 目标类型 seg 二选一 → competition 分支（赛事名称/比赛日期/目标成绩/对应项目只读）or cycle 分支（周期阶段 chips / 阶段重点 / 周期开始 / 周期结束）→ goal-summary 当前目标条 → 两个 details.sec 折叠区（PB 成绩、健身房极限数据），summary 右侧显示条数。
- 第 3 步（public）「看一下你的档案」（OnboardingView.vue:203-222）：14 行 review 列表（模式/称呼/年龄/身高体重/目标/经验/可用时间/器材/场地/需要避开/自动推荐），值为空时统一回落为「—」或「未填写」。
- 错误条 error（OnboardingView.vue:224）：role="alert"，红色软底圆角块，出现在整个卡片底部（表单之后、导航之前）。
- 导航条 nav（OnboardingView.vue:226-230）：上一步（ghost，第 1 步禁用）/ 下一步 / 完成建档（带 Check 图标；编辑模式文案变「保存修改」）。
- 隐私脚注 privacy（OnboardingView.vue:233）：「档案与训练记录都只存在这台设备的浏览器里（localStorage），不会上传。」
- PbList.vue 内部：新增/编辑表单（项目 select + 自定义项目名 + 径赛/田赛 seg + 成绩 + 日期 + 备注）+ rows 列表（项目/类别标、成绩数字、日期备注、「当前 PB」/「历史」徽章、改/删）+ 空态文案。
- GymList.vue 内部：新增/编辑表单（动作 input + datalist 深蹲/硬拉/卧推、重量 kg、次数、日期、1RM/训练最高 seg）+ rows 列表 + 空态文案。
## UI 模式
- 三步线性向导：单一 BaseCard（class="panel"）承载全部步骤内容，步骤切换靠模板里 v-if / v-else-if / v-else 链（step===1 → step===2 → mode==='athlete' → 回顾问），无过渡动画，靠 dots 进度条指示。
- 选择型控件统一为「胶囊 chip」：所有多选/单选（目标、经验、时间、器材、场地、限制、门槛项、周期阶段、主项）都是 button.chip + :class="{active}" + :aria-pressed，无原生 radio/checkbox。选中态为实心强调色（--color-accent / --color-on-accent），warn 变体选中后转 caution 色。
- 模式选择用「卡片式 choice」（两列 grid），与 chip 是两套不同控件；目标类型用「分段 seg」（两枚按钮），第三种形态。三种选择控件并存。
- 表单结构统一为 label.field > span.field-label + input（单列或 grid2 双列），提示文案用 small.fine（灰）或 small.fine.err（红），字段级错误贴在被控字段正下方。
- 长表单用 details.sec 原生折叠（PB / 极限数据）收进「专项信息」步，summary 右侧用 em 显示条数，避免把建档页拉长。
- 回顾页用「标签—值」分隔线列表（ul.review > li，flex space-between，底部 1px hairline），与 Dashboard 的卡片式统计不同。
- 底部主按钮右对齐（nav flex-end），移动端（≤640px）翻转为 column-reverse 全宽按钮；choices/grid2 在 ≤640px 塌成单列。
- 提示层级靠语义色 + 文案语气区分：note（灰）/ fine（更灰小字）/ gate（黄底 caution，role="status"）/ error（红底 danger，role="alert"）；免责与「不据此判断动作是否安全」这类话术一律走 fine/note 而不是警示色。
- 空态：PB 与极限数据用一句非评判式的灰字（「没有记录不等于没有成绩，只是这里还没填」）。
- 无 loading 态：建档全程同步；但 finish() 会异步触发模型提问，全局弹窗由 PlanDraftDialog 承担加载态。
## 样式写法
全部为 `<style scoped>`（OnboardingView 438-494 行，PbList 161-214，GymList 146-192），不依赖任何 CSS 框架。样式完全走 `src/styles/tokens.css` 的 CSS 变量：颜色用 --color-ink / --color-text-secondary / --color-text-muted / --color-accent / --color-accent-soft / --color-accent-line / --color-caution-soft / --color-danger-soft / --surface-field / --color-neutral-soft / --color-border / --color-divider，形状用 --radius-lg(12) / --radius-md(10) / 999px，节奏用 --motion-fast(150ms) / --motion-base(250ms) / --easing-ease-out，数字字族用 --font-num(Bahnschrift)，小标签字距用 --tracking-eyebrow(0.16em)。但「组件级原语」没有抽象层：.eyebrow / .field / .field-label / .chips / .chip / .choices / .choice / .note / .fine 这些类在 OnboardingView、SettingsView、ExecutionView、PlanView、MealsView、MealForm、FoodCaptureDialog、InsightCard 八个文件里各写一遍（scoped 使其互不共享），其中 .eyebrow、.field、.field-label、.chips、.chip 在 OnboardingView 与 SettingsView 中几乎逐字相同。BaseCard 提供 --card-pad 变量让调用方调内距，但 OnboardingView 没用它，而是用 .panel{padding:26px} 直接覆盖，绕开了组件提供的接缝。全局只提供 .micro / .num / .visually-hidden / .hairline 四个工具类。深色主题靠 html[data-theme] 覆盖令牌，组件零感知——这一点对换皮友好。
## 数据流
读：store.userProfile（localStorage 键 twopoles_state 里的 profile，store.init() 时经 normalizeProfile() 补齐 personalBests/gymRecords 空数组）→ 在 setup 里被拆成 20 多个独立 ref（OnboardingView 278-304）→ 模板双向绑定。纯函数读：bodyErrors(height, weight)、cycleRangeError(start, end)、goalSummary({...})、isCurrentBest(pb, list)、parseResult(raw, track)（由 PbList 调用）。外部只读依赖：planRules 的 AUTO_RECOMMEND_MIN_AGE(18)、exercises 的 gateReason(restrictions)。写：finish() 组装一个 23 字段的 Partial<UserProfile> 交给 store.updateProfile()（首次建档时 store 用默认值 age:25/goal:''/experience:''/availableTimes:[]/equipment:[]/restrictions:[] 打底并生成 id），随后 store.persistState() 序列化整个 state 到 localStorage。模式：updateProfile 之后再调 store.commitMode(mode)（绕过 switchPreview 确认弹窗）。副产物：store.generatePlanQuestions()（把档案经 llm.profileSnapshot() 序列化成中文键 JSON 发给模型）、store.regenerateWeekPlan(new Date())（编辑模式才调，旧计划进 planHistory）。子组件写回：PbList/GymList 通过 `v-model` 的 update:modelValue 事件把新数组 emit 给父级的 personalBests/gymRecords ref（父级再整体传给 store）。所有勾选项都是中文字符串（如 '10 分钟'、'宿舍或家'、'无器材'），不是枚举 ID——这正是与下游规则服务之间的隐式数据契约。
## 状态模型
页面状态是一个由 `step`(ref<number>，1..3) 驱动的三态向导机，没有显式状态枚举：step===1 选模式 → step===2 基本情况 → step===3 分支渲染（mode==='athlete' 走专项信息，否则走回顾页）。切换规则：back() 只做 step--（第 1 步禁用）；next() 先跑第 2 步校验（age/goal/experience），通过才 step++；finish() 在第 3 步执行落库。表单状态是 20+ 个彼此独立的 ref（nickname/age/goal/experience/availableTimes/equipment/availableVenues/restrictions/discipline/cyclePhase/cycleStartDate/cycleEndDate/targetEvent/height/weight/goalType/targetEventDate/targetResult/cycleFocus/personalBests/gymRecords），彼此不联动——例如 goalType 切换不清空另一分支内容，mode 切换不重置任何已填字段（注释明确写「切换不会丢掉另一类已填的内容」「运动员字段切到大众模式保存时也原样带回」）。独立的派生状态有 5 个 computed：bodyError（身体数据错误）、athleteDraft（模板类型收窄的绕行别名）、bodyLabel（回顾页展示串）、cycleError（周期起止）、summary（goalSummary 的结果），以及 blocked（自动推荐是否被关：年龄 < 18 或命中 GATE_RESTRICTIONS）。编辑态由 store.hasProfile 派生（editing = computed(() => store.hasProfile)），已有档案时所有 ref 用 `profile?.xxx ?? 默认值` 回填，personalBests/gymRecords 每次复制一份浅拷贝，避免编辑中途污染 store。
## 耦合
跨组件 import：OnboardingView → BaseCard、BaseButton（common）、PbList、GymList（profile）、useAppStore、types/domain、planRules.AUTO_RECOMMEND_MIN_AGE、exercises.gateReason、profileRules 的 4 个导出；PbList/GymList → profileRules（parseResult/isCurrentBest/formatCnDate/TRACK_EVENTS/FIELD_EVENTS/LIFT_PRESETS）+ utils/id.newId；SettingsView → profileRules.goalSummary（与建档页共享同一句口径）；stores/app.ts → profileRules.normalizeProfile。共享 store 字段：userProfile、currentMode、hasProfile、planLlmReady、pendingSwitch/modeLog（模式切换历史由 confirmModeSwitch/commitMode 写），建档页的 commitMode 会往 modeLog 里追加一条记录。共享类型：UserProfile、PersonalBest、GymRecord、GoalType、Mode 直接来自 types/domain，且是 localStorage 里的持久化格式。跨子系统的语义耦合最强的一处是「选项字符串」：建档页写进 profile 的 availableTimes / availableVenues / equipment / restrictions 全部是中文字符串，planRules 用 parseInt('10 分钟') 取时长、用 VENUE_LABELS 映射场地、用 hasEquipment 的 includes 比对器材、用 passesRestrictions 的 === 比对四条限制文案；改一个字面量就静默失效。另一处是 llm.profileSnapshot() 会把 profile 的中文键快照发给第三方模型接口，因此档案字段的语义同时是提示词契约（提示词要求模型「不要重复档案里已有的年龄、目标、经验、器材、场地、回避条件」）。
## 设计债
- OnboardingView.vue 第 112 行 `v-else-if="mode === 'athlete'"` 与第 203 行 `v-else` 回顾问构成互斥分支，而第 7 行 `stepTitles[step-1]` 对第 3 步固定写死「确认无误就可以开始了。」——运动员模式下第 3 步其实是「专项信息」填写页，永远走不到回顾页。因此运动员用户的流程里没有复核确认环节，而文案和 dots 进度都宣称这是最后确认步。交付说明.md:475 记录了早期 `total = athlete ? 3 : 2` 的版本 bug，改成常量 3 之后这个语义错位被留下了。
- 第 211-213 行 `<li v-if="athleteDraft">` 三条（主项/训练目标/PB·极限数据）在回顾问里是死代码：回顾问只在 public 模式渲染，而 athleteDraft 只在 mode==='athlete' 时为真，两个条件互斥。
- 年龄区间 12–90 写死在三处且没有常量：输入框属性 `min="12" max="90"`（第 41 行）、next() 里的字面量比较 `age.value < 12 || age.value > 90`（第 358 行）、以及错误文案「请填写 12–90 之间的年龄」（第 359 行）。profileRules.ts 只为身高/体重导出了 HEIGHT_RANGE/WEIGHT_RANGE，年龄没有对应出口。
- 身高/体重的 HTML 属性是硬编码字符串，和导出的常量脱钩：第 49 行 `min="100" max="250"`、第 54 行 `min="25" max="200"` 与 profileRules.ts:6-8 的 HEIGHT_RANGE/WEIGHT_RANGE 数值相同但没有任何绑定关系，改常量不会改输入框。
- `v-model.number` 的字符串洞：Vue 的 number 修饰符对无法 parseFloat 的输入保留原字符串，用户在年龄框输入 'abc' 后 `!age.value` 为 false、`'abc' < 12` 与 `'abc' > 90` 都为 false，next() 的校验直接放行，'abc' 被原样写进 `profile.age`。profileRules.ts 里有 bodyErrors 用 Number.isFinite 兜住 height/weight，却没有任何 ageErrors 对应物（脚本自检也只覆盖 bodyErrors/cycleRangeError）。
- 选项列表在视图与规则引擎之间重复定义且未共享：restrictionOptions（第 273 行）逐字等于 exercises.ts:91 的 RESTRICTION_KEYS；venueOptions（第 272 行）等于 exercises.ts:11 的 Venue 与 planRules.ts:24-28 的 VENUE_LABELS；timeOptions（第 270 行）的 '10 分钟' 文本格式被 planRules.budgetMinutes 用 parseInt(t,10) 解析。视图没有 import 任何一个，改字面量即静默失配。
- equipmentOptions（第 271 行）里有两个死选项：'单杠' 在整个 src/ 里只出现在这一行，'跑步机' 只作为 ex-easy-run 的 reason 文案出现，从未出现在任何 exercise.equipment 数组里——勾选它们对筛选结果零影响。'无器材' 语义冗余：exercises.ts:28 注释已说明 `equipment: []` 就代表「不需要器材」，hasEquipment 对空数组直接返回 true，所以 '无器材' 实际是靠「不匹配任何具体器材名」这个副作用生效的。
- 「特殊情况」与「需要避开的」共用同一个 restrictions 数组：第 98 行与第 105 行都调用 toggle(restrictions, ...)，把动作过滤器（无跳跃/膝部负担小/腰部负担小/低强度起步）与自动推荐开关（孕期或产后/伤病或遵医嘱限制）混在同一个持久化字段里。两者语义完全不同，文件自己在第 274 行加了注释说明「这几项不是动作过滤器」，全靠 gateReason() 里的 GATE_RESTRICTIONS.includes 过滤来区分。改版时一旦「顺手」拆成两个数组，profile.restrictions 的持久化格式与 passesRestrictions/gateReason 的查找都会失效。
- 同一个 mode 在三处有三套不同描述：OnboardingView 第 264-265 行的 modeChoices（'每天一小段，跟着计数做完就行' / '按周期安排，关注负荷与完成质量'）、SettingsView 第 244-247 行的 modes（'按器材与时长过滤的一周安排、摄像头计数、简单餐次确认' / '周期与锁定训练、距离时长与 RPE 负荷、训练日用餐时间线'）、以及 stores/app.ts:191-199 的 switchPreview.differences（4 条差异文案）。
- blocked（第 375-381 行）在视图里重新实现了一遍 planRules.ts:109-122 的门槛逻辑，且判定约定不同（视图返回 string|null，planRules 返回 auto:boolean+gateNote）；视图版还多一条 `!Number.isFinite(age.value) → return null`，意味着年龄非法时静默显示「可自动推荐」。
- PbList.vue 与 GymList.vue 是近乎逐字复制的双胞胎：CSS（PbList 161-214 / GymList 146-192，.rec/.rec-head/.hint/.add/.form/.grid/.f/.seg/.form-actions/.btn/.rows/.row/.ev/.res/.meta/.acts/.empty）与脚本结构（open/editingId/error/draft/reset/startNew/startEdit/cancel/save/remove）几乎一致，只差字段名。两份约 200 行、共 406 行代码维护同一套皮肤，改版时视觉要改两遍。
- 表单原语在 8 个文件里各写一遍：.eyebrow（OnboardingView 441 行与 SettingsView 415 行逐字相同）、.field/.field-label（457-458 vs 448-449 逐字相同）、.chips/.chip（460-465 vs 451-454 逐字相同）。globals.css 里没有任何表单/芯片原语，全局只提供 .micro/.num/.visually-hidden/.hairline。
- 第 322 行 `const athleteDraft = computed(() => mode.value === 'athlete')` 带注释「模板里 mode 会被 v-else 收窄，用一个 computed 绕开这个收窄」——这是为绕过 vue-tsc 类型收窄而留在生产代码里的语义别名，改版拆分组件后即可消失。
- 字段到模型的映射是手写清单：finish() 第 398-422 行逐字段列出 23 个键，并各自带一条 '空值转 undefined' 规则（如 `height.value === '' ? undefined : Number(height.value)`、`nickname.value.trim() || undefined`）。新增一个档案字段需要同时改：第 278-304 行的 ref、finish() 的映射、以及回顾页第 205-220 行的一行展示——三处且容易漏。
## 约束
- 年龄门槛常量 AUTO_RECOMMEND_MIN_AGE = 18（planRules.ts:22）同时决定建档页的门槛提示文案、回顾页「自动推荐」一行、以及 buildDayPlan 的 auto/gateNote。UI 不得再写死 18，必须继续引用这个常量，否则三处口径会分叉。
- 门槛项（孕期或产后 / 伤病或遵医嘱限制）是「适用范围开关」而不是「动作过滤器」，产品口径固定：建档页第 58 行「身体数据只用于记录与展示，不据此给出 BMI 或健康结论」、第 108 行「系统不据此判断动作是否安全」、第 221 行「系统不会据此判断动作是否安全」这三句免责话术不可删改或弱化。
- profile 的四个数组字段存的是中文字符串而非 ID，与下游规则逐字比对：availableTimes 必须是 'N 分钟'（planRules.budgetMinutes 用 parseInt(t,10) 取值）、availableVenues 必须是 '宿舍或家'/'健身房'/'户外'（planRules.VENUE_LABELS 只映射这三个）、equipment 必须与 exercises.ts 各动作的 equipment 数组元素同名（hasEquipment 用 includes）、restrictions 中的四条过滤项必须是 '无跳跃'/'膝部负担小'/'腰部负担小'/'低强度起步'（passesRestrictions 用 ===）。改文案等于改算法。
- localStorage 持久化格式不能随意改：键名固定为 twopoles_state（app.ts:151）与 twopoles_llm（llm.ts:19）；UserProfile 的 JSON 形状即数据格式，旧档案缺 personalBests/gymRecords，由 normalizeProfile() 补齐——字段改名必须写迁移，不能直接改键名。
- profile.restrictions 必须继续同时承载「动作过滤器」和「自动推荐门槛」两类字符串（当前两者同数组），除非同步修改 exercises.gateReason/passesRestrictions 与 UserProfile 类型并做数据迁移，否则老档案的门槛项会被当成动作过滤条件处理。
- PersonalBest.result 存用户输入原文，比较时用 parseResult 解析（'2:05.3' 解析成 125.3 秒，'6.85 m' 解析成 6.85 米）；解析不出来的记录不参与 PB 比较但必须仍留在列表里；PB 是追加式历史，eventBests 只「标出当前 PB，不删除也不合并历史记录」。界面不能表达成「新增会覆盖旧成绩」。
- parseResult 的负号护栏（/^[-−]/ 必须在数字清洗前判断）不能删：否则 '-3' 会被正则削成 '3'，把无效输入变成有效成绩；田赛成绩带冒号一律判非法。
- GymRecord.kind 区分 '1rm'（实测 1RM）与 'working'（训练最高重量），两者不互相反推、不派生建议重量（gymRecordLabel 的注释与文案明确）；1RM 与训练最高重量的措辞不能混用。
- cycleRangeError 只在起止两端都填了才校验，且按 ISO 字符串比较 start > end；日期输入是原生 type="date"，持久化格式是 'YYYY-MM-DD'（formatCnDate 只用正则 /^(\d{4})-(\d{2})-(\d{2})/ 解析，解析不了原样返回）。不能改成 Date 对象或本地化日期串。
- 身体数据区间口径固定在 profileRules 的 HEIGHT_RANGE(100–250cm) / WEIGHT_RANGE(25–200kg)，且「留空即未填写」——finish() 用 `=== '' ? undefined : Number(...)` 写入，不允许把空值写成 0。
- 档案快照会发给第三方模型：llm.profileSnapshot() 把 mode/age/goal/experience/availableTimes/equipment/availableVenues/restrictions/height/weight（athlete 还加 discipline/cycle/比赛目标/PB/极限重量）序列化成中文键 JSON，经本机 Vite 代理 /api/llm/chat 转发到外部 base_url。因此「档案不上传」这句承诺（OnboardingView 第 233 行）在已配置模型时不成立——改版要么修正文案，要么保证不外发。这是硬约束，不是建议。
- 模型提示词契约：buildPlanQuestionMessages 要求「最多 3 问、必须包含每周训练次数、不要重复档案里已有的年龄/目标/经验/器材/场地/回避条件、不问医疗诊断与体重评价」。改档案字段的含义会改变模型被问什么；档案字段名改动会改变 prompt 内容（profileSnapshot 用中文键）。
- 建档完成后的两个后续动作有顺序依赖：store.generatePlanQuestions() 必须在此之前触发（它读的是已写入的 userProfile），而 store.regenerateWeekPlan() 只在编辑已有档案时执行（否则会覆盖新建档当周的计划版本）。
- 浏览器约束：档案与所有记录共用 localStorage 同一 key，quota 满时 store 弹「本机存储写入失败」并提示关闭照片缩略图——改版不要把大体积数据（如 base64 图片）塞进 profile，否则会挤爆同一配额。
## 改版接缝
- profileRules.ts 是最干净的接缝：零 Vue 依赖、零 store 依赖、零 DOM 的纯函数层，且 scripts/selfcheck.ts 已经对它 9 个导出做了断言。所有新增校验（年龄区间、器材合法性、场地枚举）都应该先在这里加一个纯函数 + 一条 selfcheck 断言，再由页面调用——这是改版时最省事、风险最低的扩展点。
- PbList.vue / GymList.vue 是标准的 v-model 叶组件（props: modelValue / emits: update:modelValue），不碰 store、不碰 router、不直接操作父级状态，只要保持 emit 出的数组形状不变（PersonalBest[] / GymRecord[]），两个组件的整块模板与样式可以整体替换而不动任何逻辑。
- store.updateProfile(partial) + store.commitMode(mode) + store.regenerateWeekPlan(date) 已经是完整的写边界：建档页只应调这三个 action，不该直接改 userProfile 或 currentMode。换皮时保持这条边界即可完全不碰 store。
- BaseCard 暴露了 `--card-pad` 变量和 variant('default'|'flush'|'ink')，BaseButton 暴露了 variant/size/icon/disabled —— 它们是现成的替换点。但 OnboardingView 目前用 `.panel{padding:26px}` 绕开了 --card-pad，改版时把它换成 style="--card-pad:26px" 就能让卡片内距跟随新皮肤，而不必写 :deep() 覆盖。
- goalSummary() 已经被 SettingsView 与 OnboardingView 共用，是「文案口径」的单一来源——重写文案时必须同时改 profileRules.ts 这一处，否则两个页面会各说各话（注释里已明确这个意图）。
- normalizeProfile() 是老档案迁移的唯一切口（当前只补 personalBests/gymRecords 空数组）。改版若要给档案加字段（如训练偏好、体脂率），在这里做版本化补齐即可，不必在每个读档案的地方写 `?? []`。
- step / total / stepTitles 这个三元组可以整体抽成一个描述数组或 useOnboardingSteps() composable：把 { id, title, canEnter, validate } 声明化，模板就只剩一个 <component :is>，新增/重排步骤不用碰 next() 里的魔数 2。
- 模式选择器（modeChoices）、目标类型二选一（seg）、主项 chips 与「其他」自由输入（otherPicked/otherSport/pickEvent/pickOtherSport）各自是一个自洽的小交互，可以各自替换成新的控件组件而不影响其余部分；「其他」用独立开关而不是占用 discipline ref，这个设计解耦值得保留。
- 必须先解耦再动的三处：(1) 20+ 个独立 ref 组成的表单模型 → 先合并成单个 reactive draft 对象，再谈重排布局；(2) 模板里 v-if/v-else-if/v-else 的步骤分支链 → 先拆成 StepMode/StepBasics/StepAthlete/StepReview 四个子组件，页面退化成单分支渲染；(3) finish() 里校验/保存/副作用/导航四层混写 → 先拆成 validateDraft() / saveDraft() / afterSave() 三个函数，才谈得上「保存并下一步」这类新流程。
- 回顾页的 14 行 ul.review 应先改成描述符数组 [{ label, value }]，才能从「单列分隔线列表」换到双列摘要卡/分组摘要；目前它是硬编码 markup，与 SettingsView 的 profileLine/goalLine 属于同一份数据的第三种呈现。
- blocked 需要先从「一个 string|null」拆成 { ageBlocked, gateBlocked }，才能让「年龄门槛」显示在年龄字段旁、「孕期/伤病门槛」显示在对应 chip 下方——目前两者被压成同一句文案，贴在特殊情况那一组的下方。
- FormField / ChipGroup / ChoiceCard / SegmentedControl 这四个原语目前不存在于 src/components/common/；把 OnboardingView 与 SettingsView 里逐字重复的 .field/.field-label/.chips/.chip/.choices/.choice/.seg 抽成组件，是全局换肤的前置条件（否则新皮肤要粘进 8 个文件）。同理，PbList 与 GymList 共约 90% 的模板与 CSS，先合并成一个 schema 驱动的 RecordList，再统一上皮肤。
- 第 233 行的隐私脚注是一个可整块替换的文案接缝——但替换前必须先修正事实（配置了模型时档案会外发给第三方），否则新文案会继承旧的不实承诺。

## 职责
这一层负责把 7 个业务页面装进一个统一的「左图标脊 + 顶页头 + 内容列 + 移动端底栏」外壳里，并承载三类**全局上下文**（而非页面级内容）：① 当前模式（大众/运动员）的切换入口与切换前确认；② 全局导航信息架构（桌面图标脊 / 平板抽屉 / 手机胶囊底栏三套形态指向同一批路由）；③ 全局浮层宿主（Toast 通知区、AI 计划草稿对话框）。它同时是**响应式形态切换的总闸**——断点选择（1099px 抽屉化、767px 底栏化）直接决定三套导航组件各自的显示形态。文件分层上它刻意做得很薄：App.vue 只渲染 AppShell，AppShell 只做「装配 + 抽屉开合 + 路由出口 + store.init()」，几乎不含业务逻辑，因此它是前端改版中**最容易整块替换**的一块；但它同时也是**布局契约的源头**（侧栏宽度、z-index 层级、页头高度），任何视觉改动都会外溢到 Toast 定位、抽屉遮挡、移动端底栏等下游依赖。
## 关键组件
- AppShell 第 2–19 行模板：`.shell` 是唯一根节点，内含 6 个并列区块 —— TopBar（顶）、SidebarNav（左侧 fixed 贯穿整屏）、`.scrim`（抽屉遮罩，v-if=mobileOpen）、`main.main-content`（唯一的内容出口）、MobileNav（底部）、PlanDraftDialog + ToastRegion（两个全局浮层）
- AppShell `.main-content`（第 46–50 行）：内容区唯一容器，用 `margin-left: var(--sidebar-width)` 让出导航脊，内距为 `var(--space-2) var(--gutter) var(--space-10) var(--space-7)`；其内是 `<RouterView v-slot>` + `<Transition name="page" mode="out-in">`
- AppShell `.scrim`（第 6 行 / 样式 51 行）：抽屉打开时的遮罩，z-index = calc(var(--z-sticky)+1) = 1101，点击关闭抽屉
- TopBar `.topbar`（第 2–75 行）：sticky top:0、height 58px、自身也带 `margin-left: var(--sidebar-width)`；内部从左到右是 `.menu-btn`（仅 ≤1099px 显示）→ `.lockup` 品牌 → `.right`（模式芯片 + 日期 + 头像）
- TopBar `.mode-wrap`（第 24–70 行）：模式芯片 + 下拉 popover，是全站唯一的「模式切换确认」入口；popover 内部分两态——`!preview` 时列 2 个模式选项，`preview` 时切成「变化/保持不变 + 确认/取消」双栏
- TopBar `.avatar`（第 73 行）：30px 圆形头像，点击 router.push('/settings')；初始字母取自 store.userProfile.nickname 首字符，缺省 '我'
- SidebarNav `.rail`（第 2–44 行 / 样式 65–121）：桌面为 86px 图标脊（position:fixed，left:0，top:0，bottom:0，z-index=--z-sticky）；≤1099px 变 244px 抽屉，transform: translateX(-100%) → .open 时 translateX(0)，z-index 升到 calc(--z-sticky+3)
- SidebarNav 品牌位 `.brand`（第 3–15 行）：RouterLink 到 /dashboard，内联 64×64 SVG 太极双极标记
- SidebarNav `nav > .nav-item`（第 17–30 行）：5 项主导航，每项同时渲染 `.short`（10px 短标签）与 `.full`（全称）两个 span，桌面只显示 short、抽屉里只显示 full
- SidebarNav `.rail-foot`（第 32–43 行）：底部两项（档案 → /onboarding、个人设置 → /settings），未纳入 items 数组，是模板里手写的两个 RouterLink
- MobileNav `.mobile-nav`（第 1 行模板）：≤767px 才 display:flex，fixed 于 bottom:10px、左右各留 10px 的胶囊条，内含 4 个 tab（今日/记录/图表/我的），选中态用 accent 色 + accent-soft 底 + bold
- router/index.ts 第 3–50 行：7 条路由（onboarding/dashboard/plan/execution/meals/report/settings），全部 `() => import(...)` 懒加载，每条带 `meta.title` 中文标题
- router/index.ts 第 64–71 行 afterEach：document.title = `${meta.title} - 两仪·TwoPoles`，是全站唯一的路由元数据消费点
## UI 模式
- 布局骨架是「三区固定外壳」：左侧 86px fixed 图标脊（贯穿整屏）+ 顶部 58px sticky 页头 + 右侧内容列。页头是 sticky 不是 fixed，因此内容列不需要额外 top 偏移，AppShell 第 45–46 行有明确注释说明这一点
- 内容宽度不由外壳控制，而是每个视图自己收口：4 个视图用 var(--content-max-width)（1440px），OnboardingView 硬编码 760px、SettingsView 硬编码 860px、ExecutionView 硬编码 1400px。外壳只给内容列加 padding（--gutter + --space-7 左内距）
- 响应式分三档，且断点是写死的 px 字面量而非令牌：≥1100px 桌面图标脊；768–1099px 脊变 244px 抽屉（带 translateX 滑入）+ TopBar 出现汉堡按钮（两处同一档出现，README 注明是修过的旧 bug）；≤767px 追加浮动胶囊底栏，同时抽屉入口仍保留
- 卡片语言只有两种表面：纸面（BaseCard default/flush，白底 + 1px 发丝线 + inset 顶亮内描边，无投影）与仪表面（variant="ink"，深墨渐变 + 22px 细网格遮罩），投影只留给浮层（弹层/Toast）
- 激活态的表达方式因组件而异：SidebarNav 用「白底 + 1px 边 + inset 2px 左侧强调条 + font-weight 600」（不靠颜色面积）；MobileNav 用「强调色文字 + accent-soft 底 + bold」；TopBar 模式芯片用「6px 圆点 + 文字 + 可选 W{n} 徽标」
- 导航项在桌面与抽屉是两套 DOM：同一份 items 渲染 .short（10px 短标签）与 .full（全称）两个 span，靠 CSS 显隐切换（第 118 行 display:none / 148–149 行 display:inline）
- 浮层玻璃化：rail/topbar/toast/mobile-nav 都用 backdrop-filter: blur() + saturate()，配 --surface-glass / --surface-glass-strong 两种半透明底
- 动效克制：页面级统一 <Transition name="page" mode="out-in">（opacity + translateY 10px→-6px，250ms）；遮罩 fade 250ms；模式 popover pop（translateY -4px，150ms）；Toast 用 TransitionGroup slideInRight + bounceIn 图标
- 空态与加载态：外壳层没有任何空态/加载态（store.init() 是同步读 localStorage，无 loading）；页面级空态在 DashboardView 内自带（.bars-empty 逐日负荷为空、.rest-body 休息日说明、.upcoming 接下来 3 个训练日）
- 焦点管理有明确意图：模式切换确认后用 nextTick 把焦点还给触发它的模式按钮（第 129–131 行），选择后自动把焦点交给「确认切换」（第 139–143 行）；onDocClick 用 e.composedPath() 而非 closest('.mode-wrap')，因为重渲染会让被点按钮脱离 DOM 导致 closest 误判
- 状态一律「形状 + 文字」双编码，不靠颜色单独传达（ShapeState 实心/半填/空心、StatusBadge 实心/空心圆点）
- 深色主题整组覆盖同名 CSS 变量，组件零感知；首帧前由 index.html 内联脚本预置 data-theme，避免刷新白闪
## 样式写法
全部是 Vue SFC 的 `<style scoped>`，无预处理器、无 CSS-in-JS、无原子类框架；颜色/间距/圆角/动效/z-index 一律走 src/styles/tokens.css 的 CSS 自定义属性，浅色在 :root、深色在 html[data-theme="dark"] 整组覆盖同名变量，因此换肤改令牌即可、不必动组件。排版原子放在 globals.css：`.micro`（10px + .17em 大写字距，页面节奏的来源）、`.num`（Bahnschrift 等宽数字）、`.hairline`、`.visually-hidden`；BaseCard 额外约定内距走 `--card-pad` 变量，避免父子组件抢 padding 选择器。布局尺寸也做成了令牌（--sidebar-width 86px、--topbar-height 58px、--mobile-nav-height 64px、--gutter、--content-max-width），但**只在一半的地方被真正引用**。重复的自定义样式主要有四类：① 布局偏移在 AppShell.vue:48 与 TopBar.vue:175 两处各写一遍 var(--sidebar-width)，并在 AppShell.vue:57 / TopBar.vue:280 / SidebarNav.vue:123 / SidebarNav.vue:136 四处用 1099px/767px 媒体查询各自重置，改宽度要动 6 个位置；② 品牌 SVG 在 SidebarNav.vue:4–14 与 TopBar.vue:8–18 逐字重复（同一段 64×64 viewBox 路径，仅 stroke-width 5.4/5.6 与尺寸不同）；③ 按钮绕开 BaseButton 另起炉灶：TopBar.vue:254–256 自写 .btn-primary/.btn-ghost（min-height 38px、radius 8px、无 focus-visible 定制），DashboardView.vue:554–560 又自写 .btn/.btn.primary/.btn.ghost（42px），加上 BaseButton.vue:9/13 的 .primary/.ghost（44px、radius-md、自带 focus ring）共三套；④ 模式切换确认 UI 在 TopBar.vue:32–69（.popover 预览分支）与 SettingsView.vue:29–40（.switch-confirm）各写一遍，渲染同一个 store.switchPreview，文案结构一致。绕过令牌直接写死的有：StatusBadge.vue:5 的 border-radius:999px（未用 --radius-pill）、ToastRegion.vue:4 的 border-radius:15px 与 top:106px、ExecutionView.vue:738 的 max-width:1400px、OnboardingView.vue:439 的 760px、SettingsView.vue:413 的 860px、BaseButton.vue:7 的 rgba(15,118,110,.32) 焦点环、PlanDraftDialog.vue:353 与 FoodCaptureDialog.vue:888 的 rgba(17,22,26,.46) 遮罩。**死令牌**：tokens.css:180–183 定义的 --breakpoint-sm/md/lg/xl（640/768/1024/1280）全仓无引用（CSS 变量本就无法用于 media query），且数值与实际使用的 767/1099 对不上；globals.css:142–148 的 .container 工具类无任何调用方。**死代码**：src/components/journey、src/components/reports、src/components/training、src/data 四个目录全空，全仓（src/ + README + 脚本）grep 无任何 import 引用；README.md:96 已注明"那是早期交付文档设想的规划结构，未落地"，但 README.md:271 的"添加新组件"仍在指导把组件放进 common/journey/training。
## 数据流
props/emits 是外壳与子组件之间的**唯一**通信方式，没有任何 provide/inject、没有全局事件总线：AppShell → TopBar 传 `:menu-open="mobileOpen"` 并接 `@toggle-menu`；AppShell → SidebarNav 传 `:open="mobileOpen"` 并接 `@close`；SidebarNav 内部每个 RouterLink 点击时额外调 `emit('close')` 关闭抽屉（TopBar.vue:3 用 `$emit` 而脚本里用 `defineEmits` 声明，两处一致）；MobileNav 无 props/emits，自行 useRoute() 读 route.path。AppShell 的 script 只有 3 行逻辑：mobileOpen ref、watch(() => route.fullPath) 关闭抽屉、onMounted 调 store.init()。Pinia 是唯一状态来源：AppShell 与 TopBar 都直接 `useAppStore()`，TopBar 消费 currentMode / isAthleteMode / switchPreview / userProfile 以及 requestModeSwitch / confirmModeSwitch / cancelModeSwitch 三个动作；MobileNav 只依赖 vue-router。**服务层（src/services/*）在这条链路上完全没有参与**——布局层不碰 planRules/loadRules/weekRules/llm，唯一的服务层调用是 TopBar.vue:83 的 utils/time.shortDate() 格式化日期。持久化只有一条路径：store.init() 读 localStorage['twopoles_state']（JSON，字段 mode/profile/sessions/meals/privacy/collapsed/theme/plans/planHistory/modeLog/unitGrams），store.persistState() 写回；主题另有一路写 document.documentElement.dataset.theme，且 index.html:9–19 的首帧脚本用**同样的判断逻辑**再实现了一遍（读 saved.theme → 判 system/dark → 设 data-theme），与 stores/app.ts:85–88 的 applyTheme() 重复。路由数据流：router → 视图懒加载，视图不用 route.params，只有一处 query 传参——DashboardView.vue:512 的 router.push({ path: '/execution', query: { exercise: mainItem.value.exerciseName } })。
## 状态模型
外壳层只有一个状态位：AppShell.vue:31 的 `const mobileOpen = ref(false)`，语义是「平板抽屉是否展开」。它的三个关闭路径互相重叠——① TopBar 汉堡按钮 toggle-menu 取反；② SidebarNav 每个导航项点击 emit('close')；③ AppShell.vue:35–37 的 watch(() => route.fullPath) 在任何路由变化时置 false（与 ② 重复）；④ scrim 点击置 false。抽屉开启时 SidebarNav 的 .rail 加 `.open` 类（transform: translateX(0)），同时 AppShell 渲染 .scrim 遮罩。真正的业务状态机都在 store 里：**模式切换三段式**——requestModeSwitch(target) 置 pendingSwitch（若 target===currentMode 直接返回 null）→ switchPreview computed 基于 pendingSwitch/from/openPlans 生成 { fromLabel, toLabel, differences[], keeps[], openPlanCount, openPlanNote } → 用户 confirmModeSwitch()（写 currentMode、同步 userProfile.mode + modeChangedAt、push modeLog、persistState、弹 Toast）或 cancelModeSwitch()（清 pendingSwitch）。注意 switchPreview 里的 differences/keeps/openPlanNote 是**写死在 store 里中文字符串**（app.ts:189–199），不是数据。**模式枚举** Mode = 'public' | 'athlete'，两套模式标签文案又各写了一份：TopBar.vue:97–100（label/note：'大众模式 · 轻量推荐 · 自动计数 · 简单餐次确认'）与 SettingsView.vue:245–246（label/desc：'按器材与时长过滤的一周安排…'），措辞不同。另有建档专用的旁路 commitMode(target)（app.ts:233–243），跳过确认直接落地，仅 OnboardingView.vue:423 调用。**主题三态** themePref = 'system' | 'light' | 'dark'，applyTheme() 解析成 html[data-theme] 的 'light'|'dark'，同时监听 matchMedia('(prefers-color-scheme: dark)') 的 change 事件（app.ts:68/104），支持系统跟随。**计划草稿状态机**（驱动全局 PlanDraftDialog，由 store 持有、组件只渲染）：planDraftState.status = 'idle' → 'loading'(loadingStage: 'questions'|'plan') → 'questions' → 'ready' | 'error'，每个状态还带 error / warnings / answers / draft 字段；PlanDraftDialog.vue:187 用 `open = computed(() => state.value.status !== 'idle')` 把它映射成弹层的显隐——**弹层开关与 store 状态强耦合，没有独立的 open/close 状态**，close() 只能靠 resetPlanDraft() 把 status 打回 idle。
## 耦合
① 外壳 → store：AppShell.vue:29/39 与 TopBar.vue:82 都 `useAppStore()`，直接读 currentMode / isAthleteMode / switchPreview / userProfile 并直接调 requestModeSwitch / confirmModeSwitch / cancelModeSwitch 三个 action；外壳不引入任何自己的 store。② 外壳 → 路由：AppShell.vue:9 用 RouterView v-slot + Transition；MobileNav.vue:2-3 用 useRoute() 读 route.path 做选中判定；TopBar.vue:81 用 useRouter() 做 router.push('/settings')。③ 外壳 → 视图：router/index.ts 的 7 条懒加载路由是外壳与页面层唯一的耦合面，视图本身不知道外壳存在——但反过来，视图**隐式依赖**外壳的左让位（各自再收口 max-width 并 margin:auto）。④ 外壳 → 公共组件：AppShell.vue:27-28 引入 ToastRegion 与 PlanDraftDialog，两者都是全局单例、靠 store 状态驱动（store.toasts / store.planDraftState），与页面无关，因此换布局时必须继续在根部挂载。⑤ 外壳 → 样式层：AppShell/SidebarNav/TopBar/MobileNav 共同消费 tokens.css 的 --sidebar-width、--topbar-height、--mobile-nav-height、--gutter、--space-*、--z-sticky/-dropdown/-modal*/-toast、--overlay、--surface-glass/-strong、--color-border/-divider/-card/-ink/-accent*、--radius-*、--motion-*、--easing-*。⑥ 外壳 → utils：TopBar.vue:83 只用到 utils/time.shortDate()。⑦ 导航信息架构跨三处重复且互不同步：router/index.ts（7 条路由的 to/meta.title）、SidebarNav.vue:54-60（5 项 items）、MobileNav.vue:4（4 项 items + owns 子路由归属），三套标签文案各不相同（周报/图表、饮食/记录、我的/个人设置）。⑧ 模式元数据与文案跨四处重复：TopBar.vue:97-100 的 modes、SettingsView.vue:245-246 的 modes、TopBar.vue:102 的 currentLabel、store/app.ts:189-199 的 switchPreview 中文清单。⑨ 跨组件共享的 DOM 资产：品牌 SVG 在 SidebarNav 与 TopBar 各内联一份。⑩ z-index 层级靠相对 calc 手工协调：AppShell.scrim=--z-sticky+1、SidebarNav 抽屉=--z-sticky+3、TopBar=--z-sticky、MobileNav=--z-sticky、ToastRegion=--z-toast、PlanDraftDialog/FoodCaptureDialog 遮罩=--z-modal-backdrop，彼此没有统一的层级语义表。
## 设计债
- 【导航 IA 三处重复且命名不一致】router/index.ts 的 7 条路由、SidebarNav.vue:54-60 的 items（今日/计划/跟练/饮食/周报）、MobileNav.vue:4 的 items（今日/记录/图表/我的 + owns 映射）是三张互不同步的导航表。改版时漏改一处就会出现「桌面叫周报、移动叫图表」「桌面叫跟练、底栏没有跟练」这类割裂。
- 【品牌 SVG 逐字重复】SidebarNav.vue:4-14 与 TopBar.vue:8-18 是同一段 64×64 viewBox 路径（circle r=21.5 + 两条 22.2 弧 + 两颗 r=3.1 圆点 + stroke-linecap=round），只有 stroke-width 5.4 / 5.6 与尺寸 30px / 20px 不同。换 logo 必须同时改两处，应抽成 BrandMark.vue（用 currentColor / CSS 变量控色）。
- 【侧栏让位写死在 6 个位置】AppShell.vue:48 `.main-content { margin-left: var(--sidebar-width) }` 与 TopBar.vue:175 `.topbar { margin-left: var(--sidebar-width) }` 各一处，另在 AppShell.vue:57、TopBar.vue:280、SidebarNav.vue:123（宽度改 244px + transform 抽屉）、SidebarNav.vue:136（brand align-self）四处用 1099px/767px 媒体查询各自重置。把图标脊换成可折叠侧栏或浮层时，这 6 处会一起失效。
- 【模式切换确认 UI 写了两遍】TopBar.vue:32-69 的 .popover 预览分支（pop-title / pop-lead / pop-cols「变化·保持不变」/ pop-actions）与 SettingsView.vue:29-40 的 .switch-confirm（sw-lead / sw-cols / actions）渲染的是同一个 store.switchPreview，结构一一对应，只有类名和文案标签（「变化」vs「会变化」）不同。换皮必须改两处，且长期会漂移。
- 【全站三套按钮】TopBar.vue:254-256 自写 .btn-primary/.btn-ghost（min-height 38px、radius var(--radius-base) 8px、无自定义 focus-visible）；DashboardView.vue:554-560 自写 .btn/.btn.primary/.btn.ghost（min-height 42px、.primary:hover 写死 #000）；BaseButton.vue:4-18 是标准件（min-height 44px、radius-md、focus-visible 用 box-shadow 3px ring）。改版换按钮语言时三处都要动，且新页面会继续长出第四套。
- 【模式文案散落四处且措辞不一致】TopBar.vue:97-100 的 modes（note:'轻量推荐 · 自动计数 · 简单餐次确认'）、SettingsView.vue:245-246 的 modes（desc:'按器材与时长过滤的一周安排、摄像头计数、简单餐次确认'）、store/app.ts:189-199 switchPreview 里硬编码的 differences/keeps 中文清单、TopBar.vue:102 的 currentLabel 再判一次模式名。重写文案需要同时改 store 与三个视图。
- 【业务算法写在视图里】TopBar.vue:107-115 的 cycleWeek 直接在组件内算周期周数：`new Date(`${start}T00:00:00`).getTime()` → `Math.floor((Date.now()-t)/86400000)` → `Math.floor(days/7)+1`。没有进 services/，.selfcheck.mjs 里也没有任何 cycle 相关断言覆盖（该文件共 0 处涉及 router/SidebarNav/TopBar/MobileNav/AppShell）。周期口径变更时没有测试网兜底。
- 【TopBar 的 dateLabel 不刷新】TopBar.vue:94 `const dateLabel = shortDate(new Date())` 在 setup 时求值一次且非响应式；应用跨零点常驻时页头日期会停在昨天。相邻的 cycleWeek（第 107–115 行）虽是 computed，但只依赖 store.userProfile.cycleStartDate 这一个响应式源，Date.now() 不可追踪，所以长会话内跨周也不会更新——两处都是「看起来是 computed 其实不会重算」的坑。
- 【断点散落且与令牌对不上】代码里实际用了 520 / 560 / 640 / 720 / 767 / 900 / 1024 / 1099 / 1100(min) / 1279 共 10 个 px 断点；tokens.css:180-183 定义的 --breakpoint-sm/md/lg/xl (640/768/1024/1280) 一个都没被引用（CSS 变量本就无法用于 media query），且数值与真实断点（767 / 1099）不一致。改版调整断点要全仓搜 10 个字面量。
- 【页面容器类名与宽度六套并存】DashboardView.vue:517 用 .page（1440）、ReportView.vue:280 用 .page（1440）、MealsView.vue:543 用 .page-wrap（1440）、PlanView.vue:423 用 .page-wrap（1440）、OnboardingView.vue:439 用 .page-wrap（760）、SettingsView.vue:413 用 .page-wrap（860）、ExecutionView.vue:738 用 .execution-page（1400 硬编码，未用令牌）。globals.css:142-148 的 .container 工具类完全没有调用方。
- 【页头区块重复实现 4 遍】OnboardingView.vue:440-443、SettingsView.vue:414-417、PlanView.vue:427-429、ExecutionView.vue:739-742 各自写一套 flex 页头 + eyebrow + h1 + p，h1 字号分别是 28 / 28 / 36 / 28px；其中 .eyebrow::before 的菱形点样式（6px 旋转 45deg 方块 + accent 色）在 OnboardingView.vue:441 与 SettingsView.vue:415 是**逐字相同的两行 CSS**，各写一遍。
- 【抽屉打开时页头整体不可点】SidebarNav 抽屉 z-index = calc(--z-sticky+3) = 1103，AppShell.scrim = 1101，TopBar = 1100。抽屉在 768–1099 档铺满左侧 244px，正好盖住 TopBar 左端的汉堡按钮（topbar padding var(--space-6)=24px，按钮 margin-left:-8px，落在 16–48px），该按钮的 aria-expanded 因此无法被点击来回切换，只能靠遮罩或导航项关闭；同时模式芯片与头像在抽屉打开期间也被 scrim 盖住不可用。
- 【reduced-transparency 只做了一半】SidebarNav.vue:154-156 与 BaseCard.vue:73-79 有 @media (prefers-reduced-transparency: reduce) 降级为不透明底；但 TopBar.vue:180-182（blur 10px）、MobileNav.vue:10（blur 16px）、ToastRegion.vue:4（blur 14px）都用了 backdrop-filter 却没有对应降级。
- 【ToastRegion 定位是魔法数字】ToastRegion.vue:4 `.toasts{position:fixed;right:24px;top:106px}` —— 106 = 58px 页头 + 48px 猜测，无 token、无注释；移动端又改成 82px（同样无依据）。页头高度一改，Toast 就会压到页头或离得太远。
## 约束
- localStorage 持久化契约：键名固定为 'twopoles_state'，JSON 字段名固定为 mode / profile / sessions / meals / privacy / collapsed / theme / plans / planHistory / modeLog / unitGrams（stores/app.ts:137-150 写、99-132 读）。index.html:12 的首帧脚本也要读 `saved.theme`。改版不得改键名或字段名，否则老用户数据读不出来；privacy.showEnergyEstimate 直接决定是否跑热量估算链路（app.ts:773-777）。
- 深色主题的实现机制是「html[data-theme="dark"] 整组覆盖同名 CSS 变量」（tokens.css:199-258），落地点在三处且必须同步：index.html:9-19 的首帧脚本、stores/app.ts:85-88 的 applyTheme()、tokens.css:199 的选择器本身。改版换主题机制（如改用 class 或 prefers-color-scheme 直接生效）必须三处一起改，否则深色用户刷新会白闪。
- 路由路径与路径语义不得变更：/dashboard /plan /execution /meals /report /onboarding /settings 被 SidebarNav、MobileNav、DashboardView、ReportView、TopBar 头像等处硬编码跳转；'/execution?exercise=<name>' 是 DashboardView 进入跟练页的唯一传参方式（DashboardView.vue:512），改版换 query 参数名会断掉这条链路。
- vue-router 使用 createWebHistory（非 hash 模式），生产部署需要服务器把未知路径回退到 index.html，否则直接访问 /report 会 404；index.html 的 title 依赖 router.afterEach 写入 document.title（router/index.ts:64-71）。
- 安全上下文要求不可放宽：navigator.mediaDevices 只在 https 或 localhost 存在，否则跟练页必须退回演示回放；crypto.randomUUID 在非安全上下文不可用时 utils/id.ts 会退到时间戳+随机数（id.ts）。改版不能引入比这更严格的环境要求（如必须 WebCrypto、必须 Worker 模块化、必须 SharedArrayBuffer）。
- 浏览器 API 依赖与降级链路：跟练取帧依赖 video.requestVideoFrameCallback（不可用时回落 rAF + video.currentTime 去重），推理依赖 OffscreenCanvas + WebGL2 GPU delegate（不可用时回落 CPU），推理落点在 module worker（worker 起不来或单次推理超 2 秒时回落主线程）。这些边界固化在 composables/usePoseCamera.ts 与 composables/poseInference.worker.ts，改版不能把这些 API 调用挪出该边界或删掉降级分支。
- 照片存储分层不能合并：餐食原图存 IndexedDB（services/mealPhotos.ts，键为 photoId），缩略图（256px JPEG）存 localStorage。store.persistState 的配额失败只提示一次（quotaWarned，app.ts:75/156-165）。改版不得把更多二进制塞进 twopoles_state，否则会撑爆浏览器存储。
- 状态必须保持「形状 + 文字」双编码（ShapeState 的实心/半填/空心、StatusBadge 的实心/空心圆点），不能退回纯颜色传达——这是 README 声称的 7 条路由 0 项 WCAG AA 失败的前提。
- 模型密钥的边界：服务端默认模型的密钥只从 LLM_DEFAULT_* 读取（README:21），用户在设置页自填的 baseUrl / apiKey / model 只存本机且不随导出 JSON/CSV 带走（app.ts:338 loadLlmConfig、app.ts:137-150 的 persistState 不含 llmConfig）。改版不得把这些字段打进构建产物或导出包。
- 构建校验路径受环境限制：npm run build 在受限沙箱下会因 esbuild 子进程 spawn EPERM 失败（README:15），因此改版的验证应以 npm run typecheck + npm run selfcheck（237 项纯逻辑断言）为准，浏览器渲染需另在正常本机跑。
- 无后端账号体系：全部数据只落本机，不存在服务端会话/鉴权；改版不能引入需要登录或服务端持久化的界面流程。
## 改版接缝
- 【可直接整块替换：AppShell 的模板层（AppShell.vue:2-19）】这是纯装配层，script 只有 3 行逻辑（mobileOpen ref、watch、store.init()）。改布局骨架时可以整块重写，但要保留 4 条契约：① TopBar 仍接收 menu-open 并 emit toggle-menu；② SidebarNav 仍接收 open 并 emit close；③ main 内仍是 RouterView 出口；④ PlanDraftDialog 与 ToastRegion 必须继续被挂载（它们是全局单例，靠 store 状态驱动，与页面无关）。
- 【可直接整块替换：SidebarNav 的 items 数据（SidebarNav.vue:54-60）】是一个纯数据数组 {to, label, full, icon}，icon 是组件引用。改导航结构或换图标只改这一个数组，模板不用动；但必须同步 MobileNav.vue:4 的那张表。
- 【可直接整块替换：TopBar 的模式弹层（TopBar.vue:24-70）】确认/取消分支完全由 store.switchPreview 驱动，TopBar 只负责渲染与焦点管理。把 popover 换成 Drawer / Dialog / 独立页面都不需要碰 store。
- 【逻辑边界清晰可复用：store 的模式切换三段式】requestModeSwitch / confirmModeSwitch / cancelModeSwitch + switchPreview computed 构成干净的契约——UI 只读 switchPreview、只调这三个方法。改版换任何确认交互形态都不需要动 store 逻辑。
- 【换肤接缝：CSS 变量令牌】tokens.css 的 :root 与 html[data-theme="dark"] 两组覆盖了颜色/间距/圆角/动效/z-index/布局尺寸。改配色与质感只需改令牌、不必动组件——但 --sidebar-width 这类布局尺寸被 AppShell 与 TopBar 同时引用，改宽度必须同时动这两处。
- 【换卡片语言的接缝：BaseCard 的三个 variant 契约（BaseCard.vue:12-19）】全站只有 default / flush（纸面）与 ink（仪表面）两种表面，所有卡片内距统一走 --card-pad。改版换卡片质感只需改 BaseCard 这一个文件 + 令牌，不用逐页改。
- 【可复用的既有原语】StatStrip（指标条）、ShapeState（三态形状）、StatusBadge（状态徽标）、MetricCard、InsightCard、TwoPoleDial（双极环）、LoadChart 已经是成型的积木，DashboardView 已经把它们当积木用；改版可直接复用而不必重写。
- 【可复用的排版原子】globals.css 的 .micro（10px + .17em 大写字距）与 .num（Bahnschrift 等宽数字）是全站节奏的来源，改版可以继续以它们为契约；globals.css 的 .container 目前无调用方，可作为新页面的收口工具或直接删掉。
- 【必须先解耦 1：TopBar 的焦点与外部点击管理（第 146-166 行）】onDocClick 用 e.composedPath().some(node => node.classList.contains('mode-wrap')) 判断「点在外部」，onEsc 关闭，confirm/cancel 后 nextTick 把焦点还给模式按钮——这套逻辑与 TopBar 的视觉完全无关但被写在同一文件。改皮前应抽成独立 composable（如 useDismissable/useFocusReturn），否则换任何形态的弹层都要重新抄一遍这段有注释解释微妙 bug 的代码。
- 【必须先解耦 2：TopBar 的 cycleWeek 算法（第 107-115 行）】纯业务逻辑（周期起始日 → 第几周）写在视图组件里，没有进 services/、没有断言覆盖。改版要把它挪到 services/weekRules.ts 一类的纯函数里，才能在改版中安全地调整周期口径。
- 【必须先解耦 3：按钮体系】TopBar.vue:254-256 的 .btn-primary/.btn-ghost 与 DashboardView.vue:554-560 的 .btn 系列各自绕过 BaseButton。改版换按钮语言前，必须先把 TopBar 与 DashboardView 收敛到 BaseButton（同时能修掉 TopBar 按钮缺 focus-visible 定制、低于 44px 的问题），否则新界面只会继续复制。
- 【必须先解耦 4：SidebarNav 的 short/full 双标签机制】同一份导航渲染成两种形态靠 .short / .full 两个 span + 第 118、148-149 行的 display 规则 + 1099px 媒体查询里的整段重排共同实现。改成抽屉形态时必须同时理解这四段 CSS；建议先改成单一 DOM + CSS 控制显隐，或直接拆成 RailNav / DrawerNav 两个组件，让形态差异变成组件差异而不是媒体查询差异。
- 【必须先解耦 5：内容让位契约】AppShell.vue:46-58 的 .main-content（margin-left + padding + 三档媒体查询）与 TopBar.vue:175 的 margin-left 共同构成「内容区让出导航」的隐式约定，分散在两个文件。改版要重排栅格时，应先把它收敛成单一来源（例如 shell 统一出一个 --content-offset，或改用 grid-template-areas），否则三处（AppShell / TopBar / SidebarNav）会不一致。
- 【必须先解耦 6：模式切换确认 UI 的两份实现】TopBar.vue:32-69 的 .popover 预览分支与 SettingsView.vue:29-40 的 .switch-confirm 必须先合并成一个共享组件（放到 components/common/），再谈重新设计它的外观，否则改版后两份实现会立刻分叉。
## 职责
src/stores/app.ts 是整个应用唯一的全局状态中枢（Pinia setup store，963 行、42 个方法）。它承担六件事：① 身份与模式（大众/运动员，当前模式、待确认的模式切换、切换历史）；② 档案（UserProfile 单份）；③ 训练记录与训练计划（含规则生成与 LLM 生成两条来源、计划版本历史）；④ 饮食记录与本机"1 单位=几克"换算口径；⑤ 偏好与设置（隐私开关、主题三态、解释类卡片的折叠状态）；⑥ AI 计划的草稿状态机与模型配置。它同时是**本地持久化的唯一写入点**（localStorage `twopoles_state`），并直接承担了三块业务逻辑：模式切换的差异说明与确认流程、计划版本管理（不静默覆盖，旧版进 history）、LLM 草稿→确认→入库的两阶段流程。服务层（src/services/*）全是纯函数、不 import store，依赖方向是单向的：view/component → store → services。
## 关键组件
- 模式切换确认面板（SettingsView.vue:29-40 与 TopBar.vue 的模式下拉共用）：数据源是 store 的 switchPreview computed，渲染 from/to/differences/keeps/openPlanNote 五段文案；确认走 confirmModeSwitch()，取消走 cancelModeSwitch()
- AI 计划草稿弹窗（src/components/common/PlanDraftDialog.vue，461 行，全局挂载在 AppShell）：完全由 store 的 planDraftState.status 驱动四个态 —— loading（区分 loadingStage='questions'|'plan'）/ error / questions / ready；ready 态下在组件内维护 local 副本供用户改动作、类型、时长、组次、增删训练日，确认后调 acceptPlanDraft 入库
- Toast 通知区（src/components/common/ToastRegion.vue，6 行 + AppShell 全局挂载）：只渲染 store.toasts，四种 type（success/error/warning/info）各有图标与左边框色；store.showToast 统一带 duration 自动消失
- 可折叠解释卡（src/components/common/InsightCard.vue）：cardId prop + store.toggleCard/isCardCollapsed(id)；目前只有 MealsView 的 'meal-rules' 与 ReportView 的 'report-quality' 两个实例在用
- 设置页四组开关（src/views/SettingsView.vue）：使用方式（模式）、模型接入（llmConfig/llmDefault）、隐私（privacy 的 5 个开关 + 保留天数 + 导出格式）、外观（themePref 三态）、我的数据（导出/清除）
- Dashboard 页的 store 消费面（src/views/DashboardView.vue:296-513）：约 250 行 computed 取数层，直接从 store.sessions/meals/userProfile/currentMode 现算周报、负荷序列、强度分布、三餐摘要、时间轴
## UI 模式
- store 本身不渲染任何 UI，但它决定了跨页面的状态呈现语义：① 模式是全局开关（TopBar 有模式下拉、SettingsView 有二选一卡、SidebarNav 不涉及），两种模式的首页主视觉完全不同（DashboardView 里 isAthlete 分成"负荷曲线"与"今日安排"两条分支）；② 计划状态有三层 —— 状态机态（idle/loading/questions/ready/error，由 PlanDraftDialog 全局消费）、周计划实体态（plans 数组，按 weekStartDate+mode 查）、条目态（locked/completed 两个布尔，由 PlanView 的两个 mini 按钮切换）；③ 空态语义在 store 层就已固化：'未记录' ≠ '没吃'/'没练'（loadRules 把缺 RPE 记为 missing 而非 0，weekRules 缺 RPE 的天不进负荷合计）；④ 折叠态是持久化的（collapsedCards），解释类卡片默认不常驻占位；⑤ 通知是一律性的（showToast 带 duration，4 种 type），成功/错误/信息在业务动作里就地弹出
## 样式写法
store 本身不含样式，但它通过三条路径强耦合设计系统：① `applyTheme()` 直接写 `document.documentElement.dataset.theme = 'dark' | 'light'`（app.ts:87），并监听 `matchMedia('(prefers-color-scheme: dark)')` 的 change 事件实时跟随 —— 主题三态（system/light/dark）是 store 的公开 state，themePref 被持久化；② `index.html` 第 12-21 行有一段首帧前内联脚本，读取同一份 localStorage 的 theme 字段并写同样的 dataset.theme，注释里明说"否则深色用户每次刷新都会白闪一下" —— 这是主题判定逻辑的**第二份手抄副本**，store 里 applyTheme 与 index.html 的算法必须保持一致；③ 换肤的实际战场在 src/styles/tokens.css（258 行）+ globals.css + animations.css + gradients.css 这四个全局样式文件，main.ts 里全局引入，组件一律用 var(--token) 引用 token，scoped CSS 写在各自 .vue 里。store 层的样式耦合点只有 dataset.theme 这一个 DOM 契约。
## 数据流
**数据来源**：全部数据来自本机，没有后端数据库。唯一的远端是 `/api/llm/status`（读服务端默认模型是否存在）与 `/api/llm/chat`（OpenAI 兼容代理），两者都在 services/llm.ts 里，store 只是转发。**三处持久化**：① localStorage key `twopoles_state` —— 由 store 的 persistState()（app.ts:137-167）用 JSON.stringify 一次性写入 11 个字段：mode / profile / sessions / meals / privacy / collapsed / theme / plans / planHistory / modeLog / unitGrams。序列化无版本号、无 schema 标记、无法向量化；② localStorage key `twopoles_llm` —— 由 services/llm.ts 的 loadLlmConfig/saveLlmConfig 独立管理，**故意不进导出**（含 API key）；③ IndexedDB `twopoles_meal_photos`（DB_VERSION=1，objectStore `photos`）—— 存饮食照片原图 Blob，key 是 Meal.photoId；Meal.photoThumb 则是 256px JPEG data URL，跟 meals 一起进 localStorage。**迁移逻辑**：没有版本化迁移框架，只有 init() 里逐字段的防御式读取 —— `Array.isArray(data.sessions) ? ... : []`、`data.privacy` 做浅合并、`data.theme` 三选一白名单、`unitGrams` 逐条过滤 `v > 0 && v <= 5000`、旧档案走 normalizeProfile() 补齐 personalBests/gymRecords 空数组。**数据流向**：视图 → store.state（只读）→ services 纯函数 → 视图；写路径统一是 store action 内部改 ref 再调 persistState()。没有 watch 订阅式自动持久化，persistState() 是手写调用，散落在 18 处。**导出口**：SettingsView.payload computed 单独组装一份导出对象（比 localStorage 少 collapsed/theme/pendingSwitch，多 exportedAt），JSON 走 JSON.stringify、CSV 走手写转义加 BOM。**导入口不存在** —— 项目里没有任何 FileReader / file input，导出的 JSON 无法回灌。
## 状态模型
**① 模式状态机（两段式确认）**：currentMode（'public'|'athlete'）→ requestModeSwitch(target) 置 pendingSwitch → switchPreview computed 产出差异说明 → confirmModeSwitch() 或 cancelModeSwitch()。另有 commitMode(target) 供建档流程末页直接落地，跳过确认。**② 计划版本模型**：plans（当前版本，按 weekStartDate + mode 定位）+ planHistory（不可变快照）。三处写入路径：ensureWeekPlan（创建，version=1）、bumpVersion（改动，version+1，旧版进 history）、acceptPlanDraft（LLM 录入，version = old+1，旧版进 history）。计划条目级有 locked / completed 两个布尔。**③ AI 草稿状态机**：planDraftState.status ∈ {idle, loading, questions, ready, error}，正交维度 loadingStage ∈ {'questions', 'plan', null}（用于区分"正在准备问题"和"正在生成计划"），伴随 questions[] / answers{} / draft / error / warnings[]。并发控制用闭包里的单调计数器 planRequestId，晚到的旧请求结果直接丢弃。**④ 主题状态**：themePref ∈ {'system','light','dark'}，解析后写 <html data-theme>。**⑤ 折叠状态**：collapsedCards: string[]（卡片 id 集合）。**⑥ 餐次完整性**：Meal.completeness ∈ {'complete','partial','unknown'}（由 deriveCompleteness 判定）。**⑦ 计划新鲜度**：dayPlanNotice.stale 布尔，判定式是 `p.source !== 'llm' && !p.reason.includes(PLAN_RULES_VERSION)`。**⑧ 隐私开关**：PrivacySettings 六个布尔/枚举（cameraEnabled / saveVideoLocally / dataRetentionDays / exportFormat / showEnergyEstimate / saveFoodPhotoLocally）。
## 耦合
**跨组件 import**：16 个文件 import `useAppStore` —— 7 个 view（DashboardView、PlanView、MealsView、ReportView、SettingsView、OnboardingView、ExecutionView）、7 个 component（TopBar、AppShell、ToastRegion、PlanDraftDialog、InsightCard、DailyWellnessCard、MealForm、FoodCaptureDialog）。store 出现在 AppShell 全局层（ToastRegion、PlanDraftDialog）与 App.vue 根部，是所有页面的公共依赖。**共享 store 字段**（按引用次数）：userProfile(20) / sessions(20) / privacy(19) / meals(19) / llmConfig(18) / llmDefault(16) / showToast(14) / currentMode(12) / isAthleteMode(10) / hasProfile(7) / unitGrams(4) / plans(3) / planHistory(3) / planDraftState / switchPreview / pendingSwitch / modeLog。**共享类型**：@/types/domain 被 store、6 个 service、7 个 view 同时 import，domain.ts 的 interface 形状直接等于 localStorage 的序列化形状 —— 类型与持久化格式是同一份契约，没有中间 DTO 层。**store → services 的依赖**（store 内部调用，全是纯函数）：mealRules(analyzeMeal, deriveCompleteness) / foodComposition(estimateEnergy, unitKey) / mealPhotos(clearMealPhotos, deleteMealPhoto) / planRules(buildDayPlan, PLAN_VERSION, PLAN_RULES_VERSION) / profileRules(normalizeProfile) / llm(11 个导出) / weekRules(weekStart) / utils/time(toISODate)。**反向耦合为零**：services 目录下没有任何文件 import store，依赖方向严格单向 —— 这是这个 store 少数让人省心的点，也意味着 services 层在改版中可以整体不动。**重复聚合**：buildWeeklyReport 被 3 个 view 各自调用（DashboardView.vue:334、PlanView.vue:290、ReportView.vue:172），三处都传同样的 {profile: store.userProfile, mode: store.currentMode}；store 自己没有暴露"本周汇总"这个口径，视图层各自重算。**日期口径分散**：`const now = new Date()` 在 5 个 view 里各写一遍（DashboardView:292、MealsView:265、PlanView:187、ReportView:152、TopBar:94），store 的 action 又各自再 new Date() 一次 —— 没有任何一处把"当前参考日"提升为全局状态。**视图直写 store state**：MealsView.vue:519 `store.meals = store.meals.filter(...)` 绕过 removeMeal 与 persistState（靠紧跟其后的 addMeal 才补上持久化）。**store ↔ DOM**：applyTheme 直接写 document.documentElement.dataset.theme；showToast 用 setTimeout 管生命周期；init() 注册 matchMedia 的 change 监听器且从不移除。
## 设计债
- **持久化是"手抄四份 schema"**：新增一个 state 字段必须同时改 4 处 —— persistState() 的 state 对象（app.ts:138-150）、init() 的读取分支（app.ts:105-130）、clearAllData() 的复位清单（app.ts:869-891）、SettingsView.payload 的导出清单（SettingsView.vue:328-340）。漏掉任何一处都不报错，只是静默丢数据。这是改版最容易踩的坑。
- **twopoles_state 没有 schema 版本号**：init() 是整块 JSON.parse 后逐字段防御式读取（app.ts:105-130），解析失败时只 console.error 并保留初始默认值（app.ts:127-129），用户看起来像"从没建过档"。没有 data.version 字段，将来无法区分"旧数据缺字段"和"新数据"。
- **主题判定逻辑写了两遍**：app.ts:86 `applyTheme()` 的 `pref === 'dark' || (pref === 'system' && !!darkMedia?.matches)` 与 index.html:14-19 的内联脚本是同一套算法的两份手抄副本。改主题口径必须同时改两处，否则首帧会闪。app.ts:84 的注释自己也承认了这件事。
- **init() 里 applyTheme() 被调用两次**（app.ts:100 与 app.ts:117）—— 第一次在读 storage 之前（用旧偏好算了一遍），第二次在读完之后。第 100 行那次是多余的。
- **TDZ 隐患**：init()（app.ts:102 读 llmConfig、app.ts:120 写 modeLog）引用的 llmConfig（app.ts:338）与 modeLog（app.ts:175）都是同一作用域里声明在 init() **之后**的 const。现在能跑通纯粹是因为 init() 由 AppShell.vue:39 的 onMounted 触发、store setup 已执行完毕。任何人在模块顶层或 setup() 里同步调 store.init() 就是 ReferenceError。
- **openPlanCount 在 store 内有两种口径**：switchPreview.openPlanCount = carry.length（app.ts:195，只算**原模式**的计划）vs modeLog.openPlanCount = openPlans.value.length（app.ts:221/241，算**全部模式**的计划，因为 openPlans 定义在 app.ts:177-179 不带 mode 过滤）。同名字段两种含义，跨视图读会读错。
- **计划版本号有三套互相矛盾的策略**：ensureWeekPlan 永远写 version:1（app.ts:282）；regenerateWeekPlan（app.ts:319-334）把旧计划挪进 history 后调 ensureWeekPlan，导致新计划版本号**退回 1**，但 toast 却说"旧版本 v3 已存为历史"（app.ts:330）—— 版本号会倒退；acceptPlanDraft 用 (old?.version ?? 0) + 1（app.ts:572）；bumpVersion 用 plan.version += 1（app.ts:597）。
- **复制到另一模式的计划会被误判成"旧规则生成"**：dayPlanNotice 的 stale 判定是 `p.source !== 'llm' && !p.reason.includes(PLAN_RULES_VERSION)`（app.ts:314）。copyPlanToMode 写的 reason 是"由「大众模式」v1 复制而来"（app.ts:255）不含 plan-rules-v3，source 又是靠 ...src 继承的（规则计划为 undefined）→ stale 恒为 true，Dashboard 会显示"计划由旧规则生成，可在计划页重生成"。
- **复制计划会产出重复 item id**：copyPlanToMode 用 id: `${i.date}-${i.exerciseName}-c` 重建 id（app.ts:256），而 LLM 草稿允许同一天出现两个同名动作（validatePlanDraft 只去重日期不去重条目，llm.ts:394-438）→ 复制后两条 item 同 id；而 markItemCompleted（app.ts:635）、toggleItemLock（app.ts:627）、acceptAdjustment（app.ts:609-613）全部按 id 匹配，**一次操作会同时改到两条**。
- **confirmModeSwitch 与 commitMode 是 8 行完全重复的代码**（app.ts:212-230 vs app.ts:233-243），差别只有 toast 和 pendingSwitch 清空。
- **store 里塞了整段面向用户的中文文案**：switchPreview 的 differences / keeps / openPlanNote 是写死的中文句子（app.ts:191-198），SettingsView.vue:33-34 与 TopBar 都直接渲染。改版换措辞 = 改 store；换语言 = 无从下手。
- **switchPreview.keeps 里的数字口径不对**："已存在的 ${plans.value.length} 份计划保留原模式与规则版本"（app.ts:194）用的是全部模式、全部周的计划总数，而同一个对象里的 openPlanCount 却是"原模式未完成"的数量。同屏两个数字含义不一致。
- **bumpVersion 每勾一次复选框就往 planHistory 塞一份完整计划快照**（app.ts:595）。markItemCompleted / toggleItemLock / addManualItem 全走它 → planHistory 无上限、无清理、整体进 localStorage。配合照片缩略图，这是写满 localStorage 的主因，而 app.ts:156-165 的配额提示只提了缩略图，误导用户。
- **视图直接改 store 的 state**：MealsView.vue:519 `store.meals = store.meals.filter(m => m.id !== meal.id)` 绕过了 removeMeal（也就绕过了 IndexedDB 照片删除）和 persistState()（靠后面紧跟的 addMeal 才补上持久化）。store 缺 updateMeal / replaceMeal action，"编辑一顿饭"这个高频操作没有正规入口。
## 约束
- **twopoles_state 的 JSON 结构就是用户数据本身**：11 个 key（mode/profile/sessions/meals/privacy/collapsed/theme/plans/planHistory/modeLog/unitGrams）已经在真实用户浏览器里。改名 = 丢数据。改版必须做「读旧写新」或保留 key 兼容层，不能直接改字段名。
- **twopoles_llm 与导出隔离是安全属性不是实现细节**：这个 key 含 API key 且**故意不包含在 JSON/CSV 导出里**（llm.ts:18 的注释明确写了原因）。拆 key / 并 key 时必须保持"导出文件里没有密钥"这条不变量。
- **IndexedDB 库名 twopoles_meal_photos / objectStore photos / DB_VERSION=1**：Meal.photoId 是指向它的 key。改库名或 store 名 = 所有已保存的原图失联（缩略图还在、原图变灰）。
- **index.html 的首帧内联脚本必须在 module 脚本之前读 localStorage['twopoles_state'].theme 并写 document.documentElement.dataset.theme** —— 这是深色用户刷新不白闪的唯一保障。换 key 名或换 DOM 属性名都会导致首帧闪烁。
- **主题三态 system|light|dark → <html data-theme="dark|light">**，且 system 必须实时跟随 matchMedia('(prefers-color-scheme: dark)') 的 change 事件（app.ts:104）。store 的 applyTheme 与 index.html 的内联脚本必须保持同一判定。
- **负荷口径：负荷 = 时长(分钟) × RPE；缺 RPE 或缺时长 → 不可计算（null），绝不按 0 补齐；当天只要有一条训练缺 RPE，整天负荷就是 null**（weekRules.ts:30-33 与 62-69、loadRules.ts:100-107）。weekRules、loadRules、SettingsView 的 CSV 导出（SettingsView.vue:362）、store 的 applyFeedback toast（app.ts:752）四处必须口径一致，不能各算一遍。
- **ACWR 口径**：近 7 天均值 / 近 28 天均值，窗口 28 天、急性 7 天、至少覆盖 14 天才出数（loadRules.ts:50-53、113-118）；分档阈值 0.8 / 1.3 / 1.5（loadRules.ts:145-151）。先取整再相除会落错档，均值/比值必须用原始值算完再取整。
- **所有实体 id 必须走 newId()（src/utils/id.ts）**：crypto.randomUUID 在非安全上下文（http + 局域网 IP）不可用，newId() 有 Date.now+Math.random fallback。直接调 crypto.randomUUID 会让部分用户的应用起不来。
- **PlanItem.id 在同一个 plan 内必须唯一**：markItemCompleted / toggleItemLock / acceptAdjustment 全部按 id 匹配（app.ts:609-613、627、635），重复 id 会导致一次操作改到多条。跨天规则生成的 id 是 `${date}-${ex.id}`（planRules.ts:85），手工录入是 `${date}-${name}-m${base36}`（app.ts:645）。
- **Plan.id ↔ PlanItem.planId 的关联由 store 覆盖**：ensureWeekPlan 会把 buildDayPlan 产生的占位 planId（plan-v3）覆盖成真 id（app.ts:291）；MealItem.mealId / MealAnalysis.mealId 同理（analyzeMeal 返回 mealId:''，app.ts:781-786 才补上）。
- **planRequestId 必须保持单调递增**（app.ts:351、414、427、480、493）：LLM 请求是异步的，靠这个计数器丢弃过期响应，防止关弹窗后晚到的结果把弹窗重新打开。任何并发改造都不能让旧请求覆盖新状态。
- **浏览器能力降级守卫不能删**：matchMedia 可能不存在（app.ts:68 有 typeof matchMedia === 'function' 守卫）、indexedDB 可能不存在（mealPhotos.ts:7-9 守卫）、crypto 可能不存在（id.ts:3 守卫）。
- **localStorage 配额（典型上限约 5MB）**：缩略图 data URL 与 planHistory 快照是主要占用，写入失败必须给用户可见提示（app.ts:154-166 已经这么做，且用 quotaWarned 保证只弹一次）。改版若增加大字段需重新评估。
- **日期与周边界口径**：toISODate 用本地时区（time.ts:27-29），全项目的"今天"都是本地日期；weekStart 以周一为起点（weekRules.ts:14-19）；训练日固定为周一/三/五（planRules.ts:19 TRAINING_WEEKDAYS）。跨时区与夏令时的行为不能随意改。
## 改版接缝
- **主题是干净的接缝**：对外只有 applyTheme() 与 setTheme(pref) 两个接口，偏好三态 system|light|dark 不动。换肤只需重写 applyTheme 内部把偏好映射到 CSS 变量/类名（注意 dataset.theme 是与 index.html 共享的契约，见 constraints）。
- **通知系统已完全解耦**：showToast / dismissToast / store.toasts 三个接口 + 只有 6 行的 ToastRegion.vue。换一套通知组件（栈式/内联/banner）完全不影响任何业务代码。
- **折叠状态是纯 id 字符串集合**：collapsedCards + toggleCard(id) / isCardCollapsed(id)，与卡片外观完全无关（InsightCard 只用 cardId prop）。卡片外观可任意重做，只需保留 card-id 字符串。
- **AI 草稿弹窗是自包含的**：PlanDraftDialog.vue（461 行）只读 store.planDraftState，store 不含任何弹窗逻辑。整块换掉弹窗 UI 不用碰 store。
- **模式切换预览是纯数据对象**：switchPreview 返回 {from, to, fromLabel, toLabel, differences[], keeps[], openPlanCount, openPlanNote}，不含任何 DOM。确认弹窗可以整块重写 —— 前提是先把 differences/keeps/openPlanNote 里的中文文案从 store 挪到视图层或文案表（这是当前唯一挡住该接缝的东西）。
- **services/ 层是完全独立的**：src/services/* 下 11 个文件全是纯函数、零 store 依赖、零 DOM 依赖（foodComposition/mealRules/planRules/weekRules/loadRules/profileRules/exercises/llm/wellnessCards/foodRecognition/mealPhotos）。改版换皮换布局时可以整体不动，也不用担心它们被 store 的重构波及。
- **domain.ts 的类型是纯数据契约**：无方法、无类、无行为。可以自由增加可选字段（Meal.uncertain / MealItem.modelEnergy / EnergyEstimateRef.gramsPerUnit 都是这么加的），但**改名字或改嵌套层级等于改持久化格式**。
- **必须先解耦再动的四处**：① 持久化的四份手抄 schema（persistState / init / clearAllData / SettingsView.payload）—— 改版必然要动持久化，必须先抽成统一的 serialize/deserialize/clear 三函数或换用持久化插件；② switchPreview 里的中文文案（store 里写 UI 文案）；③ dayPlanNotice 的「存档 items + 实时 conflicts」混合契约 —— 界面重排时无法判断该信哪个；④ store 对 DOM 的直接操作（applyTheme 写 dataset.theme、showToast 的 setTimeout、matchMedia 监听器不卸载）。
- **可补齐的现成 seam**：store 缺 updateMeal/replaceMeal（MealsView.vue:519 只好直接写 store.meals），补上后编辑一顿饭的流程可以整体重写；store 没有暴露「本周汇总」口径（buildWeeklyReport 被 3 个 view 各调一次，DashboardView.vue:334 / PlanView.vue:290 / ReportView.vue:172），收进 store 就能消掉三份重复取数；「当前参考日」在 5 个 view 里各 new Date() 一次（DashboardView:292 / MealsView:265 / PlanView:187 / ReportView:152 / TopBar:94），提升到 store 或路由 query 后，加「回看某天」类功能才不会各页各算。
- **planHistory 是 UI 的一等公民（PlanView.vue:156-163 的版本列表）**：改版若要折叠/隐藏历史，得先给 planHistory 加上限或去重策略，否则它会持续撑爆 localStorage（每勾一次复选框就多一份完整快照，app.ts:595）。

# 周报与负荷/恢复分析子系统（ReportView + weekRules + loadRules + wellnessCards）
## 职责
把本机记录（训练 session / 餐食 meal）按「周一为周首」聚合成一份可回看的周报，并给运动员模式提供负荷-恢复判定。职责分三层且界限清楚：(1) `src/services/weekRules.ts` 是周报取数层，按周一为起点聚合一周，产出 `WeekSummary`（计划场次 / 有记录场次 / 总时长 / 总负荷 AU / 逐日负荷 / 餐食类别覆盖 / 数据质量说明），核心口径是「没记录 ≠ 0」「缺 RPE 不进合计」；(2) `src/services/loadRules.ts` 是运动员模式的负荷序列层，产出 28 天 `LoadPoint` 序列（load/rest/missing/unknown 四态）、CTL/ATL/ACWR、强度分布（低/高/未归类时长占比）与 ACWR 分档；(3) `src/services/wellnessCards.ts` 是首页「今日养生」每日科普卡的内容层，15 张卡的文案与按日期的稳定取卡规则。`src/views/ReportView.vue` 只负责把这些数据渲染成周报界面（指标条 + 每日负荷柱图 + 餐食类别点阵 + 训练明细账本 + 数据质量卡），**不含任何统计口径**——改界面时这些服务层必须原样保留。
## 关键组件
- 顶部抬头 .lede（ReportView.vue:3-14）：左「micro kick + h1（日期范围 + 第 N 周 small）+ 一句口径说明」，右 .weeknav 三个按钮（上一周 ChevronLeft / 本周 / 下一周 ChevronRight，当前周时下一周 disabled）。周切换只改 refDate，所有区块随之重算。
- StatStrip 指标条（ReportView.vue:16，179-210）：四格「计划场次 / 有记录场次 / 总时长 / 训练负荷」，每格是「label + 数字 + 单位 + hint 说明」，第三格固定 min、第四格固定 AU。数据源为 buildWeeklyReport 的 WeekSummary。
- 安全提示条 .safety（ReportView.vue:18-20）：仅当 report.blockedByDiscomfort 为真时出现，说明「本周有训练报了不适：自动加量建议已停止」，左侧 3px 强调色内阴影 + caution 底色。
- 每日负荷卡（ReportView.vue:24-49）：BaseCard variant="flush"，表头「micro Load by day + h2 每日负荷」+ 右侧三色图例（已计算实心 / 缺 RPE 斜纹 / 未记录空心）；主体是纯 div 的 .plot（7 列 .col，每列上方数字 + 下方 .bar），下面一排 .days 星期标签（今天高亮、计划日加圆点），底部 .axis-note 说明圆点含义。
- 餐食结构卡（ReportView.vue:51-74）：BaseCard variant="flush"，表头「micro Meals + h2 餐食结构」+ 右侧 .chip 显示「N 条记录 / 未记录」；主体 .matrix 是 2 列 × 4 行的点阵，每行 = 类别名 + 4 个点（按相对次数填充）+ 次数；底部 .mx-foot 列出「本周没出现过」的类别标签，.axis-note 声明「出现次数按记录条目累计，不代表分量或营养摄入量」。
- 训练账本卡（ReportView.vue:78-117）：BaseCard variant="flush"，表头「micro Sessions + h2 本周训练记录（N 条 · 按时间）」+ 右侧说明「RPE 为自评，空着就是不填」；主体是 .table-wrap 包裹的 7 列表格（日期/动作/时长/次数·组/RPE/负荷/状态），状态列用 StatusBadge（success/warning/neutral）；无记录时是 .empty 空态 + 两个跳转按钮（去跟练 / 记一餐）。
- 数据质量 InsightCard（ReportView.vue:119-125）：card-id="report-quality"、eyebrow="DATA QUALITY"、title="这份报告没说的三件事"、tone="ink"；内容是 report.dataQuality 的 <ul>，末尾附 ruleVersion 与本机数据条数说明。收起状态由 InsightCard 写 store.collapsedCards。
- 页脚 .footnote（ReportView.vue:127-130）：左侧「负荷为自评口径（RPE × 时长），只用于自己和自己比」，右侧 ruleVersion。
- （同族组件，供改版参照/复用）LoadChart.vue：首页运动员模式的 SVG 28 天负荷曲线 + CTL/ATL 均线 + ACWR 刻度带 + 样本不足提示。
- （同族组件，供改版参照/复用）DailyWellnessCard.vue：今日养生卡的可折叠详情版式（正文 + 要点 + 右侧运动员补充 + 来源 + 免责声明）。
## UI 模式
- 骨架：单列 .page（max-width 变参 --content-max-width）自上而下 —— 抬头 → StatStrip → 条件安全条 → 双图区 .charts（grid 1.22fr 1fr）→ 账本表 → InsightCard → 页脚。左右分栏只发生在「双图区」和 StatStrip 内部。
- 卡片：全部 BaseCard variant="flush"（内距归零，表头与行分隔由页面自己画），卡片之间只有 14px 间距、1px 发丝线边框、无投影，靠「纸面 + 发丝线」而不是「浮起」分层。
- 数字优先：--font-num（Bahnschrift）+ tabular-nums；.micro 小标签 10px / 字距 .17em / 全大写；h1 用 38px 负字距；量与名分层明显。
- 状态呈现三重冗余（不靠颜色单独承载）：负荷三态 = 渐变实心（已计算）/ 45° repeating-linear-gradient 斜纹（缺 RPE）/ 仅 inset 描边（未记录）/ 强调色描边（今天且无数据）；类别出现次数用 4 点相对档位点阵而非长条；完成状态用 StatusBadge 的圆点形状 + 语义色双通道。
- 文案口径层：几乎每个数字都配一句「这条数据说了什么 / 没说什么」（StatStrip 的 hint、图表下方的 .axis-note、.micro + h2 双层标题），是这套页面的主要表达手段，不只是装饰。
- 交互：上一周 / 本周 / 下一周按钮组（下一周在当前周 disabled，opacity 0.4 + not-allowed）；InsightCard 收起/展开（aria-expanded + ChevronDown 翻转）；空态里两个 BaseButton 跳转（/execution、/meals）。
- 空态：账本无记录时给「这一周还没有训练记录。负荷图保持空白，而不是画成 0。」+ 两个 CTA；数值缺失一律显示「—」而不是 0（ReportView.vue:39、96-99、184、203）。
- 响应式：1099px 时 .charts 变单列、StatStrip 变 2×2（并补第三条上边线）；767px 时抬头纵排、padding 20→14px、表格横向滚动（min-width 720px + .table-wrap overflow-x:auto）。
- 无 loading / 无骨架屏 / 无错误态：所有数据来自本地 store 的同步 computed，不存在异步态；也没有「规则不可用」的兜底 UI。
- 动效：ReportView 自身没有入场动画类（DashboardView 用 animate-fade-in / animate-slide-in-up），页面切换动画在 AppShell 的 <Transition name="page">；全局 animations.css 对 prefers-reduced-motion 做了全量降级。
## 样式写法
纯 CSS，全部 <style scoped>，没有预处理器、CSS-in-JS 或 Tailwind。设计系统是「CSS 变量令牌 + 全局工具类 + 少量共用组件」三层：令牌在 src/styles/tokens.css（颜色/字号/圆角/间距/阴影/动效/双主题 html[data-theme="dark"] 整组覆盖），全局工具类在 globals.css（.micro 10px+.17em 字距、.num 等宽数字、.container、.hairline、.visually-hidden），组件层是 BaseCard/BaseButton/StatusBadge/StatStrip/InsightCard。ReportView 的换皮应当优先只动 tokens.css 与 scoped 里的 CSS，不动模板。\n\n但「重复的自定义样式」很多，且没有收敛：\n1) .chip 在 ReportView.vue:321-327 与 DashboardView.vue:579-584 各写一份（结构近似但实现不同）；\n2) 逐日负荷柱 .bar/.plot 与 .bars 在 ReportView.vue:329-337 和 DashboardView.vue:652-661 各写一份，几乎逐行重复（同样的 4 段式渐变 + 斜纹 + 今天描边），只是高度 132/96px、gap 12/10px 不同；\n3) 标签胶囊 .tags/.mx-foot .tags 在 ReportView.vue:365、DailyWellnessCard.vue:269、DashboardView.vue:681 各写一份；\n4) tokens.css 里定义了 --space-1..16、--radius-*、--font-size-*，但 ReportView 大量使用裸 px（padding 20px、font-size 11.5px、border-radius 2px、max-width 34px），令牌体系只被用了一半；\n5) 硬编码颜色绕过令牌：ReportView.vue:331 与 DashboardView.vue:654 的柱渐变写死 #12857c→#0c655e（深色主题下 --color-accent 已变成 #3ec9b6，柱色不跟着变，且与同页图例 .sw.solid 用 var(--color-accent) 对不上）；LoadChart.vue:233 的 var(--color-caution-soft, #f6ecd8) 是永远不会触发的 fallback；\n6) 断点用裸 px（1099px / 767px）散落在各组件，tokens.css 里的 --breakpoint-sm/md/lg/xl 没有任何地方使用（CSS 媒体查询不支持变量）；\n7) 表格样式（th/td/td.num/td.d/td.name）只在 ReportView 的 scoped 里存在，别处无法复用；\n8) globals.css 的 h1/h2 全局字号（36px/32px）与 .lede h1（38px）局部覆盖并存，改主题时容易打架。
## 数据流
单向：localStorage('twopoles_state') → store.init() 解析 → store.sessions / store.meals / store.userProfile / store.currentMode（Pinia setup store）→ ReportView 的 computed → 模板。全程没有 props/emits（报告页是路由级页面，不复用），没有 watch，没有网络请求，没有 store action 被调用（唯一的写入是 InsightCard 内部的 store.toggleCard('report-quality') 与 router.push）。\n\n具体三条取数支路：\n1) 周报主体：report = buildWeeklyReport(store.sessions, store.meals, refDate, { profile: store.userProfile, mode: store.currentMode }) → WeekSummary，驱动 StatStrip、数据质量卡、餐食矩阵。\n2) 逐日负荷：dayStates 在 ReportView 内部**自己**再算一遍（store.sessions.filter(s => s.date === iso) → loadOf 逐条），没有复用 report.loadByDay；sessions 明细表也是 ReportView 自己 filter + sort。\n3) 餐食类别：report.categoryCoverage（服务端按「餐内条目数」累计，不是按餐数、不按份量）→ 页面再算 4 档相对点阵与「本周没出现过」列表。\n\n写入侧：ReportView 自身不写数据；周切换只改本地 ref refDate（不落盘）。所有持久化都是 store.persistState() 写 localStorage 'twopoles_state'（含 sessions/meals/profile/collapsed/theme/plans/planHistory/modeLog/unitGrams）。
## 状态模型
周报本身没有显式状态机，全部是 refDate（当前查看的周）派生的 computed：refDate → weekStart → days → report/dayStates/sessions/stats/categoryRows/missingCats。唯一的显式枚举/状态来自服务层：\n1) LoadDayState = 'load' | 'rest' | 'missing' | 'unknown'（loadRules.ts:12）：load=当天有训练且全部带 RPE；rest=首条记录之后但当天无记录（负荷记 0，参与平均）；missing=有记录但缺 RPE（整天剔除，不按 0 补齐）；unknown=早于首条记录（既不是 0 也不是缺失，不参与平均）。周报层没有这套四态，只用 number | null 两值，null 同时代表「没记录」和「缺 RPE」两种情况。\n2) LoadZone = 'low' | 'optimal' | 'high' | 'veryHigh' | 'unknown'（loadRules.ts:142），边界 <0.8 / ≤1.3 / ≤1.5 / >1.5，unknown 表示样本不足或非有限值。\n3) TrainingSession.completionStatus = 'completed' | 'partial' | 'skipped'（domain.ts:173），ReportView 用 statusText() 翻成「完成/部分/跳过」。\n4) Meal.completeness = 'complete' | 'partial' | 'unknown'（mealRules.ts:155-158）。\n5) nullable 语义是这套系统的核心状态：totalLoad 可为 null（本周没有任何带 RPE 的记录）、completionRate 可为 null（本周无安排，不计算完成率）、lowShare/highShare 可为 null（没有可归类时长）、acwr 可为 null（覆盖不足 14 天）。UI 约定：null 一律显示「—」或「样本不足」，绝不显示 0。\n6) ReportView 内部另有一个三态视觉编码（zero / hatch / today），由 day.load === null 与 day.hasSession 两个布尔量临时推出，不是服务层状态（详见 designDebt）。
## 耦合
跨文件 import：ReportView → weekRules（WEEK_LABELS, buildWeeklyReport, loadOf, weekDates, weekStart）、mealRules（FOOD_CATEGORIES）、utils/time（toISODate）、stores/app、components/common/{BaseCard,BaseButton,StatusBadge,StatStrip,InsightCard}、lucide-vue-next 图标。\n服务层依赖链：loadRules.ts:10 从 weekRules.ts import loadOf —— 底层（负荷序列）反向依赖上层（周报聚合），是层级倒置；weekRules.ts:4 从 planRules import isPlanDay（计划规则）→ planRules → exercises（动作库）。\n共享 store 字段：sessions / meals / userProfile / currentMode（周报与负荷的唯一数据源）、collapsedCards（InsightCard 收起状态，跨页共享，card-id 字符串是隐式契约：'report-quality' / 'meal-rules'）。\n共享类型：types/domain.ts 的 TrainingSession / Meal / FoodCategory / WeeklyReport 被服务层与视图层共用；StatItem 类型从 StatStrip.vue 的普通 <script> 块导出供 ReportView/MealsView import。\n跨视图耦合：DashboardView 与 ReportView 共享 buildWeeklyReport / weekStart / WEEK_LABELS 且各自实现一份逐日负荷柱图与一份 ISO 周数算法；PlanView.vue:182 也 import 了 weekDates/weekStart/buildWeeklyReport（用于周期阶段负荷对比）。weekRules 的 ruleVersion 串了两套版本号（report-rules-v2 / diet-rules-v2），改任一套规则都会改到周报的版本标识。\nwellnessCards.ts 与周报子系统无耦合，仅共享 store.isAthleteMode（DailyWellnessCard 读取）。
## 设计债
- ReportView.vue:226 `planned: [1, 3, 5].includes(d.getDay())` 把「计划训练日」写死为周一/三/五，但同页 ReportView.vue:48 的轴注写的是「圆点＝按你当前档案过滤后、该日计划应训练的日子」，而真实口径在 weekRules.ts:71 用 `isPlanDay(d, profile, mode)`（受年龄门槛 18 岁、场地、器材、限制影响）。未满 18 岁或档案过滤掉某天时，图上的圆点与 StatStrip 的「计划场次」会互相矛盾。修法：直接调 isPlanDay(d, store.userProfile, store.currentMode)。
- ReportView.vue:219-227 的 dayStates 重新实现了一遍 weekRules.ts:62-69 的逐日负荷规则（当天任一条缺 RPE 则整天 null）。WeekSummary 里已有 loadByDay（weekRules.ts:106）却被完全忽略 —— 同一口径两份实现，改一边必然漂移。
- ReportView.vue:239-242 的 barClass 依赖 day.hasSession 才能区分「没记录（空心）」与「缺 RPE（斜纹）」，而 hasSession 是页面自己 filter 出来的，不是 report 对象的一部分。也就是说周报数据层已经把两种「null」压平了，UI 再反推一次 —— 换皮时如果只接 report.loadByDay，斜纹与空心就区分不出来，必须先把这个区分提升为服务层字段或纯函数。
- ReportView.vue:164-170 与 DashboardView.vue:343-349 逐字重复同一段 7 行 ISO 周数算法（UTC 归一 + 移到当周周四 + 与年初差除 7）。应提到 utils/time.ts 的 isoWeekNo()，否则改周口径要改两处。
- DashboardView.vue:335-342 又手写了一份 weekDates（weekRules.ts:21 已导出并被 PlanView 使用）。ReportView.vue:261 和 PlanView.vue:187 各自又写了一份周一序的星期名数组 ['一','二',...]（weekRules.WEEK_LABELS 已存在）。三处重复。
- 负荷刻度下限 120 出现两处且算法不同：ReportView.vue:229 `Math.max(120, ...dayStates.map(d => d.load ?? 0))`（不取整档），LoadChart.vue:102-105 `Math.max(120, Math.ceil(peak / 60) * 60)`（按 60 取档）。同一个「120 AU 下限」在周报柱图和首页曲线里的视觉含义不一致。
- ReportView.vue:230 `const PLOT_H = 132` 与 CSS 完全脱钩：`.plot { height: 158px }`（第 329 行）、移动端 `.plot { height: 138px }`（第 405 行）。最坏情况 132(柱) + 6(gap) + ~17(数字标签) ≈ 155px，而移动端绘图区内容高只有 138-12-1 = 125px → 最高的柱子和它的数值标签会溢出绘图区约 30px，压到卡片表头上。换图表前必须把柱高改成按容器尺寸计算或改成 SVG viewBox。
- ReportView.vue:184-196 的 StatStrip 文案与数据口径不符：标签写「计划场次」「有记录场次」且单位写「场」，但 r.plannedSessions 实际是 plannedDays.length（天数，weekRules.ts:114）、r.completedSessions 实际是有记录的去重日期数（weekRules.ts:102）。同一天记两条训练时 completedSessions 仍是 1，完成率也因此按「天」算而不是按「场」算。
- weekRules.ts:72 的 completedDates 取的是「有任意 session 的去重日期」，不含 completionStatus 过滤 —— 标记为 'skipped' 的训练也算「有记录」，进而计入完成率分子。StatStrip 的 hint 写「完成率 X% · 未记录不计入分母」（ReportView.vue:192）没错，但「跳过算完成」这件事界面上没有任何说明。
- weekRules.ts:98 `userId: sessions[0]?.userId ?? 'demo-user'` 取的是**传入全量数组**的第一条 session，而不是本周内的第一条；多用户/多周数据下报表归属会错位。
- weekRules.ts:103 totalDuration 把缺 RPE 的训练时长也计入，但 totalLoad 不计入 → 同一张报表里「总时长」与「总负荷」的覆盖范围不同，而 ReportView.vue:199 的 hint 只写「来自实际记录，不含估算」，没有说明两者口径不一致。
- ReportView.vue:247-256 把 `FOOD_CATEGORIES.slice(0, 8)` 写死两处，FOOD_CATEGORIES 实际有 10 类（第 9、10 类「油脂类」「其他」永远不进矩阵、也永远不出现在「本周没出现过」里）。这个「8」与 README.md:165 的「8 类食物出现次数」硬绑定，加类别要同时改三处。
- ReportView.vue:249 的 `max` 在 .map 内部计算 —— 每个类别行都重算一次全表最大值（8 次重复计算），应提到 computed 外层。
- ReportView.vue:250 的 `level = Math.max(1, Math.round((count / max) * 4))` 与同一行的 `count` 是两套数，4 点相对档位没有图例说明「点阵=相对次数」，count 又单独显示一次，信息重复且读者需要自己把点阵换算回次数。
## 约束
- 负荷定义不可改：单次 load = Math.round(actualDuration × rpe)，rpe 为 null 或时长缺失一律返回 null（weekRules.ts:30-33）。不能改成「缺 RPE 记 0」「缺 RPE 用平均时长补齐」或换成 TRIMP 等其他公式 —— 界面上的 AU 数字含义必须与此一致。
- 天级聚合规则：当天的训练中只要有一条缺 RPE，整天负荷为 null（weekRules.ts:66-67、loadRules.ts:104-106）。两处必须保持同一判断，否则周报与首页曲线会互相打脸。
- 合计口径：totalLoad 只累加有完整 RPE 的天，缺的天不进合计，并在 dataQuality 里说明覆盖天数与「不按 0 补齐」（weekRules.ts:74-75、88）。周报里任何「总负荷」都不能改成含缺失天的估计值。
- ACWR 定义：近 7 天平均负荷 ÷ 近 28 天平均负荷；CTL 分母包含休息日（负荷 0），missing / unknown 天从窗口剔除；覆盖天数 < 14 天或 CTL ≤ 0 时返回 null，不给假数字（loadRules.ts:112-127）。样本不足必须显示「还需 N 天」而不是 0。
- 取整顺序：均值先用原始值算，比值用原始值算完再取整（r1/r2 只在最后一步，loadRules.ts:64-67、116-117）。任何「先取整再相除」的重构都会让 1.49 变成 1.5 并落错档 —— selfcheck.ts:380 断言 ACWR 恰好等于 1.00。
- ACWR 分档边界不可挪动：<0.8 low、≤1.3 optimal、≤1.5 high、>1.5 veryHigh、null/非有限 unknown（loadRules.ts:144-150），selfcheck.ts:392-398 逐条断言。LOAD_ZONE_TEXT 的文案与档位一一对应。
- 强度分布按 RPE ≥ 7（threshold 默认 7）分低/高两段，用时长不用次数；未记 RPE 的时长单列（unknownMinutes），不塞进任何一侧；可归类时长为 0 时 lowShare/highShare 必须是 null（loadRules.ts:178-203）。
- 「还没开始用」≠ 0：首条记录之前的天是 unknown，既不参与 CTL/ATL 均值也不画成 0（loadRules.ts:96-100）。新用户第一天不能被算成重度减量。
- 周起始为周一（weekRules.ts:14-19），WEEK_LABELS 是周一序的 ['一'…'日']；若改周起始，所有 `(d.getDay() + 6) % 7` 的换算（ReportView.vue:261、DashboardView.vue:459 等）必须同步。
- 完成率口径：无安排（plannedDays 为空）时不计算，必须为 null 而不是 0；未记录不计入分母（weekRules.ts:90-94、117）。
- 安全闸：本周任一天 discomfort 为真 → blockedByDiscomfort 为 true（weekRules.ts:118），ReportView 据此显示「自动加量建议已停止」提示（ReportView.vue:18-20）。这条提示不能被新设计静默丢掉。
- 数据只存本机浏览器（localStorage 'twopoles_state'，stores/app.ts:105、151），无账号、无后端、无网络请求。周报界面上的「数据只存本机浏览器」说明（ReportView.vue:124）属于产品承诺，不能在改版中删掉或弱化。
- 餐食类别覆盖统计的是「记录条目数」，不是餐数、不是份量、不是营养摄入量（weekRules.ts:78-81）。界面上必须保留这一句限定说明（ReportView.vue:73）。
- wellnessCards：同一天多次调用必须返回同一条且跨时刻稳定、健身/饮食按日交替、相邻两天不同、连续 16 天 16 个不同 id（selfcheck.ts:331-336）；dayIndex 必须用本地日历分量经 Date.UTC 构造，不能换成 toISOString()（会在时区边界跨日，wellnessCards.ts:538-541 的注释明确警告）；来源名不得编造论文页码或外链；免责声明文案固定（WELLNESS_DISCLAIMER）；每卡 detail 2–4 段、points 2–4 条、tags 2–4 个、athlete 三段齐全（selfcheck.ts:315-324）。
## 改版接缝
- 【可整块换掉、不动逻辑】buildWeeklyReport / buildLoadSeries / loadZone / intensitySplit / loadOf / weekStart / weekDates / pickDailyWellnessCard 全部是纯函数，输入输出都是纯数据，视图层可以完全重写而不碰它们。
- 【可整块换掉】StatStrip 的 StatItem（label/value/unit/hint/tone）就是为「换皮不换算」设计的展示契约 —— 只要重写 StatStrip 内部样式或结构，ReportView 的 stats computed 一行都不用动；反过来若要改指标结构，ReportView.vue:179-210 的 stats 数组也要跟着改。
- 【可整块换掉】InsightCard 的 props（cardId/eyebrow/title/tone）+ icon/content 两个 slot + 内部 store.collapsedCards 收起逻辑，是洞察卡的完整边界。ReportView.vue:119-125 只用了 8 行，换皮时保留 card-id="report-quality" 即可保住持久化与 aria-expanded。
- 【可整块换掉】BaseCard 的 variant（default/flush/ink）+ --card-pad 变量已经承担了「表面系统」的职责；ReportView 三张卡都用 flush，重排时只需换内部结构，不必碰卡片外观。
- 【可整块换掉】ReportView 的三个内容区（每日负荷卡、餐食结构卡、训练账本卡）各自有独立边界：BaseCard 包壳 + .card-head（micro + h2 + 右侧 slot）+ role="img"/aria-label 的主体 + .axis-note 脚注。这四段可以分别替换成完全不同的视觉（SVG 折线、堆叠条、卡片流、时间轴），不影响其他区块。
- 【可整块换掉】wellnessCards.ts（内容 + 类型 + 取卡函数）与 DailyWellnessCard.vue（呈现）已经分离；DailyWellnessCard 可以整块重写而不动文案，取卡规则（每日稳定、类别交替）不动即可。
- 【可整块换掉】周切换交互（shiftWeek/goToday/refDate）纯本地，refDate 是唯一的 ref；把翻页改成下拉、滑动或分段控件都不影响任何计算，只要仍然驱动 refDate。
- 【必须先解耦再换皮 1】逐日负荷的状态编码与几何混在 view 里：dayStates（数据）+ barPx（像素高度）+ barClass（zero/hatch/today 三态）是三件事。应先抽出一个纯函数 dayState(day) → 'load'|'missing'|'none'|'today'（数据层）与一个 dayMeta（数值/单位/轴标签），再让渲染层只消费它们；否则换 SVG / Canvas 时会连带复制一份口径。
- 【必须先解耦再换皮 2】weekRules.ts:84-95 的 dataQuality 是整段中文字符串。要让新界面按「缺 RPE / 计划差 / 餐食未记录」分栏展示，必须把服务层改成返回结构化条目（如 { kind: 'rpe-missing' | 'coverage' | 'meals', text }），或至少保留原文并另加机器可读的 kind；否则 UI 只能整段丢进一个 <li>。
- 【必须先解耦再换皮 3】stats 的取数与文案写在一起（ReportView.vue:179-210）。建议拆成「从 WeekSummary 取值」与「值 → 呈现（单位/文案/tone）」两步；改版常常要同时改文案和布局，混在一起会让两边互相绊住。
- 【必须先解耦再换皮 4】柱高与容器尺寸的耦合（PLOT_H=132 vs CSS 158/138）。换成 SVG 时应改用 viewBox + preserveAspectRatio 或百分比高度；换成别的图表（如折线、热力图）时这个常量直接作废，但前提是先把它从 CSS 里解耦。
- 【必须先解耦再换皮 5】planned 圆点必须改成调用 isPlanDay(d, store.userProfile, store.currentMode)（或直接消费 report.plannedDays），否则档案一变圆点就与「计划场次」打架 —— 这是数据正确性，不是样式问题，必须在换皮前修。
- 【必须先解耦再换皮 6】周数算法与 weekDates/星期名数组应先收敛到 utils/time.ts 或 weekRules.ts 的单一实现（现在 ReportView、DashboardView、PlanView 各有一份），再重排周导航 UI；否则周标签与周号会各说各话。
- 【半成品/待决策】周报页没有任何模式分支，而 DashboardView 有完整的 isAthlete 分支、交付说明.md:733 把「周报两套图表」明确列为下一轮待做。大改版时应在这里明确二选一：补齐运动员版周报（可直接复用 loadRules + LoadChart），或把周报定义成模式中立的「事实报告」并在文案里说明。
## 职责
设置页承担四件事：(1) 切换「自主/监督」使用方式，切换前用 `switchPreview` 给出「会变化 / 保持不变」的双栏对照并要求二次确认；(2) 配置大模型接入——用户可填自己的 OpenAI 兼容接口（base_url / 模型名 / API Key），或选择使用服务端内置默认模型；(3) 管理隐私与外观偏好——摄像头开关、本地留存视频、能量估算展示、食物照片本地留存、数据保留天数、导出格式、主题（system/light/dark）；(4) 管理本机数据——统计概览、导出 JSON/CSV、以及两步确认的「清除全部数据」。同时它是整个 LLM 能力的配置中枢：`llmConfig`（用户自填）与 `llmDefault`（服务端默认）两套来源在此汇合，决定了「计划生成」和「食物识别」两条 AI 链路是否可用；`src/services/llm.ts` 是这两条链路共用的配置持久化 + 提示词构造 + 响应校验 + 代理调用层；`.env.example` 定义了服务端默认模型的注入方式。API Key 的安全边界是本子系统的核心设计：用户自己的 Key 存在独立 localStorage 键 `twopoles_llm` 中（绝不随 `twopoles_state` 导出），服务端的默认 Key 只存在于 Node 侧，浏览器只能通过 `GET /api/llm/status` 拿到 `{available, model}` 两个字段。降级策略是分层的：自填接口 → 服务端默认模型 → 纯本地规则（`planRules` 内置计划 / 餐食手工录入），识别失败再降级到本地 EfficientDet-Lite0。数据导入导出方面只实现了「导出」——JSON（完整业务数据）与 CSV（训练/餐食/计划三合一），仓库中不存在任何导入/恢复代码路径。
## 关键组件
- 页头 .page-head：左侧 eyebrow「设置 / SETTINGS」+ h1「设置」+ 说明段落，右侧 StatusBadge 显示「已建档 / 未建档」
- 「使用方式」BaseCard：两枚 .choice 大按钮（自主 / 监督）构成单选卡组，选中后展开 .switch-confirm 双栏面板（左「会变化」右「保持不变」，数据来自 store.switchPreview），底部 .row-line 展示当前档案摘要并给 RouterLink 到 /onboarding
- 「模型接入」BaseCard：.llm-head 行（h2 + 副标题 + StatusBadge llmBadge）；.llm-default 段落展示服务端默认模型名与可用性；.llm-pick 两按钮偏好组（用我的接口 / 用内置模型）+ .llm-pick-note 解释回退行为
- 模型表单：.fields 两列布局，base_url 输入、模型名输入、API Key 输入（type=password），.actions 行放「保存配置」「测试连接」两个 BaseButton，右侧 .llm-msg 内联状态文本（llmMsg / llmMsgBad）
- 「隐私」BaseCard：4 个手写 .toggle 开关（摄像头、本地留存视频、显示能量估算、本地留存食物照片）+ 保留天数 number 输入（min=7 max=3650）+ 导出格式 .chips（JSON / CSV）
- 「外观」BaseCard：主题 .chips 三选（跟随系统 / 浅色 / 深色）+ 一行系统当前主题说明（systemDark 文案）
- 「我的数据」BaseCard：.stats 四格统计（训练次数 / 餐食条数 / 计划条数 / 占用空间 KB），两个导出 BaseButton（JSON / CSV），exportError 错误段落
- 「清除全部数据」BaseCard.danger：两段式确认，首击变文案 + 出现第二个「确认清除」按钮，confirming 状态控制
- 页脚一行：版本 {{ RULE_VERSION }}（当前值 'diet-rules-v2'，实为餐食规则版本，不是应用版本号）
- 抽屉/弹层（不在本页但同一子系统）：PlanDraftDialog 承载计划草稿的 questions/ready 状态机；FoodCaptureDialog 承载云端识别与本地识别两条路径
## UI 模式
- 整体骨架：单列窄页 .page-wrap（max-width 860px）居中，页头 sticky 感觉的 flex 行（左标题右状态徽章），下面依次 6 张 BaseCard，视觉分隔靠卡片阴影与 --space-6 间距
- 分区模式：每张 BaseCard 内是「h2 标题 + .sub 副标题 + 内容」，无分隔线，靠间距分组；BaseCard 有 default/flush/ink 三种 variant 但本页全用 default
- 单选卡组模式：.choice 网格两张大按钮式卡片，.active 加边框与强调色，用 radio 语义但无真实 input[type=radio]
- 对照确认模式：.switch-confirm 双栏 diff（左 changes 红/右 keeps 绿），条目用 li 列表 + 前面的小圆点标记，底部「确认切换」行动按钮
- 分段控件模式：.llm-pick 两个按钮并排，active 用 .active 类，不是原生 radio group
- 表单元模式：.field 包裹 label + input，底部分隔线，placeholder 承担示例说明；API Key 用 type=password，无「显示/隐藏」切换
- 开关模式：自绘 .toggle（隐藏 checkbox + .tg 轨道 + 滑块），label 与说明文字同行，focus-visible 有描边；共 4 个，样式完全手写、无公共组件
- 芯片选择模式：.chip 圆角小标签按钮，active 用 .active 类 + 强调底色；共 2 组（导出格式、主题）
- 统计磁贴模式：.stats 四列网格，.stat 单元 = 数字（无单位大字号）+ 说明小字；与项目其它页的 StatStrip 发丝线风格不同
- 危险区模式：BaseCard.danger 变体 + 两步确认，第二次点击才显示真正动作
- 反馈模式混用：模型配置用内联 .llm-msg 文本（成功/失败两套 class），导出失败用 .exportError 段落，而项目其它地方用 store.showToast 弹层；保存配置同时既弹 Toast 又写 .llm-msg
- 空态/加载态：设置页基本没有骨架屏或加载态，仅「测试连接」期间禁用按钮并把文案改成「测试中…」
- 响应式：@media(max-width:767px) 把 .choices/.fields/.stats 降为 1-2 列、页头改纵向、按钮满宽；@media(max-width:560px) 再收窄开关列；断点全部硬编码，未用 tokens.css 里的 --breakpoint-*
## 样式写法
全站统一 `<style scoped>` + 裸 CSS（无 CSS 预处理器、无 CSS Modules），颜色/间距/圆角/动效令牌来自 src/styles/tokens.css 的自定义属性（--color-ink/--color-muted/--space-1..10/--radius-*/--motion-*/--easing-*/--shadow-*/--font-num），主题靠 html[data-theme] 覆盖同名字符实现。SettingsView.vue 第 412-483 行 72 行 scoped CSS 是一整套「自建 mini 设计系统」：.eyebrow（带 ::before 菱形）、.sub、.fine、.chip、.field、.actions、.stats/.stat、.toggle/.tg、.llm-*、.switch-confirm、.choice。问题是这套类名不是本项目独有的——.eyebrow 在 OnboardingView 与 PlanView 各写一遍（字面量几乎相同），.fine 三处字号不同（10.5/11/11.5px），.chip 三处定义（12px/13px/强调填充），.field 四处定义。字号没有走 --font-size-* 令牌（tokens.css 只有 --font-num 用于数字），圆角也自造了 13px/14px 等令牌表里不存在的值（令牌只有 6/8/10/12/16/999），而项目里 BaseButton/BaseCard 走的是令牌。关键冲突：BaseCard 的 padding 契约是 `var(--card-pad, var(--space-6))` 并在组件注释里写明「调用方要改内距请设置 --card-pad，不要和组件抢选择器优先级」，但 SettingsView 第 418 行 `.section{padding:22px}` 直接改了 BaseCard 根元素的内距——两者特异度相同（.card[data-v-x] 与 .section[data-v-y] 都是 0,2,0），最终胜负靠 CSS 注入顺序，属于脆弱覆盖。另有 `.actions :deep(button){width:auto;padding:0 20px}` 穿透 BaseButton 改盒模型，`.section`/`.eyebrow` 等类又与 BaseCard 的 variant 体系无关——说明「设置页」实质是一套脱离公共组件契约的私有视觉层。
## 数据流
数据来源分三层：(1) localStorage 键 `twopoles_state`——由 src/stores/app.ts 统一读写，内含 profile / mode / modeLog / sessions / meals / plans / planHistory / unitGrams / privacy / theme / collapsed；(2) localStorage 键 `twopoles_llm`——由 src/services/llm.ts 单独读写，只含 LlmConfig {baseUrl, apiKey, model, preference}，与 `twopoles_state` 物理隔离，导出时不会被带走；(3) IndexedDB `twopoles_meal_photos`（store 名 photos，v1）——存食物原图，localStorage 只留缩略图 photoThumb 与 photoId。设置页与 store 之间全部是单向读取 + 显式 action 写回：视图不直接碰 localStorage，只调 store.setLlmConfig / setLlmPreference / updatePrivacy / setTheme / clearAllData；表单侧用本地 ref `llmForm` 拷贝一份 store.llmConfig 作为编辑缓冲，保存/测试/切偏好三处各自手动 `llmForm.value = { ...store.llmConfig }` 回写同步。服务端方向：浏览器从不直连模型厂商，一律走同源 POST /api/llm/chat 与 GET /api/llm/status，由 vite.config.ts 的 llmProxy 插件在 dev/preview 期注入；真实部署需要自建后端承载同契约。导出方向：设置页把 store 里的 sessions/meals/plans/planHistory/unitGrams/privacy/profile/mode/modeLog 拼成 payload（meals 显式置 photoId: undefined，照片本体不导出），JSON 走 JSON.stringify(payload, null, 2) 下载 .json，CSV 走自建 toCsv() 拼 15 列（带 BOM ﻿ + CRLF）下载 .csv。导入方向：不存在——全仓库没有任何 parse/restore/import 代码，导出的 JSON 也无法回灌，因为 payload 结构与 `twopoles_state` 结构并不相同（payload 多 exportedAt、缺 theme/collapsed、meals 缺 photoId）。
## 状态模型
本子系统的状态是三组彼此独立、耦合很弱的模型：(1) 模型接入态：LlmPreference = 'custom' | 'default'，叠加 LlmConfig 字段完备性。三态派生 usingDefault(cfg) = preference==='default' || !isLlmReady(cfg)（注意 isLlmReady 只要求 baseUrl && model，不要求 apiKey），canUseLlm(cfg, fallback) = usingDefault ? fallback.available : (isLlmReady(cfg) || fallback.available)——即「用户声明优先、就绪度兜底」的双输入模型。设置页再自派生 llmBadge（内置模型/未配置/自己的接口/接口未填）四态文案。(2) 隐私偏好态：PrivacySettings 六个平铺字段，cameraEnabled / showEnergyEstimate / saveFoodPhotoLocally / exportFormat 已接线，saveVideoLocally 与 dataRetentionDays 是「已实现存储但无任何消费方」的空开关。(3) 主题态：ThemePreference = system|light|dark，store 监听 matchMedia('(prefers-color-scheme: dark)') 变化并 applyTheme，index.html 的内联预绘制脚本也读 twopoles_state.theme 提前打 data-theme 防闪烁——同一逻辑在两处实现。此外还有跨页共享的 PlanDraftState 状态机（status: idle|loading|questions|ready|error，loadingStage: questions|plan|null），它的类型定义在 src/services/llm.ts，迁移逻辑却在 src/stores/app.ts（generatePlanQuestions / generatePlanDraft / acceptPlanDraft），并用 planRequestId 做过期请求丢弃；设置页只负责把 llmConfig/llmDefault 喂进去，不直接操作该状态机。
## 耦合
跨文件耦合点：(1) 设置页 → store：只依赖 useAppStore() 暴露的 setLlmConfig / setLlmPreference / refreshLlmStatus / updatePrivacy / setTheme / clearAllData / switchPreview / llmConfig / llmDefault，页面本身不直接操作 localStorage，是干净的；(2) llm.ts → types/domain.ts：isLlmReady/usingDefault/canUseLlm 依赖 LlmConfig，但 llm.ts 内部又自建了一份 TRAINING_TYPES 常量（重复 domain.ts 的 TrainingType 联合类型），llm.ts 不 import domain.ts 的类型，白名单靠人工同步；(3) llm.ts → vite 代理：依赖 /api/llm/chat 与 /api/llm/status 这两个 URL 常量，调用方拿不到 vite.config.ts 里的实现，代理逻辑与前端逻辑双向耦合在同一个字段名 useDefault/baseUrl/apiKey/model 上；(4) llm.ts → weekRules/planRules/mealRules：计划草稿的校验 validatePlanDraft 依赖 RULE_VERSION 等规则版本，生成计划的降级路径依赖 planRules；(5) 视图间耦合：设置页的「使用方式」与 TopBar 的切换是同一业务动作的两套实现，TopBar 内嵌了一份 modes 常量和一份 switch 确认弹层（pop-cols/pop-lead/pop-actions 结构），设置页在页面内展开同一份 switchPreview 对照——同一条规则、两种交互、两个数据源（store.modes 与视图内 modes）；(6) 全局耦合：设置页的 .eyebrow/.fine/.chip/.field/.actions 等 scoped 样式在各 view 重复实现，是跨视图的隐性耦合（改一处不会联动另一处）；(7) BaseCard 的 --card-pad 变量契约是设计上预留的换肤接缝，但设置页用 .section{padding:22px} 绕过了它，实际耦合在 CSS 优先级上；(8) 隐私开关的数据契约在 types/domain.ts 的 PrivacySettings 与 store 里的默认对象两处重复定义（clearAllData 内又复制了一遍默认值），改一个字段要动三处。
## 设计债
- src/views/SettingsView.vue 第 455-458 行：`.stats` 四列网格（.stat 单元 = 数字 + 说明）与项目已有组件 src/components/common/StatStrip.vue 职责完全重复——StatStrip 的引入注释明确写着「替换掉之前每页各写一遍的四张等宽卡」，MealsView/ReportView 都已改用 StatStrip，唯独设置页仍留着手写的旧式四卡，数字也没有用 --font-num（Bahnschrift），与全站「数字用等宽表格字体」的设计原则不一致
- src/views/SettingsView.vue 第 418 行 `.section{padding:22px}` 直接覆盖 BaseCard 的 `padding: var(--card-pad, var(--space-6))`，而 BaseCard 源码里明写「内距走变量，调用方要改直接给 --card-pad，不必和组件抢选择器优先级」——这是被官方注释点名的坏味道；.card[data-v-x] 与 .section[data-v-y] 特异度相同(0,2,0)，胜负靠 CSS 注入顺序，属于随时会翻车的脆弱覆盖
- src/views/SettingsView.vue 第 460 行 `.actions :deep(button){width:auto;padding:0 20px}` 穿透进 BaseButton 的盒模型改内距，绕过 BaseButton 自己的 size 体系（sm/md/lg）；BaseButton 一旦调整内距或改用 flex 布局，这行会静默失效
- src/views/SettingsView.vue 第 415-417 行 `.eyebrow` 与 OnboardingView 第 441 行逐字节相同（含 ::before 菱形），PlanView 第 425 行的 .eyebrow 又是另一套；`.fine` 在三处字号分别 10.5/11/11.5px；`.chip` 在 SettingsView(12px)/OnboardingView(13px)/ExecutionView(强调填充) 三份定义；`.field` 在四处重复
- src/views/SettingsView.vue 第 294-307 行 `runTest()` 先执行 `store.setLlmConfig({ ...llmForm.value })`——「测试连接」会顺带把配置写入 localStorage（副作用），而且没有把 preference 切到 'custom'：当用户此前点过「用内置模型」（preference='default'）再填自填接口，测试走的是服务端默认模型而非用户刚填的 base_url，却照样显示「连接正常」，是明确的假阳性
- src/views/SettingsView.vue 第 269-282 行 `saveLlm()` 会在就绪时把 preference 强行改成 'custom'，即「保存」顺手改掉了用户显式选过的「用内置模型」偏好；preference 是用户可选项，却被保存动作当作派生值覆盖
- src/views/SettingsView.vue 第 258 行 `const llmForm = ref<LlmConfig>({ ...store.llmConfig })` 是 store.llmConfig 的第二份真相；第 270、287、295 行三处各自手写 `llmForm.value = { ...store.llmConfig }` 回同步，没有 watch 绑定，store 侧任何其它来源的变更（refreshLlmStatus 之后、或未来加的「从别处导入配置」）都不会回流到表单
- src/views/SettingsView.vue 第 262-264 行 `llmBadge` 在视图里第三次重推「当前用的是哪个模型」；同样的文案逻辑还散在 PlanDraftDialog.vue 的 modelLabel、FoodCaptureDialog.vue 的 cloudModelLabel、MealsView 的识别方式提示里，共四处各写一遍，规则一改要改四处
- src/services/llm.ts 第 39-52 行 `saveLlmConfig` 用 try/catch 把 localStorage.setItem 的失败完全吞掉，只留一行注释；设置页随后无条件弹「已保存」——在隐私模式或配额耗尽时用户会被告知保存成功，实际没存上
- src/services/llm.ts 第 23-37 行 `loadLlmConfig` 不做任何归一化，而第 39-52 行 `saveLlmConfig` 会 trim 掉 baseUrl 末尾斜杠与 apiKey/model 空白——读写不对称，读路径直接信任存储内容
- src/services/llm.ts 第 296 行 `desiredWeeklySessions` 的正则 `/([1-7])\s*(?:次|天)?/` 中 `(?:次|天)?` 是可选的，因此「每周 10 次」会先匹配到「1」而返回 1 次/周；用户自定义输入两位数时结果错误（选项只有 3-6 次才不出问题）
- src/services/llm.ts 第 287-303 行 `validatePlanQuestions` 先 `slice(0, 4)` 再用 `if (questions.length >= 3) break` 截断，实际上限是 3 但写得像 4；同一函数还把 `allowCustom` 硬编码为 true，模型自己返回的 allowCustom=false 被忽略
- src/services/llm.ts 第 58 行 `TRAINING_TYPES` 是一份手抄的 TrainingType 字符串数组（与 src/types/domain.ts 的 TrainingType 联合类型重复），改训练类型要同时改两处，漏改会让模型输出 planTypes 校验失败
- src/services/llm.ts 第 161-167 行的 WEEKDAY/weekdayOf 与 PlanDraftDialog.vue 内的 weekday()、src/utils/time.ts 的 WEEKDAYS_CN 是三份星期格式化实现
## 约束
- localStorage 键名不可改：`twopoles_state`（主数据，index.html 的预绘制主题脚本也读它）与 `twopoles_llm`（API 配置）被多处硬编码，迁移需要同时改 store、llm.ts、index.html 与 README
- LLM 走同源代理而非直连：`POST /api/llm/chat`（body：useDefault / baseUrl / apiKey / model / messages / temperature；返回：{text, model} 或 {error}）与 `GET /api/llm/status`（返回仅 {available, model}）。直连模型厂商会被 CORS 挡掉，url 形状不能改
- 上游契约：vite.config.ts 拼 `${baseUrl}/chat/completions`、带 `Authorization: Bearer`、非流式（stream:false）；base_url 必须以 http:// 或 https:// 开头，否则代理返回 400；末尾斜杠会被去掉
- 服务端默认 Key 绝不能进入前端：/api/llm/status 只能返回 {available, model} 两个字段，LLM_DEFAULT_* 只能通过 loadEnv 在 Node 侧读取，绝不能改成 VITE_ 前缀变量（那会打进前端 bundle）
- 代理请求体上限 6_000_000 字节（vite.config.ts readJson 的 limit），与食物图片 base64 内联发送耦合；上游超时 150s、客户端 120s，超时后必须 abort 上游（res.on('close') 联动 AbortController）
- 模型必须支持 OpenAI 的 image_url 消息格式才能做食物照片识别（.env.example 已写明「照片识别和计划生成共用这份配置」）
- 用户自己的 apiKey 会随每次 /api/llm/chat 请求体上传到本机/自建代理，代理必须原样透传给上游 Authorization 头——改传输层时不能顺手把 key 留在服务端或改成别的字段名
- 导出格式不可破坏：JSON 的字段名（exportedAt / profile / mode / modeLog / privacy / sessions / meals / plans / planHistory / unitGrams）与 CSV 的 15 列表头顺序、'﻿' BOM 前缀、CRLF 换行（Excel 中文不乱码依赖这个 BOM）
- 照片存储分层不可打破：缩略图 photoThumb 存 localStorage，原图存 IndexedDB(twopoles_meal_photos / photos / v1)，meal 上的 photoId 是唯一关联；导出时 photoId 必须置空（undefined 会被 JSON.stringify 丢弃）
- 负荷口径算法不可改：load = actualDuration × rpe，缺 RPE 或缺时长的记录不计入合计（src/services/weekRules.ts loadOf），周报与导出的数字必须一致
- 规则版本号会出现在用户可见的记录里（PLAN_VERSION=3、PLAN_RULES_VERSION='plan-rules-v3'、RULE_VERSION='diet-rules-v2'），改动需同步升级并保留旧记录的可读性
- 主题机制：html[data-theme] 属性 + 监听 matchMedia('(prefers-color-scheme: dark)')；index.html 里的预绘制脚本与 store.applyTheme 两处都要设置同一个属性，改主题时两处必须同步，否则刷新会闪白
- localStorage 约 5MB 配额：food photos 的 base64 缩略图很容易逼近上限，导出体积统计与任何新的本地持久化都要考虑配额
- dev/preview 服务器 host: true（监听 0.0.0.0），同网段可访问 /api/llm/chat，会消耗服务端默认 Key 额度；这是现存的暴露面，部署方案不能默认「只有本机能用」
## 改版接缝
- 【可直接整体替换的干净接缝】设置页六个区块（使用方式 / 模型接入 / 隐私 / 外观 / 我的数据 / 清除全部数据）是六张独立的 BaseCard，每张自带标题与内容，互不共享 DOM，可逐块换皮而不动逻辑
- 【可直接整体替换的干净接缝】store 暴露的 action 已经足够细：setLlmConfig / setLlmPreference / refreshLlmStatus / updatePrivacy / setTheme / clearAllData / switchPreview —— 新界面可以完全不碰 llm.ts 与 store 内部实现
- 【可直接整体替换的干净接缝】switchPreview 把「会变化 / 保持不变」两栏内容算成数据（differences / keeps 两个字符串数组），确认面板是纯数据驱动渲染，样式与文案可自由重写
- 【可直接整体替换的干净接缝】BaseCard 预留的 `--card-pad` 自定义属性是官方内距接缝，配合 variant（default/flush/ink）可以让新皮肤不改组件源码
- 【可直接整体替换的干净接缝】llm.ts 里的纯函数（isLlmReady / usingDefault / canUseLlm / buildPlanMessages / buildPlanQuestionMessages / validatePlanQuestions / validatePlanDraft / extractJson）无 DOM 与 store 依赖，可整体搬到新目录并被新面板直接调用
- 【可直接整体替换的干净接缝】导出三件套（payload computed / toCsv / download）虽然物理上在视图里，但全是纯数据变换，抽成 src/services/export.ts 后「数据管理」新页面可整体复用
- 【需先解耦再换皮】模型接入卡片：视图逻辑（llmForm 编辑缓冲、saveLlm / setPreference / runTest、llmMsg 内联反馈）与展示结构缠在一起，且 runTest 有写副作用、preference 被 saveLlm 派生覆盖。改版前应先把「表单状态」抽成独立 composable/useLlmForm，把「测试」改成不落库的纯探测，把 preference 变成用户显式可选而非派生量
- 【需先解耦再换皮】隐私卡片：四个开关的 label/说明/是否已接线全硬编码在模板里（saveVideoLocally、dataRetentionDays 是空开关），而 store 里的隐私默认值在两处重复。改版前应先把 PrivacySettings 的每一项抽成带 {key, label, hint, enabled(是否已实现)} 的元数据表，由表驱动渲染，并让默认值只有一份
- 【需先解耦再换皮】主题与系统主题：设置页的 theme chips 与 store 的 applyTheme、index.html 的预绘制脚本三处协作，且设置页的 systemDark 文案是过期快照。改版前应抽出统一的 themeService（读 localStorage + 监听 media query + 设置 data-theme），三处共用
- 【需先解耦再换皮】使用方式切换：同一业务在设置页与 TopBar 各实现一遍确认 UI、各有一份 modes 数组。改版前应抽成共享的 ModeSwitchConfirm 组件 + 单一 modes 数据源
- 【需先解耦再换皮】统计区：SettingsView 的 .stats 是 StatStrip 的重复实现且未用 --font-num，新版应直接改用 StatStrip（并让 StatStrip 支持需要的变体），而不是再写一套磁贴
- 【需先解耦再换皮】流式/加载态：模型调用目前只有「测试中…」一个按钮禁用态，PlanDraftDialog 承担了 questions/loading/ready/error 四态呈现。改版若要给设置页加模型连通性检查，需要把 llm.ts 的探测结果抽成一个可被设置页与其它页面共用的状态源，而不是各页各写 cloudModelLabel
- 【新增能力所需的接缝】导入/恢复功能：当前完全缺失，且导出结构与 twopoles_state 结构不同。新增时建议把「持久化 schema」抽到 src/services/persist.ts（唯一序列化 + 反序列化入口），导出直接复用该 schema 就能天然得到可回灌的 JSON，并把 import 做成与 export 对称的一对
- 【新增能力所需的接缝】vite.config.ts 第 43-146 行的 llmProxy 是 100 行内联的服务端代码，dev 与 preview 各自注册一次。改版若要改部署形态（独立后端、nginx 反代、正式域名），应先把它抽成独立 server/llmProxy.ts 模块，让前端契约与部署形态解耦
## 职责
这是「两仪·TwoPoles」训练闭环的执行环节：用户在计划页或仪表盘选定一个动作后进入本页，一边看画面（真实摄像头或预录的演示回放）一边完成组数，页面同时承担三件事——（1）呈现训练画面：摄像头分支是 `<video>` + `<canvas class="cam-overlay">` 叠一层实时骨架，演示分支是一幅内联 SVG 剪影配合预置时间轴演出同样的节奏；（2）端侧姿态识别与计数：MediaPipe PoseLandmarker 在 worker（不可用时主线程）里出关键点，`useRepCounter` 依据关节角 + 可见度 + 时序做迟滞判定并累计次数；（3）训练结算：整组结束后收集 RPE、主观不适、备注，写进 `useAppStore` 的会话列表并持久化到 localStorage。UI 3.0 的「编辑式仪表盘」设计语言在这一页被一块固定深色的「舞台」打断，页面同时承担了取流、推理、计数、演出、结算五类职责，是全站耦合最重的一页，也是大改前端界面时最需要先拆解的一页。
## 关键组件
- 页头 `.page-header`（页面最上方）：一行 kick line + h1「{{exercise.name}} · 第 {{displaySet}} 组」+ `.exercise-switch` 动作切换 chips（来自 demoExercises）+ `.source-switch` 数据源切换 chips（演示回放 / 实时摄像头 / 重试摄像头）+ `.cam-note` 隐私说明 + `.cam-error` 错误行（role="alert"）。
- 双栏骨架 `.execution-grid`（grid-template-columns: 1.4fr 1fr）：左舞台右信息，是本页唯一的主结构；1024px 以下塌成单列，`.info-cards` 变两列。
- 舞台容器 `.stage-card` → `.stage-container` → `.demo-frame`（固定 height:min(64vh,580px)，深色径向渐变底）：摄像头分支是 `<video class="cam-feed">` + `<canvas class="cam-overlay">`（两者都 `transform:scaleX(-1)` 镜像 + `object-fit:cover`），演示分支是 `.skeleton-overlay` + 内联 `<svg class="figure" viewBox="0 0 560 760">`。
- 舞台覆盖层 `.stage-overlay`：左上 `.confidence-badge`（识别良好/一般/较差，:key 绑 confidenceClass 强制重挂载重放动画）、右上 `.phase-badge`（阶段文案，来自 demoCameraService.getPhaseText）。
- `.frame-sheen.gradient-shimmer` 扫光装饰 + `.stage-live` 底部半透明白提示条（aria-live="polite"，实时显示关节角与置信度）+ `.stage-hint` 操作提示。
- 舞台控件 `.stage-controls`：暂停/播放、跳过本组（SkipForward）、结束（Square 圆形 `.ctrl-btn`）；在摄像头分支另加校准按钮。
- 右栏 `.info-cards` 四张 BaseCard：① count-card「当前组数」+ 组进度条；② count-card.primary「本组完成次数」+ `.reps-grid`（按 repsPerSet 生成的一排小格）；③ status card，四行实时指标 Activity/Gauge/Ruler/Timer（时长/次数/角度/帧率）+ `.calib` 校准区；④ actions-card，正常时是「手动修正」表单（数字输入 + 确认），结束后换成 actions-card.summary 汇总卡（本次摘要列表 + RPE 0..10 一排 chip + 不适 checkbox + 原因选择 + 备注 + 保存/再练一组）。
- 全局反馈通道 `ToastRegion`（AppShell 级，fixed 右上 top:106px）：每次计数成功弹一条「第 N 次」toast，跨页可见。
- 动作切换 chip 组与数据源切换 chip 组：前者改 `exercise`（并 router.replace 写 query），后者在 演示回放 / 实时摄像头 / 重试摄像头 三态间切换，是本页唯一的「模式开关」。
## UI 模式
- 布局骨架：全站是 AppShell（fixed 侧栏 + 顶栏 + 右侧内容区 + 移动端底部导航），本页在其内自建「页头 + 双栏 1.4fr/1fr」，右栏 4 张卡竖排堆叠。
- 卡片样式：BaseCard 的中性纸面 + 细描边 + 圆角 + 阴影；本页另用 `padding:0!important`（舞台卡）与 `padding:22px!important`（计数卡）改内边距，因此卡片内边距在这一页与其他页不一致。
- 舞台区是「固定深色孤岛」：深色径向渐变底 + 居中剪影/画面 + 两枚半透明白玻璃徽章 + 底部半透明白提示条 + 扫光动画，整块不随 light/dark 主题变化。
- 数字排版：计数与指标用 `--font-num`（Bahnschrift）大号数字，角度用「度」后缀拼字符串而非单位 token。
- 状态呈现三处并置：徽章（置信度/阶段）、底部提示条（角度与置信度明细）、全局 toast（每次计数成功），同一批事实被重复表达三次。
- 交互：chip 切动作与数据源；圆形图标按钮做暂停/跳过/结束；校准按钮仅在 live && counter 时出现；RPE 用 0..10 一排 chip 单选，不适用 checkbox，原因用下拉。
- 空态/加载态薄弱：摄像头未就绪只有一行文案提示「摄像头未就绪」，没有骨架屏或占位插画；`startingStage`（camera / model）已建模但没有对应的加载视觉；错误态复用 `.cam-error` 一行红字 + 一个「重试摄像头」chip。
- 响应式：@media(max-width:1024px) 双栏塌成单列且 `.info-cards` 变两列、`.actions-card` 跨满两列；@media(max-width:767px) 再降一档（padding 与栅格压缩）。断点值写死在各文件里，未取自 tokens。
- 动效：卡片入场用 `.animate-slide-in-up`，扫光用 `.gradient-shimmer`，直播点用 `.animate-pulse`，全局有 prefers-reduced-motion 兜底。
- 无障碍：`.stage-live` 与 `.cam-note` 有 aria-live="polite"，`.cam-error` 有 role="alert"；但置信度徽章、阶段徽章、计数变化都没有 live region，读屏用户听不到「第 N 次」以外的关键状态。
## 样式写法
全局是 CSS 变量 token 体系：`src/styles/tokens.css` 定义颜色/间距/圆角/阴影/动效/字体，`html[data-theme="dark"]` 覆盖一组 token；`globals.css` 提供 reset 与 body 纸面底 + 颗粒层；`animations.css` 提供 keyframes 与 `.animate-*` 工具类并带 prefers-reduced-motion 兜底；`gradients.css` 只剩 `.gradient-shimmer` 一个类在用。组件层全部用 `<style scoped>`，本页 ExecutionView 亦然。问题在于这一页的 scoped CSS 与 token 体系是「半接入」关系：一部分是 token（`var(--radius-md)`、`var(--shadow-sm)`、`var(--easing-ease-out)`、`var(--motion-base)`、`var(--brand-pole-a-dark)`、`var(--font-num)`），另一部分是硬编码字面量——`.cam-feed{background:#0d1f2c}`、`.demo-frame` 的 `radial-gradient(120% 100% at 50% 0%,#263038 0%,#14191d 55%,#0c1013 100%)`、`.db{fill:#2c363e}`、`.confidence-badge/.phase-badge{background:rgba(255,255,255,.9)}`、`.stage-live{background:rgba(255,255,255,.92);color:#15181b}`、SVG 渐变 fxNear/fxFar/fxTorso/fxHead 里的灰色 hex。结果是舞台区在 light/dark 两个主题下长得完全一样（永远是深底 + 白玻璃浮层 + 深色字），主题切换在这一页基本无效。token 也没有被 composable 层消费：`usePoseCamera.draw()` 的骨架颜色写成 `rgba(79, 209, 197, 0.85)`（连线）与 `#0f766e`（关键点填充），代码注释已说明「canvas 的 fillStyle/strokeStyle 不解析 CSS 变量，这里只能写字面色值」——这条限制本身不可破，但可以通过 getComputedStyle 读 token 再传字面量来消除硬编码。重复的自定义样式主要有三类：一是 BaseCard 提供的 `--card-pad` 钩子被 `!important` 绕开（`.stage-card{padding:0!important}`、`.count-card{padding:22px!important}`）；二是父组件用 `:deep()` 强改子组件按钮宽度后又用另一条 `:deep()` 撤销（`.actions-card :deep(button){width:100%}` 与 `.correct-form :deep(button){width:auto}`）；三是内联 `:style` 表达栅格（`.reps-grid` 的 `gridTemplateColumns: repeat(N, 1fr)`）。此外 12 条 `transform-origin` 规则把 SVG 动画硬绑在 viewBox 560×760 的绝对坐标上（如 `transform-origin:288px 714px`），并依赖 `transform-box:view-box`（SVG 上属较新特性，需在目标浏览器上确认）。断点（1024px / 767px）在本页写死，而 tokens.css 里的断点是 CSS 变量、无法用于 media query，两者没有共用来源。
## 数据流
数据来源分四条通路。（1）路由输入：`/execution?exercise=<中文动作名>`，页面 `onMounted` 时用 `getDemoExercise(route.query.exercise)` 取演示配置，PlanView.vue:328 与 DashboardView.vue:512 通过 `router.push` 传入动作名；点击 `.exercise-switch` chip 时同时改本地 `exercise` ref 和 `router.replace`（没有对 query 的 watch，改 URL 手输动作名不触发任何反应）。（2）动作目录（双源）：`demoCameraService.demoExercises` 提供 sets / repsPerSet / restDuration / setEvents 演示时间轴，`services/exercises.ts` 的 `findExercise(name).camera` 提供计数阈值 {joint, neutral, bottom, minStageMs}，两者靠中文动作名 join；`demoExercises` 只有两项，其余 24 个目录动作在本页没有相机配置也没有演示数据。（3）实时链路（摄像头分支）：`usePoseCamera.start(video, canvas)` → getUserMedia 三档降级 → 等待 metadata → `video.play()` → canvas 尺寸取 videoWidth/videoHeight → `createPoseEngine`（DEV 主线程 / 生产 worker）→ 帧循环（优先 `video.requestVideoFrameCallback`，退回 rAF）→ 每帧 `createImageBitmap(video)` → `engine.detect(bitmap, ts)` → worker 或主线程内 `computeMetrics` 得到 {kneeAngle, hipAngle, elbowAngle, visibility} → `applyMetrics` 写回 composable 的 ref → `draw(landmarks)` 在叠加 canvas 上画骨架；视图通过读 `pose.kneeAngle.value / pose.elbowAngle.value / pose.visibility.value` 喂给 `useRepCounter.feed(angle, visibility, ts)`，拿到 `{phase, counted, gate}` 后写视图本地的 `phase` / `reps` / `message`。（4）结算与持久化：整组结束 `summarizeSession({elapsedMs, reps, sets, manualCorrections, ...})` 生成 `TrainingSession` 片段 → `store.addSession(...)` 写入 `useAppStore.sessions` 并 `persistState()` 到 `localStorage['twopoles_state']` + 弹 toast；用户随后提交 RPE/不适/备注 → `store.applyFeedback(...)` 回写同一条 session 的 rpe / discomfort / reason / notes 并再次 toast。展示层还有一条纯前端补间通路：`watch(reps)` → 独立的 rAF 把 `displayReps` 从旧值推到新值，供数字滚动动画使用；`reps` 是真值，`displayReps` 只是显示量。注意 `reps.value = Math.min(c.count, exercise.value.repsPerSet)` 会被「手动修正」打断（`corrected` 标志一旦置真就不再被模型计数覆盖，模型计数与修正值分别保留）。
## 状态模型
页面上并存三台状态机，彼此语义并不干净对齐。第一台是相机链路状态 `PoseCameraStatus`（usePoseCamera.ts:9）：idle → starting(startingStage = 'camera' → 'model') → live / unsupported / denied / error。unsupported 与 denied 是终态（需用户点重试），error 是推理链路彻底失败的降级终态（同时把 errorMessage 写成「端侧推理失败…，已退回演示模式」并 stop()）；live 之外还有一条隐藏的中间降级路径：worker 推理出错时 `recover()` 先降级到主线程 CPU 再考虑退到演示（`downgraded` 标志保证只降一次）。第二台是动作阶段 `ExercisePhase`（types/domain.ts）= idle | ready | down | up | occluded | complete，它被演示回放和实时计数共用，但两种来源语义不同：演示侧来自 DemoEvent.state（剧情动作），实时侧来自 `useRepCounter.feed` 返回的 phase（含义是「当前到达行程的哪一端」，由 `rule.bottom > rule.neutral` 决定 up 还是 down）。第三台是页面本地状态：`status: 'playing' | 'resting' | 'idle'`（组进行中 / 组间休息 / 未开始）、`paused`、`finished`、`phase`、`reps` / `displayReps`、`setIndex` / `repsBySet`、`message` / `stageMessage` / `sourceNote` / `stageHint`（三份不同职责的文案）、`corrected`（非响应式 plain let）。`useRepCounter` 内部还有第四台更细的判定机：把角度按 start / end / between 三区划分，方向由 `rule.bottom > rule.neutral` 决定，迟滞带 hysteresis=8°，3 帧滑动平均平滑，配合 stageConfirmed（none / end / start）、minStageMs（阶段驻留下限）、minRepMs=700（过快抖动拒绝）、maxStageMs=6000（停滞重置）、minVisibility=0.5（遮挡冻结，且遮挡后必须重新回到起始区才恢复计数）。校准 `calibrate(readSample, 900)` 采样 ≥4 个有效点求均值写入 `calibratedNeutral` 并重置计数。视图层用 `tick()` 一条 rAF 循环同时推进演示时间轴（消费 setEvents）、喂实时计数、推进组间休息并判定结束。
## 耦合
（1）跨组件 import：ExecutionView 引入 `BaseCard` / `BaseButton` / lucide 图标 / `useAppStore` / `demoCameraService` 的 5 个导出 / `usePoseCamera` / `useRepCounter` / `services/exercises` 的 `findExercise` / `types/domain` 的 `ExercisePhase`；本页没有反向依赖，但 `demoCameraService` 同时被本页与结算逻辑共享。（2）共享 store 字段：`useAppStore` 的 `sessions`（本页 addSession/applyFeedback 写）、`toasts`（本页每次计数成功调用 showToast，ToastRegion 渲染）、`privacy.cameraEnabled`（本页模板用它决定是否显示「重试摄像头」chip 和整段摄像头提示）。store 通过 `localStorage['twopoles_state']` 持久化，键名与结构是跨页数据契约。（3）共享类型：`ExercisePhase` 同时被 demoCameraService、useRepCounter、ExecutionView 三处按不同语义使用；`TrainingSession` 被 demoCameraService.summarizeSession 产出、被 loadRules/weekRules/ReportView/MealsView/SettingsView 消费。（4）跨子系统口径耦合（最需要警惕）：`summarizeSession` 写 `actualDuration = Math.round(elapsedMs / 1000)`（秒），而 `types/domain.ts:167` 注释、loadRules.ts:188、weekRules.ts:31-32、ReportView.vue:96、MealsView.vue:362、SettingsView.vue:361-362 全部按**分钟**消费，本页写入的训练时长在周报负荷、训练量、明细里被当成分钟，量级差 60 倍。另一处是 `cameraUsed: true` 硬编码 —— 演示回放（根本没开摄像头）也会被记成「使用了摄像头」。（5）跨目录动作目录耦合：`demoCameraService.demoExercises`（组数/次数/休息/时间轴）与 `services/exercises.ts`（26 项真实目录 + 相机阈值）靠中文动作名 join，PlanView 的 firstExercise 按 **type** 匹配，DashboardView 的 mainItem 可能是目录里任一动作，两处传出的名字在 demoExercises 里不存在时会被 `getDemoExercise` 静默回落到「坐站训练」。（6）共享样式/资源耦合：ExecutionView 的 scoped CSS 依赖 `src/styles/tokens.css` 的 token、`animations.css` 的 `.animate-*`、`gradients.css` 的 `.gradient-shimmer`；`public/mediapipe/` 下的 wasm 与 .task 模型由 `npm run camera:assets` 生成且被 gitignore，部署必须自备。（7）视图与 composable 的越界耦合：ExecutionView 三处直接写 `pose.errorMessage.value`（453/468/477），以及 `counter` 整个 composable 实例被塞进一个 `ref` 存放，视图读到的是 reactive 代理解包后的值，与 composable 内部 ref 不是同一层。
## 设计债
- 模板里的占位符是死代码：`pose.kneeAngle ?? '—'`（ExecutionView.vue:206）永远走不到 `'—'` 分支。`pose` 是 `usePoseCamera()` 返回的普通对象（内部装 ref），模板只对顶层 setup 绑定做解包，编译产物实测是 `unref(pose).kneeAngle ?? "—"`，ref 对象永不为 nullish，`??` 失效后由 `toDisplayString` 兜底渲染成空串 —— 角度为空时界面显示「膝 ° · 髋 ° · 肘 °」而不是「—」。同一文件 20/23 行的 `pose.errorMessage.value` 却显式取 `.value`，两种写法自相矛盾，抄错就会静默出空值。
- 视图直接写 composable 的内部 ref：ExecutionView.vue:453 `pose.errorMessage.value = '摄像头画面容器没有准备好，请重试。'`，468 与 477 行 `pose.errorMessage.value = ''`（清错误）。`usePoseCamera` 没有暴露 `clearError()`/`setError()`，所以清错误只能由外部手改内部状态 —— 换 UI 时这个口子会继续扩散。
- 两套动作目录靠中文名 join，且有一方静默兜底：`demoCameraService.demoExercises`（demoCameraService.ts:70-73，只有「坐站训练 2×8」「站姿弯举 2×10」）与 `services/exercises.ts`（26 项，带 CameraConfig）各写一份组数/次数。ExecutionView 的组数次数取前者、计数阈值取后者（`findExercise(exercise.value.name)?.camera`），改一处不同步另一处就会静默错配。更糟的是 `getDemoExercise`（demoCameraService.ts:75-77）找不到名字时静默回落到 `demoExercises[0]`，而 PlanView.vue:328 传的 firstExercise 是按 **type** 匹配的（可能是「弹力带弯举」），DashboardView.vue:512 传的也可能是目录里任一动作 —— 访问 /ex
- 半个字段：`demoCameraService.setDuration`（L12 类型定义、L64 赋值）定义后全库无人使用，实际组时长由 setEvents 时间轴和硬编码的 restDuration 决定；`makeExercise` 把所有动作的 restDuration 统一写死 6000ms，与 exercises.ts 目录里的真实参数无关。
- `summarizeSession` 里 `cameraUsed: true` 恒为真（demoCameraService.ts:139），演示回放（根本没有开摄像头）也会被记成「使用了摄像头」，隐私口径失真；`ExecutionView` 也没有把「本次是否真的用了摄像头」传给这个函数。
- `actualDuration` 单位错配且波及全站：demoCameraService.ts:133 写的是 `Math.round(input.elapsedMs / 1000)`（秒），而 types/domain.ts:167 注释是 minutes，loadRules.ts:188、weekRules.ts:31-32、ReportView.vue:96、MealsView.vue:362、SettingsView.vue:361-362 全部按分钟消费 —— 跟练页写入的时长在周报负荷、训练量、明细里被当成分钟，量级差 60 倍（交付说明.md:372 记录的「actualDuration=50」正是秒）。
- `ExercisePhase` 一套枚举承担两种语义：演示回放里 'down'/'up' 是剧情动作状态（`getPhaseText` 映射成「下蹲阶段/起身阶段」），实时计数里 `useRepCounter.feed` 的 'down'/'up' 是「到达行程的哪一端」（`rule.bottom > rule.neutral ? 'up' : 'down'`）。对「站姿弯举」而言实时模式会显示「下蹲阶段/起身阶段」，且内联 SVG 剪影的 `.figure.up.elbow` 姿态与实时几何含义正好相反。
- 计数状态机被视图的 rAF 驱动而不是被推理帧驱动：ExecutionView 的 `tick()` 每帧调用 `counter.feed(angle, visibility, ts)`（L377、L542），传进去的角度是上一张推理帧的旧值（推理 15-30fps，rAF 60fps），于是 `useRepCounter` 的 3 帧滑动平均（SMOOTH_WINDOW=3）平均的是同一个数而不是三个真实采样，minStageMs / maxStageMs 的驻留判定也按 60Hz 计。
- 方向判定与阈值口径不一致：`useRepCounter.feed()` 用 `rule.bottom > rule.neutral`（原始标定值）决定方向，而 `lowThreshold/highThreshold` 用 `calibratedNeutral.value ?? rule.neutral` 计算中位与迟滞方向；校准后两者可能反号，届时同一角度会落进相反的区。
- 校准会静默清零计数：`useRepCounter.calibrate()` 末尾调 `reset()`，而视图的 `runCalibrate` 只要 `live && counter` 就能触发（不限于组开始前）。校准后 `reps` 会被下一次 tick 覆盖成 0，已完成次数无提示地归零。
- `useRepCounter` 内部用 `const window: number[] = []` 遮蔽了全局 `window`（滑动平均缓冲）。当前不碰 DOM 所以没炸，但这是该文件里最危险的地雷，任何一次「在这里用 window.setTimeout」都会静默变成对数组调用 setTimeout。
- 相机链路颜色写死，跟不上 token 与主题：`usePoseCamera.ts:58-67` 用 `rgba(79, 209, 197, 0.85)`（连线）和 `#0f766e`（关键点填充），注释说明 canvas 不解析 CSS 变量。结果实时骨架色既不等于 light token `--color-accent`（同值）也不等于 dark token `#3ec9b6`，和演示剪影的 `var(--brand-pole-a-dark)`（#3ec9b6）更是两个颜色 —— 同一屏两种蓝绿，交付说明.md:710 记录过这个 live/demo 骨架视觉冲突，至今未收敛。
- 样式层 token 与硬编码混用导致主题失效：`.cam-feed{background:#0d1f2c}`(749)、`.demo-frame` 的 `radial-gradient(...#263038...#14191d...#0c1013)`(760)、`.db{fill:#2c363e}`(780)、`.confidence-badge/.phase-badge{background:rgba(255,255,255,.9)}`(823)、`.stage-live{background:rgba(255,255,255,.92);color:#15181b}`(828)、SVG 的 fxNear/fxFar/fxTorso/fxHead 渐变灰阶全部写死。舞台区事实上是一块固定深色孤岛，浅色半透明浮层在任何主题下都不变，dark 主题改不到这里。
- 用 `!important` 与 `:deep()` 硬压 BaseCard：`.stage-card{padding:0!important}`(756)、`.count-card{padding:22px!important}`(838) 绕开了 BaseCard 自带的 `--card-pad` 变量钩子；`.actions-card :deep(button){width:100%;margin-bottom:8px}`(862) 与 `.correct-form :deep(button){width:auto;margin-bottom:0;padding:0 18px}`(865) 互相撤销，同一个按钮被两条规则反复改写。
## 约束
- MediaPipe 资源路径与体积是硬事实：wasm 目录与 `pose_landmarker_lite.task`（5,777,746 字节）、`efficientdet_lite0.tflite` 位于 `public/mediapipe/`，由 `npm run camera:assets`（scripts/fetch-camera-assets.mjs）下载且被 gitignore，部署必须自备；路径常量写死在 usePoseCamera.ts:11-13 的 `/mediapipe/wasm` 与 `/mediapipe/models/pose_landmarker_lite.task`，换 CDN 目录名要同步改这里。
- 摄像头取流必须在安全上下文：`window.isSecureContext` 必须为真（https 或 localhost），否则 getUserMedia 不可用；`navigator.mediaDevices.getUserMedia` 缺失时必须报 unsupported。这是浏览器硬限制，任何离线/内网 http 部署都会退化。
- 取流失败必须靠 DOMException 的 `name` 分类（NotAllowedError / PermissionDeniedError / SecurityError / NotFoundError / OverconstrainedError / NotReadableError）才能给出可区分的中文提示（usePoseCamera.ts:186-192、214-226），若在重构中把它们统一包成普通 Error，错误文案粒度会不可逆地丢失。
- `PoseLandmarker.detectForVideo` 要求时间戳严格递增；`poseMath.nextTimestamp` 用媒体时间换算并在不递增时返回 null 跳过该帧（usePoseCamera.ts:98）。任何重写帧调度的改法都必须保留这个单调约束，否则 MediaPipe 会直接抛错或输出脏结果。
- 推理必须是**经典** worker：`import PoseInferenceWorker from './poseInference.worker?worker'`（poseEngine.ts:9-11 注释 + 108 行）。原因是 MediaPipe 的 wasm loader 在 worker 内走 importScripts，module worker 下 Vite dev 不把 public/ 里的 glue 当模块解析、直接 500；这条限制同时决定了 dev 模式恒定回落主线程，不能简单改成 module worker。
- GPU delegate 必须绑定一块**专用** canvas，且该 canvas 不能已经有 2D context —— 因此不能复用 UI 上的叠加层 canvas，worker 内只能自建 `new OffscreenCanvas(640, 480)`（poseInference.worker.ts handleInit / poseLandmarkerFactory.ts）。若改版想「用 UI 画布同时做 GPU 绑定和骨架绘制」，会直接失效。
- MediaPipe DrawingUtils 只吃字面色值：canvas 的 fillStyle/strokeStyle 不解析 CSS 变量（usePoseCamera.ts:57 注释明确记录，交付说明.md:550 记过一次 `var(--color-accent)` 被静默忽略的 bug）。骨架颜色要跟随主题，只能读取 computed style 后传字面量，不能在 draw 调用里写 var(...)。
- 几何口径固定为左侧 6 个关键点（shoulder 11 / elbow 13 / wrist 15 / hip 23 / knee 25 / ankle 27，poseMath.ts 的 LEFT 常量），`computeMetrics` 需要 ≥28 个 landmark；可见度是这 6 个点的均值（按 11..27 整段取会 >1，这是代码注释里写死的坑）。`minVisibility: 0.5` 的遮挡门限直接依赖这个定义，改成全身可见度会让遮挡判定整体失真。
- 计数口径由 `npm run selfcheck`（scripts/selfcheck.ts，第 5 节 F05、第 8 节）锁定：完整行程只计一次、遮挡不累加、快抖不计数、阈值可被校准覆盖、膝/肘角 180°/90°、可见度 ≤1、时间戳单调。改 `useRepCounter` 的迟滞 / 遮挡 / 最短最长时长阈值，必须让自检保持全绿。
- 当前实测的动作参数是标定数据而非自由值：坐站训练 knee neutral 168 / bottom 100 / minStageMs 220，站姿弯举 elbow neutral 170 / bottom 55 / minStageMs 180；通用参数 hysteresis 8°、minRepMs 700ms、maxStageMs 6000ms。改任一个都要重新标定并跑自检。
- 帧循环与取帧的浏览器能力契约：没有 `requestVideoFrameCallback` 时必须能退回 rAF（usePoseCamera.ts:77-88）；`video.readyState < 2` 时不能推理；取帧入口是 `createImageBitmap(video)`；主线程路径必须在 finally 里 `bitmap.close()`，worker 路径靠 transfer 转移所有权后由 worker 关闭，重复关闭或泄漏都会累积显存。
- `TrainingSession` 的字段名与 `localStorage` 键 `twopoles_state` 的持久化结构是跨页数据契约（store.persistState）。其中 `actualDuration` 在 domain.ts:167 约定为 minutes —— 当前写入方写的是秒（属 bug），修版时应统一为分钟并考虑既有数据的换算，而不是改消费方。
- MediaPipe 的 VIDEO 运行模式与 numPoses=1 决定只跟踪单人；`PoseLandmarker.POSE_CONNECTIONS` 决定绘制出的连线集合是 MediaPipe 固定的 33 点人体拓扑，不能自定义成仅左侧 6 点连线。
## 改版接缝
- 【可整体替换·边界清晰】`usePoseCamera()` 返回扁平响应式接口（status / errorMessage / fps / kneeAngle / hipAngle / elbowAngle / visibility / delegate / runsIn / startingStage + start / stop），不泄露内部 engine / stream / handle，换成任何一套新舞台 UI（例如分屏、画中画、纯指标面板）都只需重写 ExecutionView 的模板与样式，composable 一行不用动。
- 【可整体替换·边界清晰】`poseMath.ts` / `poseLandmarkerFactory.ts` / `poseEngine.ts` / `poseInference.worker.ts` 是与 UI 完全解耦的纯推理层（除 OffscreenCanvas 创建外无 DOM 依赖），可以整体搬到新的 `src/features/execution/` 目录而不波及其它页面；`useRepCounter.ts` 同理，只依赖角度/可见度/时间戳三个入参。
- 【可整体替换·边界清晰】`useRepCounter` 的对外契约就是 reset / calibrate / feed 三件套加一组只读 ref，视图只喂 `(angle, visibility, ts)` 拿 `{phase, counted, gate}` —— 换计数呈现方式（环形进度、节奏条、节拍器）完全不触碰算法。
- 【可整体替换·边界清晰】`demoCameraService` 的 `getPhaseText` / `getConfidenceLevel` / `summarizeSession` 是纯函数，可以整体搬到新的文案层或 i18n 层，视图不感知；`demoExercises` 的时间轴数据也可以换成真正的 JSON 资源文件而不改视图。
- 【可整体替换·边界清晰】右栏 4 张 BaseCard 已是独立块，各自带 variant 与 `--card-pad` 钩子，可逐个抽成 `RepCounterCard.vue` / `JointMetricsCard.vue` / `ManualCorrectionCard.vue` / `SessionSummaryCard.vue`，逻辑留在各自组件内，页面只负责排布。
- 【可整体替换·边界清晰】BaseCard 已提供 variant=default/flush/ink + `--card-pad` 变量 + 遗留 `glass` prop，是现成的换皮接口；把 ExecutionView 里那两处 `padding:...!important` 换成 `--card-pad:0` 后，这一页就能并入统一卡片体系，不再单独维护内边距。
- 【可整体替换·边界清晰】内联 SVG 剪影（ExecutionView.vue:41-115 与 773-803 的 transform-origin 表）可整体抽成 `DemoFigure.vue`，props 只需 phase / joint / paused，把 viewBox 坐标表关进组件内部，换插画风格不影响页面。
- 【可整体替换·边界清晰】`.reps-grid` 次数格、`.stage-overlay` 的两枚徽章、`.frame-sheen` 扫光、`.stage-live` 底部条、`.stage-controls` 圆形按钮组，都是纯展示块，可各自成为独立组件或换成完全不同的形态。
- 【可整体替换·边界清晰】顶部 `.source-switch`（演示回放 / 实时摄像头 / 重试摄像头）与 `.exercise-switch` chips 已经是「本地 ref + 事件回调」的形态，可直接换成新的分段控件、下拉或设置入口。
- 【需要先解耦·样式与逻辑纠缠】`tick()`（ExecutionView.vue 约 L349-392）把演示时间轴推进、实时计数喂数、组间休息、结束判定、elapsedMs/setElapsed 计时、reps/displayReps 补间写进同一条 rAF；界面大改时任何重排都会碰它。必须先拆成「时钟」「计数器驱动」「展示补间」三层（各自独立 rAF 或 setInterval），再动布局。
- 【需要先解耦·样式与逻辑纠缠】实时骨架的绘制在 `usePoseCamera.draw()`（主线程 canvas + DrawingUtils），颜色线宽是字面量；而画面容器、镜像 transform、object-fit:cover 都在 ExecutionView 的 CSS 里，canvas buffer 尺寸取 videoWidth/videoHeight。骨架与画面是两套各自维护的坐标系，想改舞台布局（竖屏、画中画、分屏）必须先统一「画面矩形 ↔ 骨架坐标」映射，不能直接改 CSS。
- 【需要先解耦·样式与逻辑纠缠】`pose.errorMessage.value` 的三处直写（453/468/477）必须先改成 composable 暴露的 `clearError()` / `setError()`，否则新 UI 的错误提示只能继续靠外部改内部 ref。
- 【需要先解耦·样式与逻辑纠缠】`pose.kneeAngle ?? '—'` 的 ref 解包错误必须先修：要么让 usePoseCamera 的返回值用 `reactive()` 包一层以获得模板深层解包，要么在视图里统一改用 `.value`；新 UI 若沿用现写法会继续渲染「膝 °」这类空值。
- 【需要先解耦·样式与逻辑纠缠】`stageMessage` / `sourceNote` / `stageHint` 三条文案，加上 `getPhaseText`/`getConfidenceLevel` 里的中文硬编码（还放在一个叫 demo 的服务里），必须先抽成单一文案表并区分「演示剧情文案」与「实时几何文案」，再重排右侧信息卡的阶段展示。
## 职责
仪表盘是路由 '/' 的落地页，首页承担的任务是「今天做什么」：第一屏用一个 40px 的 h1 直接写出今天的主项动作名与时长，右上角给两个动作（换一项 / 开始跟练），把用户直接推入跟练流程，而不是先讲理念。次一级任务是让训练与饮食在同一屏可比——这是产品名「两仪」的核心：左侧时间轴讲「今天怎么打发这 30 分钟」，右侧深墨双极仪表把「本周训练完成率 vs 饮食记录率」（运动员模式则换成「低强度 vs 高强度时长」）画成同一个环，底部账本再补三块信息：本周逐日负荷柱状图、今天三餐的记录完整度、以及一句「为什么是这 N 分钟」的解释。第三级任务是补足信息与信任：顶部在未建档时给一条去建档的引导，页面末尾给一条每天轮换的「今日养生」知识卡（含来源与免责声明），页脚声明「无账号 · 记录只存本机」。它同时也是模式切换的展示面——整个模板按 store.isAthleteMode 分支，模式切换换掉的是首页结构（时间轴 → 28 天负荷曲线、仪表语义、账本第一块）而不只是文案。
## 关键组件
- `.setup` 建档提示条（DashboardView.vue L4-11，页面最上方）：仅当 `!store.hasProfile` 时出现，是一个 RouterLink 到 /onboarding，样式为 accent-soft 底 + accent-line 边；不占首屏主位。
- `header.lede` 标题区（L14-47）：三层信息。① `micro kick` = eyebrowDate + 「本周第 N 次」+ 目标/周期阶段（L352-358）；② `h1` = `mainItem.exerciseName` + 时长 + 「分钟」，无计划时写「今日休息」（L17-21）；③ `meta` 行 = 合计时长 / 场地 / 器材 / 避开项 / `notice.stale` 时的「计划由旧规则生成」警告（L22-39）。右侧是「换一项」(→ /plan) 与「开始跟练」(→ /execution?exercise=...) 两个按钮（L41-47）。
- `.cluster` 主集群（L50-205，grid: minmax(0,1fr) / 356px）共 4 个互斥/并列区块：
- 时间轴卡（L51-91，`v-if="!isAthlete && timeline.length"`）：panel-head 显示「今天的 N 段 · 合计 M 分钟」；每行 `.tl-row` 是 `时间段 00—05` | 空心/实心圆点轴 | 动作名+组次说明 | 分钟数；下面 `.tl-note` 是 gateNote + 周期锁定数；最后 `.tl-foot` 三格统计（上次同类 / 近 4 周平均 / 本周目标）。
- 休息日卡（L94-135，`v-else-if="!isAthlete"`）：SVG 圆环静态图 + gateNote 或「未安排 ≠ 没活动」+ 冲突列表 + 「接下来」列表 + 三格 tl-foot。
- 运动员负荷面板（L138-157，`v-if="isAthlete"`）：`LoadChart` 28 天柱 + CTL/ATL 均线 + ACWR 指针；与时间轴卡互斥。
- 双极仪表卡（L160-204，`BaseCard variant="ink"`）：`TwoPoleDial`（`:size="228"`）内嵌大数字「本周负荷 AU」+ 图例（训练/饮食 或 低/高强度）+ 三格数字 foot（场次 / 时长 / RPE 或 餐次）。
- `.ledger` 底部账本（L208-261，grid: 1.15fr / 1fr / 1fr）三块：① 本周逐日负荷柱状图或「接下来 3 个训练日」（L209-234）；② 今天的三餐三行（时间 / ShapeState / 菜名 / 「改·＋记」RouterLink，L236-249）；③ 「为什么是这 N 分钟？」解释卡 + 标签行（L251-260）。
- `DailyWellnessCard` 今日养生卡（L264）：折叠态一行摘要（eyebrow「今日养生 · 分类 / 主题」+ 标题 + 摘要 + 展开提示），展开态分正文列（detail 段落 + 要点列表）与侧栏（运动员补充 / 标签 / 来源 / 免责声明 / 收起按钮）。
- `footer.footnote`（L266-269）：「无账号 · 记录只存本机 · 照片经同意才用于识别」与版本号 `v3 · plan-rules-v3`。
## UI 模式
- 两种表面：纸面（BaseCard default/flush = 白底 + 1px 发丝线 + `inset` 顶亮内描边，无投影）与仪表面（variant="ink" = 深墨渐变 + 22px 细网格 + 径向 mask）。全页只有仪表一块深色，是刻意的视觉焦点。
- 发丝线分层替代投影：行分隔用 `--hair-soft`，卡片边用 `--color-border`，图表基线用 `--hair-strong`，虚线 `--color-border` 只用于「备注/元信息」区（`.tl-note`、`.upcoming`、`.w-meta`）。
- 单一强调色 + 语义色：teal `--color-accent` 表示进度/今天/已完成；`--color-caution` 琥珀表示部分/偏高；`--color-danger` 表示 veryHigh。语义色永远与形状或文字同时出现，不单独用颜色表意。
- 形状即状态（色觉障碍冗余编码）：三餐完整度用 ShapeState 的实心/半填/空心条；训练完成用 `.tl-axis` 实心圆点 vs 空心圆环；负荷柱的「未记录」用斜纹或描边而不是 0 高度。
- 「未记录 ≠ 0」贯穿全页：null 一律显示 '—'（`.v.dim`、`.num-big` 的 '—'），空图表用文字说明而不是画 0（`bars-empty`：「负荷图显示为空，而不是 0。」）。
- 数字排版：所有数值用 `--font-num`（Bahnschrift，Windows 自带 DIN 骨架）+ `font-variant-numeric: tabular-nums`；标签用 `.micro`（10px / .17em 字距 / uppercase）。
- 网格骨架：`.cluster` = minmax(0,1fr) / 356px；`.ledger` = 1.15fr / 1fr / 1fr；`.tl-foot` 与 `.g-foot` = repeat(3, 1fr) 竖线分隔。
- `display: contents` 技巧（L626）：让 `.g-body` 不产生盒子，使环与 `.g-side` 成为 `.gauge`（flex column）的直接子项，从而在 ≥1100px 保持「环在上、图例在下」，≤1099px 再把 `.g-body` 切成 grid 变成「左环右数字」。
- 响应式三档：≥1280px 三列账本；1100–1279px 账本变两列 + 「为什么」跨满；768–1099px `.cluster` 单列 + 仪表转横向（236px 环 + 420px 数字）；≤767px 全部单列、内距收到 14px、`.tl-note .lock` 隐藏、`.num-note` 隐藏。
- 展开披露模式：DailyWellnessCard 用 `v-show` + `Transition` + `aria-controls`/`aria-expanded`，隐藏时内容不留在无障碍树；底部收起后把焦点还给头部按钮（`collapseFromBottom` → `nextTick` → `toggleBtn.focus()`）。
- 空态是文案而非插画：「本周还没有训练记录。负荷图显示为空，而不是 0。」「接下来 7 天都没有安排训练，可在计划页手工加一项。」
- 动效克制：只有 opacity + translateY(4px) 的展开过渡（motion-base 250ms / motion-fast 150ms），无缩放、无旋转、无循环动画；两个文件都写了 `prefers-reduced-motion: reduce` 降级。
- 说明性底色块用于「解释」而非「状态」：`.setup`（accent-soft）与 `.w-athlete`（accent-soft + accent-line 边）表示可展开的补充信息。
## 样式写法
纯手写 scoped CSS，无任何 CSS 框架 / Tailwind / CSS-in-JS。令牌层：`src/styles/tokens.css` 定义颜色（单一强调色 + 发丝线三档 + 墨/纸两级表面 + 深色主题整组覆盖）、圆角（6/8/10/12/16）、字体（正文系统字族 + `--font-num` Bahnschrift 数字）、动效（--motion-fast/base/slow + 三条 easing）、间距（--space-1..16）；`src/styles/globals.css` 提供 reset 与 `.micro` / `.num` / `.hairline` / `.animate-*` 工具类。页面内一律 `<style scoped>`，颜色与尺寸一律走 var(--token)，但用得并不彻底：DashboardView L628-646 与 TwoPoleDial L117-123 把深色面板的白色文字写成裸 rgba(255,255,255,x)，而 tokens.css L36-39 就有 --ink-panel-on / --ink-panel-muted / --ink-panel-line 三枚对应 token（只有 --ink-panel-muted 被用到 L627）。面板内距统一走 BaseCard 的 `--card-pad` 变量而不是抢 padding（README「样式约定」明确要求，DashboardView L623/L676 用 `--card-pad` 覆盖是正确范式）。响应式断点全是裸像素（1100 / 1099 / 1279 / 767，散落在 DashboardView L327/687/691/704、DailyWellnessCard L327/349、ReportView L398/401、AppShell L57-58），tokens.css L180-183 定义的 --breakpoint-sm/md/lg/xl 全站无人使用。重复的自定义样式（未抽组件）：`.chip` 在 DashboardView L579、ReportView L321、MealsView L550 各写一遍（字号与高度 24/26px 还不一致）；负荷柱状图的 `.bar` 渐变 `linear-gradient(180deg, #12857c, #0c655e)` + `max-width: 34px` 在 DashboardView L654 与 ReportView L331 逐字重复；小标签 chip（`font-size:10.5px; padding:3px 7px; border:1px solid var(--color-border); border-radius:var(--radius-sm)`）在 DashboardView L681、DailyWellnessCard L270-277、ReportView L366 各写一遍。样式与逻辑的耦合点：DashboardView L626 的 `.g-body { display: contents }` 用 CSS 技巧编码了「环在上、图例在下」的视觉顺序；L728-729 用 `.dial { --dial-size: 132px }` 试图从父组件覆盖子组件 TwoPoleDial 的内部变量——但 TwoPoleDial L5 用内联 `:style` 写死了 `--dial-size`，内联样式永远压过样式表规则，这条 ≤767px 的规则是死的。
## 数据流
数据源分三层，页面本身只做展示层聚合：
① Pinia store `useAppStore`（src/stores/app.ts）——页面读取 `store.hasProfile`、`store.userProfile`、`store.currentMode`、`store.isAthleteMode`、`store.sessions`、`store.meals`，以及 `store.dayPlanNotice(now)`。store 的持久化是 localStorage 单键 `twopoles_state`（app.ts L137-167 persistState），初始化在 AppShell.vue onMounted 里 `store.init()`。首页本身不写任何 store 数据，只做读与跳转。
② 服务层（纯函数，无 Vue 依赖）——`buildDayPlan`（planRules，含年龄/档案 gate 与冲突文案）、`buildWeeklyReport` / `loadOf` / `weekStart` / `WEEK_LABELS`（weekRules）、`buildLoadSeries` / `intensitySplit` / `loadZone`（loadRules）、`summarizeDay` / `MEAL_SLOTS`（mealRules）、`pickDailyWellnessCard`（wellnessCards）。口径全部在这一层，页面只负责显示。
③ 视图内自算的展示派生量——`mainItem`（取 plannedDuration 最长的一段，L301-305）、`timeline`（按分钟累加出 00—05 / 05—25 区间，L312-331）、`bars` / `peak`（L440-471）、`upcoming`（未来 7 天内的训练日，L450-464）、`lastSame` / `recentAvg`（L496-508）、`avgRpe`（L430-437）、`weekNo`（ISO 周号 L343-349）、`tags` / `whyText` / `kicker`（L352-392）、`mealRows`（L474-489）。
出向流（页面 → 路由）：`换一项` → router.push('/plan')；`开始跟练` → router.push({ path:'/execution', query:{ exercise: mainItem.exerciseName } })；三餐行与休息日卡 → RouterLink 到 /meals、/plan；建档条 → RouterLink 到 /onboarding。
DailyWellnessCard 的数据流独立：`props.date`（由 DashboardView 传 `:date="now"`）→ `pickDailyWellnessCard(date)` → 按本机日历天序号确定性取卡（不随机、不受模式影响）；`store.isAthleteMode` 只决定是否额外渲染 `card.athlete` 区块，不改变取哪张卡。`expanded` 是纯组件内 ref，刻意不落 localStorage、不走 `store.toggleCard`（见该文件 L77-79 注释）。
## 状态模型
页面级状态机是隐式的，由 `isAthlete`（= store.isAthleteMode）与「今天有没有计划项」两个维度决定渲染分支：
- 大众模式 + timeline 非空 → 时间轴卡（L51）
- 大众模式 + timeline 为空 → 休息日卡（L94，`v-else-if="!isAthlete"`）
- 运动员模式 → 负荷面板（L138，`v-if="isAthlete"`），与上面两个互斥
- 未建档 → 顶部 `.setup` 提示条叠加（L4，`v-if="!store.hasProfile"`）
注意：条件是 `!isAthlete && timeline.length` 与 `!isAthlete`，所以运动员模式永远看不到时间轴与休息日卡，即使今天有计划项。
`notice` = `store.dayPlanNotice(now)` 返回 `{ items, conflicts, auto, gateNote, stale }`（app.ts L305-316）：`items` 优先取已存计划，否则按档案现算；`stale` = 已有计划但既非 llm 来源、`reason` 串里也不含 `PLAN_RULES_VERSION` 时为 true，页面据此显示「计划由旧规则生成，可在计划页重生成」（L34）。
DailyWellnessCard 的状态机只有一个布尔 `expanded`：collapsed ⇄ expanded。整卡点击 `expand()` 只在 collapsed 时切到 expanded（L102-104，头部按钮与底部「收起」按钮才双向切换）；`collapseFromBottom()` 收起后经 nextTick 把焦点还给 `toggleBtn`（L107-111）。
其余派生状态都是无状态枚举：餐次状态 'complete' | 'partial' | 'none'（由 `meal.completeness` 推导，L483）；餐次 chip '' | 'part' | 'ok'（L490-493）；负荷分档 'low' | 'optimal' | 'high' | 'veryHigh' | 'unknown' 来自 loadRules.loadZone(acwr)，DashboardView L416-420 把它压成 ok/part/bad 三个 chip class。
## 耦合
跨组件 import：BaseCard、TwoPoleDial、ShapeState、LoadChart、DailyWellnessCard + 5 个 service 模块。共享 store 字段：hasProfile / userProfile / currentMode / isAthleteMode / sessions / meals / dayPlanNotice。共享类型：PlanItem（@/types/domain）、LoadPoint/LoadZone（loadRules）、WellnessCard（wellnessCards）。模式耦合最深：整个 template 按 `store.isAthleteMode` 分支，模式切换换掉的是首页的「结构」而不只是内容（时间轴卡 → 负荷面板、账本第一块换成「接下来」、仪表语义从训练/饮食换成低/高强度、g-foot 第三格从餐次换成 RPE），因此任何版式重构都必须同时交付两套模式。与兄弟页的隐性耦合（重复而非依赖）：weekNo（DashboardView L343-349 == ReportView L164-170）、.chip（DashboardView L579 == ReportView L321 == MealsView L550）、负荷柱状图（DashboardView L652-661 == ReportView L329-338）、标签 chip（DashboardView L681 == ReportView L366）、TwoPoleDial 目前只有首页在用。DashboardView L455 的 `upcoming` 绕过 store 直接调 buildDayPlan，因此与 L297 走的 store.dayPlanNotice 不是同一口径。store.collapsedCards / toggleCard / isCardCollapsed 已存在且被 InsightCard 使用，但首页的「为什么」卡与 DailyWellnessCard 都不接。
## 设计债
- DashboardView L163：`{{ isAthlete ? 'Load' : 'Load' }}` 两个分支完全相同，是遗留的空三元；仪表 eyebrow 在两种模式下没有区别。
- DashboardView L166：`{{ isAthlete ? 'W2' : 'LIVE' }}` 的 'W2' 是硬编码字面量，与同页 L343 的 `weekNo` 无关——运动员模式无论第几周都显示「W2」。
- DashboardView L728-729：`.dial { --dial-size: 132px; }`（≤767px）是**死规则**。TwoPoleDial.vue L5 用内联 `:style="{ '--dial-size': size + 'px' }"` 写死该变量，而 DashboardView L173 传 `:size="228"`；内联样式在自定义属性上永远压过样式表规则，所以手机端双极环仍是 228px。L728 的注释「窄屏只改这个变量，不动组件的 svg」是错的。
- DashboardView L602-607：`.tl-foot` 手写了一个「标签 + 大数值 + 竖发丝线」的三格指标条，与 `StatStrip.vue`（ReportView L16、MealsView L16 在用）功能重复。首页是全站唯一没用 StatStrip 的数据页。
- DashboardView L652-661：`.bars` 重新实现了一遍周报页 L329-338 的负荷柱状图，连 `background: linear-gradient(180deg, #12857c, #0c655e)` 与 `max-width: 34px` 都是逐字复制；但归一化口径不同（Dashboard L440 `Math.max(1, ...)` vs Report L229 `Math.max(120, ...)`），同一周在两个页面柱高不同。
- DashboardView L343-349：`weekNo`（ISO-8601 周序号）与 ReportView L164-170 逐字重复。`services/weekRules.ts` 已经集中了 weekStart / weekDates / WEEK_LABELS，却唯独漏了 weekNo。
- DashboardView L251-260：「为什么是这 N 分钟？」卡重新实现了一遍 `InsightCard.vue` 的结构（eyebrow + 标题 + 正文），但没有它的收起开关，用户无法收起它——而 `research/界面偏好调研.md` L108/L131 把「任何洞察/建议卡必须可隐藏、可下移、可重排」列为明确要求，且 store 里的 `collapsedCards` / `toggleCard` 就是为此存在的。
- DailyWellnessCard.vue 同样问题：`expanded` 是组件内临时状态、不落盘（L77-79 注释明说），而且整张卡无法被隐藏、无法下移。这是与调研文档的直接冲突（脚本注释解释了取舍，但没有替代方案）。
- DashboardView L510-513：`start()` 跳 `/execution?exercise=<mainItem.exerciseName>`，但 ExecutionView L307 走 `getDemoExercise()`，而 `demoExercises`（demoCameraService.ts L70-73）只有「坐站训练」「站姿弯举」两条，其余静默回落到 `demoExercises[0]`。运动员模式主项是「轻松跑 / 快走」（20 分钟），点「开始跟练」实际开始的是坐站训练，全程无任何提示。
- DashboardView L292：`const now = new Date()` 是普通 const 不是 ref。页面跨零点不会翻篇——`today`、`week`、`timeline`、`upcoming`、养生卡全部停在昨天，必须手动刷新。ReportView 至少还有 `refDate`。
- DashboardView L114-120 与 L217-223：同一份 `upcoming` 数据被渲染两遍，一处叫 `.up-row`（休息日卡），一处叫 `.next-row`（运动员账本），CSS 也各写一遍（L615-619 / L571-575）。应抽成一个组件。
- DashboardView L455：`upcoming` 直接调 `buildDayPlan(d, store.userProfile, store.currentMode)`，绕过 L297 用的 `store.dayPlanNotice(d)`。所以「接下来」显示的是规则现算的模板，不是那些日子真正存下来的（可能是 LLM 生成的）计划——首页会与计划页自相矛盾。
- DashboardView L465-471：`peak` 重新遍历 `week.loadByDay` 求最大值，而 L442-447 的 `bars` 已经在遍历同一个数组。同一次计算做两遍。
- DashboardView L626：`.g-body { display: contents; }` 让环与 `.g-side` 隐式成为 `.gauge`（flex column）的直接子项。任何在 `.g-head` 与 `.g-body` 之间插入兄弟节点、或改动 `.gauge` 的 flex 顺序，都会静默改变视觉顺序而不改 DOM——重排版时这是最脆的一块。
## 约束
- 负荷口径不可改：负荷 = 实际时长 × RPE（weekRules.loadOf），当天只要有一条缺 RPE 就整天不算数、绝不按 0 补齐（weekRules L66-68 / loadRules L104-107）。'休息'(0)、'缺失'(剔除)、'未知'(早于首条记录) 三态必须保持区分，否则新用户首日会被算成重度减量。
- ACWR 口径不可改：近 7 天均值 ÷ 近 28 天均值，样本不足（coveredDays ≥ 14 且急性窗口覆盖足够、ctl > 0）时必须返回 null 而不是给假数字；均值先算原始值再取整（loadRules L116-121 注释明确说「先取整再相除会把 1.49 舍成 1.5，落错档」）。
- 未满 18 岁不生成自动推荐（AUTO_RECOMMEND_MIN_AGE = 18），且「无解时如实返回冲突原因，不强行安排」——首页必须继续展示 gateNote 与 conflicts，不得用兜底文案掩盖。
- 「未记录 ≠ 没练 ≠ 0」是全项目口径：null 一律显示 '—'，缺 RPE 的天从窗口剔除而不是填 0，休息日必须显示为「未安排」而非失败。
- 数据只存本机（localStorage key `twopoles_state`），无账号、无后端；页脚「无账号 · 记录只存本机 · 照片经同意才用于识别」是产品承诺，改版不能引入需要登录的入口。
- 养生内容必须保持「一般科普」定位：每条带资料名 source、不编造论文页码外链；面向 12 岁以上用户，不写减重/断食/补剂/极端饮食方案；`WELLNESS_DISCLAIMER` 必须在展开区末尾出现。
- 养生卡片选择算法是确定性的（按本机日期分量算 dayIndex，健身/饮食交替），同一天多次调用与不同时刻调用必须返回同一条（selfcheck L331-332 有断言）——不能引入随机或依赖 UTC。
- 「运动员模式」只追加内容不换卡：同一张 WellnessCard 在两种模式下 id/内容不变，运动员补充是叠加段（wellnessCards L19 注释 + selfcheck 有断言）。
- 双极仪表的两极语义与几何固定：右弧 = 训练（顺时针）、左弧 = 饮食（逆时针），两段各 144°、上端留 12° 口子（TwoPoleDial L14-21、L63-72）；弧长按比例 0–1 截断。
- 浏览器/平台约束：颜色不能是唯一信息源（形状冗余编码，ShapeState 与训练圆点都靠形状）；需支持 `prefers-reduced-motion` 与 `prefers-reduced-transparency` 降级；`--font-num` 依赖 Windows 自带 Bahnschrift，中文需靠字族回退；触控目标 44px 级别（自绘按钮/chip 目前低于 44px 是已记录的欠账）。
- 双主题 + 跟随系统（`data-theme` 覆盖全部 token），深色不是半适配——改版换皮必须同时给两套。
- 跟练页的 demo 动作库只有「坐站训练」「站姿弯举」两条（demoCameraService L70-73），首页「开始跟练」的跳转目标必须在真实动作库与 demo 动作库之间做映射，不能假设动作名通用。
## 改版接缝
- 边界最清晰、可整块换掉而不动逻辑的部分：① `.tl-row` 列表（L57-65，纯展示，输入是已算好的 timeline 数组）；② `.tl-foot` 三格（L77-90）——换成 `StatStrip` 只需把数据映射成 `StatItem[]`，样式整块丢弃；③ `.g-side` 的 legend 与 `.g-foot`（L184-202）——纯展示，可换任何组件；④ `.bars` 柱状图（L224-230）——输入是 `bars` 数组，输出是 DOM，可整块换成 SVG 或图表组件；⑤ `.meals` 三行（L241-248）——输入是 `mealRows`，`ShapeState` 已是独立组件；⑥ `.why` 卡（L251-260）——换 `InsightCard` 只需传 `cardId/eyebrow/title`，顺带获得可收起能力；⑦ `footer.footnote`（L266-269）；⑧ DailyWellnessCard 的整卡外壳与展开区
- 数据层已经是干净的 seam：DashboardView 里所有 computed 都可以原样搬进一个新的 `useDashboardData()` composable 或 store getter——`mainItem`(L301)、`totalMinutes`(L306)、`timeline`(L312)、`week`(L334)、`bars`(L442)、`peak`(L465)、`upcoming`(L450)、`mealRows`(L474)、`lastSame`(L496)、`recentAvg`(L502)、`avgRpe`(L430)、`tags`(L369)、`whyText`(L380)、`kicker`(L352) 都只依赖 store + services，没有一个读 DOM 或写 ref。把这层抽出来后，模板可以整份重写而不触碰任何口径。
- services 层是现成的稳定接口，改版不应也不需要动：`pickDailyWellnessCard(date)`、`buildDayPlan`、`buildWeeklyReport`、`buildLoadSeries`、`intensitySplit`、`loadZone`、`summarizeDay`、`MEAL_SLOTS`、`WEEK_LABELS`、`loadOf`。DashboardView 已经把它们当纯函数调用。
- 样式与逻辑揉在一起、必须先解耦再换皮的地方：① `.g-body { display: contents }`（L626）——必须先把仪表的 DOM 结构定死（环 / 图例 / 数字三块）再谈重排；② `TwoPoleDial` 的内联 `--dial-size`（TwoPoleDial L5）——父组件无法从外部改尺寸，必须先去掉内联写法或加响应式 prop，否则任何尺寸调整都是无效的；③ `mainItem` 的选取规则（L301-305「时长最长者即主项」）与 `start()` 的跳转（L510-513）耦合在一起——换布局时要同时决定「主项是否还是最长的那段」「跟练页能不能接住这个动作名」；④ `notice.stale`（L32-35）的过期判断依赖 `plan.reason` 里是否包含 `PLAN_RULES_VERSION` 字符串（app.ts L314），这是靠字符串匹配实现的版本判定，UI 上任何「版本」展示都会牵动它；⑤ `.weekNo`（L343-349
- 可直接复用的既有 seam：`BaseCard` 的 `--card-pad` 变量（BaseCard L30）已经是官方换肤入口，父子不抢 padding；`TwoPoleDial` 的 `tone: 'ink' | 'paper'` + `showTicks` + `showInnerRing` + `ariaLabel` 四个 prop 已经支持深浅两种表面；`ShapeState` 的 `state` 三态；`StatStrip` 的 `items` 数组（含 `unit`/`hint`/`tone`）；`InsightCard` 的 `cardId`（走 store 持久化的收起状态）；`LoadChart` 的 7 个纯 props（无取数逻辑，可整块替换）；`store.dayPlanNotice(reference)` 这一个方法已经封装了「已存计划优先、否则按档案现算」的口径。
- 若要把「今日养生」做成可隐藏/可下移/可重排（调研文档 L108/L131 的硬要求），现成接缝是 `store.collapsedCards` + `toggleCard(id)` + `isCardCollapsed(id)`（app.ts L66 / L855-864）——DailyWellnessCard 现在完全没用它，把 `expanded` 换成 store 状态即可获得跨页面持久化与隐藏能力。
- 组件拆分建议（当前全是 DashboardView 内部的裸 div）：`TimelinePanel`（时间轴 + 备注 + 三格 foot）、`RestDayPanel`、`LoadPanel`（已存在 LoadChart，只差外壳）、`GaugePanel`（仪表卡，含 legend/foot）、`WeeklyLoadBars`、`MealTodayPanel`、`WhyCard`——这七个区块的输入输出都已成形，拆出来后换皮可以逐块进行、逐块验收，不必一次性推翻整页。

# 训练计划子系统（PlanView + planRules + exercises）
## 职责
计划页是产品的"排课中枢"：把用户档案（年龄、可用时间、器材、场地、需要避开的）+ 模式（大众/运动员）翻译成一周的逐日训练安排，并提供锁定、完成、替换、搬移、手工录入、版本历史这一整套"人和计划讨价还价"的编辑交互。同时它承担 F04（按器材/场地/时长/限制筛动作库并给出可解释的替换候选）与 F05（把当天可跟练的动作接到摄像头计数页）的入口职责。周视图是"月历 + 当日详情"两栏，另有"四周周期"第二视图展示周期阶段与负荷条；两条生成路径并存——内置规则（planRules，固定周一/三/五 3 天）与大模型（先问 1–3 个问题再生成草稿，用户可改后入库），二者共用同一套 Plan/PlanItem 数据结构与同一份本机版本历史。
## 关键组件
- page-head（L3-6）：左侧 eyebrow「TRAINING PLAN」+ h1「训练计划」+ 副标题，右侧一枚 BaseButton 切换手工录入表单的开合。
- toolbar（L8-24）：左侧 tabs 切「本周 / 四周周期」；右侧版本区显示当前版本号 plan.version、模式 chip、「按规则重算」与「用模型规划」两枚自绘按钮（后者受 store.planLlmReady 门控）。
- gate-note / conflicts（L26-30）：全宽提示条。gate-note 是 caution-soft 底 + 3px 左竖条，用于"未满 18 岁 / 孕期或产后 / 伤病限制"这类不生成推荐的说明；conflicts 是 neutral-soft 无序列表，逐条显示被筛掉的原因。
- manual 表单（L32-42）：v-if 展开的 4 字段表单（日期 / 名称 / 时长 / 错误位），提交走 saveManual → store.addManualItem，保存即生成新版本。
- 周视图两栏 .layout（L44-117）：grid 1.05fr / 1fr，左侧 BaseCard 日历，右侧 BaseCard 详情，align-items:start 让两卡各自定高。
- 月历卡（L45-67）：月份头（上一月/下一月，canForward 限制在当前月 +3）+ 周标签行 + 7 列日历格（today 实心 accent、selected accent-soft + inset 描边、rest 灰字）+ 底部三色图例。
- 当日详情卡（L69-116）：detail-head（eyebrow + 日期 h2 + StatusBadge 状态）→ detail-hero（Dumbbell 图标 + 计划标题 + 副文案 + 锁定 Lock 图标）→ plan-item 列表 → rest-note 空态 → 替换候选区 → detail-actions。
- plan-item 行（L83-94）：左图标（按 TrainingType 映射 lucide）+ 名称 + note（含「已锁定 / 已完成」em 标记）+ 时长数字 + 右侧「标记完成 / 锁定」两枚 aria-pressed 的 mini 按钮。
- 替换候选区（L98-105）：每行一个原动作名 + 最多 2 枚带 reason 的候选按钮；无候选时 replace-none 用文案解释"被器材、场地或需要避开的筛掉了"。
- 四周周期视图（L119-128）：4 个 phase 卡片（基础准备 / 强度建立 / 量化提升 / 减量与测试），每张含 phase-tag（当前/已过/计划中）、load-bar 百分比条、相对四周峰值负荷的百分比与该周起止日。
- 版本与调整卡（L130-154）：版本卡显示"有 1 条调整建议等待确认"并可展开预览（adjust-row 的「原安排 → 建议改为」对比 + 接受/保持原计划两个动作）。
- 本机计划历史卡（L156-163）：最近 6 个版本的账本行（版本号 / 模式 chip / reason / 创建时间）。
- PlanDraftDialog（独立组件，AppShell 挂载）：LLM 的 loading → questions → ready → error 四态，questions 阶段是选项 chip + 自由输入，ready 阶段是可编辑的草稿表格（动作名/类型/时长/组/次 + 增删动作与训练日）。
## UI 模式
- 布局骨架：单页纵向 flow —— page-head → toolbar(tabs + 版本区) → 提示条(gate-note / ver-reason / conflicts) → 可折叠手工表单 → 主体（周视图两栏 或 周期四列）→ 版本卡 → 调整预览卡 → 历史卡。所有区块都是 BaseCard 堆叠，无抽屉、无分页。
- 卡片样式：BaseCard default 表面（白底 + 1px 发丝线 + inset 顶亮描边，无投影）；日历卡与详情卡通过 CSS 变量 --card-pad: 0 0 18px 覆写内距自己接管 padding，卡片内部分隔一律用 --hair-soft 发丝线而非边框或阴影。
- 状态呈现：日历格三态 today（accent 实心块 + 白字 + 反色小圆点）、selected（accent-soft 底 + inset accent-line 描边）、rest（--hair-strong 灰字）；条目状态用文本 em 标记（「· 已锁定」「· 已完成」）而不是形状/颜色区分；顶部状态用 StatusBadge（已过去=neutral / 待完成=info / 休息日=success）。
- 交互方式：整格可点的日历 button + 翻月箭头（canForward 限死到当前月 +3）；行内 mini 按钮做完成/锁定（aria-pressed 承担 pressed 语义）；替换候选做成带 reason 副标题的整块按钮；调整预览做成「原安排 → 建议改为」的对比行；无任何拖拽或手势。
- 空态：休息日用 Moon 图标 + 「这一天没有安排训练。它表示"未安排"，不代表没有活动」；无替换候选时用 replace-none 文案解释原因而不是留白；周期缺 cycleStartDate 时用 cycle-note 明说「负荷一律标为"未记录"——不用示例数字冒充你的数据」。
- 加载态：PlanView 本身没有 loading/骨架态（所有取数都是同步 computed）；LLM 的四态全在 PlanDraftDialog 里（loading 转圈 + 阶段文案「通常 10–60 秒」、error 带 warnings 列表、questions 表单、ready 可编辑草稿）。
- 响应式：900px 断点两栏塌成一栏、周期 4 列变 2 列；767px 断点 page-head 竖排、标题降为 28px、日历格高 46→42px、版本卡竖排。⚠ 其中 .page-head :deep(button){display:none} 会把「手工录入一项」按钮在手机端整个隐藏掉，没有任何替代入口。
- 入场动效：区块用 animations.css 的 .animate-slide-in-up，详情卡带 :key="selected" 换日期时整卡重播入场，表单与调整卡用 .animate-scale-in；prefers-reduced-motion 下全部降为 0ms。
## 样式写法
全部是 scoped CSS，无 CSS 预处理器、无 UI 组件库；图标统一用 lucide-vue-next。颜色/圆角/字号/间距/动效都从 tokens.css 的 CSS 变量取值（--color-*、--hair-soft/--hair-strong、--radius-sm..lg、--space-*、--font-num/Bahnschrift、--motion-fast、--tracking-micro），PlanView 里没有一处硬编码色值，深色主题靠 tokens 全量覆盖自动生效。但 PlanView 的 118 行 scoped CSS 里仍大量硬编码 px（gap:24px、padding:18px 0 16px、height:46px、font-size:11.5px 等），--space-* 这一整套间距令牌在 PlanView 里几乎没用。重复的自定义样式：① .eyebrow 在 PlanView L425、OnboardingView L441、SettingsView L415、InsightCard.vue L47 各定义一次，且 PlanView 是「14×1px 横线 + muted + uppercase」而另外两处是「6px 旋转 45° 方块 + accent」，两种形态并存；② .page-wrap 在 PlanView L423 / MealsView L543 / OnboardingView L439 / SettingsView L413 重复定义，max-width 还各不相同（1440 / 1440 / 760 / 860）；③ .page-head 在 PlanView L427、OnboardingView L440、SettingsView L414 重复定义；④ 周标签数组在 PlanView L188、weekRules.ts L7、utils/time.ts L1 三处各存一份；⑤ 按钮有三套并行的自绘实现（.regen、.mini、.alt、.tabs button、.month button），没有走 BaseButton 的 variant 体系，改主色要逐个改；⑥ .manual input（L448）重复了 globals.css L117-125 已经做过的 input 聚焦环与内阴影。
## 数据流
【输入】store.userProfile（age / availableTimes '10 分钟' 这类字符串 / equipment / availableVenues / restrictions / cycleStartDate）、store.currentMode、store.plans + store.planHistory、store.sessions + store.meals。【规则路径】PlanView.itemsOn(L215) → planRules.buildDayPlan(date, profile, mode) → exercises.activeExercises() + blockers/passesRestrictions/hasEquipment → DayPlan{items, conflicts, auto, gateNote, ruleVersion} → PlanItem{id:`${date}-${ex.id}`, planId:'plan-v3', exerciseId, exerciseName, type, note(reason??howto), plannedDuration, plannedSets, plannedReps, locked(type==='坐站训练'), completed:false, alternatives(≤2)}。【落盘】store.ensureWeekPlan(L266) 把 7 天结果写进 plans[]，items 的 planId 被改写成真实 plan id；旧版本进 planHistory。【LLM 路径】PlanView「用模型规划」→ store.generatePlanQuestions() → llm.buildPlanQuestionMessages → /api/llm/chat 代理 → validatePlanQuestions → planDraftState.status='questions'；PlanDraftDialog 答题 → store.generatePlanDraft() → buildPlanMessages → validatePlanDraft → 'ready'（草稿存在 PlanDraftDialog 的 local 本地副本，用户可改）→ store.acceptPlanDraft() 写入 source:'llm' 的 Plan，旧版本进历史。【编辑】锁定/完成/替换/搬移/手工录入全部经 store.bumpVersion —— 一次改动 = 一个新版本，理由文本写进 plan.reason。【读取】store.weekPlan(date) 按 weekStartDate + mode 匹配；store.dayPlanNotice(date) 合并「已存计划 items」与「规则实时算出的 conflicts / gateNote / stale」。【周期负荷】PlanView.cyclePhases → weekRules.buildWeeklyReport(sessions, meals, refDate) → totalLoad。【持久化】全部走 localStorage key 'twopoles_state'（plans / planHistory / profile / sessions / meals 一起 JSON 化），无服务端。【props/emits】PlanView 是路由页，没有 props/emits；PlanDraftDialog 也没有 props，靠 store.planDraftState 单向驱动、确认/取消回写 store action —— 也就是说计划子系统没有组件级契约，改版要自己造。
## 状态模型
视图局部状态：view: 'week' | 'cycle'（唯一真正的 tab 状态机）；cursor {year, month}；selected（ISO 日期字符串）；adjustOpen / adjustResolved（boolean）；manualOpen（boolean）；manual {date, name, minutes} + manualError。计划级：store.plans[] 是「每周一份当前计划」，无 plan 时 weekPlan 返回 null —— 页面因此存在「有落盘计划 / 只有规则实时预览」两种数据来源，PlanView.itemsOn(L215) 负责合并；Plan 有 version(number)、mode、source: 'rules' | 'llm'、locked、reason。规则级：DayPlan.auto(boolean) 表示是否允许自动推荐，false 时附 gateNote；DayPlan.conflicts: string[] 是无解原因列表而不是状态枚举；DayPlan.ruleVersion 恒为 'plan-rules-v3'。条目级：PlanItem.locked 与 PlanItem.completed 是两个独立布尔，不是互斥状态机（可以同时为真）；规则生成时 locked 恒等于 (type === '坐站训练')；替换动作通过 PlanChange{type:'unchanged'|'changed'|'locked'} 表达，但全项目实际只用过 'changed'，PlanAdjustment 类型则完全没被实例化。动作级：Exercise.status: 'active' | 'retired'；TrainingType 六个值（跑步/动态热身/坐站训练/站姿弯举/舒缓整理/其他）。LLM 草稿状态机（store.planDraftState.status）：idle → loading(loadingStage 'questions') → questions → loading('plan') → ready →（用户改 local 副本）→ acceptPlanDraft 落盘；任意阶段可进 error；planRequestId 用于丢弃过期响应（防止关闭弹窗后晚到结果又弹出来）。
## 耦合
【跨组件 import】PlanView 同时 import 4 个 service 与 3 个 utils：planRules(buildDayPlan/alternativesFor)、exercises(findExercise)、weekRules(weekDates/weekStart/buildWeeklyReport)、utils/time(eyebrowDate/monthCells/shortDate/toISODate)。【共享 store 字段】plans、planHistory、currentMode、userProfile、sessions、meals、planDraftState、planLlmReady、collapsedCards、toasts。【共享类型】domain.ts 的 Plan / PlanItem / AlternativeExercise / UserProfile / TrainingType / Mode 被 exercises.ts、llm.ts、planRules.ts、app.ts、5 个 view 共用。TrainingType 枚举同时出现在 exercises.ts 的 type 字段、llm.ts 的 TRAINING_TYPES(L58)、PlanView 的 icons 映射(L198-205)、domain.ts 的联合类型，改动作类型要同步四处。【关键耦合点 1】排课规则不在 store 里，视图直接调 service：DashboardView L281/L455 与 weekRules L71 都直接 import buildDayPlan/isPlanDay —— 换掉排课引擎要同时改 planRules.ts、stores/app.ts、DashboardView.vue、weekRules.ts、OnboardingView.vue 五个文件。【关键耦合点 2】动作中文名是事实上的主键：findExercise(exercises L126) 用 name 查库、PlanView L250 用它找替换来源、ExecutionView L344/L518 用它取 camera 阈值、/execution?exercise=<中文名> 是跨页深链、PlanItem.id 在规则项里是 `${date}-${ex.id}` 而手工项是 `${date}-${name}-m${ts}`、LLM 项是 newId() —— 三种 id 格式并存。【关键耦合点 3】场地字符串 '宿舍或家'/'家'/'健身房'/'户外' 在档案里是自由字符串，靠 planRules L24-29 的 VENUE_LABELS 映射到 Venue 枚举，改档案选项要同步这张表。【关键耦合点 4】PlanDraftDialog 挂在 AppShell（L16）而非 PlanView，LLM 弹窗是全站共享的，改版时不能把它当计划页的私有子组件重写。【注释与实现不符的耦合】planRules L1 注释称"周报与侧栏都用它"，但 SidebarNav 现在只有导航项、根本不显示计划数；ReportView/DashboardView 用的是 weekRules 的 plannedSessions，不是 planRules 的 items。
## 设计债
- planRules.ts L132-134 的 mainTypes 在 athlete 分支里算完就扔：mode==='athlete' 走的是 L136-145 的独立分支，mainTypes 只有 else 分支（L151）会读，athlete 那份 ['跑步','舒缓整理'] 永远没人用。
- planRules.ts L19 TRAINING_WEEKDAYS=[1,3,5] 让规则计划一周固定只有 3 天，而 llm.ts L319 的提示词要求大众 4–5 天、运动员 5–6 天。两条生成路径的训练天数口径不一致，同一周里"计划数"有两个答案，用户在规则计划与模型计划之间来回切换会看到完全不同的排课密度。
- weekRules.ts L71 的 plannedDays 只认 isPlanDay（规则），从不读 store.plans。用户接受了一份 5 天的模型计划后，DashboardView L88/L124/L197 与 ReportView L184 仍然显示"3 场"，完成率分母是错的。planRules.ts L1 注释宣称"周报与侧栏都用它，避免'计划数'两处算得不一样"——只统一了规则 vs 规则，规则 vs 已存计划这一对还没统一。
- stores/app.ts L319-334 regenerateWeekPlan 把旧版本推进历史后调 ensureWeekPlan，而 ensureWeekPlan L283 永远写 version: 1；acceptPlanDraft L572 却用 (old?.version ?? 0) + 1。三处版本号口径不一致，"按规则重算"会让 PlanView L14 显示的版本号从 v3 退回 v1。
- stores/app.ts L595 bumpVersion 原地改 plan 对象（plan.items = items; plan.version += 1），而 L624-638 的 toggleItemLock / markItemCompleted 每次点一下都调它 —— 锁一个动作、标一次完成各产生一条历史版本，planHistory 里全是无意义噪声，PlanView L211 recentHistory 只显示最近 6 条，真正有意义的版本被挤掉。
- PlanView L340-348 applyReplace 的 newValue 只改 exerciseName / note / plannedReps，不改 type 也不改 plannedDuration，而 stores/app.ts L612 acceptAdjustment 直接 {...item, ...newValue} 覆盖。替换后 PlanView L239 planTitle、L313 iconFor、L241 firstExercise 用的都还是旧 type，会出现"标题写'无器械基础体能'、图标是 PersonStanding、名字却已是弹力带弯举"。
- PlanView L241-243 firstExercise 只按 type 找（坐站训练/站姿弯举），但 exercises.ts 里 type='站姿弯举' 有三条（L63 站姿弯举、L64 弹力带弯举、L65 水瓶替代弯举），只有 L63 带 camera 配置。firstExercise 可能挑中一个没有 camera 的动作跳到 ExecutionView，而 ExecutionView L344-348 拿不到 camera 就 counter=null —— 跟练链路静默降级。
- PlanView L62-66 的图例画了三种圆点（.dot.plan / .dot.locked / .dot.rest-dot），但 L59 日历格只渲染一个 <i>，后两种 class 只存在于 L474 的 CSS 里，日历网格根本区分不出"锁定日"。图例在骗人。
- PlanView L540 的响应式规则 .page-head :deep(button){display:none} 会在 767px 以下把「手工录入一项」按钮整个隐藏，而手工录入是未满 18 岁用户的唯一安排入口（planRules L114 的 gateNote 就写着"需要安排请在计划页手工录入"）—— 手机端这条路径直接断掉。
- planRules.ts L76-80：pick() 里时长超限的候选被 continue 掉且不留任何原因。同一类型池里若既有被限制筛掉的也有超时的，最终 conflicts 只报限制原因，超时原因静默丢失；反过来若池里全部因场地/器材被挡，blocked 非空，超时信息也永远看不到。
- planRules.ts L57 的 `profile.equipment.length &&`：器材数组为空时整个器材过滤被跳过，等于"没填 = 不过滤"。而 OnboardingView L271 的器材选项里就有字面量 '无器材'，选了它反而不满足 hasEquipment，不选反而会被推荐"坐站训练（需要椅子）"。语义自相矛盾。
- planRules.ts L55 的 `ex.status === 'retired'` 判断是死代码：pick(L71) 与 alternativesFor(L189) 都只遍历 activeExercises()，retired 条目永远进不来。这道防线目前只在 exercises.ts L3 的注释里。
- planRules.ts L147-166 的排课顺序写死成"取动作库池内第一个通过的条目"：热身几乎恒为肩环绕（1min）、力量恒为靠墙静蹲、放松恒为大腿后侧拉伸。动作库 30 条里规则最多命中 8–9 条，弹力带划船、臀桥、鸟狗式、侧支撑、提踵、开合跳等永远进不了规则计划 —— 动作库相对于规则引擎是半成品，改版时"丰富动作库"不会改变界面输出。
- planRules.ts L169-173 给每个 item 填 item.alternatives，但 PlanView L246-256 的 replaceTargets 完全不用它，而是重新调 alternativesFor —— 同一份候选算两遍；PlanItem.alternatives 这个字段全项目零读取点。
## 约束
- 训练日固定为周一/三/五（planRules L19 TRAINING_WEEKDAYS=[1,3,5]）是产品口径（大众模式一周 3 次），改版只能改呈现不能改这个算法；模型路径的 4–5/5–6 天是另一条口径，两者要并存还是统一属于产品决策而非界面决策。
- 可用时间预算 = profile.availableTimes 里的最大值（planRules L42-45 budgetMinutes，parseInt 解析 '10 分钟' 这类字符串，无值时兜底 20 分钟）；时长的单位一律是分钟，且 PlanItem.plannedDuration 是唯一权威时长字段。
- 安全门槛不可弱化：未满 18 岁（AUTO_RECOMMEND_MIN_AGE）不生成任何自动推荐；命中 GATE_RESTRICTIONS（'孕期或产后'、'伤病或遵医嘱限制'）也不生成自动推荐，只能手工录入（exercises L97-103）。这两条是适用范围门槛而不是动作过滤器，界面上必须继续明确写出"可以记录但不生成推荐"，不能弱化成一句提示。
- 过滤口径一一对应且不可改语义：exercises.ts 的 jumpFree / kneeFriendly / spineFriendly 三个布尔 + intensity 四档，对应档案里的 '无跳跃' / '膝部负担小' / '腰部负担小' / '低强度起步'（exercises L105-114）；器材用 OR 语义（hasEquipment L117-120，动作器材与档案器材有任一交集即满足），场地用交集语义。
- 动作库条目带 source 标注「自编演示条目 · 参照常见居家训练动作，未经专业人士审核」（exercises L8）。任何新界面都不得把它呈现为专业处方；status:'retired' 的条目（L81）不得用于新推荐。
- 摄像头跟练只支持带 camera 配置的动作：ex-chair-sitstand（joint knee, neutral 168, bottom 100, minStageMs 220）与 ex-stand-curl（joint elbow, neutral 170, bottom 55, minStageMs 180）。这些角度阈值是 useRepCounter 状态机的识别口径（迟滞 8°、minRepMs 700、maxStageMs 6000、minVisibility 0.5），UI 层不能改；"开始跟练"入口必须继续只对有 camera 的动作开放。
- 持久化格式：localStorage key 'twopoles_state' 里存 plans / planHistory / profile / sessions / meals / unitGrams（app.ts L105、L138-151）。Plan / PlanItem 的字段改动必须向后兼容旧数据（app.ts init 只对 profile 做了 normalizeProfile，plans 没有兼容层，改结构要自己兜）。
- 版本语义：一次改动 = 一个新版本，旧版本永不静默覆盖，一律进 planHistory（app.ts L322 / L546 / L595）。这是产品承诺，界面改版不能改成"就地保存"。
- 负荷口径：缺 RPE 的天整日不计入、不按 0 补齐（weekRules L66-68、loadRules L104-107）；未记录 ≠ 没发生。计划页四周周期的负荷条依赖这个口径，不能为了好看而改成 0。
- 浏览器约束：localStorage 容量有限，persistState 写失败必须提示而不是静默丢数据（app.ts L151-166）；planHistory 随每次改动增长（app.ts L322/L546），改版若增加高频自动保存会加速撑爆配额。
- 跨页深链 /execution?exercise=<动作名> 是既有契约（PlanView L328 → ExecutionView L293-344），动作名同时是查库键；改动动作命名或链接参数会打断这条链路。
- 日期口径：全部用本地时区的 YYYY-MM-DD 字符串（utils/time.toISODate），周起点是周一（weekRules.weekStart 用 (d.getDay()+6)%7），月格也是周一起始（monthCells）。跨时区/跨月的边界计算不能改成 UTC 字符串。
## 改版接缝
- 【整块可换 · 不动逻辑】月历卡 PlanView L45-67：输入只有 monthCells/cursor/selected，输出只有 select(day) 与 hasPlan(day) 两个语义。可以整体换成周视图、列表视图或横向时间轴而不碰任何规则代码。
- 【整块可换】当日详情里的 plan-item 列表 L83-94：输入是 PlanItem[]，输出动作只有 toggleComplete / toggleLock 两个。可以整块换成卡片堆叠、时间轴行、或右侧抽屉，逻辑不动。
- 【整块可换】四周周期四卡 L120-128：全部数据来自 cyclePhases 这个纯 computed（L282-307），没有副作用，可整块换成甘特条、环形图或阶段时间轴。
- 【整块可换】手工录入表单 L32-42 与本机版本历史卡 L156-163：一个 4 字段表单 + 一个纯展示列表，都与规则引擎零耦合。
- 【整块可换】工具条 L8-24：tabs 与版本区是纯展示 + 两个 store action 调用，可以换成任何形态的工具条；前提是先统一 L14-15 的版本号/模式双来源。
- 【整块可换】PlanDraftDialog 已经是独立组件（AppShell 挂载），461 行自成一体，不属于计划页内部结构；改版计划页时不必也不应该动它。
- 【必须先解耦 · 样式与逻辑揉在一起】PlanView 的 template 与 script 强耦合：detail / cycle / replace / manual 四个区块的显示条件散落在模板的 v-if 里，没有任何子组件边界。改版第一步应是抽出 PlanCalendar / PlanDetail / CyclePhases / ManualEntryForm 四个组件，computed 进 props、事件走 emits，然后再动样式。
- 【必须先解耦】replaceTargets（L246-256）被模板两处引用（L98 替换区、L114 按钮 disabled），且依赖 findExercise(L250) 这个"用中文名反查动作库"的耦合。应把候选计算下沉到 service 层，并改用 exerciseId 作为连接键（注意：LLM 生成的 PlanItem.exerciseId 是空的，需保留按名字兜底的路径）。
- 【必须先解耦】adjustment（L259-279）把超预算检测、建议文案、目标日期计算揉在一个 computed 里，UI 与算法没有分层。应抽成 planRules.adjustmentFor() 之类的纯函数，PlanView 只负责渲染。
- 【必须先解耦】cyclePhases（L282-307）在视图里现算 buildWeeklyReport，且 604800000 毫秒常量硬编码在 L293/L296。应下沉到 weekRules/loadRules，视图只拿卡片数据。
- 【必须先解耦】TrainingType → lucide 图标的映射（L198-205）把呈现决策写死在视图里；应改成可替换的 map，或让动作条目自带图标字段。
- 【必须先解耦】scoped CSS（L422-541）与 DOM 结构强耦合：.detail / .plan-item / .replace / .cycle / .phase 一整套子选择器都假设了当前的 flex 行布局与 20px 内边距；换布局必然要重写这一段，不能靠覆盖补丁。
- 【必须先解耦】store.dayPlanNotice 返回四个字段但只有两个被 PlanView 使用（stale 只在 DashboardView 用，auto 无人用）。应让 store 暴露更细的 selector（例如 planStale / planGate / planConflicts）并把 stale 真正显示在计划页上，再重画顶部提示区。
- 【必须先统一口径再改界面】"计划数"有规则与已存计划两套定义（weekRules L71 vs store.plans）。界面一旦要显示"本周 N 场"，必须先让 weekRules 的 plannedDays 优先读已存计划、规则只在没有计划时兜底，否则改版只会把矛盾固化到新 UI 上。
## 职责
承载「两仪·TwoPoles」全部视觉语言与可复用 UI 原语：一条 CSS 变量令牌体系（浅色/深色双主题）、一套全局 reset 与排版工具类、以及 11 个跨页面复用的展示/交互组件（按钮、卡片、指标条、状态徽标、形状状态、负荷图表、两仪仪表盘、洞察卡、Toast 区域、AI 计划草稿弹窗）。这层是「大规模前端界面改版」的核心资产：换皮应当主要发生在这里，页面层只做结构调整与少量逻辑改动。当前状态是"令牌体系已成型但组件层半成型"——令牌定义得相当完整且有明确设计意图（编辑式仪表盘 / 纸面 + 发丝线 / 单一强调色 / 形状编码），但组件层只有 11 个原语，缺弹层、抽屉、分段控件、骨架屏、空态、表单原语等一整片；且多个视图绕开 common 层手写重复样式，导致"换皮"会漏。
## 关键组件
- BaseButton.vue：全站唯一正规按钮。variant primary(深墨底)/secondary(白底描边)/ghost(中性底)/danger，size sm(36px)/md(44px)/lg(50px)，icon 为 lucide 组件。触控目标基线 44px 由此确立，但 size="sm" 破例为 36px。
- BaseCard.vue：两种表面的载体。variant default（白纸 + 1px 发丝线 + 顶亮内描边）/ flush（--card-pad:0，供自带表头的面板）/ ink（深墨 + 22px 细网格 + radial mask 渐隐）。内距由父组件通过 --card-pad 注入。
- StatStrip.vue：指标条。--cols: items.length 驱动的 grid，格间竖发丝线分隔；44px Bahnschrift 等宽数字 + 14px 单位 + 11.5px hint。≤1099px 降为 2×2。
- StatusBadge.vue：胶囊徽标 + 圆点。实心点=已达成/需注意/错误，空心点=进行中（info 变体），保证色觉障碍下仍可区分。
- ShapeState.vue：26×7px 的小横条，实心=记录完整、半填（54% 线性渐变）=部分记录、空心=未记录。纯形状编码，aria-label 随状态自动生成。
- LoadChart.vue：SVG 手绘的 28 天负荷图。灰底区标出"尚未开始记录"，缺 RPE 的天画 6px 斜纹短柱，CTL 实线 + ATL 虚线，下方是 ACWR 指针轨道（0.0–2.0 四档色带）。
- TwoPoleDial.vue：品牌双弧仪表。220×220 viewBox，R=90 两段 144° 弧 + 12° 顶部缺口，12 根刻度，两极各一个锚点圆，中心为 slot。tone ink/paper 两套配色。
- InsightCard.vue：eyebrow + 标题 + 图标 + 展开/收起。折叠状态存全局 store 并落盘（collapsedCards）。
- ToastRegion.vue：右上角堆叠（fixed, top 106px, 宽 min(360px, 100vw-32px)），TransitionGroup slideInRight 进出场，左侧 4px 语义色边 + lucide 图标。
- PlanDraftDialog.vue：AI 计划草稿弹层。loading(转圈+阶段文案) / error(含 warnings 列表) / questions(编号问题 + 选项按钮 + 自由输入) / ready(逐日逐项可编辑表格 + 补训练日) 四种内容态，footer 按状态切换 4 组按钮。
- MetricCard.vue：已废弃，等宽四卡指标位，零调用。
## UI 模式
- 表面只有两种：纸面（白底 + 1px 发丝线 + 顶亮内描边 var(--inner-light)，不做投影）与仪表面（深墨 + 22px 细网格 + radial-gradient 遮罩渐隐）。除弹层与 Toast 外全站无投影，层级靠发丝线与纸面厚度表达。
- 单一强调色：--color-accent #0f766e 只用于"交互、进度、已达成"，主操作按钮反而走深墨 --color-ink，避免青色抢语义。第二极 --brand-pole-b #24586f 只给"饮食"这条数据线，两极是全站唯一允许的双色场合。
- 语义色永远与形状/文字同时出现（tokens.css:51 明写此约束）：ShapeState 用实心/半填/空心三种几何，StatusBadge 用实心点/空心点，保证色觉障碍下可读。
- 数字先行：所有"量"用 --font-num（Bahnschrift，Windows 自带 DIN 骨架）+ font-variant-numeric: tabular-nums + 负字距（-0.02em ~ -0.045em），保证两组数字能竖向比较。拉丁小标签用 10px + 0.17em 字距 + uppercase。
- 面板内距走 --card-pad 变量而非组件抢 padding（README 明列为样式约定），父子通过 scoped CSS 在子组件根节点上注入自定义属性。
- 进场动效一律无错位（不带 delay），仅 5 个 .animate-* 工具类；循环动效只留给加载与"演示进行中"。prefers-reduced-motion 在 tokens.css 与 animations.css 双处降级到 0ms。
- 响应式只有 3 个主断点：≥1100px 桌面（86px 图标脊 + 多列）/ 768–1099px 平板（图标脊收成抽屉，仪表改横向布局，StatStrip 转 2×2）/ ≤767px 手机（底部 4 Tab 胶囊栏 + 全单列 + 仪表缩到 132px）。StatStrip 的 2×2 补线是硬编码 nth-child(3)/(4)。
- 弹层统一形态：Teleport to body + 全屏 scrim + 居中卡片（宽 min(840px,100%)，max-height min(90vh,950px)），≤720px 转成底部圆角 sheet。但这是三个组件各自复制的，不是共享原语。
- Toast 右上角堆叠，左侧 4px 语义色边 + 图标，5 秒自动消失可手动关闭，TransitionGroup 做滑入滑出。
- 仪表语言：SVG 轨道 + 描边 + 锚点圆，颜色只做冗余；轨道与进度共用一套 --brand-pole-a/-b 及其 dark 变体。
- 空态策略是"文案优先 + 不画成 0"：负荷图缺失显示"—"或斜纹而不是 0；未记录与没发生是两套独立表达（ShapeState 的空心 vs LoadChart 的灰底区）。
- 响应式处理是纯视口断点，没有容器查询；组件无法感知自身可用宽度，因此 DashboardView 必须靠 .dial/--dial-size 之类的外部覆盖来改尺寸（其中一处因内联样式而失效）。
## 样式写法
令牌体系 100% 是 CSS 自定义属性，全仓没有任何 TS 侧的设计常量（grep "export const.*COLOR|TOKEN|PALETTE" 零命中），组件一律在 scoped CSS 里用 var(--x) 消费。结构上是"三层"：tokens.css 定义 :root 全部令牌 + html[data-theme="dark"] 整组覆盖（浅色/深色两套，组件零感知）；globals.css 做 reset + 排版基线 + 5 个工具类（.container/.micro/.num/.hairline/.visually-hidden）；animations.css 提供 7 个 keyframes + 5 个 .animate-* 入场工具类；gradients.css 只剩一条 .gradient-shimmer。所有 SFC 用 <style scoped>，无 CSS-in-JS、无 CSS Modules、无 Tailwind/UnoCSS。main.ts 顺序引入这 4 个文件，是全站样式的唯一装配点。

令牌覆盖有明显断层与绕过：
1) 圆角阶梯被绕过 —— tokens.css 只定义 6/8/10/12/16/999 六档，但代码里实际出现 3/4/5/7/8/9/10/11/12/13/14/15/16/18/999 共 15 种硬编码圆角（如 PlanDraftDialog.vue:434 的 11px、InsightCard.vue:42 的 13px、ToastRegion.vue:4 的 15px）。
2) 阴影基本闲置 —— --shadow-xs/--shadow-sm/--shadow-card 全站零引用，阴影只出现在弹层与 Toast；--shadow-accent 被 InsightCard.vue:43 引用但其值是 none，所以那半个阴影永远不显示。
3) Spacing 令牌几乎不用 —— 组件里大量写裸值（12px/13px/15px/11.5px），--space-3/--space-12/--space-16 零引用。
4) 死令牌 —— --gradient-brand、--gradient-hero、--shadow-hero、--hairline、--motion-instant、--easing-elastic、--space-12、--space-16 全仓 0 引用；--breakpoint-sm/md/lg/xl 注释写着 "used in media queries"，但 CSS 自定义属性根本不能用在 @media 条件里，实际代码用的是 1099/1279/767/720/520/1100 六个数字，与令牌毫无关系。
5) 焦点环两套并存 —— globals.css:135 的 *:focus-visible{outline:2px solid var(--color-accent)} 与 BaseButton.vue:7 的 box-shadow:0 0 0 3px rgba(15,118,110,.32) 语义重复。

可收敛的重复手写样式（每条都有明确出处）：
A. 按钮 4 份：BaseButton.vue:4-18（正规）、DashboardView.vue:554-560（.btn/.btn.primary/.btn.ghost，Dashboard 的"开始跟练"根本没 import BaseButton）、PlanDraftDialog.vue:434-437、TopBar.vue:254-256。四份的圆角(10/11/8)、高度(44/42/38)与主按钮底色各不相同。
B. 输入框 3 份：PlanDraftDialog.vue:394(.q-input)、:414-417(.n)、:418-421(.name-input,.type-input)、:427(.add-day select) —— 四套几乎一样的边框/圆角/字号。
C. chip/badge 3 份：DashboardView.vue:579-584(.chip + .ok/.part)、StatusBadge.vue:5-11(.badge)、SettingsView.vue:177-184(手写 chip 组)；语义色/边框/圆角各写一遍。
D. 柱状图 4 份：LoadChart.vue(SVG)、ReportView.vue:329-336(.plot)、DashboardView.vue:652-661(.bars)、ReportView.vue:60-68(.matrix 餐食格)。
E. 弹层 3 份：PlanDraftDialog.vue:352-360、FoodCaptureDialog.vue:888、MealPhotoViewer.vue:132 —— scrim 底色 .46/.46/.72、blur 3px/3px/4px 都不一样。
F. 空态 4 份：DashboardView.vue:218/231-233、ReportView.vue:110-116、MealPhotoViewer.vue:140。
G. 硬编码品牌色：ReportView.vue:331 与 DashboardView.vue:654 都写了同一串 linear-gradient(180deg, #12857c, #0c655e)，绕过 --color-accent/--brand-pole-a 且不随深色主题变化。
H. 焦点环 2 套（同上）。
I. LoadChart.vue:177/184/187/192/193/207 共 6 处 rgba(17,22,26,α) 硬编码（发丝线/柱/基线/未知带），未用 --hair/--hair-soft/--hair-strong。
J. 同一个"缺 RPE"语义有两种编码：ReportView.vue:334 用 45° 斜纹（repeating-linear-gradient），LoadChart.vue:187 用一段 6px 的实色短柱。
K. 星期中文有 3 份实现：utils/time.ts:1(WEEKDAYS_CN)、services/llm.ts:161(WEEKDAY)、PlanDraftDialog.vue:247(WEEKDAY)。

缺失的常见 UI 原语（改版时大概率要新写）：
- 弹层/Modal：无 BaseDialog。三处手写（PlanDraftDialog / FoodCaptureDialog / MealPhotoViewer），其中只有后两者有 Escape 键与焦点管理，PlanDraftDialog 两者皆无，也没有 body 滚动锁。
- 抽屉/Sheet：无。AppShell 的移动导航抽屉在 SidebarNav 里自绘；PlanDraftDialog.vue:441 的窄屏底部圆角面板相当于一次性实现的 sheet。
- 分段控件：无。主题三选（SettingsView.vue:177-184 的 chip 组）、模式切换（TopBar.vue:33-68 的 popover menu）、周切换（ReportView.vue:10-12 的三按钮）、日期区间 —— 四种形态四种实现。
- 图表层：无通用 chart 原语，除 LoadChart 外全是 div 手写柱/格。
- 骨架屏：无。gradients.css:1-5 的注释说原 .skeleton 工具类"经 grep 确认无引用故整批移除"，于是现在全站零骨架屏，PlanDraftDialog.vue:370-375 只好自己写 @keyframes spin。
- 空态：无 EmptyState 组件，4 处各写各的。
- 表单原语：无 Select/Input/NumberField/Switch/RadioGroup/Checkbox/Tabs/Accordion/Tooltip/Avatar/ProgressBar/Slider/DatePicker/Table。
- Toast 原语：只有 ToastRegion 一体成型，没有独立的 BaseToast 供复用；也没有 Toast 队列 composable（调用方必须直接改 store.toasts）。
## 数据流
令牌流：tokens.css 的 :root 变量 → 组件 scoped CSS 的 var(--x) → html[data-theme="dark"] 整组覆盖（由 stores/app.ts:87 的 applyTheme() 写 document.documentElement.dataset.theme 驱动）。TS 侧没有任何设计常量副本，这是纯 CSS 令牌体系。副作用是：SVG 组件也用 var() 着色（可行），但硬编码 rgba 就成了破口（见 designDebt）。

组件数据流分三类：
1) 纯 props / slot，无 store、无 emit：BaseCard（只有 interactive/glass/variant 三个 prop + 默认 slot）、BaseButton（variant/size/disabled/icon + click emit）、StatStrip（items: StatItem[]，StatItem 从 SFC 的普通 <script lang="ts"> 块导出供调用方 import）、StatusBadge、ShapeState、TwoPoleDial（training/meal/size/tone/showTicks/showInnerRing/ariaLabel + 中心 slot）、MetricCard（已废弃）。
2) 直接读 Pinia：InsightCard.vue:36-37 用 useAppStore() 读 collapsedCards；ToastRegion.vue:2 读 store.toasts 并调 store.dismissToast(id)。展示组件因此与全局状态绑定，无法独立复用/快照测试。
3) 容器型：PlanDraftDialog.vue:186-187 从 store.planDraftState 读五态状态机，本地用 JSON.parse(JSON.stringify(draft))（第 205 行）做可编辑副本，编辑只落在 local ref 上，确认时 cleanItem() 裁剪后调 store.acceptPlanDraft(cleaned) 入库。store 是唯一真源。

数据来源分层：页面取数走 services（loadRules.buildLoadSeries / weekRules.buildWeeklyReport / mealRules.summarizeDay / planRules.buildDayPlan），组件只接收结果——LoadChart 的 8 个 props 全部来自 buildLoadSeries()，组件自己不碰 store。持久化只有一路：stores/app.ts 的 persistState() 写 localStorage key "twopoles_state"，字段为 mode/profile/sessions/meals/privacy/collapsed/theme/plans/planHistory/modeLog/unitGrams；LLM 配置单独一个 key；照片走 IndexedDB（services/mealPhotos.ts）。
## 状态模型
本子系统有 5 套独立的状态模型，全部是"散落在各自文件里"的形态，没有统一的状态原语：

1) PlanDraftDialog 的五态机（唯一真正复杂的一套）。定义在 services/llm.ts:145-154 的 PlanDraftState：status: 'idle' | 'loading' | 'questions' | 'ready' | 'error'，另加 loadingStage: 'questions' | 'plan' | null。实现分散在 stores/app.ts:341-530（generatePlanQuestions → generatePlanDraft → acceptPlanDraft / resetPlanDraft），组件侧只按 status 做 v-if 分支。问题：status 与 loadingStage 是两个平行字段而非判别联合，因此 status:'ready' & loadingStage:'questions' 这类非法组合在类型层面可表达；模板里 PlanDraftDialog.vue:16 又用 `state.loadingStage === 'questions' ? ... : ...` 二元判断来区分两个 loading 阶段。

2) Toast 生命周期（stores/app.ts:685-711）：showToast 推入 toasts[] 并 setTimeout(duration 默认 5000) 自动 dismiss；dismissible 恒为 true（Toast 类型在 types/domain.ts:366-373，type 为 'success'|'error'|'warning'|'info'）。没有队列上限、没有去重。

3) InsightCard 折叠态（stores/app.ts:66/855-864）：collapsedCards: string[] 的扁平数组，toggleCard 做 push/splice。折叠 id 是硬编码字符串（'report-quality'、'meal-rules'），没有注册表/命名空间，新增卡片必须自己保证 id 唯一且稳定。

4) ShapeState 的 complete/partial/none（ShapeState.vue:18）与 StatusBadge 的 success/warning/danger/info/neutral（StatusBadge.vue:2）——两套都是"语义枚举 + 颜色 class 名一一对应"的隐式契约：改枚举字符串会静默丢掉样式，没有任何 TS 映射表。

5) LoadChart 相关：LoadDayState = 'load'|'rest'|'missing'|'unknown'（loadRules.ts:12）、LoadZone = 'low'|'optimal'|'high'|'veryHigh'|'unknown'（loadRules.ts:142）。LoadZone 的字面量字符串直接被当作 CSS class 名用（LoadChart.vue:68、219-222），所以 service 枚举改名 = 图表静默失色。

6) 主题三态（stores/app.ts:67 themePref: 'system'|'light'|'dark'）→ applyTheme() 落到 document.documentElement.dataset.theme → tokens.css:199 的 html[data-theme="dark"] 整组覆盖。
## 耦合
跨子系统 import（common 层 → 其它层）：
- LoadChart.vue:82-83 → @/services/loadRules 的 LoadPoint / LoadZone / LOAD_ZONE_TEXT。图表的 class 名（.low/.optimal/.high/.veryHigh）与 LoadZone 字面量一一对应。
- PlanDraftDialog.vue:179-183 → @/services/llm（TRAINING_TYPES、usingDefault、PlanDraft/PlanDraftDay/PlanDraftItem）、@/services/exercises（activeExercises、findExercise）、@/services/weekRules（weekDates、weekStart）、@/utils/time（toISODate）。
- InsightCard.vue:27 / ToastRegion.vue:2 / PlanDraftDialog.vue:177 → @/stores/app（useAppStore）。common 层的展示组件直接依赖 Pinia store。
- BaseButton.vue:2 / InsightCard.vue:25 / ToastRegion.vue:2 → lucide-vue-next 的图标组件（BaseButton 用 icon?: Component + :size 传尺寸）。

隐式 CSS 契约（最容易在改版中被打断）：
- BaseCard.vue:30 读 var(--card-pad, var(--space-6))，父组件通过 scoped CSS 给 BaseCard 根节点写 --card-pad 来控制内距（DashboardView.vue:623、:676，InsightsCard 同样）。这个变量没有 TS 类型、没有 props 声明，纯粹靠 Vue scoped CSS "子组件根节点受父作用域影响"的机制工作 —— 改用 CSS-in-JS、Shadow DOM 或改 BaseCard 根节点结构都会让它静默失效。
- TwoPoleDial 的根 class 名就是 .dial，DashboardView.vue:632 与 :729 用 .dial 选择器给子组件根元素定 align-self/margin-top/--dial-size —— 父组件依赖子组件的内部 class 名，属于跨层样式耦合。
- BaseCard 的 variant='flush' 里写 --card-pad:0（BaseCard.vue:41），靠 .card.flush 的双 class 特异性压过父组件的 .gauge/--card-pad，改 class 命名会破坏优先级。
- StatStrip 的 StatItem 类型从 SFC 普通 script 块导出（StatStrip.vue:13-22），调用方写 import StatStrip, { type StatItem } from '...'（ReportView.vue:141、MealsView.vue:243）—— 类型定义寄生在组件文件里，无法单独复用。
- globals.css 的 .micro / .num 是全局工具类，被所有视图直接用；DashboardView.vue:212 甚至用内联 :style 改 .micro 的颜色，说明工具类缺少变体。

状态耦合：InsightCard 的折叠态经 store.collapsedCards 持久化到 localStorage 的 collapsed 字段（stores/app.ts:115/146），cardId 字符串是跨版本的持久化主键。

视图层耦合：common 组件的 props 契约被 9 个视图消费，其中 DashboardView.vue:170-182 对 TwoPoleDial 的用法把"低强度/高强度"语义塞进了"训练/饮食"两个 prop（:training="isAthlete ? lowPct : trainingPct"），语义随模式漂移。
## 设计债
- MetricCard.vue 整个文件是已废弃的半成品：第 16-19 行 @deprecated 注释自称"当前无任何调用"，全仓 grep 复核确认零引用（唯一命中是它自己的注释），却仍占 72 行、还带着一个模板与样式都没用到的 accent?: string prop（第 27 行）。改版前直接删，不要在新皮肤里再造一个 "MetricCard v2"。
- BaseCard.vue:12-20 的 interactive 与 glass 两个 prop 全仓零调用（grep "variant=\"glass\"|:glass|interactive" 在 src 下无命中）。其中 glass 的注释写"保留是为了不打断现有调用"，但根本没有任何调用需要被打断；连带 BaseCard.vue:67-79 的整套 backdrop-filter + @media (prefers-reduced-transparency) 降级逻辑是纯死代码（该媒体查询特性全站只此一处用）。
- TwoPoleDial.vue:5 用内联 style 写死 --dial-size: ${size}px，而 DashboardView.vue:729 想在 ≤767px 用 .dial{--dial-size:132px} 缩小它 —— 内联样式优先级恒高于 scoped class，**移动端缩小仪表的规则从来没有生效过**（手机上仪表仍是 228px，会撑破 DashboardView.vue:727 的 132px 栅格列）。这是"几何走 prop、尺寸走 CSS 变量"两条路互相打架的典型样本，也是必须先解耦才能换皮的地方。
- LoadChart.vue:132-146 的 polyline() 在组件里重算了一遍 CTL/ATL 移动平均，而 loadRules.ts:112-118 已经算好 ctl/atl 直接传进来了，且两套口径不一致：loadRules.ts:113 的 acutePoints 用 .filter(p => p.state==='load'||p.state==='rest') 把缺 RPE 的天剔除，LoadChart.vue:134 的 vals 却把 missing 天映射成 p.load ?? 0 = 0 并留在 7 天窗口里。结果是**图例里的 "ATL 7 天" 数字（来自 service）与图上 ATL 虚线末点的纵坐标可以不相等**，缺 RPE 越多偏差越大；同时组件还把窗口常量 7/28 复制了一份（loadRules 的 DEFAULT_ACUTE/DEFAULT_WINDOW）。
- LoadChart.vue:229-235 的 ACWR 色带把分档阈值写成了 40% / 65% / 75%（= 0.8/2、1.3/2、1.5/2），与 loadRules.ts:144-149 loadZone() 的阈值 0.8 / 1.3 / 1.5 是同一组数字的两个副本。改任一处而漏另一处，色带就会与文案说谎。
- LoadChart.vue:233 写了 var(--color-caution-soft, #f6ecd8)，但 --color-caution-soft 在 tokens.css:55 已定义且值就是 #f6ecd8 —— fallback 是复制粘贴留下的重复真值，掩盖了"这个变量到底存不存在"的疑问。
- LoadChart.vue:177/184/187/192/193/207 共 6 处硬编码 rgba(17,22,26,α)（发丝线、柱体、基线、未知带、图例色块），没走 --hair / --hair-soft / --hair-strong。全仓没有任何组件级 dark 覆盖（grep data-theme 只命中 tokens.css:199），所以**深色主题下 LoadChart 的网格线/柱体/基线/未知带全部是深色画在深色上，几乎不可见**。这是本次改版必须先修的可见性 bug。
- StatStrip.vue:89-97 的 2 列断点用硬编码 .cell:nth-child(3) 与 .cell:nth-child(4) 补上边线，而列数由 --cols: items.length 决定（第 2、36 行）。当前两个调用方（ReportView.vue:179-209、MealsView.vue:308-321）都恰好传 4 项所以没暴露；一旦传 5 项，2 列布局下第 5 格会拿到一条横跨行中间的 border-left。
- StatStrip.vue:92 与 :94 重复声明了 .cell:nth-child(3)（一次加 border-top、一次清 border-left），:93 又单独声明 .cell:nth-child(4) —— 同一组断点样式被拆成三条散落规则，无法整体替换。
- 语义色词汇同时存在 5 套命名：tokens 里叫 caution（tokens.css:54-55）、StatusBadge 的 variant 叫 warning（StatusBadge.vue:2）、Toast 的 type 叫 error（types/domain.ts:368）而 StatusBadge 又叫 danger、StatItem.tone 叫 caution（StatStrip.vue:20）、LoadZone 叫 high/veryHigh（loadRules.ts:142）。同一个语义 5 个名字，没有一处映射表，跨组件复用时全靠人肉记忆。
- 按钮样式被复制 4 份且互相不一致：BaseButton.vue:4-18（正规实现，圆角 10 / 高 44）、DashboardView.vue:554-560（.btn/.btn.primary/.btn.ghost，圆角 10 / 高 42 —— Dashboard 的"开始跟练"与"换一项"根本没 import BaseButton）、PlanDraftDialog.vue:434-437（圆角 11 / 高 42）、TopBar.vue:254-256（.btn-primary/.btn-ghost，圆角 8 / 高 38）。
- PlanDraftDialog.vue:143-170 的 footer 手写了 4 组按钮组合（questions / ready / error / 兜底），每组自己排一遍 ghost+primary 的顺序与 spacer，与 BaseButton 的 variant/size 契约完全脱节。
- 弹层没有统一原语，三份各自手写 scrim + dialog + 键盘处理：PlanDraftDialog.vue:2-4（.scrim 底色 rgba(17,22,26,.46)、blur 3px，**没有 Escape 关闭、没有焦点陷阱、没有 body 滚动锁**）、FoodCaptureDialog.vue:2-4 + :430（有 Escape、有 dlgEl ref 聚焦）、MealPhotoViewer.vue:2-4 + :56（有 Escape）。三份的 scrim 参数各不相同（.46 / .46 / .72，blur 3px / 3px / 4px），底部 sheet 的圆角处理也各不相同。
- PlanDraftDialog.vue:439-460 的移动端断点用 max-width: 720px，而全站其它地方一律用 767px（AppShell.vue、TopBar.vue:285、DashboardView.vue:704、StatStrip.vue:89 用 1099）。721–767px 之间会出现"页面已是手机布局、弹窗还是桌面布局"的错位。
## 约束
- localStorage 'twopoles_state' 的字段结构不可随意改名：stores/app.ts:105/138-152 读写 mode/profile/sessions/meals/privacy/collapsed/theme/plans/planHistory/modeLog/unitGrams，改字段名 = 丢掉用户本机已有数据。
- collapsedCards 里的卡片 id 字符串是跨版本持久化主键（InsightCard.vue:29 的 cardId，实例 'report-quality'、'meal-rules'），改 id = 所有用户已折叠的卡片重新展开。
- 主题机制契约：stores/app.ts:87 写 document.documentElement.dataset.theme，tokens.css:199 用 html[data-theme="dark"] 整组覆盖令牌。改主题实现必须同步改这两处，且所有令牌名（--color-*、--hair*、--space-*、--radius-*、--z-*）被全仓 scoped CSS 按名引用，不能随意改名而不全仓同步。
- --card-pad 是 BaseCard 与父组件之间的隐式公开契约（BaseCard.vue:30 读、:41 覆盖），没有 TS 声明也没有 props，任何改动 BaseCard 根节点结构都会让所有调用方的内距静默失效。
- 负荷口径（loadRules.ts:99-139）不可改：没发生 ≠ 未记录（休息日按 0 参与平均）；有记录但缺 RPE 整天从窗口剔除、不按 0 补齐；首次记录之前是"未知"（既不是 0 也不是缺失），否则新用户第一天会被算成重度减量；ACWR = 近 7 天均 / 近 28 天均，样本不足返回 null 不给假数字；且必须先算原始值再取整（loadRules.ts:116 注释：先取整再相除会把 1.49 舍成 1.5，落错档）。图表改版不得改变这些语义。
- 强度分布口径（loadRules.ts:178-203）：按 RPE 分高低两段，默认阈值 RPE>=7，用时长占比而非次数（80/20 说的是时间占比）。阈值与算法口径属于调研结论，不可为了视觉分组调整。
- 形状即语义是硬性无障碍要求（tokens.css:51 与 ShapeState.vue:32 注释）：实心/半填/空心三种几何 + StatusBadge 的实心点/空心点是颜色之外的第二重编码，色觉障碍下必须可读 —— 颜色不能成为唯一的状态通道。
- 所有"量"必须保持等宽数字（--font-num + font-variant-numeric: tabular-nums），否则两组数字无法竖向比较，这是排版版面的基础约束。
- 浏览器 API 依赖：backdrop-filter（含 -webkit- 前缀，BaseCard/Toast/TopBar/FoodCaptureDialog 共 20 处）、mask-image/-webkit-mask-image（BaseCard.vue:63-64 的网格遮罩）、color-mix(in srgb, ...)（TopBar.vue:180）、text-wrap: balance（globals.css:55）、prefers-reduced-motion、prefers-reduced-transparency、:focus-visible。降级方案不能删这些属性。
- z-index 阶梯 --z-modal-backdrop:1200 / --z-modal:1300 / --z-toast:1400 / --z-dropdown:1000 / --z-sticky:1100，新弹层与 Toast 必须落在这条阶梯上，否则与 PlanDraftDialog/FoodCaptureDialog/MealPhotoViewer 的 Teleport 层叠关系错乱。
- lucide-vue-next 的图标组件契约：BaseButton 以 icon?: Component + :size 传尺寸，InsightCard/ToastRegion 直接 import 图标组件；替换图标库会破坏这三处。
- 同仓库 ExecutionView 依赖 MediaPipe (@mediapipe/tasks-vision)、getUserMedia 与 https/localhost 要求（README 已记载），与本子系统同属一次改版但技术栈独立，界面重构不应顺手改动其识别与计数逻辑。
## 改版接缝
- 可以整块换掉、不动逻辑的（样式已与逻辑分离）：BaseCard 全部 80 行 —— 零业务逻辑，只有 variant/interactive/glass 三个 prop + 默认 slot，换皮只需改 BaseCard.vue:24-79 的 style 块；唯一要处理的是先删掉 interactive/glass 两个死 prop。
- StatStrip：items: StatItem[] 契约稳定、StatItem 类型已从 SFC 导出给 ReportView/MealsView 使用，且 44px/34px 数字层级是版面的核心节奏 —— 改版只动 StatStrip.vue:34-97 的样式与响应式规则（把硬编码 nth-child(3)/(4) 换成基于 --cols 的解法），数据侧零改动。
- ShapeState（3 状态 + width/height，零逻辑）与 StatusBadge（5 个 variant，零逻辑）：两者是纯映射表，可以整体重画形状与配色，只需保持 state/variant 字符串与 class 名一一对应的既有契约。
- BaseButton：variant/size/icon 契约稳定（9 个视图在用），可整体换皮；改之前只需补一个显式 type prop 以摆脱对 attribute fallthrough 的依赖（PlanView.vue:38 正在依赖它）。
- ToastRegion：只依赖 store.toasts 的 {id,type,title,message,dismissible,duration} 契约与 store.dismissToast(id)，是最容易整块换皮（甚至升级为 BaseToast 独立原语）的一个。
- TwoPoleDial 的配色与描边：tone ink/paper 两套 stroke 取值集中在 TwoPoleDial.vue:112-132，换品牌色只改这里；几何部分（polar/arc/144°/12° 缺口/12 刻度）不要动，它是"两仪"母题的语义载体。
- globals.css 的 .micro / .num 两个工具类已被所有视图消费，是最适合扩展为变体（.micro--accent / .micro--muted 等）的位置，能直接消掉 DashboardView.vue:212 一类的内联覆写。
- animations.css 的 5 个 .animate-* 工具类已是全局统一入口，新增入场动效应加在这里而不是各组件 scoped 里写 animation 简写（README 已就此写过警告）。
- 必须先解耦、样式和逻辑揉在一起的地方（按优先级）：
1) TwoPoleDial.vue:5 的内联 --dial-size —— 去掉 size prop 或去掉内联写法，只留一条入口，否则移动端覆盖永远失效；
2) LoadChart.vue:132-146 的 polyline() —— 算法上移到 loadRules.ts（service 已算好 ctl/atl），组件只渲染传入的路径点数组，顺带修掉 ATL 口径不一致；
3) LoadChart.vue:177-207 的 6 处硬编码 rgba —— 换成 var(--hair-soft)/var(--hair)/var(--color-border)，深色主题自动跟随；
4) InsightCard.vue:36-37 的 useAppStore() —— 改成 collapsed?: boolean + emit('toggle')，让它回归纯展示组件，折叠状态由父组件或 AppShell 接到 store；
5) PlanDraftDialog.vue:351-461 —— 461 行里模板、状态机分支、编辑逻辑、四套输入框样式、footer 四组按钮全在一起，必须先抽 <BaseDialog> 外壳 + 复用 BaseButton，再谈换皮；
## 职责
承担"拍照→识别→确认→入库"的完整饮食记录闭环，并向全应用输出结构化餐次数据。具体职责包括四条：①入口与引导——MealsView 提供"拍一张，记一顿"的主 CTA、手动补录入口、今日三餐进度 chip 与指标条；②采集——FoodCaptureDialog 负责调用摄像头 getUserMedia 或选择本地文件，生成待识别图像；③识别——把图像交给云端 LLM（`/api/llm/chat` 的 `image_url` 内容段）或本机 MediaPipe EfficientDet-Lite0，得到"食物名 + 类别 + 置信度 + 可选份量/热量"的候选清单，并强制校验（confidence 必填、不得臆造）；④入库与展示——确认后的 Meal 写入 Pinia `store.meals`，缩略图 data URL 落 localStorage，原图 Blob 落 IndexedDB，页面上以"餐次卡片 + 食物行 + 类别覆盖"展示，MealPhotoViewer 负责全屏看图。同时该子系统还是"营养数据出口"：`mealRules`/`foodComposition` 的常量与函数被 DashboardView、ReportView、SettingsView、weekRules 共同消费，改名或改语义会波及周报与首页。
## 关键组件
- MealsView.vue:6-14 `.lede` 页头：「记录饮食，拍一张就好」标题 + 右侧 `recordedSlots/3` 进度 chip（0 条时无 class，1-2 条 .part，3 条 .ok）。
- MealsView.vue:17 `<StatStrip :items="mealStats">` 指标条，4 项（已记录餐次、类别覆盖 x/8、热量估算状态、待确认项）。
- MealsView.vue:21-32 `.capture-hero` BaseCard：主 CTA「拍一张，记一顿」打开 FoodCaptureDialog，次要链接「手动补录」以 initialView='manual' 打开同一弹窗。
- MealsView.vue:35-95 `.day-grid`（grid-template-columns:1.9fr .8fr）：左侧 `.today-card`（BaseCard variant="flush"）是当日餐次卡片列表，每张卡头含餐次类型下拉（原生 select）+ 时间 + 展开箭头，展开后是食物行 + 热量摘要 + 编辑/删除；右侧 `.side-col` 依次是「今日类别覆盖」和「一餐只要三步」howto 卡。
- MealsView.vue:97-120 训练时间线 BaseCard（仅运动员模式显示）：把 meals 与 sessions 合并成按时间排序的时间线；session 时间用 `s.createdAt.slice(11,16)`。
- MealsView.vue:122-127 `<InsightCard card-id="meal-rules" :limitations>`：规则说明卡，折叠状态存 store.collapsedCards。
- MealsView.vue:1-4 `<FoodCaptureDialog>` 与 `<MealPhotoViewer>` 两个 Teleport 弹窗宿主，页面本身只是挂载点。
- FoodCaptureDialog.vue:1-60 弹窗外壳：scrim + 卡片头（标题 + 关闭「✕」）+ 底部（保存说明 + 「保存这一餐」/「重试」按钮）。
- FoodCaptureDialog.vue:61-120 拍摄区（view='capture'）：三选一——开启摄像头（`cameraActive` 内嵌 <video> + 「拍照」按钮）、选择文件（<input type=file>）、「手动补录」。拍摄区是固定深色舞台（#0d1114）。
- FoodCaptureDialog.vue:121-160 分析中（view='analyzing'）：两段式进度文案（processingStage='reading' 读图 / 'model' 跑模型），配 `.spin` 动画。
- FoodCaptureDialog.vue:161-260 结果区（view='result' 与 view='manual' 共用同一模板分支）：识别出的食物候选列表（每行含名称输入、类别下拉、份量输入+单位下拉、置信度标签、热量、uncertain 标记）+ 「再加一项」+ 识别模式切换（本机/云端）+ 同意上传勾选 + 隐私开关「只在本机保存照片」。
- FoodCaptureDialog.vue:261-300 错误区（view='error'）：展示 FoodRecognitionError 的中文文案 + 「重试」/「改用手动」两个出口。
- FoodCaptureDialog.vue 底部 action bar：「保存这一餐」（主按钮，saving 时禁用并显示「保存中…」）。
- MealForm.vue:1-120 编辑表单：`label` 标题 + 时间输入（<input type=time>）+ 若干 `.row` 食物行（名称/类别/份量/单位/热量/删除）+ 「添加一项」+ 内置目录搜索结果面板 + 常吃食物快捷 chip。
- MealForm.vue 底部 `.form-actions`：「取消」+「保存修改」。
- MealPhotoViewer.vue:1-33 全屏看图：`.photo-stage` 深色底居中放原图，底部 caption 区分「本机原图 · 仅存于这台设备」/「本机缩略图（原图未保存）」。
## UI 模式
- 页面骨架是「单列纵向流 + 局部双栏」：.lede 头 → StatStrip → 全宽 hero 卡 → .day-grid(1.9fr/.8fr) → 时间线 → InsightCard。移动端（max-width:767px）把双栏塌成单列、指标条换行。
- 卡片层级完全依赖 BaseCard：默认卡（带标题栏）、variant="flush"（无内边距，用于贴边列表）、ink 变体。子组件里没有第二套卡片实现。
- 状态呈现方式不统一：同一页里同时存在 StatStrip 数值指标、.chip 药丸标签（ok/part 两态）、.f-conf 置信度条（high/low 两色）、.badge-photo 徽标、InsightCard 的折叠说明。徽标与 chip 全部用各组件自写的 scoped CSS，没有共享的 Badge 组件（common/StatusBadge.vue 只服务别处）。
- 交互模式：列表项用「单击展开/收起」的单开手风琴（expandedId 单值），编辑用「行内展开一个 MealForm」（editingId 单值）；两层互斥状态各用一个 ref 控制，没有统一 selection 状态机。
- 弹窗模式：scrim + 居中卡片 + header(标题/✕) + 内容区 + 底部 action bar，移动端（max-width:640px）变成全屏 100vh、圆角归零。FoodCaptureDialog 与 MealPhotoViewer 各写了一套几乎相同的壳与 body 滚动锁。
- 加载态：.spin 圆环（FoodCaptureDialog:922 与 MealPhotoViewer:143 各定义一份同名 keyframes）+ 文案；错误态用 .analysisError / .cameraError 段落内嵌；空态用 .empty（MealPhotoViewer）与 MealsView 的手写空态文案。
- 响应式断点散落且互不一致：MealsView 用 1099/767，FoodCaptureDialog 与 MealPhotoViewer 用 640，MealForm 用 520，StatStrip 用 1099，ToastRegion 用 767，PlanDraftDialog 用 720；tokens.css 里定义了 --breakpoint-sm/md/lg/xl 却零引用。
- 相机预览区是固定深色舞台（#0d1114），与浅色卡片形成强对比；这导致该区块必须写死浅色文字（#cbd5dc、#e8edf1），无法直接套用主题 token。
- 图标基本不用组件库：关闭用字符「✕」，其余靠文字与色块区分。
## 样式写法
全部是 Vue SFC + `<style scoped>`，没有 CSS-in-JS、没有 Tailwind/UnoCSS。样式写法是「混合体」：能用 token 的地方用 var(--color-card)/var(--color-border)/var(--radius-xl)/var(--font-num)/var(--motion-fast)/var(--z-modal-backdrop) 这类 tokens.css 变量；不能用 token 的地方直接写死 rgba()/hex。具体坏味道：① 大量硬编码浅色值不随暗色主题变化——MealsView 的 `.chip.part{border-color:rgba(138,90,0,.26);color:#8a5a00}`、FoodCaptureDialog 的 `.badge-photo{background:rgba(15,118,110,.16)}`、`.privacy.upload{border-color:rgba(138,90,0,.25)}`、MealPhotoViewer 与 dialog 的 `.photo-stage{background:#0d1114}` 与 `.loading{color:#cbd5dc}`；其中 FoodCaptureDialog 的 `.candidate li{border:1px solid rgba(220,229,237,.85)}` 是近白色边框硬编码在白卡上，暗色主题下会变成刺眼白框。② 组件间重复实现同一视觉：`.spin` 关键帧在 FoodCaptureDialog:922 与 MealPhotoViewer:143 各写一份；`.empty`/`.loading` 空态样式各写一份；MealsView 与 ReportView 都手写「/ 8 类」的进度条；MealsView 的 `.row`、MealForm 的 `.edit-row`、FoodCaptureDialog 的 `.edit-row` 是三份互不复用的食物行布局。③ 缺口：没有共享的 Select 组件，MealsView 的餐次类型切换用原生 <select> 直接内联样式，视觉上与 BaseButton/BaseCard 体系脱节；没有共享的 Badge 组件，.chip/.f-conf/.badge-photo 三个徽标各写各的。④ 重复的自定义样式族：`.micro`/`.num` 已在 globals.css 里，但各组件仍在 scoped 里重复写 .micro{font-size:11px;letter-spacing:.08em} 类规则。改版时这些是主要返工点。
## 数据流
【数据来源】① 照片输入：<input type="file"> 的 File（Blob）或 getUserMedia 摄像头 canvas 导出的 data URL 字符串，两者在组件内以 `originalPhoto: Blob | string | null` 统一承载。② 识别结果：云端走 `recognizeFoodWithModel`（src/services/llm.ts 的 callLlmChat → POST /api/llm/chat，消息体里带 image_url 段），本机走 `recognizeLocally`（@mediapipe/tasks-vision ObjectDetector，模型 /mediapipe/models/efficientdet_lite0.tflite，wasm 在 /mediapipe/wasm，scoreThreshold 0.35、maxResults 16、9 个本地类）。③ 食物目录与热量：foodComposition.foodTable + UNIT_GRAMS + 用户覆盖表 store.unitGrams。④ 规则：mealRules.analyzeMeal / deriveCompleteness / summarizeDay / inferMealType。⑤ 全局状态：Pinia `useAppStore`（src/stores/app.ts），其中 meals、unitGrams、privacy 三块与本子系统直接相关。⑥ 浏览器存储：localStorage key `twopoles_state`（整个 app state，含 meals 数组、unitGrams、privacy、collapsedCards）与 `twopoles_llm`（模型配置，独立 key）；IndexedDB DB `twopoles_meal_photos` v1 / store `photos` / key=photoId / value=Blob。

【完整链路：拍照→识别→确认→入库】（FoodCaptureDialog.vue）1) 选路：view='capture'，可开摄像头或选文件或直接进 view='manual'。2) 归一化：文件走 `prepareFoodPhoto`（createImageBitmap → canvas → JPEG data URL，最长边 1024，MAX_INPUT_BYTES 12MB 校验）；摄像头走 `captureFrame()`（canvas 缩放到最长边 1280 → toDataURL('image/jpeg',0.85)），这条路径不经过 prepareFoodPhoto。3) 识别：`recognizeFoodWithModel` 或 `recognizeLocally`，view 切到 'analyzing'，processingStage 区分 'reading'（读图）与 'model'（跑模型）；有 runId 计数 + AbortController + withTimeout（识别 120s、prepareFoodPhoto 20s）防竞态与超时。4) 校验：`validateRecognitionObject` 强制 confidence 必填、items ≤12、按小写名去重取高置信、energy 限 0..5000、portion 限 0<s≤5000 且 unit ∈ UNIT_GRAMS，并按 `row.uncertain===true || confidence<LOW_CONFIDENCE(0.6) || category==='其他' || isMixed(name)` 打 uncertain 标记。失败抛 FoodRecognitionError（code: image/network/not_configured/upstream/invalid_output/empty），view 切 'error'。5) 确认：view='result'（'manual' 共用同一模板），用户可改名称/类别/份量/单位；改名称会清掉 nutrition 与 confidence。6) 入库（save()，顺序是硬约束）：先 validate → 组装 normalized items → `makeFoodThumbnail(prepared)`（最长边 256、JPEG q0.7，5s 超时，长度上限 120_000 字符）→ `store.addMeal({date, mealType, time, items, photoThumb, photoId})` → addMeal 成功之后才 `saveMealPhoto(photoId, blob)`（摄像头 data URL 需先 `dataUrlToBlob`，10s 超时）→ toast 警告 → emit('saved') + emit('close')。关键点：`const photoId = photoThumb && originalPhoto.value ? newId() : undefined`（FoodCaptureDialog.vue:840）——原图是否落 IndexedDB 取决于缩略图是否生成成功，缩略图失败/超限时原图也被丢弃。7) 展示：MealsView 的 records 按 date 过滤、按 time+createdAt 排序；`openPhotoViewer` 打开 MealPhotoViewer，用 photoId 从 IndexedDB 取 Blob，失败时退回 meal.photoThumb（localStorage 里的 data URL）。8) 删除/清空：store.removeMeal 调 deleteMealPhoto；store.clearAllData 调 clearMealPhotos。

【照片存储机制：两级】
- 缩略图：JPEG data URL（最长边 256、q0.7），存在 `meal.photoThumb` 字段里，随整个 app state 一起序列化进 localStorage `twopoles_state`。它吃 localStorage 配额——store.persistState 已捕获 QuotaExceededError 并提示「可能是饮食照片缩略图占满了浏览器存储」。
- 原图：Blob 存 IndexedDB（DB `twopoles_meal_photos`，store `photos`，key=photoId），meal 上只留 `meal.photoId` 字符串指针。`privacy.saveFoodPhotoLocally` 控制是否写原图（FoodCaptureDialog 里用 writable computed `saveThumb` 绑到 store.privacy.saveFoodPhotoLocally，勾选框的取值直接读写全局偏好并即时持久化），默认值 true。
- 导出：SettingsView 的 JSON 导出剥掉 photoId（Blob 导不出），CSV 不含照片；因此导出后原图彻底不可达。

【数据流方向】MealsView → FoodCaptureDialog（props: open/date/initialView；emits: close/saved）→ store.addMeal → localStorage + IndexedDB；MealsView → MealPhotoViewer（props: open/photoId/fallback/label；emits: close）→ IndexedDB 读 → objectURL。视图层不直接写 IndexedDB，也不直接写 localStorage，全部经 store / service。
## 状态模型
【FoodCaptureDialog 视图状态机】type View = 'capture' | 'analyzing' | 'result' | 'error' | 'manual'（'manual' 与 'result' 共用同一模板分支，仅靠 isManual 区分文案）；mode: 'cloud' | 'local'（初始 'local'，loadStatus() 检测到已配置模型后切成 'cloud'，云端需勾选同意才可触发）；processingStage: 'reading' | 'model'。主链路 capture → analyzing → result（失败则 error，error 可重试回 analyzing 或改手动）；manual 直接进结果模板；保存成功后 emit('saved')+emit('close')，父组件把 open 置 false，watch 触发 cleanup() 清空 prepared/items/result/photo 并 abort 在途请求。

【MealsView 视图状态机】expandedId: string | null（单开手风琴，展开某张餐次卡）；editingId: string | null（单开编辑态，展开 MealForm）；photoViewer: {photoId?, fallback?, label?} | null；captureOpen: boolean；captureInitialView: 'capture' | 'manual'。onEditSave 完成后 editingId=null 且 expandedId 设为新 meal.id。

【领域状态枚举】MealType = breakfast | lunch | dinner | snack；Meal.completeness = 'complete' | 'partial' | 'unknown'（deriveCompleteness 要求每项 i.confirmed && i.portionSize !== undefined）；FoodCategory 10 值；MealItem.source = 'photo' | 'manual'；MealItem.uncertain = boolean；识别置信度分档：confidence ≥ LOW_CONFIDENCE(0.6) 为高，<0.6 为低。

【规则状态】MEAL_TIME_WINDOWS 按当前本地时间推断餐次：05:00–10:29 早餐、10:30–14:59 午餐、15:00–21:00 晚餐、其余为加餐；MEAL_SLOTS 只有早/午/晚三个槽（defaultTime 08:00/12:00/18:30），加餐不在槽位体系内。

【持久化状态机】app.ts 的 meals 数组是唯一真源；store.addMeal 会重算 completeness/analyzeMeal/estimateRefs 后 push 并 persistState；store.removeMeal 同时删 IndexedDB 照片；clearAllData 清 meals + unitGrams + privacy + clearMealPhotos。
## 耦合
【跨组件 import】MealsView → FoodCaptureDialog、MealPhotoViewer、BaseCard/BaseButton/StatStrip/InsightCard、store(app.ts)、mealRules、foodComposition、foodRecognition。FoodCaptureDialog → foodRecognition（prepareFoodPhoto/makeFoodThumbnail/recognizeFoodWithModel/recognizeLocally/dataUrlToBlob/validateRecognitionObject/LOW_CONFIDENCE/LOCAL_CLASS_COUNT）、foodComposition（UNIT_GRAMS/FOOD_CATEGORIES/estimateEnergy）、mealRules（MEAL_TYPE_OPTIONS/FOOD_CATEGORIES/mealTypeLabel）、mealPhotos（saveMealPhoto）、store。MealForm → foodComposition（UNIT_GRAMS/foodTable/searchFoods/frequentFoods/estimateEnergy/unitKey/resolveUnitGrams）、mealRules（suggestCategory）、store（rememberUnitGrams/forgetUnitGrams）。

【跨视图共享 service 常量（改版时最易踩雷）】mealRules.FOOD_CATEGORIES 被 MealsView、FoodCaptureDialog、ReportView、weekRules 消费；mealRules.RULE_VERSION 被 weekRules 消费；mealRules.MEAL_SLOTS 被 DashboardView 消费；mealRules.summarizeDay 被 MealsView 与 DashboardView 消费；foodComposition.FOOD_SOURCE_LABEL 与 estimateEnergy 的 basis 字符串被 UI 直接渲染成免责声明文案。

【共享 store 字段】store.meals（MealsView、MealForm、FoodCaptureDialog 全部直接读写数组）、store.privacy.showEnergyEstimate（决定 addMeal 是否写 estimateRefs，UI 也据此显示热量）、store.privacy.saveFoodPhotoLocally（决定原图是否落 IndexedDB）、store.unitGrams（单位克重覆盖表，被 MealsView/FoodCaptureDialog/MealForm 共用）、store.collapsedCards（InsightCard 的 meal-rules 折叠态）。

【共享类型】src/types/domain.ts 的 Meal/MealItem/MealDraft/MealAnalysis/PrivacySettings/FoodCategory/MealType 贯穿全链路；MealDraft 与 MealItem 的差异（draft 无 source/photoConfidence/uncertain/modelEnergy/confirmed）正是 MealsView.onEditSave 里手写字段搬运的原因。

【隐性耦合（无 import 但强依赖）】① localStorage key `twopoles_state` 的 JSON 结构与 src/stores/app.ts 里的 persist/load 逻辑强绑定，改 Meal 字段名会让历史数据反序列化出 undefined。② MealsView 用 `document.getElementById('meal-'+meal.id)` 滚动定位到新记录，DOM id 与 meal.id 强耦合。③ MealsView 的 `limitations` 计算用字符串匹配 `l.includes('hasNutritionEstimate = false')` 过滤 mealRules 生成的文案，规则文案一改就失效。④ 拍摄/保存链路依赖 vite dev/preview 代理的 `/api/llm/chat`（body 上限 6,000,000 字节），与图片体积策略耦合。
## 设计债
- MealsView.vue:519-527（onEditSave）：编辑保存不是更新，而是「先删后建」——`store.meals = store.meals.filter(m => m.id !== meal.id)` 直接改 store 数组（绕过 store.removeMeal，因此也绕过了 deleteMealPhoto，照片才得以幸存），再走 store.addMeal 重建。结果是每次编辑都换新 meal.id、createdAt 被重置、analysis/limitations/estimateRefs 全部重算，旧 id 引用的展开态、DOM id、潜在外部链接全部失效。改版应改成 store.updateMeal(id, patch) 原位更新，保留 id 与 createdAt。
- FoodCaptureDialog.vue:840：`const photoId = photoThumb && originalPhoto.value ? newId() : undefined` —— 原图是否落盘取决于缩略图是否生成成功。makeFoodThumbnail 超时（5s）或结果超过 120_000 字符时，photoId 为 undefined，saveMealPhoto 永不执行，IndexedDB 里没有原图，用户拍的原片直接丢失。缩略图与原图应当各自独立决定是否持久化。
- MealsView.vue:359：`time: s.createdAt.slice(11, 16)` —— createdAt 是 `new Date().toISOString()` 的 UTC 字符串，切片取的是 UTC 时分，而同页的餐次时间用的是本地 clockTime()。在 UTC+8 下训练时间线会整体差 8 小时。
- foodRecognition.ts:69 的 JSDoc 写「把用户选/拍的照片缩到最长边 1280」，实际常量是 MAX_IMAGE_EDGE = 1024（同文件 :16）。文档与代码不一致。
- FoodCaptureDialog.vue:640 与 :681 —— 摄像头路径单独用 1280 缩放并直接 toDataURL('image/jpeg',0.85)，完全绕过 prepareFoodPhoto：不做 EXIF 方向纠正、不做白底合成、不做 12MB 输入校验、不受 MAX_IMAGE_EDGE 约束。文件路径 1024、相机路径 1280，两条压缩策略不一致。
- mealRules.ts:116 `export const LIMITATIONS = buildLimitations(false)` 与 foodComposition.ts:226 `export function summarizeEnergy(...)` 全项目零引用（已 grep 确认），是死导出。
- mealRules.ts:8 `suggestCategory` 只是 foodComposition.ts:167 `inferCategory` 的转发；mealRules.ts 的 `isMixed` 是 foodComposition.ts:139 `isMixedFood` 的别名。两个「规则层」实际是「目录层」的转发壳，调用方却从不同模块引入，读者会误以为是两套口径。
- 「8 类」这个数字被复制了 5 处：MealsView.vue:167（`/ 8 类` 文案）、:289（`FOOD_CATEGORIES.slice(0, 8)`）、:313（`${s.coverage.length} / 8`）、FoodCaptureDialog.vue:413（`FOOD_CATEGORIES.slice(0, 8)`）、ReportView.vue:247/249/255。而 mealRules.ts:28 里真正的 8 类清单 EXPECTED_CATEGORIES 是 private 的，谁也拿不到。FOOD_CATEGORIES 一旦调整顺序（比如把「油脂类」提前），三处 slice(0,8) 全部会取错类别，且不会有编译错误。
- 「3 餐」也被复制：MealsView.vue:10 `recordedSlots === 3`，以及 mealRules.MEAL_SLOTS 隐含的 3。summary 里其实已经能拿到槽位数（MEAL_SLOTS.length），却用字面量 3。
- 「餐次槽位」有三套并存的定义：mealRules.MEAL_SLOTS（3 个，defaultTime 08:00/12:00/18:30）、MEAL_TYPE_LABELS/MEAL_TYPE_OPTIONS（4 个含 snack）、MEAL_TIME_WINDOWS（3 个时间窗）。MealsView 额外在组件内自己又列了一遍 ['breakfast','lunch','dinner','snack']。DashboardView 用 MEAL_SLOTS、MealsView 用 OPTIONS、推断用 WINDOWS，三者时间语义还不同（槽位给的是建议时间，窗口给的是边界）。
- MealsView.vue:334：`base.filter(l => !l.includes('hasNutritionEstimate = false'))` —— 用字符串匹配去剔除 mealRules 生成的某条 limitation 文案。mealRules.ts 的文案一改措辞，这里就静默失效（多显示一条或多删一条），无类型保护。
- MealForm.vue:147 `const UNITS = ['碗','盘','份','个','杯','片','克','把']` 与 FoodCaptureDialog.vue:318 `const UNIT_OPTIONS = Object.keys(UNIT_GRAMS)` —— 两份单位清单，来源不同（一个写死一个来自 UNIT_GRAMS），顺序也不同（把/克位置相反）。同一个 app 里两个下拉框选同一个单位，写入 store.unitGrams 的 key 却是 `unitKey(name, unit)`，其中 unit 字符串必须完全一致，这里靠巧合对齐。
- 食物行编辑器有三份互不复用的实现：MealForm.vue 的 `.row`（flex：名称/类别/份量/单位/热量/删除）、FoodCaptureDialog.vue 的 `.edit-row`（grid，无单位换算与目录搜索）、MealsView.vue 内联的编辑区。FoodCaptureDialog 的编辑器没有 MealForm 的单位↔克换算、常吃食物、目录搜索能力；MealForm 的编辑器没有 FoodCaptureDialog 的置信度/uncertain 展示。改版必须先合并成一份。
- 「不确定」的判定逻辑被复制三份：foodRecognition.ts 的 validateRecognitionObject（写 uncertain 标记）、FoodCaptureDialog.vue 的 uncertainNames（渲染标记）、MealsView.vue 的 itemIsUncertain（读时再判一次，含 category==='其他' / isMixed / photoConfidence 低）。三处的阈值与分类规则各写各的，很容易出现「保存时不确定、显示时不不确定」。
## 约束
- IndexedDB 存储契约不能改：DB 名 `twopoles_meal_photos`、版本 1、object store `photos`、key 为 photoId 字符串、value 为 Blob。改库名/版本/store 名/值类型后，已有用户设备上保存的原图将无法被 getMealPhoto 找回（且当前没有迁移代码）。photoId 与 localStorage 里 meal.photoId 的对应关系必须保持。
- localStorage 键与结构不能改：`twopoles_state`（整个 app state，含 meals 数组、unitGrams、privacy、collapsedCards）与 `twopoles_llm`（模型配置，独立 key）。Meal/MealItem 字段名（photoThumb/photoId/items/analysis/createdAt 等）被持久化读取，改名会让历史数据反序列化为 undefined。
- 导出格式不能改：SettingsView 的 JSON 导出（剥掉 photoId）与 CSV 导出，字段名与列顺序被外部流程依赖。
- 餐次推断口径不能改：MEAL_TIME_WINDOWS 边界 05:00–10:29 / 10:30–14:59 / 15:00–21:00，其余为加餐；EXPECTED_CATEGORIES 的 8 类与 FOOD_CATEGORIES 的 10 类之间的差集（油脂类、其他）是「不算覆盖」的业务定义，不是显示偏好。
- 热量估算口径不能改：ESTIMATE_BAND=0.25（±25%）、只在食物命中 foodTable、非混合菜、有份量、unit ∈ UNIT_GRAMS 时才给值、basis 字符串必须带单位克重与「own/demo」来源标注、FOOD_SOURCE_LABEL='内置演示参考值（未与权威成分表逐项核对）' 必须随 UI 一起呈现、foodTable 全部条目 verified:false——这些是反臆造的产品底线，改版时不能因为版式需要而隐藏或软化免责声明。
- 置信度口径不能改：LOW_CONFIDENCE=0.6 是 uncertain 判定阈值；识别结果必须带 confidence，不允许无置信度入库；≤12 项、按名称去重取高置信、energy 限 0..5000、portion 限 0<s≤5000。
- 图片体积与格式约束：MAX_IMAGE_EDGE=1024（file 路径）、MAX_INPUT_BYTES=12MB、缩略图最长边 256 且 JPEG q0.7、缩略图 data URL ≤120_000 字符；`/api/llm/chat` 代理 body 上限 6,000,000 字节。改版若改用新上传通道，需重新核对这三个上限的先后关系。
- 硬件/浏览器 API：navigator.mediaDevices.getUserMedia 需要 HTTPS 或 localhost（file:// 或 http 局域网下摄像头不可用，UI 必须保留「选择文件」兜底路径）；canvas.toDataURL('image/jpeg') 与 createImageBitmap 的可用性；MediaPipe 资产路径 `/mediapipe/wasm` 与 `/mediapipe/models/efficientdet_lite0.tflite`（vite 静态资源路径，改 base 或部署路径会断）；ObjectDetector 参数 scoreThreshold 0.35、maxResults 16、9 个本地类不可随意改，否则识别行为变化。
- 本机识别路径不得上传图片、必须显式获得用户同意后才走云端（consent 勾选），这是隐私硬约束，不能为了「一键拍完就出结果」而默认开启云端。
- 识别模型服务契约：/api/llm/chat 的 image_url 内容段与 FOOD_RECOGNITION_SYSTEM 规定的 JSON 结构（items[] 字段 foodName/category/confidence/uncertain/portion/energy），以及 LLM 输出禁止推断餐次类型、禁止给营养建议的提示词约束。
- 本地识别的模型只认 9 类，识别结果必须允许用户改名、改类别；UI 不能假设模型给出的类别一定属于 10 类 FoodCategory。
- newId() 依赖 crypto.randomUUID 并带降级方案（src/utils/id.ts），photoId 生成不能改成自增或时间戳（会与 IndexedDB key 语义冲突）。
- indexedDB 不可用时（隐私模式等）mealPhotos 的 API 退化为 no-op，UI 必须能容忍「有缩略图但无原图」的状态（MealPhotoViewer 的 isOriginal=false 分支）。
## 改版接缝
- 【清晰边界，可整块换掉】四个 service 层（foodRecognition / foodComposition / mealRules / mealPhotos）是纯函数 + 纯 IO，没有 Vue 依赖，换皮期间完全不用碰；它们的常量（LOW_CONFIDENCE、UNIT_GRAMS、MEAL_TIME_WINDOWS、FOOD_CATEGORIES、ESTIMATE_BAND）已被视图层引用，替换视图时保持常量不变即可。
- 【清晰边界，可整块换掉】通用展示原语 BaseCard / BaseButton / StatStrip(+StatItem 类型) / InsightCard / StatusBadge / ToastRegion 已是稳定的 API 面（props 少、variant 枚举清晰），新页面直接复用即可；饮食页的自定义 chip/f-conf/badge 都可以换成 StatusBadge。
- 【清晰边界，可整块换掉】基础样式层 tokens.css（明暗双主题变量）与 globals.css（.micro/.num）已就位，新版只要用 token 就不必再调色。
- 【清晰边界，可整块换掉】MealPhotoViewer 是独立自洽的弹窗（只依赖 props.open/photoId/fallback/label 与 emits.close），可以整体保留或整体替换为新的 BaseDialog 变体，不影响数据链路。
- 【清晰边界，可整块换掉】store 的 action 面（addMeal/removeMeal/updateMealType/rememberUnitGrams/forgetUnitGrams/toggleCard/updatePrivacy/showToast）已经是清晰的写入口，视图层新代码只要走 action 就不破坏持久化。
- 【清晰边界，可整块换掉】src/types/domain.ts 的领域模型是稳定的契约层，界面上换布局不需要动它。
- 【清晰边界，可整块换掉】FoodCaptureDialog 的 props/emits 契约（open/date/initialView → close/saved）足够稳定，换皮时保持这个契约，就能让 MealsView 只改版式不改逻辑。
- 【必须先解耦】FoodCaptureDialog.vue（998 行）是最大的纠缠点：一个文件里同时有 (a) 相机/文件 IO（getUserMedia、captureFrame、canvas 压缩）、(b) 识别 provider 调度（云端/本机、AbortController、runId、withTimeout）、(c) 校验后的候选数据模型、(d) 候选编辑 UI、(e) 缩略图/原图持久化、(f) 隐私开关、(g) 弹窗外壳与 body 滚动锁、(h) 约 120 行 scoped CSS。改版前应拆成 useFoodCamera / useFoodRecognizer / useMealPhotoStorage 三个 composable + 4 个纯展示子视图（CaptureView / AnalyzingView / ResultView / ManualView），把 view 状态机提为显式的状态对象；否则任何视觉调整都会碰到 IO 与持久化代码。
- 【必须先解耦】MealForm.vue（429 行）把「单位↔克换算状态机（own/pending/demo）+ 单位克重记忆 + 内置目录搜索 + 常吃食物 + 逐行实时热量」与表单版式耦合在一起，且自带一份与 FoodCaptureDialog 不同的单位清单和第三份食物行布局。改版前应先抽 foodRowEditor 组件 + useUnitGrams composable，两条编辑路径共用。
- 【必须先解耦】MealsView.vue（694 行）把全部 view-model 派生（summary/records/coverageRows/mealStats/limitations/timeline/itemIsUncertain/structureText/localEnergyText/modelEnergyText…）与 300+ 行模板/CSS 写在一个 SFC 里；改版前应把派生逻辑抽成 useMealsViewModel()（纯 computed 组合式函数），让模板只负责渲染——这同时能顺手修掉第 334 行那种字符串匹配过滤 limitation 的脆弱写法。
- 【必须先解耦】三处 body 滚动锁（FoodCaptureDialog、MealPhotoViewer、PlanDraftDialog）与三处 modal 外壳（scrim+header+✕+action bar）应统一成一个 BaseDialog 组件（提供 open/scroll-lock/Esc/焦点管理/响应式全屏），这是换皮收益最高的一步。
- 【必须先解耦】「食物行编辑器」有三份重复实现（MealForm 的 .row、FoodCaptureDialog 的 .edit-row、MealsView 内联），必须先合并成单一 FoodRowEditor（可配置是否显示置信度/单位换算/热量），再谈视觉统一。
- 【必须先解耦】「餐次槽位」三套定义（MEAL_SLOTS / MEAL_TYPE_OPTIONS / MEAL_TIME_WINDOWS）应先合并为单一模型（并导出 EXPECTED_CATEGORIES 供视图用），否则新版布局里「今日 3 餐进度」和「类别覆盖 8 类」两个模块会继续各写各的字面量。
- 【可作为重排支点的接缝】`<FoodCaptureDialog :open :date :initial-view @saved @close>` —— 换皮时可把它整体换成新弹窗，只要保持 emits.saved(meal) 语义。