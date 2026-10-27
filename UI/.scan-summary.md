### 建档流程（Onboarding）+ 档案规则（profileRules）
DEBT:
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
  - finish()（第 383-435 行）一个函数里塞了五件事：校验身体数据与周期区间 → store.updateProfile → store.commitMode → 触发模型提问 → 触发本周计划重算 → 弹 toast → router.push。校验、保存、保存后的副作用、导航四层没有分界，改成「先预览再保存」或「保存后进下一步」需要重写整个函数而不是替换其中一段。
  - 错误提示位置离出错字段太远：`<p v-if="error" class="error" role="alert">` 在第 224 行，卡片底部；而第 2 步有约 10 个字段（昵称/年龄/身高/体重/5 组 chips），在窄屏下错误条会落在视口之外，也没有 focus 或 scrollIntoView。第 42 行的年龄未成年提示倒是就地显示的，说明同一页里存在两套错误呈现方式。
  - profileRules.ts:147 有一条只剩注释没有代码的悬空行（「// 身高/体重保持"没填就是没填"，不塞默认值，也不改写已有体重」），是删代码后没清理的残留；normalizeProfile 的注释说「补齐新增字段」，但 height/weight 实际未做任何补齐。
  - TRACK_EVENTS/FIELD_EVENTS 的拼接散落三处：OnboardingView 第 306 行 eventOptions、PbList 模板第 17 行的选项循环、PbList 脚本第 115 行的 startEdit 反查。profileRules.ts 没有导出合并后的 ALL_EVENTS 常量。
  - stepTitles 与 total 分离：第 256-260 行写了三条标题，第 261 行 `const total = 3`，第 7 行用 `stepTitles[step - 1]` 取值，但 next()（第 357 行）里又硬编码 `if (step.value === 2)` 来决定校验第 2 步。加一步要同时改模板分支链、stepTitles、total 和 next() 里的魔数 2。
  - 编辑模式下会连弹两个 toast：store.regenerateWeekPlan 内部弹「本周计划已按新条件重生成」，finish() 末尾再弹「档案已更新」。
  - 无障碍缺口：五组 chips（第 62/69/76/83/90/97/104 行）都是裸 div，没有 role="group" 与 aria-label（对比 SettingsView 第 176 行的 `<div class="chips" role="group" aria-label="主题">`）；目标类型的 seg（第 140 行）同样缺分组语义；第 161 行「对应项目」是一个 disabled input，键盘不可聚焦，屏幕阅读器读到的是个不可编辑字段。
HOOKS:
  > profileRules.ts 是最干净的接缝：零 Vue 依赖、零 store 依赖、零 DOM 的纯函数层，且 scripts/selfcheck.ts 已经对它 9 个导出做了断言。所有新增校验（年龄区间、器材合法性、场地枚举）都应该先在这里加一个纯函数 + 一条 selfcheck 断言，再由页面调用——这是改版时最省事、风险最低的扩展点。
  > PbList.vue / GymList.vue 是标准的 v-model 叶组件（props: modelValue / emits: update:modelValue），不碰 store、不碰 router、不直接操作父级状态，只要保持 emit 出的数组形状不变（PersonalBest[] / GymRecord[]），两个组件的整块模板与样式可以整体替换而不动任何逻辑。
  > store.updateProfile(partial) + store.commitMode(mode) + store.regenerateWeekPlan(date) 已经是完整的写边界：建档页只应调这三个 action，不该直接改 userProfile 或 currentMode。换皮时保持这条边界即可完全不碰 store。
  > BaseCard 暴露了 `--card-pad` 变量和 variant('default'|'flush'|'ink')，BaseButton 暴露了 variant/size/icon/disabled —— 它们是现成的替换点。但 OnboardingView 目前用 `.panel{padding:26px}` 绕开了 --card-pad，改版时把它换成 style="--card-pad:26px" 就能让卡片内距跟随新皮肤，而不必写 :deep() 覆盖。
  > goalSummary() 已经被 SettingsView 与 OnboardingView 共用，是「文案口径」的单一来源——重写文案时必须同时改 profileRules.ts 这一处，否则两个页面会各说各话（注释里已明确这个意图）。
  > normalizeProfile() 是老档案迁移的唯一切口（当前只补 personalBests/gymRecords 空数组）。改版若要给档案加字段（如训练偏好、体脂率），在这里做版本化补齐即可，不必在每个读档案的地方写 `?? []`。
  > step / total / stepTitles 这个三元组可以整体抽成一个描述数组或 useOnboardingSteps() composable：把 { id, title, canEnter, validate } 声明化，模板就只剩一个 <component :is>，新增/重排步骤不用碰 next() 里的魔数 2。
  > 模式选择器（modeChoices）、目标类型二选一（seg）、主项 chips 与「其他」自由输入（otherPicked/otherSport/pickEvent/pickOtherSport）各自是一个自洽的小交互，可以各自替换成新的控件组件而不影响其余部分；「其他」用独立开关而不是占用 discipline ref，这个设计解耦值得保留。
  > 必须先解耦再动的三处：(1) 20+ 个独立 ref 组成的表单模型 → 先合并成单个 reactive draft 对象，再谈重排布局；(2) 模板里 v-if/v-else-if/v-else 的步骤分支链 → 先拆成 StepMode/StepBasics/StepAthlete/StepReview 四个子组件，页面退化成单分支渲染；(3) finish() 里校验/保存/副作用/导航四层混写 → 先拆成 validateDraft() / saveDraft() / afterSave() 三个函数，才谈得上「保存并下一步」这类新流程。
  > 回顾页的 14 行 ul.review 应先改成描述符数组 [{ label, value }]，才能从「单列分隔线列表」换到双列摘要卡/分组摘要；目前它是硬编码 markup，与 SettingsView 的 profileLine/goalLine 属于同一份数据的第三种呈现。
  > blocked 需要先从「一个 string|null」拆成 { ageBlocked, gateBlocked }，才能让「年龄门槛」显示在年龄字段旁、「孕期/伤病门槛」显示在对应 chip 下方——目前两者被压成同一句文案，贴在特殊情况那一组的下方。
  > FormField / ChipGroup / ChoiceCard / SegmentedControl 这四个原语目前不存在于 src/components/common/；把 OnboardingView 与 SettingsView 里逐字重复的 .field/.field-label/.chips/.chip/.choices/.choice/.seg 抽成组件，是全局换肤的前置条件（否则新皮肤要粘进 8 个文件）。同理，PbList 与 GymList 共约 90% 的模板与 CSS，先合并成一个 schema 驱动的 RecordList，再统一上皮肤。
  > 第 233 行的隐私脚注是一个可整块替换的文案接缝——但替换前必须先修正事实（配置了模型时档案会外发给第三方），否则新文案会继承旧的不实承诺。
### 应用外壳与全局导航（AppShell / TopBar / SidebarNav / MobileNav / 路由）
DEBT:
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
  - 【RouterView 缺 :key】AppShell.vue:9-13 的 `<component :is="Component" />` 没有绑定 :key。当前 7 条路由各对应不同组件，切换能正常触发 out-in 过渡；但改版中只要把路由拆成同组件多参数（如 /report/:tab），过渡会退化为原地 patch，页面不会重新挂载。vue-router 4 的 RouterView 本身不会给组件加 key（已在 node_modules/vue-router/dist/vue-router.mjs:1106 核实）。
  - 【抽屉关闭逻辑三处重复】AppShell.vue:35-37 的 watch(() => route.fullPath) 置 false，与 SidebarNav 每个 RouterLink 上的 @click="emit('close')"、scrim 的 @click 是同一意图的三份实现，前者是冗余兜底。
  - 【SidebarNav 底部两项游离在数据之外】档案 / 个人设置（第 33、38 行）是模板里手写的两个 RouterLink，没有进 items 数组，因此不参与 items.map 渲染、也无法统一配置 active 态逻辑（靠 .rail-foot .nav-item 单独改字号）。
  - 【四个空目录是纯遗留】src/components/journey、src/components/reports、src/components/training、src/data 四个目录全空；对 src/、README、scripts 全仓 grep 无任何 import 引用，Vite/tsc 也不会报错。README.md:96 已注明「仍不存在——那是早期交付文档设想的规划结构，未落地」，但 README.md:271「添加新组件」仍在建议把组件放进 common/journey/training。可直接删除，不影响任何构建。
  - 【文档与实现不一致（README.md）】① 第 279 行称 store 有 `switchMode()` 并被「侧边栏模式菜单」调用——store 里根本没有 switchMode，只有 requestModeSwitch / confirmModeSwitch / cancelModeSwitch / commitMode；README 提到的 ExecutionView 的 switchMode 是「演示回放 / 实时摄像头」，同名不同义。② 第 96 行说 components/meals 不存在，但 components/meals 现在有 FoodCaptureDialog / MealForm / MealPhotoViewer 三个文件。③ 第 259 行说 services 只有四个模块，实际有 13 个（新增 llm / foodRecognition / loadR
  - 【MobileNav 整文件压成单行】MobileNav.vue 只有 10 行，模板 1 行、script 2 行、style 1 行（2000+ 字符），与项目其余组件多行可读风格完全相反，改版时无法做行级 diff 或局部 patch，review 成本极高。
  - 【外壳未承担页面级职责，也未提供页面级接缝】AppShell 只提供 .main-content 一个容器，页面最大宽度、页头样式、空态/加载态全部由各视图各自实现（见上述六套容器与四套页头），外壳层没有任何可复用的「页面骨架」组件（如 PageHeader / PageShell），改版要统一页面语言必须逐页改。
HOOKS:
  > 【可直接整块替换：AppShell 的模板层（AppShell.vue:2-19）】这是纯装配层，script 只有 3 行逻辑（mobileOpen ref、watch、store.init()）。改布局骨架时可以整块重写，但要保留 4 条契约：① TopBar 仍接收 menu-open 并 emit toggle-menu；② SidebarNav 仍接收 open 并 emit close；③ main 内仍是 RouterView 出口；④ PlanDraftDialog 与 ToastRegion 必须继续被挂载（它们是全局单例，靠 store 状态驱动，与页面无关）。
  > 【可直接整块替换：SidebarNav 的 items 数据（SidebarNav.vue:54-60）】是一个纯数据数组 {to, label, full, icon}，icon 是组件引用。改导航结构或换图标只改这一个数组，模板不用动；但必须同步 MobileNav.vue:4 的那张表。
  > 【可直接整块替换：TopBar 的模式弹层（TopBar.vue:24-70）】确认/取消分支完全由 store.switchPreview 驱动，TopBar 只负责渲染与焦点管理。把 popover 换成 Drawer / Dialog / 独立页面都不需要碰 store。
  > 【逻辑边界清晰可复用：store 的模式切换三段式】requestModeSwitch / confirmModeSwitch / cancelModeSwitch + switchPreview computed 构成干净的契约——UI 只读 switchPreview、只调这三个方法。改版换任何确认交互形态都不需要动 store 逻辑。
  > 【换肤接缝：CSS 变量令牌】tokens.css 的 :root 与 html[data-theme="dark"] 两组覆盖了颜色/间距/圆角/动效/z-index/布局尺寸。改配色与质感只需改令牌、不必动组件——但 --sidebar-width 这类布局尺寸被 AppShell 与 TopBar 同时引用，改宽度必须同时动这两处。
  > 【换卡片语言的接缝：BaseCard 的三个 variant 契约（BaseCard.vue:12-19）】全站只有 default / flush（纸面）与 ink（仪表面）两种表面，所有卡片内距统一走 --card-pad。改版换卡片质感只需改 BaseCard 这一个文件 + 令牌，不用逐页改。
  > 【可复用的既有原语】StatStrip（指标条）、ShapeState（三态形状）、StatusBadge（状态徽标）、MetricCard、InsightCard、TwoPoleDial（双极环）、LoadChart 已经是成型的积木，DashboardView 已经把它们当积木用；改版可直接复用而不必重写。
  > 【可复用的排版原子】globals.css 的 .micro（10px + .17em 大写字距）与 .num（Bahnschrift 等宽数字）是全站节奏的来源，改版可以继续以它们为契约；globals.css 的 .container 目前无调用方，可作为新页面的收口工具或直接删掉。
  > 【必须先解耦 1：TopBar 的焦点与外部点击管理（第 146-166 行）】onDocClick 用 e.composedPath().some(node => node.classList.contains('mode-wrap')) 判断「点在外部」，onEsc 关闭，confirm/cancel 后 nextTick 把焦点还给模式按钮——这套逻辑与 TopBar 的视觉完全无关但被写在同一文件。改皮前应抽成独立 composable（如 useDismissable/useFocusReturn），否则换任何形态的弹层都要重新抄一遍这段有注释解释微妙 bug 的代码。
  > 【必须先解耦 2：TopBar 的 cycleWeek 算法（第 107-115 行）】纯业务逻辑（周期起始日 → 第几周）写在视图组件里，没有进 services/、没有断言覆盖。改版要把它挪到 services/weekRules.ts 一类的纯函数里，才能在改版中安全地调整周期口径。
  > 【必须先解耦 3：按钮体系】TopBar.vue:254-256 的 .btn-primary/.btn-ghost 与 DashboardView.vue:554-560 的 .btn 系列各自绕过 BaseButton。改版换按钮语言前，必须先把 TopBar 与 DashboardView 收敛到 BaseButton（同时能修掉 TopBar 按钮缺 focus-visible 定制、低于 44px 的问题），否则新界面只会继续复制。
  > 【必须先解耦 4：SidebarNav 的 short/full 双标签机制】同一份导航渲染成两种形态靠 .short / .full 两个 span + 第 118、148-149 行的 display 规则 + 1099px 媒体查询里的整段重排共同实现。改成抽屉形态时必须同时理解这四段 CSS；建议先改成单一 DOM + CSS 控制显隐，或直接拆成 RailNav / DrawerNav 两个组件，让形态差异变成组件差异而不是媒体查询差异。
  > 【必须先解耦 5：内容让位契约】AppShell.vue:46-58 的 .main-content（margin-left + padding + 三档媒体查询）与 TopBar.vue:175 的 margin-left 共同构成「内容区让出导航」的隐式约定，分散在两个文件。改版要重排栅格时，应先把它收敛成单一来源（例如 shell 统一出一个 --content-offset，或改用 grid-template-areas），否则三处（AppShell / TopBar / SidebarNav）会不一致。
  > 【必须先解耦 6：模式切换确认 UI 的两份实现】TopBar.vue:32-69 的 .popover 预览分支与 SettingsView.vue:29-40 的 .switch-confirm 必须先合并成一个共享组件（放到 components/common/），再谈重新设计它的外观，否则改版后两份实现会立刻分叉。
  > 【必须先解耦 7：文案数据的归属】store/app.ts:189-199 的 switchPreview 把中文差异清单硬编码在 store 里，TopBar.vue:97-100 与 SettingsView.vue:245-246 又各写一份模式描述。改版若要重写文案，需先把这些文案抽成 services/ 或 constants/ 的数据表，让 store 只负责取数、视图只负责渲染。
  > 【必须先解耦 8：全局浮层的层级与定位】ToastRegion.vue:4 的 top:106px 是按 58px 页头算的魔法数字；抽屉 1103 / scrim 1101 / topbar 1100 / bottom-nav 1100 是手写 calc 出来的相对值，没有层级语义表。改版调整页头高度或层级体系时，应先建立一张 z-index 与偏移的语义表（或改成由布局常量统一计算），否则「抽屉盖住汉堡按钮」和「Toast 压页头」这类问题会在新布局里复现。
  > 【必须先解耦 9：MobileNav 的文件形态与 owns 关系】整文件压成单行（10 行），且 owns 归属（/plan 与 /execution 归「今日」、/onboarding 归「我的」）是信息架构决策写在模板文件里。改版要动底栏时，先把它格式化、把 owns 关系提到与 SidebarNav 共用的一份 nav 配置（建议从 router 的 meta 派生），再做视觉调整。
  > 【顺手的清理项】四个空目录 src/components/{journey,reports,training} 与 src/data 可直接删除（全仓零引用，README:96 已注明未落地）；globals.css:142-148 的 .container 与 tokens.css:180-183 的 --breakpoint-* 是死代码可删，但后者若要改造成真实断点表需注意 CSS 变量无法用于 media query，只能靠构建期常量或 PostCSS 之类方案。
### 全局状态中枢（Pinia store + 领域类型 + 本地持久化）
DEBT:
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
  - **planDraftState 是整体替换的，字段字面量重复 10 次**：generatePlanQuestions / generatePlanDraft 里每次状态转移都写一遍完整 7 字段对象（app.ts:403/415/429/439/453 与 481/494/504/512/528）。加一个字段要改 10 处。PlanDraftDialog 靠两个 watch（PlanDraftDialog.vue:202-220）兜住整体替换。
  - **planDraftState.status 与 loadingStage 两个概念互相渗透**：error 态也带 loadingStage（app.ts:405、432 等），loadingStage 的实际语义是"当前在哪个阶段"，却和 status 放在同一个可空结构里，类型上不正交。
  - **llmConfig 的持久化归属在 services/llm.ts 而不在 store**：init() 调 loadLlmConfig() 读（app.ts:102、llm.ts:23-37），setLlmConfig 调 saveLlmConfig() 写（app.ts:365-367、llm.ts:39-52），是"读→清洗→写"模型；其余字段是"改 ref→persistState"模型。两套并存，且 llmConfig 是 store 的公开 state，谁在 init() 之前读它就是空。
  - **llmDefault（服务端默认模型状态）是竞态的**：init() 里 void refreshLlmStatus()（app.ts:103）是 fire-and-forget，首屏任何读 store.llmDefault.available 的地方先拿到 false。MealsView 因此自己又补了一次 void store.refreshLlmStatus()（MealsView.vue:296）—— 同一个请求两个触发点。
  - **clearAllData() 没有清 llmConfig**：app.ts:869-891 复位了 mode/profile/sessions/meals/plans/planHistory/modeLog/pendingSwitch/privacy/collapsedCards/themePref/unitGrams，但 API key 仍留在 twopoles_llm，toast 文案（app.ts:888）也没提。也没有清 toasts / planDraftState / initialized，showToast 的 setTimeout（app.ts:696-700）也不取消。
  - **导出的 JSON 无法回灌**：SettingsView.payload（SettingsView.vue:328-340）导出 profile/mode/modeLog/privacy/sessions/meals/plans/planHistory/unitGrams，但全项目没有任何 import/restore 入口（无 FileReader、无 file input）。用户拿到的备份文件回不到应用里，导出功能实际只是"单向快照"。
  - **导出 payload 与 localStorage 实际内容不一致**：payload 里没有 collapsedCards / theme / pendingSwitch，而 twopoles_state 里有（app.ts:138-150）。SettingsView.vue:195 那行标签写着"localStorage 占用"，实际算的是导出 payload 的体积（SettingsView.vue:341），不是 localStorage 的真实占用。
  - **initialized 是死状态**：app.ts:64 定义、app.ts:131 置 true、app.ts:901 导出，但全项目没有任何一处读它。视图各自用 store.hasProfile 判断"有没有档案"，这个字段纯占位。
  - **domain.ts 里有一批死类型**：PlanAdjustment（domain.ts:140-147，全项目零引用 —— PlanView 是本地 computed 算出 adjustment 再直接调 acceptAdjustment(planId, PlanChange[])）、CameraSession（domain.ts:337-346）、PoseFrame（domain.ts:330-335）均无消费者。改版时容易误以为它们还是活的契约。
  - **PlanItem.planId 在实时预览分支是假值**：planRules.toPlanItem 写死 planId: `plan-v${version}`（planRules.ts:88），而 dayPlanNotice 在没有存档计划时返回的正是这些 item（app.ts:310）→ 前端拿到的 planId 是 plan-v3 这种占位符，不是真实计划 id。任何按 planId 反查计划的下游逻辑都会踩空。
  - **dayPlanNotice 把"存档计划"和"实时计算"混在一个返回值里**（app.ts:305-316）：items 取自存档（若有），conflicts / auto / gateNote 却总是来自当前规则重新算的 buildDayPlan。档案改过之后，页面会拿旧计划的条目配新规则的冲突说明 —— stale 标志只覆盖了规则版本一种情况。
  - **MealItem.foodId 是拼接字符串而非实体引用**：addMeal 里 foodId: `${i.category}-${i.foodName}`（app.ts:766），而真正的食物目录在 foodComposition.foodTable。foodId 无法指向目录条目，改版若要做"食物库/收藏"没有现成的键可用。
  - **unitKey 的名称规范化靠调用方自觉**：unitKey(foodName, unit) 直接拼 `${foodName}|${unit}`（foodComposition.ts:27-29），注释写的是"用目录里的规范名"，但函数本身不做归一化。store.rememberUnitGrams(foodName, unit, grams)（app.ts:836-841）是公开 API 且不做 canonicalize —— 当前唯一调用方 MealForm 传的是 convOf(row).food（已是 findFood().name，MealForm.vue:234）所以碰巧是对的，任何新调用方传原始名就会写出永远命不中的 key。分隔符 `|` 也没转义。
  - **store 直接操作 DOM 与定时器**：applyTheme() 写 document.documentElement.dataset.theme（app.ts:87）、showToast 用 setTimeout 管生命周期（app.ts:696-700）、init() 注册 matchMedia 的 change 监听器且从不移除（app.ts:104）。store 不再是纯数据层，测试与 SSR 都不友好。
  - **文档与代码不一致**：交付说明.md:280 的示例写 `store.switchMode('athlete')`，但 store 里从来没有 switchMode（现名是 requestModeSwitch/confirmModeSwitch/commitMode）；同文件 335 行仍写着"init() 会读取该键，但运行时不会产生写入……switchMode() 与 updateProfile() 是唯一的写入点，而它们没有任何调用方"，与现状（persistState 在 18 处被调用）完全脱节。文档里的 store API 清单不能当参考。
HOOKS:
  > **主题是干净的接缝**：对外只有 applyTheme() 与 setTheme(pref) 两个接口，偏好三态 system|light|dark 不动。换肤只需重写 applyTheme 内部把偏好映射到 CSS 变量/类名（注意 dataset.theme 是与 index.html 共享的契约，见 constraints）。
  > **通知系统已完全解耦**：showToast / dismissToast / store.toasts 三个接口 + 只有 6 行的 ToastRegion.vue。换一套通知组件（栈式/内联/banner）完全不影响任何业务代码。
  > **折叠状态是纯 id 字符串集合**：collapsedCards + toggleCard(id) / isCardCollapsed(id)，与卡片外观完全无关（InsightCard 只用 cardId prop）。卡片外观可任意重做，只需保留 card-id 字符串。
  > **AI 草稿弹窗是自包含的**：PlanDraftDialog.vue（461 行）只读 store.planDraftState，store 不含任何弹窗逻辑。整块换掉弹窗 UI 不用碰 store。
  > **模式切换预览是纯数据对象**：switchPreview 返回 {from, to, fromLabel, toLabel, differences[], keeps[], openPlanCount, openPlanNote}，不含任何 DOM。确认弹窗可以整块重写 —— 前提是先把 differences/keeps/openPlanNote 里的中文文案从 store 挪到视图层或文案表（这是当前唯一挡住该接缝的东西）。
  > **services/ 层是完全独立的**：src/services/* 下 11 个文件全是纯函数、零 store 依赖、零 DOM 依赖（foodComposition/mealRules/planRules/weekRules/loadRules/profileRules/exercises/llm/wellnessCards/foodRecognition/mealPhotos）。改版换皮换布局时可以整体不动，也不用担心它们被 store 的重构波及。
  > **domain.ts 的类型是纯数据契约**：无方法、无类、无行为。可以自由增加可选字段（Meal.uncertain / MealItem.modelEnergy / EnergyEstimateRef.gramsPerUnit 都是这么加的），但**改名字或改嵌套层级等于改持久化格式**。
  > **必须先解耦再动的四处**：① 持久化的四份手抄 schema（persistState / init / clearAllData / SettingsView.payload）—— 改版必然要动持久化，必须先抽成统一的 serialize/deserialize/clear 三函数或换用持久化插件；② switchPreview 里的中文文案（store 里写 UI 文案）；③ dayPlanNotice 的「存档 items + 实时 conflicts」混合契约 —— 界面重排时无法判断该信哪个；④ store 对 DOM 的直接操作（applyTheme 写 dataset.theme、showToast 的 setTimeout、matchMedia 监听器不卸载）。
  > **可补齐的现成 seam**：store 缺 updateMeal/replaceMeal（MealsView.vue:519 只好直接写 store.meals），补上后编辑一顿饭的流程可以整体重写；store 没有暴露「本周汇总」口径（buildWeeklyReport 被 3 个 view 各调一次，DashboardView.vue:334 / PlanView.vue:290 / ReportView.vue:172），收进 store 就能消掉三份重复取数；「当前参考日」在 5 个 view 里各 new Date() 一次（DashboardView:292 / MealsView:265 / PlanView:187 / ReportView:152 / TopBar:94），提升到 store 或路由 query 后，加「回看某天」类功能才不会各页各算。
  > **planHistory 是 UI 的一等公民（PlanView.vue:156-163 的版本列表）**：改版若要折叠/隐藏历史，得先给 planHistory 加上限或去重策略，否则它会持续撑爆 localStorage（每勾一次复选框就多一份完整快照，app.ts:595）。
### 周报与负荷/恢复分析子系统（ReportView + weekRules + loadRules + wellnessCards）
DEBT:
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
  - weekRules.ts:84-95 把整句中文数据质量文案硬编码在服务层，UI 只能整段渲染成 <li>（ReportView.vue:122）。文案与算法强耦合：想改一句措辞或把一条拆成两栏，必须改 services 层而不是只换皮。
  - 周报页完全没有模式分支。DashboardView 有完整的 `isAthlete` 分支（大众=时间轴+双极环 / 运动员=LoadChart+强度分布），ReportView 无论哪种模式都渲染同一张「每日负荷 + 餐食结构」图，store.currentMode 只被透传给 buildWeeklyReport 参与计划天数计算。交付说明.md:733 明确把「周报两套图表」列为待做项 —— 改版时这块要么补齐要么明确声明周报是模式中立的。
  - 同一份「每日负荷」有两套完全独立的渲染实现：ReportView.vue:329-342 是纯 div + CSS（渐变柱、repeating-linear-gradient 斜纹、inset 描边），LoadChart.vue 是 SVG（rect + polyline + 网格刻度 + 未知区灰底）。两种「缺 RPE」的视觉编码也不同（斜纹 vs 6px 短条），两种「未记录」也不同（空心柱 vs 灰底 unknown band）。改版时这两块必须合并或明确分工，否则同一个概念会出现两套语义。
  - 硬编码颜色绕过令牌：ReportView.vue:331 与 DashboardView.vue:654 的柱渐变写死 `#12857c → #0c655e`，而深色主题下 --color-accent 已改成 #3ec9b6（tokens.css:200）→ 深色模式下柱色不随主题变化，且与同页图例 .sw.solid（用 var(--color-accent)）颜色对不上。
  - 图例与实际图形不一致：ReportView.vue:349 `.sw.none` 用 `--hair` 描边，而对应实际的 `.plot .bar.zero`（第 333 行）用 `--hair-strong` 描边 —— 图例色块和真实柱子的粗细对不上。
  - wellnessCards.ts 548 行纯文案（约 30KB）静态 import 进主 bundle：pickDailyWellnessCard 每天只用其中一条，但 15 张卡的 detail/athlete 全文全部进包，没有任何按需加载或按类别拆分。
  - weekRules.ts:71 调 isPlanDay → planRules.buildDayPlan → 每个动作还要跑 alternativesFor → 每次都新建一遍 activeExercises() 过滤（exercises.ts:122）。buildWeeklyReport 一次要跑 7 天 × 多次过滤，而 report 是 computed，store 任何变更都会重算。改造周报页时若把 report 从 computed 改成 ref/定时刷新需注意这个成本。
  - ReportView.vue:119 的 InsightCard 用 tone="ink"，但 InsightCard.vue:44 的 ink 图标底色写死 #11161a 且带 `box-shadow:0 10px 22px -12px rgba(21,24,27,.6)`，深色主题下深色图标块贴在深色卡上几乎不可见。
  - ReportView 的格式化逻辑全在视图内、没有独立展示层：statusText()（第 264-266 行）、weekLabel()（第 258-262 行）、'—' vs 0 的分支（第 39、96-99、184、203 行）、'场/min/AU' 单位（第 185-204 行）都是 view 内散落的字符串拼接，DashboardView 另有一套自己的翻译与单位写法。
  - ReportView.vue:124 把「数据只存本机浏览器」与实时条数写死在数据质量卡里（`{{ store.sessions.length }} 条训练 / {{ store.meals.length }} 条餐食`），与 cards 的可收起机制绑在一起 —— 换掉 InsightCard 就会丢这条隐私声明（它同时是调研结论里「无广告/本地存储」要点在文案层的唯一落点）。
HOOKS:
  > 【可整块换掉、不动逻辑】buildWeeklyReport / buildLoadSeries / loadZone / intensitySplit / loadOf / weekStart / weekDates / pickDailyWellnessCard 全部是纯函数，输入输出都是纯数据，视图层可以完全重写而不碰它们。
  > 【可整块换掉】StatStrip 的 StatItem（label/value/unit/hint/tone）就是为「换皮不换算」设计的展示契约 —— 只要重写 StatStrip 内部样式或结构，ReportView 的 stats computed 一行都不用动；反过来若要改指标结构，ReportView.vue:179-210 的 stats 数组也要跟着改。
  > 【可整块换掉】InsightCard 的 props（cardId/eyebrow/title/tone）+ icon/content 两个 slot + 内部 store.collapsedCards 收起逻辑，是洞察卡的完整边界。ReportView.vue:119-125 只用了 8 行，换皮时保留 card-id="report-quality" 即可保住持久化与 aria-expanded。
  > 【可整块换掉】BaseCard 的 variant（default/flush/ink）+ --card-pad 变量已经承担了「表面系统」的职责；ReportView 三张卡都用 flush，重排时只需换内部结构，不必碰卡片外观。
  > 【可整块换掉】ReportView 的三个内容区（每日负荷卡、餐食结构卡、训练账本卡）各自有独立边界：BaseCard 包壳 + .card-head（micro + h2 + 右侧 slot）+ role="img"/aria-label 的主体 + .axis-note 脚注。这四段可以分别替换成完全不同的视觉（SVG 折线、堆叠条、卡片流、时间轴），不影响其他区块。
  > 【可整块换掉】wellnessCards.ts（内容 + 类型 + 取卡函数）与 DailyWellnessCard.vue（呈现）已经分离；DailyWellnessCard 可以整块重写而不动文案，取卡规则（每日稳定、类别交替）不动即可。
  > 【可整块换掉】周切换交互（shiftWeek/goToday/refDate）纯本地，refDate 是唯一的 ref；把翻页改成下拉、滑动或分段控件都不影响任何计算，只要仍然驱动 refDate。
  > 【必须先解耦再换皮 1】逐日负荷的状态编码与几何混在 view 里：dayStates（数据）+ barPx（像素高度）+ barClass（zero/hatch/today 三态）是三件事。应先抽出一个纯函数 dayState(day) → 'load'|'missing'|'none'|'today'（数据层）与一个 dayMeta（数值/单位/轴标签），再让渲染层只消费它们；否则换 SVG / Canvas 时会连带复制一份口径。
  > 【必须先解耦再换皮 2】weekRules.ts:84-95 的 dataQuality 是整段中文字符串。要让新界面按「缺 RPE / 计划差 / 餐食未记录」分栏展示，必须把服务层改成返回结构化条目（如 { kind: 'rpe-missing' | 'coverage' | 'meals', text }），或至少保留原文并另加机器可读的 kind；否则 UI 只能整段丢进一个 <li>。
  > 【必须先解耦再换皮 3】stats 的取数与文案写在一起（ReportView.vue:179-210）。建议拆成「从 WeekSummary 取值」与「值 → 呈现（单位/文案/tone）」两步；改版常常要同时改文案和布局，混在一起会让两边互相绊住。
  > 【必须先解耦再换皮 4】柱高与容器尺寸的耦合（PLOT_H=132 vs CSS 158/138）。换成 SVG 时应改用 viewBox + preserveAspectRatio 或百分比高度；换成别的图表（如折线、热力图）时这个常量直接作废，但前提是先把它从 CSS 里解耦。
  > 【必须先解耦再换皮 5】planned 圆点必须改成调用 isPlanDay(d, store.userProfile, store.currentMode)（或直接消费 report.plannedDays），否则档案一变圆点就与「计划场次」打架 —— 这是数据正确性，不是样式问题，必须在换皮前修。
  > 【必须先解耦再换皮 6】周数算法与 weekDates/星期名数组应先收敛到 utils/time.ts 或 weekRules.ts 的单一实现（现在 ReportView、DashboardView、PlanView 各有一份），再重排周导航 UI；否则周标签与周号会各说各话。
  > 【半成品/待决策】周报页没有任何模式分支，而 DashboardView 有完整的 isAthlete 分支、交付说明.md:733 把「周报两套图表」明确列为下一轮待做。大改版时应在这里明确二选一：补齐运动员版周报（可直接复用 loadRules + LoadChart），或把周报定义成模式中立的「事实报告」并在文案里说明。
  > 【半成品/待决策】ReportView 完全没有 loading / 错误 / 部分数据态。数据是本地同步的，理论上不需要 loading；但 buildWeeklyReport 依赖 userProfile 与 planRules，档案字段异常时没有兜底 UI —— 大改版前建议先加一层错误边界，再谈版式。
  > 【半成品】wellnessCards 的 15 张卡文案齐全且被 selfcheck 校验，但整套内容（~30KB）静态进主包、每天只用一条。若大改版要新增/扩写卡片，先把它按 category 拆成独立模块并做按需加载，否则 bundle 会继续线性膨胀。
### 设置与数据 / 模型接入（SettingsView + llm 服务 + 服务端默认模型代理）
DEBT:
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
  - src/services/llm.ts 整个文件把 5 类职责（配置持久化 / 就绪判定 / 状态探测 / 提示词 / 响应校验 / 代理传输）混在一个 522 行模块里，提示词文案与 HTTP 调用在同一文件同一层——重做提示词或换模型厂商都要动到传输层
  - PlanDraftState 状态机的类型定义在 src/services/llm.ts（第 145-154 行），状态迁移逻辑却在 src/stores/app.ts（generatePlanQuestions / generatePlanDraft / acceptPlanDraft），同一个状态机跨两个文件维护，UI 侧（PlanDraftDialog）只读 store.planDraftState
  - src/stores/app.ts 中 generatePlanDraft 调用 validatePlanDraft 时传入的是 `llmConfig.value.model`（用户自填的模型名），而不是 callLlmChat 返回的实际模型名——当使用服务端默认模型时 llmConfig.model 为空或仍是旧的自填名，落到计划 reason 里的「模型：xxx」会记错模型名
  - src/stores/app.ts `clearAllData()` 只清 `twopoles_state` 与 IndexedDB 照片，**不清 `twopoles_llm`**——设置页「清除全部数据」卡片文案写的是「并清空本机存储」，但用户的 API Key 仍留在本机 localStorage 里，语义与实际不符（安全边界不一致）
  - src/stores/app.ts 隐私默认值被写了两遍：clearAllData 内部第 55-62 行的对象字面量，与第 878 行的对象字面量，以及设置页第 408 行 wipe() 里的硬编码 90（第三处魔数）
  - src/views/SettingsView.vue 第 352-377 行 toCsv() 里手写 `s.rpe === null || !s.actualDuration ? '未计入' : Math.round(s.actualDuration * s.rpe)`，与 src/services/weekRules.ts 第 30-33 行 `loadOf()` 的口径完全重复——负荷算法有两份实现，改一处导出就与周报对不上
  - src/views/SettingsView.vue 第 371-374 行把计划的版本号/模式/理由用 `｜` 拼进「备注」一列塞进 15 列表格，CSV 消费方无法按列解析这些信息
  - src/views/SettingsView.vue 第 328-341 行 `payload` computed 里包含带 photoThumb 的完整 meals，`sizeKb` 为了算体积对整份数据做 `new Blob([JSON.stringify(payload.value)])`，每次 store 变化都重新序列化全量数据（含 base64 缩略图），大库下是 O(n) 的重复开销；导出时又再 string 一次
  - src/views/SettingsView.vue 第 379-403 行 download/exportData/csvCell/toCsv 约 50 行导出逻辑全部内嵌在视图组件里，src/services/ 下没有任何 export 模块——想把「数据管理」做成独立页面或独立服务都得先搬家
  - src/views/SettingsView.vue 第 343-350 行 setPrivacy 只校验 dataRetentionDays >= 7，模板里虽写了 max=3650 但 number input 的 max 不阻止键入，>3650 的值会被原样写进 store；同时第 312 行的 retention ref 只在 setup 时初始化一次，store 侧变化不会回流
  - src/views/SettingsView.vue 第 309 行 `systemDark` 是 setup 期对 matchMedia('(prefers-color-scheme: dark') 的一次性快照，系统主题在运行中切换时这段「系统当前是深色/浅色」文案会过期（store 里有 media listener，视图里没有）
  - 导出只有出、没有进：全仓库没有任何 import/restore 代码；导出的 JSON payload 结构与 `twopoles_state` 结构并不一致（多 exportedAt、缺 theme 与 collapsed、meals 缺 photoId），即便将来加导入也需要一层映射
  - 界面把两个「当前无实际效果」的偏好（saveVideoLocally、dataRetentionDays）与两个已接线的开关（cameraEnabled、saveFoodPhotoLocally）用完全相同的 .toggle 样式并排呈现，只靠 .fine 小字披露；README/开始使用.md 虽标注了这一点，但界面本身没有区分
  - src/views/SettingsView.vue 第 146-149 行、107-115 行的 .fine 长段落承担了模型接入与隐私的全部安全说明（密钥不出本机、请求经本机代理、图片会发到模型厂商），是纯文字散文，没有结构化的告知形态
  - 设置页「使用方式」切换确认（.switch-confirm 双栏）在 TopBar.vue 第 200-260 行有第二套完整实现，且两处各自维护一份 modes 数组（设置页内联数组 vs store.modes）
  - src/views/SettingsView.vue 第 434 行页脚把 `RULE_VERSION`（值 'diet-rules-v2'，来自 src/services/mealRules.ts）当「版本」显示给用户——它是餐食规则版本，不是应用版本，语义错位；且应用本身没有 version 字段
  - vite.config.ts 第 148-158 行 loadEnv(mode, cwd, '') 用空前缀会读入 .env/.env.local 全量变量，pick 只挑 LLM_DEFAULT_* 三项；.env.example 未说明 .env.local 也会被读取、也未说明改完 .env 需要重启 dev server（loadEnv 只在配置加载时执行一次）
HOOKS:
  > 【可直接整体替换的干净接缝】设置页六个区块（使用方式 / 模型接入 / 隐私 / 外观 / 我的数据 / 清除全部数据）是六张独立的 BaseCard，每张自带标题与内容，互不共享 DOM，可逐块换皮而不动逻辑
  > 【可直接整体替换的干净接缝】store 暴露的 action 已经足够细：setLlmConfig / setLlmPreference / refreshLlmStatus / updatePrivacy / setTheme / clearAllData / switchPreview —— 新界面可以完全不碰 llm.ts 与 store 内部实现
  > 【可直接整体替换的干净接缝】switchPreview 把「会变化 / 保持不变」两栏内容算成数据（differences / keeps 两个字符串数组），确认面板是纯数据驱动渲染，样式与文案可自由重写
  > 【可直接整体替换的干净接缝】BaseCard 预留的 `--card-pad` 自定义属性是官方内距接缝，配合 variant（default/flush/ink）可以让新皮肤不改组件源码
  > 【可直接整体替换的干净接缝】llm.ts 里的纯函数（isLlmReady / usingDefault / canUseLlm / buildPlanMessages / buildPlanQuestionMessages / validatePlanQuestions / validatePlanDraft / extractJson）无 DOM 与 store 依赖，可整体搬到新目录并被新面板直接调用
  > 【可直接整体替换的干净接缝】导出三件套（payload computed / toCsv / download）虽然物理上在视图里，但全是纯数据变换，抽成 src/services/export.ts 后「数据管理」新页面可整体复用
  > 【需先解耦再换皮】模型接入卡片：视图逻辑（llmForm 编辑缓冲、saveLlm / setPreference / runTest、llmMsg 内联反馈）与展示结构缠在一起，且 runTest 有写副作用、preference 被 saveLlm 派生覆盖。改版前应先把「表单状态」抽成独立 composable/useLlmForm，把「测试」改成不落库的纯探测，把 preference 变成用户显式可选而非派生量
  > 【需先解耦再换皮】隐私卡片：四个开关的 label/说明/是否已接线全硬编码在模板里（saveVideoLocally、dataRetentionDays 是空开关），而 store 里的隐私默认值在两处重复。改版前应先把 PrivacySettings 的每一项抽成带 {key, label, hint, enabled(是否已实现)} 的元数据表，由表驱动渲染，并让默认值只有一份
  > 【需先解耦再换皮】主题与系统主题：设置页的 theme chips 与 store 的 applyTheme、index.html 的预绘制脚本三处协作，且设置页的 systemDark 文案是过期快照。改版前应抽出统一的 themeService（读 localStorage + 监听 media query + 设置 data-theme），三处共用
  > 【需先解耦再换皮】使用方式切换：同一业务在设置页与 TopBar 各实现一遍确认 UI、各有一份 modes 数组。改版前应抽成共享的 ModeSwitchConfirm 组件 + 单一 modes 数据源
  > 【需先解耦再换皮】统计区：SettingsView 的 .stats 是 StatStrip 的重复实现且未用 --font-num，新版应直接改用 StatStrip（并让 StatStrip 支持需要的变体），而不是再写一套磁贴
  > 【需先解耦再换皮】流式/加载态：模型调用目前只有「测试中…」一个按钮禁用态，PlanDraftDialog 承担了 questions/loading/ready/error 四态呈现。改版若要给设置页加模型连通性检查，需要把 llm.ts 的探测结果抽成一个可被设置页与其它页面共用的状态源，而不是各页各写 cloudModelLabel
  > 【新增能力所需的接缝】导入/恢复功能：当前完全缺失，且导出结构与 twopoles_state 结构不同。新增时建议把「持久化 schema」抽到 src/services/persist.ts（唯一序列化 + 反序列化入口），导出直接复用该 schema 就能天然得到可回灌的 JSON，并把 import 做成与 export 对称的一对
  > 【新增能力所需的接缝】vite.config.ts 第 43-146 行的 llmProxy 是 100 行内联的服务端代码，dev 与 preview 各自注册一次。改版若要改部署形态（独立后端、nginx 反代、正式域名），应先把它抽成独立 server/llmProxy.ts 模块，让前端契约与部署形态解耦
  > 【令牌化接缝】scoped CSS 里散落的 .eyebrow/.fine/.chip/.field/.actions/.stats 已在 3-4 个 view 重复，样式层重构前应先抽成 tokens.css 之外的共享工具类或公共组件（Toggle / Chip / FieldRow），否则新皮肤会把重复复制到第五份
### 实时跟练执行页（ExecutionView）与端侧姿态识别/计数子系统
DEBT:
  - 模板里的占位符是死代码：`pose.kneeAngle ?? '—'`（ExecutionView.vue:206）永远走不到 `'—'` 分支。`pose` 是 `usePoseCamera()` 返回的普通对象（内部装 ref），模板只对顶层 setup 绑定做解包，编译产物实测是 `unref(pose).kneeAngle ?? "—"`，ref 对象永不为 nullish，`??` 失效后由 `toDisplayString` 兜底渲染成空串 —— 角度为空时界面显示「膝 ° · 髋 ° · 肘 °」而不是「—」。同一文件 20/23 行的 `pose.errorMessage.value` 却显式取 `.value`，两种写法自相矛盾，抄错就会静默出空值。
  - 视图直接写 composable 的内部 ref：ExecutionView.vue:453 `pose.errorMessage.value = '摄像头画面容器没有准备好，请重试。'`，468 与 477 行 `pose.errorMessage.value = ''`（清错误）。`usePoseCamera` 没有暴露 `clearError()`/`setError()`，所以清错误只能由外部手改内部状态 —— 换 UI 时这个口子会继续扩散。
  - 两套动作目录靠中文名 join，且有一方静默兜底：`demoCameraService.demoExercises`（demoCameraService.ts:70-73，只有「坐站训练 2×8」「站姿弯举 2×10」）与 `services/exercises.ts`（26 项，带 CameraConfig）各写一份组数/次数。ExecutionView 的组数次数取前者、计数阈值取后者（`findExercise(exercise.value.name)?.camera`），改一处不同步另一处就会静默错配。更糟的是 `getDemoExercise`（demoCameraService.ts:75-77）找不到名字时静默回落到 `demoExercises[0]`，而 PlanView.vue:328 传的 firstExercise 是按 **type** 匹配的（可能是「弹力带弯举
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
  - 内联 SVG 剪影与绝对坐标耦合：ExecutionView.vue:41-115 约 75 行 `<svg viewBox="0 0 560 760">`（含 4 个 gradient defs 与 8 个关节 `<g>`），配套 12 条 `transform-origin` 写死 viewBox 坐标（773、792-803，如 `transform-origin:288px 714px`），依赖 `transform-box:view-box`。换比例尺、换关节、换插画风格都要同步手改整张坐标表。
  - 布局用内联 style 表达：`.reps-grid` 的 `gridTemplateColumns: 'repeat(' + exercise.repsPerSet + ', 1fr)'`(189) 写在 `:style` 上，无法用 CSS 变量或媒体查询接管，次数多时（repsPerSet 很大）格子会挤成不可读的细条。
  - 三条文案通道重复表达同一批事实：`stageMessage`（L409、L437）、`sourceNote`、`stageHint` 各自拼「摄像头未就绪 / 阶段 / 置信度」；阶段文案还来自一个叫 demo 的服务（demoCameraService.getPhaseText，demoCameraService.ts:82-95）—— 实时模式的阶段词也由「演示」模块负责。
  - `restart()` 手工重置约 25 个 ref（elapsedMs / setElapsed / reps / displayReps / repsBySet / setIndex / status / paused / finished / message / phase / manualCorrections / setProgress / tween 相关…），漏一个就残留上一组状态；且 `switchMode('camera')` 成功后也调 `restart()`，切数据源等于重开一局。
  - 同一个文件里 `status` 有两种含义：视图的 `status: 'playing'|'resting'|'idle'` 与 `pose.status: PoseCameraStatus`（idle/starting/live/unsupported/denied/error），模板中 `status` 与 `pose.status` 并存，任何一次改名或类型收敛都会误伤。
  - 置信度徽章用 `:key="confidenceClass"` 强制重挂载来重放入场动画，属于用 key hack 代替 CSS animation 重触发；`getConfidenceLevel`（demoCameraService.ts:97）的 0.8/0.5 阈值原本是给 demo 事件的 confidence 用的，被复用到实时模式的 `visibility`（关键点可见度），两个物理量共用「识别良好/一般/较差」一套文案。
  - 两条独立动画回路叠加：`usePoseCamera.onFrame` 自带 RVFC/rAF 循环并在每帧新建 `DrawingUtils` 实例全量重画（usePoseCamera.ts:50-68、95-119），ExecutionView 的 `tick()` 又有自己的 rAF；两者没有共享时钟，「帧率」指示的是推理帧率而非渲染帧率。
  - 开发态指示失真：`createPoseEngine` 在 `import.meta.env.DEV` 时恒走主线程（poseEngine.ts:108），所以界面上的「推理落点 / 后端」在开发时永远显示主线程 + CPU，worker/GPU 路径只有构建产物才能验证。
  - 文档与实现存在口径落差：README.md:246-247 记录了 dev 下 worker 不可用、README.md:307/331 仍留「未在真机验证」字样，而 交付说明.md:460+ 已把 MediaPipe 阶段记为「半真记录」、交付说明.md:662-687 记了剪影改造、710 记了 live/demo 骨架视觉冲突 —— 文档之间的成熟度描述不一致，改版时不能直接引用文档判断现状。
  - `counter` 整个 composable 实例被塞进一个 `ref`（ExecutionView 的 `counter = ref<ReturnType<typeof useRepCounter> | null>(null)`），`counter.value.count` 读到的其实是 reactive 代理解包后的值，与 composable 内部 ref 不是同一层；且 `useRepCounter` 在 `buildCounter()` 里（非 setup 上下文）创建，其内部 `computed` 不在组件 effect scope 内、不会被自动 stop，改版重构时容易漏掉释放或重复创建。
HOOKS:
  > 【可整体替换·边界清晰】`usePoseCamera()` 返回扁平响应式接口（status / errorMessage / fps / kneeAngle / hipAngle / elbowAngle / visibility / delegate / runsIn / startingStage + start / stop），不泄露内部 engine / stream / handle，换成任何一套新舞台 UI（例如分屏、画中画、纯指标面板）都只需重写 ExecutionView 的模板与样式，composable 一行不用动。
  > 【可整体替换·边界清晰】`poseMath.ts` / `poseLandmarkerFactory.ts` / `poseEngine.ts` / `poseInference.worker.ts` 是与 UI 完全解耦的纯推理层（除 OffscreenCanvas 创建外无 DOM 依赖），可以整体搬到新的 `src/features/execution/` 目录而不波及其它页面；`useRepCounter.ts` 同理，只依赖角度/可见度/时间戳三个入参。
  > 【可整体替换·边界清晰】`useRepCounter` 的对外契约就是 reset / calibrate / feed 三件套加一组只读 ref，视图只喂 `(angle, visibility, ts)` 拿 `{phase, counted, gate}` —— 换计数呈现方式（环形进度、节奏条、节拍器）完全不触碰算法。
  > 【可整体替换·边界清晰】`demoCameraService` 的 `getPhaseText` / `getConfidenceLevel` / `summarizeSession` 是纯函数，可以整体搬到新的文案层或 i18n 层，视图不感知；`demoExercises` 的时间轴数据也可以换成真正的 JSON 资源文件而不改视图。
  > 【可整体替换·边界清晰】右栏 4 张 BaseCard 已是独立块，各自带 variant 与 `--card-pad` 钩子，可逐个抽成 `RepCounterCard.vue` / `JointMetricsCard.vue` / `ManualCorrectionCard.vue` / `SessionSummaryCard.vue`，逻辑留在各自组件内，页面只负责排布。
  > 【可整体替换·边界清晰】BaseCard 已提供 variant=default/flush/ink + `--card-pad` 变量 + 遗留 `glass` prop，是现成的换皮接口；把 ExecutionView 里那两处 `padding:...!important` 换成 `--card-pad:0` 后，这一页就能并入统一卡片体系，不再单独维护内边距。
  > 【可整体替换·边界清晰】内联 SVG 剪影（ExecutionView.vue:41-115 与 773-803 的 transform-origin 表）可整体抽成 `DemoFigure.vue`，props 只需 phase / joint / paused，把 viewBox 坐标表关进组件内部，换插画风格不影响页面。
  > 【可整体替换·边界清晰】`.reps-grid` 次数格、`.stage-overlay` 的两枚徽章、`.frame-sheen` 扫光、`.stage-live` 底部条、`.stage-controls` 圆形按钮组，都是纯展示块，可各自成为独立组件或换成完全不同的形态。
  > 【可整体替换·边界清晰】顶部 `.source-switch`（演示回放 / 实时摄像头 / 重试摄像头）与 `.exercise-switch` chips 已经是「本地 ref + 事件回调」的形态，可直接换成新的分段控件、下拉或设置入口。
  > 【需要先解耦·样式与逻辑纠缠】`tick()`（ExecutionView.vue 约 L349-392）把演示时间轴推进、实时计数喂数、组间休息、结束判定、elapsedMs/setElapsed 计时、reps/displayReps 补间写进同一条 rAF；界面大改时任何重排都会碰它。必须先拆成「时钟」「计数器驱动」「展示补间」三层（各自独立 rAF 或 setInterval），再动布局。
  > 【需要先解耦·样式与逻辑纠缠】实时骨架的绘制在 `usePoseCamera.draw()`（主线程 canvas + DrawingUtils），颜色线宽是字面量；而画面容器、镜像 transform、object-fit:cover 都在 ExecutionView 的 CSS 里，canvas buffer 尺寸取 videoWidth/videoHeight。骨架与画面是两套各自维护的坐标系，想改舞台布局（竖屏、画中画、分屏）必须先统一「画面矩形 ↔ 骨架坐标」映射，不能直接改 CSS。
  > 【需要先解耦·样式与逻辑纠缠】`pose.errorMessage.value` 的三处直写（453/468/477）必须先改成 composable 暴露的 `clearError()` / `setError()`，否则新 UI 的错误提示只能继续靠外部改内部 ref。
  > 【需要先解耦·样式与逻辑纠缠】`pose.kneeAngle ?? '—'` 的 ref 解包错误必须先修：要么让 usePoseCamera 的返回值用 `reactive()` 包一层以获得模板深层解包，要么在视图里统一改用 `.value`；新 UI 若沿用现写法会继续渲染「膝 °」这类空值。
  > 【需要先解耦·样式与逻辑纠缠】`stageMessage` / `sourceNote` / `stageHint` 三条文案，加上 `getPhaseText`/`getConfidenceLevel` 里的中文硬编码（还放在一个叫 demo 的服务里），必须先抽成单一文案表并区分「演示剧情文案」与「实时几何文案」，再重排右侧信息卡的阶段展示。
  > 【需要先解耦·样式与逻辑纠缠】`ExercisePhase` 一套枚举两套语义（演示剧情 up/down vs 实时几何 up/down）必须先拆成两个类型（`DemoBeat` 与 `RepPhase`）或补一张明确映射表，再重排阶段展示与剪影姿态。
  > 【需要先解耦·样式与逻辑纠缠】`useRepCounter` 的判定完全由几何驱动，而 `.figure` 剪影动作由 `phase` 驱动，两者在「站姿弯举」上方向相反；重排剪影动画前必须先统一方向语义，否则换皮后动作看起来是反的。
  > 【需要先解耦·样式与逻辑纠缠】`summarizeSession` 的 `cameraUsed` 与 `actualDuration` 同 `loadRules`/`weekRules`/ReportView 的消费口径耦合，界面重排（新的结束卡片、新的汇总面板）时必须同时确定「单位」与「来源」，否则新汇总面板会把秒当分钟显示。
  > 【需要先解耦·样式与逻辑纠缠】`createPoseEngine` 的 DEV 主线程回落（poseEngine.ts:108）让开发态永远看不到 worker/GPU 指示；新 UI 若要展示「推理后端 / 落点」，必须先提供一条可在 dev 验证的开关路径（如 query 参数强制 worker），否则该指示在开发中不可测。
  > 【需要先解耦·样式与逻辑纠缠】12 条 `transform-origin` 与 viewBox 560×760 硬绑定，任何「放大缩小 / 换比例 / 换关节」的美化都要先把这张坐标表参数化（例如用 CSS 变量或 SVG 局部坐标系），否则改一个关节要重算全套。
  > 【需要先解耦·样式与逻辑纠缠】`restart()` 手工重置约 25 个 ref，且 `switchMode` 成功时也调用它（切数据源 = 重开一局）；重排「开始/暂停/跳过/结束」这套控件前，必须先把会话重置抽成一个显式的 `resetSession()` 边界，并把「切数据源」与「重开一局」拆成两个不同意图。
### 仪表盘首页（DashboardView + 今日养生卡片 DailyWellnessCard）
DEBT:
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
  - DashboardView L207 注释写「一条横排，替掉四张等宽卡」，但账本实际是三卡（L649 `1.15fr 1fr 1fr`）；L159 注释写双极仪表「首页/周报/跟练共用」，实际只有首页 import TwoPoleDial（grep 确认 ReportView / ExecutionView 都没用），周报页用的是手写柱状图；L674 留下一条没有对应规则的孤立注释。三处文档与代码不一致。
  - DashboardView L400-403：`loadNote` 在 `week.totalLoad === null` 时一律写「RPE 未记全，暂不合计」，但 weekRules L75 里 totalLoad 只在「本周没有任何一天算出负荷」时才是 null——常见原因其实是「本周还没有记录」，文案在说谎。
  - 负荷分档的魔法数字散落：边界 0.8 / 1.3 / 1.5 写在 `loadRules.loadZone`（L144-150），`LoadChart.vue` L73 又把 '0.8 偏低' / '1.3 偏高' 当字面量重抄一遍，L69 的 `left: (acwr/2)*100` 额外假定坐标轴是 0–2。改 loadRules 的阈值，图表刻度不会跟着变。
  - `loadRules.ts` L152-157 已经导出 `LOAD_ZONE_TEXT`（偏低/安全/偏高/明显过快/样本不足），DashboardView L410-415 的 `acwrChip` 却另写了一套语义（'ATL 在 CTL 上方' / 'ATL 在 CTL 下方'）。同一件事两份文案，其中一份没覆盖 unknown 分档。
  - `intensitySplit` 的 RPE 阈值 7（loadRules L183）从未出现在界面上：DashboardView L426-428 只显示「低 X min · 高 Y min」，不告诉用户分界线画在哪，与全项目「如实说明口径」的调性不一致。
  - 深色仪表面板的文字色全部手写 rgba(255,255,255,x)（DashboardView L628-646、TwoPoleDial L117-123），而 tokens.css L36-39 正好定义了 `--ink-panel-on` / `--ink-panel-muted` / `--ink-panel-line` 三枚 token，只有 `--ink-panel-muted` 被用上（L627）。
  - 响应式断点全是裸像素（DashboardView L327/687/691/704 = 1100/1279/1099/767，DailyWellnessCard L327/349 同值），而 tokens.css L180-183 定义了 `--breakpoint-sm/md/lg/xl` 却全站无人使用（grep 只命中定义行）。改版调整断点要同时改十几个文件。
  - `src/components/common/MetricCard.vue` 是一个完整实现但零调用点的已废弃组件（其自身注释 L16-18：「当前无任何调用；下次能改文件权限时直接删掉」）。改版前应先删掉，否则会被误当成可用积木。
  - DailyWellnessCard.vue L2：整张 BaseCard 带 `@click="expand"` + `cursor: pointer`，内部又嵌一个真正的 `<button class="w-toggle">`。整卡点击只在收起时生效（`expand()` L102-104 只会展开、不会收起），是嵌套交互语义 + 不可发现的操作。
  - DashboardView L163-167 与 L34 的 `notice.stale` 提示都靠手写中英文案拼接，没有走任何文案常量层；同一批文案散落在 template 字面量、computed 字符串和 service 常量三处，后续做多语言或口径统一时没有单一落点。
HOOKS:
  > 边界最清晰、可整块换掉而不动逻辑的部分：① `.tl-row` 列表（L57-65，纯展示，输入是已算好的 timeline 数组）；② `.tl-foot` 三格（L77-90）——换成 `StatStrip` 只需把数据映射成 `StatItem[]`，样式整块丢弃；③ `.g-side` 的 legend 与 `.g-foot`（L184-202）——纯展示，可换任何组件；④ `.bars` 柱状图（L224-230）——输入是 `bars` 数组，输出是 DOM，可整块换成 SVG 或图表组件；⑤ `.meals` 三行（L241-248）——输入是 `mealRows`，`ShapeState` 已是独立组件；⑥ `.why` 卡（L251-260）——换 `InsightCard` 只需传 `cardId/eyebrow/title`，顺带获得可收起能力；⑦ `footer.f
  > 数据层已经是干净的 seam：DashboardView 里所有 computed 都可以原样搬进一个新的 `useDashboardData()` composable 或 store getter——`mainItem`(L301)、`totalMinutes`(L306)、`timeline`(L312)、`week`(L334)、`bars`(L442)、`peak`(L465)、`upcoming`(L450)、`mealRows`(L474)、`lastSame`(L496)、`recentAvg`(L502)、`avgRpe`(L430)、`tags`(L369)、`whyText`(L380)、`kicker`(L352) 都只依赖 store + services，没有一个读 DOM 或写 ref。把这层抽出来后，模板可以整份重写而不触碰任何口径。
  > services 层是现成的稳定接口，改版不应也不需要动：`pickDailyWellnessCard(date)`、`buildDayPlan`、`buildWeeklyReport`、`buildLoadSeries`、`intensitySplit`、`loadZone`、`summarizeDay`、`MEAL_SLOTS`、`WEEK_LABELS`、`loadOf`。DashboardView 已经把它们当纯函数调用。
  > 样式与逻辑揉在一起、必须先解耦再换皮的地方：① `.g-body { display: contents }`（L626）——必须先把仪表的 DOM 结构定死（环 / 图例 / 数字三块）再谈重排；② `TwoPoleDial` 的内联 `--dial-size`（TwoPoleDial L5）——父组件无法从外部改尺寸，必须先去掉内联写法或加响应式 prop，否则任何尺寸调整都是无效的；③ `mainItem` 的选取规则（L301-305「时长最长者即主项」）与 `start()` 的跳转（L510-513）耦合在一起——换布局时要同时决定「主项是否还是最长的那段」「跟练页能不能接住这个动作名」；④ `notice.stale`（L32-35）的过期判断依赖 `plan.reason` 里是否包含 `PLAN_RULES_VERSION` 字符串（app.ts L314），这是靠字符串
  > 可直接复用的既有 seam：`BaseCard` 的 `--card-pad` 变量（BaseCard L30）已经是官方换肤入口，父子不抢 padding；`TwoPoleDial` 的 `tone: 'ink' | 'paper'` + `showTicks` + `showInnerRing` + `ariaLabel` 四个 prop 已经支持深浅两种表面；`ShapeState` 的 `state` 三态；`StatStrip` 的 `items` 数组（含 `unit`/`hint`/`tone`）；`InsightCard` 的 `cardId`（走 store 持久化的收起状态）；`LoadChart` 的 7 个纯 props（无取数逻辑，可整块替换）；`store.dayPlanNotice(reference)` 这一个方法已经封装了「已存计划优先、否则按档案现算」的
  > 若要把「今日养生」做成可隐藏/可下移/可重排（调研文档 L108/L131 的硬要求），现成接缝是 `store.collapsedCards` + `toggleCard(id)` + `isCardCollapsed(id)`（app.ts L66 / L855-864）——DailyWellnessCard 现在完全没用它，把 `expanded` 换成 store 状态即可获得跨页面持久化与隐藏能力。
  > 组件拆分建议（当前全是 DashboardView 内部的裸 div）：`TimelinePanel`（时间轴 + 备注 + 三格 foot）、`RestDayPanel`、`LoadPanel`（已存在 LoadChart，只差外壳）、`GaugePanel`（仪表卡，含 legend/foot）、`WeeklyLoadBars`、`MealTodayPanel`、`WhyCard`——这七个区块的输入输出都已成形，拆出来后换皮可以逐块进行、逐块验收，不必一次性推翻整页。
### 训练计划子系统（PlanView + planRules + exercises）
DEBT:
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
  - 三个零引用的导出：planRules.ts L203 itemsFor、exercises.ts L6 EXERCISE_CATALOG_VERSION、exercises.ts L91 RESTRICTION_KEYS。其中 RESTRICTION_KEYS 的四个字符串在 exercises.ts L108-111 与 OnboardingView L272 各写一遍，改限制项要同步两处且没人会记得更新那个常量。
  - exercises.ts L126-128 findExercise 搜全部条目（含 retired），而 PlanView L250 正是用它找替换来源 —— 已停用的 L81 桥式滚颈可以作为"替换候选的 origin"被查出来。
  - PlanView L215-219 itemsOn 对每个日历格都跑一次 store.weekPlan(d)，没落盘就退化成 buildDayPlan(...)，而 L225 hasPlan 在模板里逐格调用 —— 一个月 31 格、每次重渲染都重算整套过滤规则，没有缓存，规则一改复杂度还会放大。
  - PlanView L413-419 的 watch 在选中日期或切换模式时调 ensureWeekPlan，把一份计划写进 localStorage —— 一个纯浏览动作产生持久化写入，也意味着"没建档用户看一眼计划页"会在本机留下 plans 记录。
  - PlanView L259-279 adjustment 把"超预算检测 + 建议文案 + 目标日期"揉在一个 computed 里：只检查选中当天、目标固定为"明天"（可能不是训练日、也不检查那天已排多满）、并且 acceptAdjustment 在 store 层根本不校验 locked/completed —— README 声称的"锁定项与已完成项保持不变"只是 UI 层 L247 的过滤。
  - PlanView L212 notice 取的是 store.dayPlanNotice 的复合返回，但 PlanView 只用其中 2 个字段（gateNote、conflicts）：stale（app.ts L314，这份计划是旧规则版本生成的）只在 DashboardView L32 用，DayPlan.auto 全项目无人消费。计划页看不到"这份计划已过期"。
  - DashboardView L455 upcoming 用 buildDayPlan 实时算未来 7 天，完全忽略已存的模型计划 —— 首页"下一次是什么"和计划页内容会不一致。
  - PlanView L14-15 的版本区同时显示 plan.mode 与 currentLabel 两个模式来源，切换模式后旧计划仍在 plans 里（app.ts L245-263 的 copyPlanToMode 是唯一显式复制入口），页面上会出现"v3 运动员计划"和"大众模式"并排的矛盾文案。
  - 文档与实现三处对不上：README §2 训练计划 声称有「新建计划」按钮（当前 UI 没有，只有「按规则重算」「用模型规划」）；同一节说"四周周期负荷条为演示数据"（实际 PlanView L286-291 用 buildWeeklyReport 算真实负荷）；又说调整预览"不写入持久化计划"（实际 L363 acceptAdjustment 会 bumpVersion 落盘）。
  - PlanView 是 541 行单文件 SFC（template L1-165 / script L167-420 / scoped style L422-541），周视图、周期视图、历史列表、手工表单四个区块没有任何组件边界，模板里的 v-if 条件和 script 里的 computed 互相咬死 —— 这是本次改版最大的结构性障碍。
  - 同一页并存三套按钮外观：BaseButton（primary/ghost）、自绘 .regen/.regen.ai（L437-440）、自绘 .mini（L492）、自绘 .alt（L501）、自绘 .tabs button（L432）、自绘 .month button（L457）。改主按钮样式需要同时改六处，且它们对 hover/disabled/pressed 的处理各不相同。
  - stores/app.ts L595 的 bumpVersion 函数签名与函数体挤在同一行（`function bumpVersion(...): Plan {    planHistory.value.push(...)`），格式化工具一旦介入会把这行炸开，改版前应先跑一次格式化以免 diff 噪音淹没真正的界面改动。
HOOKS:
  > 【整块可换 · 不动逻辑】月历卡 PlanView L45-67：输入只有 monthCells/cursor/selected，输出只有 select(day) 与 hasPlan(day) 两个语义。可以整体换成周视图、列表视图或横向时间轴而不碰任何规则代码。
  > 【整块可换】当日详情里的 plan-item 列表 L83-94：输入是 PlanItem[]，输出动作只有 toggleComplete / toggleLock 两个。可以整块换成卡片堆叠、时间轴行、或右侧抽屉，逻辑不动。
  > 【整块可换】四周周期四卡 L120-128：全部数据来自 cyclePhases 这个纯 computed（L282-307），没有副作用，可整块换成甘特条、环形图或阶段时间轴。
  > 【整块可换】手工录入表单 L32-42 与本机版本历史卡 L156-163：一个 4 字段表单 + 一个纯展示列表，都与规则引擎零耦合。
  > 【整块可换】工具条 L8-24：tabs 与版本区是纯展示 + 两个 store action 调用，可以换成任何形态的工具条；前提是先统一 L14-15 的版本号/模式双来源。
  > 【整块可换】PlanDraftDialog 已经是独立组件（AppShell 挂载），461 行自成一体，不属于计划页内部结构；改版计划页时不必也不应该动它。
  > 【必须先解耦 · 样式与逻辑揉在一起】PlanView 的 template 与 script 强耦合：detail / cycle / replace / manual 四个区块的显示条件散落在模板的 v-if 里，没有任何子组件边界。改版第一步应是抽出 PlanCalendar / PlanDetail / CyclePhases / ManualEntryForm 四个组件，computed 进 props、事件走 emits，然后再动样式。
  > 【必须先解耦】replaceTargets（L246-256）被模板两处引用（L98 替换区、L114 按钮 disabled），且依赖 findExercise(L250) 这个"用中文名反查动作库"的耦合。应把候选计算下沉到 service 层，并改用 exerciseId 作为连接键（注意：LLM 生成的 PlanItem.exerciseId 是空的，需保留按名字兜底的路径）。
  > 【必须先解耦】adjustment（L259-279）把超预算检测、建议文案、目标日期计算揉在一个 computed 里，UI 与算法没有分层。应抽成 planRules.adjustmentFor() 之类的纯函数，PlanView 只负责渲染。
  > 【必须先解耦】cyclePhases（L282-307）在视图里现算 buildWeeklyReport，且 604800000 毫秒常量硬编码在 L293/L296。应下沉到 weekRules/loadRules，视图只拿卡片数据。
  > 【必须先解耦】TrainingType → lucide 图标的映射（L198-205）把呈现决策写死在视图里；应改成可替换的 map，或让动作条目自带图标字段。
  > 【必须先解耦】scoped CSS（L422-541）与 DOM 结构强耦合：.detail / .plan-item / .replace / .cycle / .phase 一整套子选择器都假设了当前的 flex 行布局与 20px 内边距；换布局必然要重写这一段，不能靠覆盖补丁。
  > 【必须先解耦】store.dayPlanNotice 返回四个字段但只有两个被 PlanView 使用（stale 只在 DashboardView 用，auto 无人用）。应让 store 暴露更细的 selector（例如 planStale / planGate / planConflicts）并把 stale 真正显示在计划页上，再重画顶部提示区。
  > 【必须先统一口径再改界面】"计划数"有规则与已存计划两套定义（weekRules L71 vs store.plans）。界面一旦要显示"本周 N 场"，必须先让 weekRules 的 plannedDays 优先读已存计划、规则只在没有计划时兜底，否则改版只会把矛盾固化到新 UI 上。
  > 【可复用接缝】BaseCard / BaseButton / StatusBadge 已经是干净的替换位：日历卡与详情卡通过 --card-pad 覆写内距、tabs 与 regen 按钮是自绘的 —— 新设计可以直接换成组件库的 variant，不必再手写第三套按钮。
  > 【可复用接缝】planRules 的 DayPlan{items, conflicts, auto, gateNote, ruleVersion} 本身就是一个完整的视图模型契约，界面只需要换渲染方式即可，不必让新组件去理解 blockers/pick 的内部逻辑。
### 设计系统与通用组件层（src/styles/* + src/components/common/*）
DEBT:
  - MetricCard.vue 整个文件是已废弃的半成品：第 16-19 行 @deprecated 注释自称"当前无任何调用"，全仓 grep 复核确认零引用（唯一命中是它自己的注释），却仍占 72 行、还带着一个模板与样式都没用到的 accent?: string prop（第 27 行）。改版前直接删，不要在新皮肤里再造一个 "MetricCard v2"。
  - BaseCard.vue:12-20 的 interactive 与 glass 两个 prop 全仓零调用（grep "variant=\"glass\"|:glass|interactive" 在 src 下无命中）。其中 glass 的注释写"保留是为了不打断现有调用"，但根本没有任何调用需要被打断；连带 BaseCard.vue:67-79 的整套 backdrop-filter + @media (prefers-reduced-transparency) 降级逻辑是纯死代码（该媒体查询特性全站只此一处用）。
  - TwoPoleDial.vue:5 用内联 style 写死 --dial-size: ${size}px，而 DashboardView.vue:729 想在 ≤767px 用 .dial{--dial-size:132px} 缩小它 —— 内联样式优先级恒高于 scoped class，**移动端缩小仪表的规则从来没有生效过**（手机上仪表仍是 228px，会撑破 DashboardView.vue:727 的 132px 栅格列）。这是"几何走 prop、尺寸走 CSS 变量"两条路互相打架的典型样本，也是必须先解耦才能换皮的地方。
  - LoadChart.vue:132-146 的 polyline() 在组件里重算了一遍 CTL/ATL 移动平均，而 loadRules.ts:112-118 已经算好 ctl/atl 直接传进来了，且两套口径不一致：loadRules.ts:113 的 acutePoints 用 .filter(p => p.state==='load'||p.state==='rest') 把缺 RPE 的天剔除，LoadChart.vue:134 的 vals 却把 missing 天映射成 p.load ?? 0 = 0 并留在 7 天窗口里。结果是**图例里的 "ATL 7 天" 数字（来自 service）与图上 ATL 虚线末点的纵坐标可以不相等**，缺 RPE 越多偏差越大；同时组件还把窗口常量 7/28 复制了一份（loadRules 的 DEFAULT_ACUTE/DEFAULT_W
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
  - tokens.css:179-183 的 --breakpoint-sm/md/lg/xl 注释写着 "used in media queries"，但 CSS 自定义属性**不能用在 @media 条件里**，全仓 0 引用。代码里实际用的是 1099 / 1279 / 767 / 720 / 520 / 1100 六个数字（grep 统计 14 处媒体查询），与这四个令牌毫无关系 —— 令牌既不可用又误导。
  - tokens.css 里成片的死令牌：--gradient-brand、--gradient-hero、--shadow-hero、--hairline、--motion-instant、--easing-elastic、--space-12、--space-16 全仓 0 引用；--shadow-xs/--shadow-sm/--shadow-card 也近乎零引用；--shadow-accent 只有 3 处引用且值是 none，导致 InsightCard.vue:43 的 var(--shadow-accent) 那半个阴影永远不显示。
  - README.md:222 写 "BaseButton 最小高度 44px"，但 BaseButton.vue:18 的 .sm{min-height:36px} 打破了这个说法 —— 文档结论对 size="sm" 不成立（README.md:227 又承认"自绘按钮存在低于 44px 的"，两条自相矛盾）。
  - BaseButton.vue 没有声明 type prop，但 PlanView.vue:38 在 <form> 里写 <BaseButton size="sm" :icon="Plus" type="submit">保存为新版本</BaseButton> —— 靠 Vue 的 attribute fallthrough 落到根 <button> 上才生效。改版若调整模板结构（加包裹元素/换根标签），这个 submit 行为会静默丢失；且未来任何在 form 里用的 BaseButton 都会默认变成 type="submit"。
  - StatusBadge.vue:1 给**每一个**状态徽标都挂了全局 animate-bounce-in（animations.css:85-87，400ms + spring 弹性曲线）。列表里每渲染一个徽标就弹一次，ReportView.vue:101 的周报表格一屏能弹十几个；animations.css:2 自己的注释写着"入场一律无错位（不带 delay）"，这条正好相反。
  - ShapeState.vue:27 的 TEXT 映射把三个中文状态文案硬编码在组件里，而 DashboardView.vue:484 又在调用方原样重写了一遍 '未记录' / '记录完整' / '部分记录' —— 同一组文案两份，改一处漏一处。ShapeState.vue:46 的 partial 填充比例还是裸写的 54% 魔法数。
  - PlanDraftDialog.vue:205 用 JSON.parse(JSON.stringify(d)) 做深拷贝生成可编辑副本 —— 会丢掉值为 undefined 的可选字段（PlanDraftItem.plannedSets/plannedReps），改版若引入 structuredClone 或新增可选字段需重新确认丢失语义。
  - 星期中文有 3 份实现：utils/time.ts:1 的 WEEKDAYS_CN、services/llm.ts:161-166 的 WEEKDAY + weekdayOf()、PlanDraftDialog.vue:247-251 又抄一遍 WEEKDAY + weekday()。三处都要单独维护。
  - InsightCard.vue:36-37 直接 useAppStore()，一个展示组件耦合到全局 store（折叠状态走 store.collapsedCards），无法在别处复用、无法做视觉快照测试、也无法单独换皮而不动 store。
  - globals.css:142-149 的 .container 工具类全仓 0 引用；而 .micro（globals.css:152-160）与 .num（:163-167）被大量使用却没有任何变体，导致各视图各自覆写颜色 —— DashboardView.vue:212 干脆用内联 :style="{ color: ... }" 改 .micro 的颜色，ReportView.vue:347-349 又另写了一套 .sw 图例色块。
  - 空态没有原语，4 处各写各的：DashboardView.vue:218（"接下来 7 天都没有安排训练…"）、:231-233（"本周还没有训练记录。负荷图显示为空，而不是 0。"）、ReportView.vue:110-116（.empty + .empty-actions）、MealPhotoViewer.vue:140（.loading,.empty）。文案口径与操作区样式都不统一。
  - 骨架屏没有原语：gradients.css:1-5 的注释说原 .skeleton 工具类"经 grep 确认没有任何模板引用，故整批移除" —— 于是现在全站零骨架屏，PlanDraftDialog.vue:370-375 只好自己写一个 @keyframes spin 转圈，ExecutionView.vue:763 的 .skeleton-overlay 只是覆盖层不是骨架。
  - 图表有 4 套独立实现且语义编码互相打架：LoadChart.vue（SVG，缺 RPE 画 6px 实色短柱）、ReportView.vue:329-336（div 柱，缺 RPE 画 45° 斜纹）、DashboardView.vue:652-661（div 柱，缺 RPE 画斜纹）、ReportView.vue:60-68（餐食类别矩阵）。同一个"缺 RPE"语义在 LoadChart 与 ReportView 里是两种编码；ReportView.vue:331 与 DashboardView.vue:654 还各自硬写了同一串 linear-gradient(180deg,#12857c,#0c655e)，绕过 --color-accent/--brand-pole-a 且不随深色主题变化。
  - PlanDraftDialog.vue:392-394 / :414-417 / :418-421 / :427 手写了四套几乎一样的输入框与 select 样式（边框 --color-border、圆角 7-8px、字号 12-12.5px），而全站没有统一的 Input/Select 原语。
  - 全站没有分段控件原语，同类切换用了四种形态：主题三选是 SettingsView.vue:177-184 的一排 chip（:aria-pressed 手搓），模式切换是 TopBar.vue:33-68 的 popover + role=menu，周切换是 ReportView.vue:10-12 的三个裸 button，日期区间在 ReportView 又是另一套。改版时若要做统一分段控件，需要同时收敛这四处。
  - 焦点环两套并存：globals.css:135-139 的 *:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;border-radius:var(--radius-sm)} 与 BaseButton.vue:7 的 .base-button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(15,118,110,.32)} 语义重复、视觉不一致（一个 2px 外描边、一个 3px 外发光）。
HOOKS:
  > 可以整块换掉、不动逻辑的（样式已与逻辑分离）：BaseCard 全部 80 行 —— 零业务逻辑，只有 variant/interactive/glass 三个 prop + 默认 slot，换皮只需改 BaseCard.vue:24-79 的 style 块；唯一要处理的是先删掉 interactive/glass 两个死 prop。
  > StatStrip：items: StatItem[] 契约稳定、StatItem 类型已从 SFC 导出给 ReportView/MealsView 使用，且 44px/34px 数字层级是版面的核心节奏 —— 改版只动 StatStrip.vue:34-97 的样式与响应式规则（把硬编码 nth-child(3)/(4) 换成基于 --cols 的解法），数据侧零改动。
  > ShapeState（3 状态 + width/height，零逻辑）与 StatusBadge（5 个 variant，零逻辑）：两者是纯映射表，可以整体重画形状与配色，只需保持 state/variant 字符串与 class 名一一对应的既有契约。
  > BaseButton：variant/size/icon 契约稳定（9 个视图在用），可整体换皮；改之前只需补一个显式 type prop 以摆脱对 attribute fallthrough 的依赖（PlanView.vue:38 正在依赖它）。
  > ToastRegion：只依赖 store.toasts 的 {id,type,title,message,dismissible,duration} 契约与 store.dismissToast(id)，是最容易整块换皮（甚至升级为 BaseToast 独立原语）的一个。
  > TwoPoleDial 的配色与描边：tone ink/paper 两套 stroke 取值集中在 TwoPoleDial.vue:112-132，换品牌色只改这里；几何部分（polar/arc/144°/12° 缺口/12 刻度）不要动，它是"两仪"母题的语义载体。
  > globals.css 的 .micro / .num 两个工具类已被所有视图消费，是最适合扩展为变体（.micro--accent / .micro--muted 等）的位置，能直接消掉 DashboardView.vue:212 一类的内联覆写。
  > animations.css 的 5 个 .animate-* 工具类已是全局统一入口，新增入场动效应加在这里而不是各组件 scoped 里写 animation 简写（README 已就此写过警告）。
  > 必须先解耦、样式和逻辑揉在一起的地方（按优先级）：
1) TwoPoleDial.vue:5 的内联 --dial-size —— 去掉 size prop 或去掉内联写法，只留一条入口，否则移动端覆盖永远失效；
2) LoadChart.vue:132-146 的 polyline() —— 算法上移到 loadRules.ts（service 已算好 ctl/atl），组件只渲染传入的路径点数组，顺带修掉 ATL 口径不一致；
3) LoadChart.vue:177-207 的 6 处硬编码 rgba —— 换成 var(--hair-soft)/var(--hair)/var(--color-border)，深色主题自动跟随；
4) InsightCard.vue:36-37 的 useAppStore() —— 改成 collapsed?: boolean + emit('tog
  > 改版期间可以放心删除的死资产（零调用，已 grep 复核）：MetricCard.vue 整个文件；BaseCard 的 interactive 与 glass 两个 prop 及 .card.glass 全套样式（含 prefers-reduced-transparency 媒体查询）；TwoPoleDial 的 paper tone、showTicks、showInnerRing 三个 prop（调用方只用过 tone="ink" + 默认值）；globals.css 的 .container 工具类；tokens.css 的 --breakpoint-* 四个（CSS 变量不能用于 @media）、--gradient-brand/--gradient-hero/--shadow-hero/--hairline/--motion-instant/--easing-elastic/--
  > 建议在改版中一并建立的接缝（当前没有、需要新建才能换皮）：BaseDialog（scrim + 尺寸档 + Escape + 焦点陷阱 + 滚动锁，三处手写弹层统一到它）、SegmentedControl（主题三选 / 周切换 / 模式切换 / 日期区间四处统一）、EmptyState（4 处空态统一）、Skeleton（gradients.css 已删工具类，需要重建）、Chart 基础层（4 套手写可视化统一到一套 SVG 组件）、表单原语 Input/Select/NumberField（PlanDraftDialog 里 4 套输入框样式统一）。
  > 语义色词汇必须先统一再换皮：把 caution/warning/danger/error/accent/high 收敛成一份 Tone 枚举（建议 success | caution | danger | neutral | accent），让 StatusBadge、Toast.type、StatItem.tone、LoadZone 共用，并让 StatusBadge.vue:2 / ToastRegion.vue:4 / StatStrip.vue:20 / loadRules.ts:142 的字符串与 CSS class 名由同一份 TS 常量驱动，而不是各写各的。
### 饮食子系统（Meals / 拍照记录，Vue3 + Pinia）
DEBT:
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
  - MealsView.vue:466 附近 `仅"其他/油脂"，未落入 8 类` 的兜底文案里硬编码了类别名，与 FOOD_CATEGORIES 常量脱钩。
  - FoodCaptureDialog.vue:580 `function clockTime(d: Date)` 重新实现了 HH:MM 格式化，而 src/utils/time.ts 里已有 pad+HH:MM 辅助（只是未导出、未被复用）。三方各写一份时间格式化。
  - FoodCaptureDialog.vue 与 MealPhotoViewer.vue 各写了一份完全相同的 body 滚动锁（前者 :419-420/:446/:451-452，后者 :59-68/:122）——包括保存/恢复 previousOverflow 的逻辑。两者可同时打开（MealsView 里从记录卡打开看图与从按钮打开拍照弹窗不冲突，但 Modal 层数一旦增加就会互相覆盖 overflow）。应抽成统一的 BaseDialog/ModalShell。
  - `.spin` 旋转动画在 FoodCaptureDialog.vue:922 与 MealPhotoViewer.vue:143 各定义一份同名 keyframes（颜色还不同）；`.empty`/`.loading` 空态样式同样各写一份。
  - 暗色主题破洞：FoodCaptureDialog 的 `.candidate li{border:1px solid rgba(220,229,237,.85)}` 是近白色边框硬编码在白卡上，暗色主题下变成刺眼白框；MealsView 的 `.chip.part` 用 rgba(138,90,0,.26)/#8a5a00 写死琥珀色、FoodCaptureDialog 的 `.badge-photo` 用 rgba(15,118,110,.16) 写死青色，都不随 html[data-theme="dark"] 变化。
  - MealForm 的「换算状态」是个自造状态机：convOf 返回 own/pending/demo 三态，rememberPer/forgetPer 直接写 store.rememberUnitGrams/forgetUnitGrams，且 submit() 因为存在 pending 换算而直接禁止保存。用户改了份量单位但没点「记住」就无法保存，这是一条没有提示、极易造成「保存按钮点不动」的隐式规则。
  - MealForm 模板里对同一行重复调用 convOf(row) / rowEstimate(row) 四五次，convOf 内部做 findFood + resolveUnitGrams，无缓存；formEstimate 又对每行再算一次 estimateEnergy（内部再走一次目录查找）。行数一多就是明显的重复计算。
  - MealForm 用 `ref="nameEls"` / `ref="sizeEls"` 收集 v-for 里的 DOM，再靠 `items.value.indexOf(row)` 去索引 nameEls[sizeEls] —— Vue 3 里 v-for 中的 ref 数组不保证与源数组同序，靠 indexOf 兜底也只对当前数组有效；一旦 items 被过滤/重排就会取到错误的输入框。
  - MealForm 编辑时不清理随食物名变化的派生字段：改名称后原来的 photoConfidence / uncertain / modelEnergy 仍原样回写（FoodCaptureDialog 的 onName 反而会清掉 nutrition 与 confidence）。同一份数据在两条编辑路径上语义相反——把「米饭」改成「牛肉面」还会留着原来那碗米饭的模型热量。
  - MealsView 里的 structureText 在有 analysis.categoryCoverage 时用快照、无则用 FOOD_CATEGORIES.filter 现场算 —— 两条兜底路径的类别集合不同（分析只含 EXPECTED_CATEGORIES 8 类，兜底会包含油脂类/其他），同一餐次可能显示出不同口径。
  - MealsView 里的 `date` 是模块初始化时的 const now = new Date()，没有日期切换能力；FoodCaptureDialog 的 `date` prop 也永远是「今天」。想加「补记昨天」得先改这一层。
  - MealsView 的餐次类型切换用的是原生 <select> 直接写样式，与 BaseButton/BaseCard 体系脱节；MealForm 的类别与单位下拉同样是裸 select。全项目没有 Select 组件，是当前改版最直接要补的缺口。
  - MealsView 的 `store.meals` 被视图层直接赋值（第 519 行），绕过了 store 的 action 层，破坏「只有 store 能改状态」的约定，也让 removeMeal 里附带的 deleteMealPhoto 副作用被无声跳过（此处是幸运，若将来补上该副作用就会误删照片）。
  - MealsView 用 `document.getElementById('meal-' + meal.id)` 滚动定位新记录，DOM id 命名与数据 id 绑定，模板重排时容易漏改。
  - store.addMeal 只在 `privacy.showEnergyEstimate` 为真时才写 analysis.estimateRefs —— 热量估算是写入时快照，不是读取时计算。用户后来打开设置开关，历史的餐次依然没有热量，热量区块不会回填。
  - 食物行是 `<img :src="meal.photoThumb">` 直接内联 data URL，缩略图 data URL 会被复制进每一次 localStorage 序列化；store.persistState 已经因此捕获过 QuotaExceededError（提示「可能是饮食照片缩略图占满了浏览器存储」）。数据量上去后 localStorage 必然是瓶颈。
  - types/domain.ts:228 的 MealItem.foodId（`${category}-${foodName}`，app.ts:766 生成）全项目无人读取，是写了但没接上的半成品字段。
  - 交付说明.md:495 描述端侧识别用的是 `composables/useFoodPhoto.ts`，但 src/composables/ 下只有 pose 相关的 6 个文件，该文件已不存在（说明文档自己标注「已被第二十一轮取代」）；而 research/界面偏好调研.md:56 仍以 `useFoodPhoto.ts` 为依据断言「候选 + 区间 + 默认关闭 + 照片不落盘」设计与证据一致、要保留——这与现状完全相反：现在默认 saveFoodPhotoLocally=true，缩略图落 localStorage、原图落 IndexedDB。改版前应先订正这处调研结论，否则会按一个已废弃的设计做决策。
  - 调研文档还主张「照片不上传」作为首页文案与导出区卖点（research/界面偏好调研.md:107），而现状是云端识别必然上传图片（需用户勾选同意）。这条约束当前被事实打破，需要在改版文案中明确区分「本机保存」与「云端识别需上传」两件事。
HOOKS:
  > 【清晰边界，可整块换掉】四个 service 层（foodRecognition / foodComposition / mealRules / mealPhotos）是纯函数 + 纯 IO，没有 Vue 依赖，换皮期间完全不用碰；它们的常量（LOW_CONFIDENCE、UNIT_GRAMS、MEAL_TIME_WINDOWS、FOOD_CATEGORIES、ESTIMATE_BAND）已被视图层引用，替换视图时保持常量不变即可。
  > 【清晰边界，可整块换掉】通用展示原语 BaseCard / BaseButton / StatStrip(+StatItem 类型) / InsightCard / StatusBadge / ToastRegion 已是稳定的 API 面（props 少、variant 枚举清晰），新页面直接复用即可；饮食页的自定义 chip/f-conf/badge 都可以换成 StatusBadge。
  > 【清晰边界，可整块换掉】基础样式层 tokens.css（明暗双主题变量）与 globals.css（.micro/.num）已就位，新版只要用 token 就不必再调色。
  > 【清晰边界，可整块换掉】MealPhotoViewer 是独立自洽的弹窗（只依赖 props.open/photoId/fallback/label 与 emits.close），可以整体保留或整体替换为新的 BaseDialog 变体，不影响数据链路。
  > 【清晰边界，可整块换掉】store 的 action 面（addMeal/removeMeal/updateMealType/rememberUnitGrams/forgetUnitGrams/toggleCard/updatePrivacy/showToast）已经是清晰的写入口，视图层新代码只要走 action 就不破坏持久化。
  > 【清晰边界，可整块换掉】src/types/domain.ts 的领域模型是稳定的契约层，界面上换布局不需要动它。
  > 【清晰边界，可整块换掉】FoodCaptureDialog 的 props/emits 契约（open/date/initialView → close/saved）足够稳定，换皮时保持这个契约，就能让 MealsView 只改版式不改逻辑。
  > 【必须先解耦】FoodCaptureDialog.vue（998 行）是最大的纠缠点：一个文件里同时有 (a) 相机/文件 IO（getUserMedia、captureFrame、canvas 压缩）、(b) 识别 provider 调度（云端/本机、AbortController、runId、withTimeout）、(c) 校验后的候选数据模型、(d) 候选编辑 UI、(e) 缩略图/原图持久化、(f) 隐私开关、(g) 弹窗外壳与 body 滚动锁、(h) 约 120 行 scoped CSS。改版前应拆成 useFoodCamera / useFoodRecognizer / useMealPhotoStorage 三个 composable + 4 个纯展示子视图（CaptureView / AnalyzingView / ResultView / ManualView），把 
  > 【必须先解耦】MealForm.vue（429 行）把「单位↔克换算状态机（own/pending/demo）+ 单位克重记忆 + 内置目录搜索 + 常吃食物 + 逐行实时热量」与表单版式耦合在一起，且自带一份与 FoodCaptureDialog 不同的单位清单和第三份食物行布局。改版前应先抽 foodRowEditor 组件 + useUnitGrams composable，两条编辑路径共用。
  > 【必须先解耦】MealsView.vue（694 行）把全部 view-model 派生（summary/records/coverageRows/mealStats/limitations/timeline/itemIsUncertain/structureText/localEnergyText/modelEnergyText…）与 300+ 行模板/CSS 写在一个 SFC 里；改版前应把派生逻辑抽成 useMealsViewModel()（纯 computed 组合式函数），让模板只负责渲染——这同时能顺手修掉第 334 行那种字符串匹配过滤 limitation 的脆弱写法。
  > 【必须先解耦】三处 body 滚动锁（FoodCaptureDialog、MealPhotoViewer、PlanDraftDialog）与三处 modal 外壳（scrim+header+✕+action bar）应统一成一个 BaseDialog 组件（提供 open/scroll-lock/Esc/焦点管理/响应式全屏），这是换皮收益最高的一步。
  > 【必须先解耦】「食物行编辑器」有三份重复实现（MealForm 的 .row、FoodCaptureDialog 的 .edit-row、MealsView 内联），必须先合并成单一 FoodRowEditor（可配置是否显示置信度/单位换算/热量），再谈视觉统一。
  > 【必须先解耦】「餐次槽位」三套定义（MEAL_SLOTS / MEAL_TYPE_OPTIONS / MEAL_TIME_WINDOWS）应先合并为单一模型（并导出 EXPECTED_CATEGORIES 供视图用），否则新版布局里「今日 3 餐进度」和「类别覆盖 8 类」两个模块会继续各写各的字面量。
  > 【可作为重排支点的接缝】`<FoodCaptureDialog :open :date :initial-view @saved @close>` —— 换皮时可把它整体换成新弹窗，只要保持 emits.saved(meal) 语义。
  > 【可作为重排支点的接缝】`<StatStrip :items>` —— 新版顶部指标条可继续用它，或按同一 StatItem 结构做新皮肤。
  > 【可作为重排支点的接缝】`<InsightCard card-id="meal-rules" :limitations>` —— 规则说明区是独立卡片，折叠态已在 store，换版可自由重排位置。
  > 【可作为重排支点的接缝】store.meals 是唯一真源且每条 Meal 自带 analysis/limitations/estimateRefs 快照 —— 新版可以只做「读」渲染而不重算，这给新布局极大自由度（但要注意 estimateRefs 是写入时快照，后台重算逻辑不能省）。
  > 【可作为重排支点的接缝】meal.photoThumb（内联 data URL）与 meal.photoId（IndexedDB 指针）分离，意味着新版可以自由决定卡片用哪一张图，甚至换成 <picture>/懒加载而不动存储层。
  > 【可作为重排支点的接缝】mealRules.summarizeDay / foodComposition.searchFoods / foodComposition.frequentFoods 都是可直接驱动新组件的服务函数。