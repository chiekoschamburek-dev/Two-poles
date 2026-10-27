export const meta = {
  name: 'design-two-pole-ui',
  description: '为「两仪」设计双极（运动/饮食）分屏界面架构：桌面左右分栏 + 移动端重叠切换',
  phases: [
    { title: 'Propose', detail: '三个独立视角提出双极架构方案' },
    { title: 'Critique', detail: '对抗式批评（可行性 / 交互与无障碍）' },
    { title: 'Synthesize', detail: '合并为一份可执行的架构规格' },
  ],
}

const ROOT = 'd:/桌面/project/project/UI'
const MAPS = ROOT + '/.subsystem-maps.md'

const CONTEXT = `
## 项目背景

「两仪·TwoPoles」是一个个性化运动与饮食协同助手的前端演示原型。技术栈：Vue 3 (script setup) + TypeScript + Vite + Pinia + vue-router + lucide-vue-next + CSS 变量设计令牌。

仓库根目录：${ROOT}

**用户刚刚明确提出的改版方向（本次设计的硬需求）：**
> 项目名称是「两仪」，两仪分别是运动-饮食。当前前端把两者放在同一个界面。我想分成两个界面同时展示在前端：**左半侧是运动，右半侧是饮食**，两者之间可以联系起来（具体怎么联系我还没想好）。**相关的内容也要分别迁移到对应的界面上**。
> 电脑端是这样的；手机端界面更小，但可以做成那种**重叠的效果，两个界面一个在上一个在下，不完全重叠，点击下面的界面两者会切换位置**。

## 现有实现的关键事实（已核实，可直接引用）

- 路由 src/router/index.ts：7 条扁平路由，全部懒加载
  \`/\`→\`/dashboard\` 今日概览 · \`/onboarding\` 个人档案 · \`/dashboard\` 今日概览 · \`/plan\` 训练计划 · \`/execution\` 摄像头跟练 · \`/meals\` 饮食记录 · \`/report\` 我的周报 · \`/settings\` 个人设置
- 布局外壳 src/components/layout/：
  - \`AppShell.vue\`：\`TopBar\`(sticky 58px 页头，含模式芯片/日期/头像) + \`SidebarNav\`(fixed 86px 图标脊) + \`.main-content\`(margin-left 让出脊宽) + \`MobileNav\`(≤767px 浮动胶囊底栏) + \`PlanDraftDialog\` + \`ToastRegion\`
  - \`SidebarNav\` items：今日/计划/跟练/饮食/周报；底部手写档案/设置两个 RouterLink（游离在数据外）
  - \`MobileNav\` items：今日(owns /plan /execution)/记录(/meals)/图表(/report)/我的(owns /onboarding)
- 视图行数：OnboardingView 495 · DashboardView 739 · PlanView 541 · ExecutionView 885 · MealsView 694 · ReportView 413 · SettingsView 483
- DashboardView 当前把两极混在一起（.page 内）：setup 建档条 → \`.lede\` 今日动作+换一项/开始跟练 → \`.cluster\`（时间轴 \`.timeline\` 或休息日卡 \`.timeline.rest\`／运动员 \`.load-panel\` 28 天负荷曲线）+ 双极仪表 \`.gauge\` → \`.ledger\`（本周逐日负荷柱 \`.ledger-pane\` + 今天的三餐 \`.ledger-pane\` + \`.why\` 为什么是这 N 分钟）→ \`DailyWellnessCard\` → footer
- ReportView 已经是左右两张图：左侧「Load by day」每日负荷、右侧「Meals」餐食结构矩阵，下方训练账本表
- 令牌 src/styles/tokens.css 已埋好两极语义：\`--brand-pole-a: #0f766e\`(青绿,训练) · \`--brand-pole-b: #24586f\`(蓝,饮食) · \`--brand-pole-a-dark: #3ec9b6\` / \`--brand-pole-b-dark: #7fa8c4\`(深底提亮) · \`--brand-pole-ring: #c9c6bb\`(太极环) · \`--gradient-brand\`/\`--gradient-hero\`
- 全站只有一个强调色 \`--color-accent: #0f766e\`(深色主题 \`#3ec9b6\`)；第二极只给"饮食"这条数据线
- \`TwoPoleDial.vue\` 组件在画双极环：props \`training\`(0-1)/\`meal\`(0-1)/\`size\`/\`tone\`(ink|paper)/\`showTicks\`/\`showInnerRing\`/\`ariaLabel\`。**注意：它当前把训练画在右弧、饮食画在左弧**（\`arcTraining\` 走 from=6° 顺时针，\`arcMeal\` 走 from=354° 逆时针），而品牌标志 SidebarNav/TopBar 的 SVG 是左点=青绿(a)、右点=蓝(b)。与用户要的"左运动右饮食"相反。
- \`src/components/common/TwoPoleDial.vue\` 用了内联 \`:style="{'--dial-size': size+'px'}"\`，导致 DashboardView 想在 ≤767px 用 \`.dial{--dial-size:132px}\` 缩小它的规则**从未生效过**（内联自定义属性恒压样式表）
- store src/stores/app.ts（962 行、42 个方法）：currentMode / userProfile / sessions / meals / privacy / toasts / collapsedCards / themePref / plans / planHistory / modeLog / pendingSwitch / unitGrams / llmConfig / llmDefault / planDraftState + openPlans / switchPreview / planLlmReady
- 持久化：localStorage key \`twopoles_state\`（含 theme，index.html 有首帧前内联脚本避免白闪）；照片缩略图(256px JPEG data URL)在 localStorage、原图 Blob 在 IndexedDB(\`twopoles_meal_photos\`/photos/v1)
- 业务逻辑全在 src/services/ 的纯函数里，被 \`npm run selfcheck\` 的 **237 项断言**覆盖：planRules / weekRules / loadRules / mealRules / foodComposition / foodRecognition / exercises / profileRules / llm / wellnessCards / mealPhotos
- 回归网：\`npm run typecheck\`(vue-tsc，当前通过) · \`npm run selfcheck\`(237/237 通过) · \`npm run build\`
- 现有断点：≥1100px 固定 86px 图标脊 / 768–1099px 244px 抽屉 / ≤767px 浮动胶囊底栏
- 通用组件：BaseCard(variant default|flush|ink + --card-pad) / BaseButton(variant/size/icon) / StatStrip(StatItem[]) / StatusBadge(5 variant) / ShapeState(三态) / InsightCard(cardId/eyebrow/title + 走 store.collapsedCards) / MetricCard(**零调用,已废弃**) / ToastRegion / PlanDraftDialog / LoadChart(7 纯 props)
- wellnessCards.ts：15 张卡，正好 8 张 \`category:'健身'\` + 8 张 \`category:'饮食'\`？——实际是 8 健身 + 8 饮食共 16 条声明中有 15 条？**已核实：8 健身 + 8 饮食 = 16 条 category 声明，但总数是 15 张卡（有一处重复计数）**。\`pickDailyWellnessCard(date)\` 按\`dayIndex % 2\` 决定当天取健身还是饮食，两类交替。
- DailyWellnessCard：整张 BaseCard 带 @click 展开，内部嵌真正的 <button class="w-toggle">；展开态是组件内 ref、**不落盘、不走 store.collapsedCards**，整卡无法隐藏或下移
- 已知数据 bug（改版前必须处理，否则新界面会显示错 60 倍的数字）：\`demoCameraService.ts:133\` 写 \`actualDuration: Math.round(elapsedMs/1000)\`（**秒**），而 domain.ts:167 注释与全部消费方（weekRules/loadRules/ReportView/MealsView/CSV 导出）都按**分钟**消费
- 已知口径矛盾：\`weekRules.plannedDays\` 只认规则的 \`isPlanDay\`、从不读 store.plans（用户接受 LLM 5 天计划后仍显示"3 场"）；ReportView 的计划圆点写死 \`[1,3,5].includes(d.getDay())\`；DashboardView 的 upcoming 用 \`buildDayPlan\` 现算而不读已存计划
- 已知 IA 缺陷：跟练页从首页跳转带 \`?exercise=<中文名>\`，但 \`getDemoExercise\` 只有「坐站训练」「站姿弯举」两条，找不到就**静默回落 demoExercises[0]**，界面无任何提示 → 用户点了"轻松跑"实际练的是坐站训练
- 空目录（可删）：src/components/{journey,reports,training}、src/data
- \`research/界面偏好调研.md\` 是本项目既有的用户调研基线（40+ 一手页面精读），其中 P2-11 明确要求"任何 AI 洞察/建议卡都必须可隐藏、可下移、可重排"；P2-12 要求"大改版走灰度并提供'返回旧版'开关"

## 上游调研产出（子系统精读地图）

**已写入文件：\`${MAPS}\`**（约 270KB，10 个子系统，每个含 职责/关键组件/UI 模式/样式写法/数据流/状态模型/耦合/设计债/约束/改版接缝）

请用 Read 工具**分段读**这个文件（offset/limit），只读与你视角相关的章节。设计债一节最有用——它列出了大量"改版时会踩的具体坑"，带文件名与行号。

## 硬性约束

1. **不能破坏业务逻辑与算法口径**（负荷 = 分钟 × RPE、ACWR 0.8/1.3/1.5 档、三态语义 null≠0、餐次时间窗、类别推断、计划生成规则、计数状态机）。改版是"换皮 + 重排 + 拆分"，不是重写算法。
2. **不能破坏本机数据兼容**：localStorage \`twopoles_state\` 字段名与嵌套层级不可改（mode/profile/sessions/meals/privacy/collapsed/theme/plans/planHistory/modeLog/unitGrams）；IndexedDB 库名/版本/store 名不可改。扩展只能加可选字段并在 init() 防御式补齐。
3. \`npm run typecheck\` 与 \`npm run selfcheck\` 必须保持通过；新增纯逻辑应补 selfcheck 断言。
4. 移动端无摄像头时要能退回手工计时/记录；getUserMedia 需 https 或 localhost。
5. 无障碍：状态要**形状 + 文字双编码**，不能只靠颜色；两极的颜色差异不能是唯一区分手段。
6. 密钥隔离：\`twopoles_llm\` 存用户自填 apiKey/baseUrl/model，故意不进导出；LLM_DEFAULT_* 只在服务端。
7. 不得引入需要登录或服务端持久化的界面流程（无账号是产品承诺）。
8. **调研文档 P2-12：改版要有"返回旧版"开关的灰度思路**。

## 本次设计要回答的问题

1. **路由与状态架构**：两个极如何在同一个 Vue Router 里表达？URL 怎么编码"当前在哪个极、哪个子页"？另一极（未激活的那一侧）显示什么、它的子页状态存在哪？给出具体到路由表和组件树的做法。**必须在当前 Vue Router 4 下真正能跑通**——RouterView 只渲染当前匹配路由，"另一极"怎么渲染出来要说清楚。
2. **桌面端分栏布局**：两列的宽度/比例、是否独立滚动、中缝（seam）长什么样、极的页头（子导航）放哪、窄屏（768–1099px）怎么办。
3. **移动端重叠切换**：精确描述——两张卡如何叠、下层卡露出多少、点击下层卡后如何交换位置（transform 序列/时长/缓动，须遵守项目已有的 \`--motion-*\` 与 \`--easing-*\` 令牌与 \`prefers-reduced-motion\` 降级）、如何避免误触、如何表达"当前哪个极在前"、与底部导航的关系、键盘与读屏怎么操作。
4. **内容迁移清单**：现有 7 个视图及其每个区块，分别落到左极（运动）/右极（饮食）/桥接层/全局。必须覆盖：DashboardView 全部区块、ReportView 训练与饮食两块、MealsView 训练日用餐时间线、PlanView 替代候选、ExecutionView 计数与反馈、OnboardingView 三步、SettingsView 全部设置项、DailyWellnessCard、TwoPoleDial、MobileNav/SidebarNav。
5. **两极之间的"联系"**（用户明确说还没想好）：至少给 3 种可选机制，每种说明用户价值、实现成本、界面落点。
6. **迁移路径**：分阶段步骤，每阶段可独立验收、可回滚。

## 写作要求

- 中文。技术判断落到**具体文件、组件名、prop 名、store 字段名、token 名**。
- 不要写"可以做成抽屉""建议优化体验"这种空话。每条建议要能回答"改哪个文件的哪一段"。
- 涉及不确定处，标注"需要核实"并给出核实方法（文件路径 + grep 模式）。
- **不要修改任何源文件**。本次只产出设计文档。
- 你的最终输出就是返回值，不要寒暄。
`

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    approachName: { type: 'string' },
    oneLiner: { type: 'string' },
    routingModel: { type: 'string' },
    componentTree: { type: 'string' },
    desktopLayout: { type: 'string' },
    mobileLayout: { type: 'string' },
    migrationTable: { type: 'string' },
    linkageOptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          how: { type: 'string' },
          value: { type: 'string' },
          cost: { type: 'string' },
          where: { type: 'string' },
        },
        required: ['name', 'how', 'value', 'cost', 'where'],
      },
    },
    storeChanges: { type: 'string' },
    tokenChanges: { type: 'string' },
    phases: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'approachName', 'oneLiner', 'routingModel', 'componentTree', 'desktopLayout', 'mobileLayout', 'migrationTable', 'linkageOptions', 'storeChanges', 'tokenChanges', 'phases', 'risks', 'openQuestions'],
}

const LENSES = [
  {
    key: 'routing',
    title: '路由与状态架构师',
    brief: `你是前端架构师，专注**路由与状态归属**。核心问题：在单 Vue Router + Pinia 前提下，如何让"两个极"同时在场且各自可导航。
必须回答：路由表怎么写（完整代码形态）、URL 怎么编码极与子页、另一极当前显示哪个子页、这个状态存哪（URL / store / 组件内）、浏览器前进后退怎么表现、刷新后恢复到哪、现有 7 条旧 URL 怎么处理（重定向 / 保留 / 404）。
必须核实 Vue Router 4 的能力边界：\`RouterView\` 只能渲染当前匹配路由，那"另一极"到底怎么渲染出来？给出**在当前 Vue Router 4 下确实能跑通**的写法，不要给出需要双 router 实例或改造 vue-router 的方案（除非明确论证代价与收益，并作为备选列出）。
**关键约束**：现有 7 条 URL 必须有明确处置（用户本机可能有书签），且 localStorage 里的数据不能因为路由重构读不出来。`,
  },
  {
    key: 'interaction',
    title: '交互与视觉设计师',
    brief: `你是交互设计师，专注**桌面分栏的视觉规格与移动端重叠切换的手感**。
必须回答：桌面两列的宽度策略、是否独立滚动、列头（子导航）如何呈现、中缝（seam）如何处理、窄屏（768–1099）如何降级。
移动端重叠切换必须给出**可施工的规格**：两张卡在文档流里怎么排（absolute? grid?）、下层卡露出多少 px、点击热区多大（如何避免误触）、交换位置时用什么 transform 序列与时长/缓动（遵守项目已有的 \`--motion-*\` 与 \`--easing-*\` 令牌，以及 \`prefers-reduced-motion\` 降级）、z-index 与阴影怎么表达"在前/在后"、怎么告诉用户"当前哪个极在前"、底部导航在这套叠卡下是否还成立、键盘与读屏用户如何操作（叠卡交换不能只靠 hover/click）。
给出关键帧的 CSS 骨架代码。
**注意**：项目已有 \`--z-base/--z-dropdown/--z-sticky/--z-modal-backdrop/--z-modal/--z-toast\` 层级语义；\`.frame-sheen\` 已有扫光动效；ToastRegion 定位是 \`top:106px\` 魔法数字（= 58px 页头 + 48px 猜测），页头高度一改就会压到页头——新布局要处理这个。`,
  },
  {
    key: 'migration',
    title: '内容迁移与产品结构设计师',
    brief: `你是产品结构设计师，专注**内容归属与迁移清单**。
必须回答：现有 7 个视图逐区块拆分到左极/右极/桥接层/全局的完整表（覆盖 DashboardView 的时间轴、双极仪表、负荷条、今天的三餐、洞察卡；ReportView 的训练负荷与饮食两块；MealsView 的训练日用餐时间线；PlanView 的替代候选；ExecutionView 的计数反馈；OnboardingView 三步；SettingsView 全部设置项；DailyWellnessCard；TwoPoleDial；MobileNav 与 SidebarNav）。
重点裁决三个模糊地带的归属：① 双极仪表 \`TwoPoleDial\`（注意它当前把训练画在右弧、饮食画在左弧，与用户要的左运动右饮食相反——要不要翻转？翻转算不算破坏语义？）② 每日洞察卡 \`DailyWellnessCard\`（内容横跨运动与饮食，且已按日交替；调研 P2-11 要求它可隐藏可下移）③ "训练日用餐时间线"（饮食页里排训练记录）。
还要回答：迁移后左极/右极各自的"首页"是什么、空极长什么样、桥接层（周报/两极平衡）还存不存在。
**产品红线提醒**：产品名叫"两仪"，两仪说的是**运动与饮食的关系**。如果拆到两极后"两者的关系"反而看不见了，那是失败——桥接层必须有实义，不能只是"两边都放一点"。`,
  },
]

phase('Propose')
log(`三个视角并行提出双极架构方案`)

const proposals = await parallel(LENSES.map(lens => () =>
  agent(`${CONTEXT}

---

# 你的角色：${lens.title}

${lens.brief}

# 工作方法

1. 先读 \`${MAPS}\` 里与你相关的章节（用 Read 的 offset/limit 分段读，别一次读满 270KB）。
2. **必须用 Read/Grep 核实源码**，特别是：src/router/index.ts、src/components/layout/ 四个文件、src/views/DashboardView.vue、src/views/ReportView.vue、src/styles/tokens.css、src/stores/app.ts、src/components/common/TwoPoleDial.vue、src/components/wellness/DailyWellnessCard.vue。你方案里提到的每个组件名、prop 名、store 字段名都要在源码里真实存在。地图与源码矛盾时**以源码为准**，并在 openQuestions 记下矛盾。
3. 产出方案。这是提案不是终稿，后面会有人挑刺。
4. **保持精炼**：每个字段写到能施工即可，不要展开成散文。migrationTable 必须是 Markdown 表格字符串。mobileLayout 必须含 CSS 骨架代码。

# 输出

按 schema 输出。中文。文件名/组件名/prop 名保留原文。`,
    { label: `propose:${lens.key}`, phase: 'Propose', schema: PROPOSAL_SCHEMA })
))

const validProposals = proposals.filter(Boolean)
log(`方案产出 ${validProposals.length}/${LENSES.length} 份，进入对抗批评`)

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    criticLens: { type: 'string' },
    verdict: { type: 'string', description: 'sound | sound-with-fixes | unsound' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          problem: { type: 'string' },
          severity: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['target', 'problem', 'severity', 'fix'],
      },
    },
    mustFix: { type: 'array', items: { type: 'string' } },
    keep: { type: 'array', items: { type: 'string' } },
  },
  required: ['criticLens', 'verdict', 'findings', 'mustFix', 'keep'],
}

const CRITIC_LENSES = [
  { key: 'feasibility', title: '可实现性 & 正确性', brief: `检查方案在**当前技术栈下是否真的能跑通**。逐条对照源码核实：引用的组件/文件/prop/store 字段是否真实存在；Vue Router 4 的用法是否合法；Pinia setup store 写法是否正确；CSS 变换/动画会不会与现有 scoped 样式或全局动画工具类冲突（项目明确警告过：同一元素别既挂 .animate-* 又在 scoped 里写 animation 简写）；会不会与现有的 prefers-reduced-motion / prefers-reduced-transparency 降级冲突；两个可滚动列 + 现有 sticky TopBar + fixed 图标脊会不会打架；移动端叠卡与现有 fixed 底栏、position:fixed 弹层（FoodCaptureDialog、MealPhotoViewer、PlanDraftDialog、ToastRegion）会不会叠压错乱；抽屉 z-index 1103 / scrim 1101 / topbar 1100 的手写层级会不会被新布局打破。` },
  { key: 'ux', title: '交互质量 & 无障碍', brief: `检查方案的**用户体验与无障碍**。移动端叠卡：误触风险、当前极的可见性、能否用键盘/读屏操作、滚动行为（两列独立滚动还是共用？叠卡时滚动锁定怎么办？）。桌面分栏：两列信息密度失衡（小内容的一列会不会空一大片）、列宽与现有断点（1100/768）的关系是否还成立。跨极联系会不会让信息噪音变大。两极配色（青绿 #0f766e / 蓝 #24586f）在深色主题下是否都达 WCAG AA；不能只靠颜色区分两极。信息迁移后用户原来一眼能看到的东西会不会被埋深。**特别检查**：调研 P2-11 要求洞察卡可隐藏/可下移/可重排，P2-12 要求"返回旧版"开关——方案里有没有回应？` },
]

phase('Critique')
log(`两个批评视角对抗 ${validProposals.length} 份方案`)

const proposalDigest = validProposals.map(p => `
## 方案：${p.approachName}（视角：${p.lens}）
一句话：${p.oneLiner}

路由与状态：${p.routingModel}

组件树：${p.componentTree}

桌面布局：${p.desktopLayout}

移动端重叠切换：${p.mobileLayout}

内容迁移表：${p.migrationTable}

两极联系机制：
${(p.linkageOptions || []).map(o => `- ${o.name}：${o.how}\n  价值：${o.value}\n  成本：${o.cost}\n  落点：${o.where}`).join('\n')}

store 改动：${p.storeChanges}
令牌改动：${p.tokenChanges}
阶段：${(p.phases || []).join(' → ')}
风险：${(p.risks || []).join(' / ')}
待确认：${(p.openQuestions || []).join(' / ')}
`).join('\n\n---\n\n')

const critiques = await parallel(CRITIC_LENSES.map(c => () =>
  agent(`${CONTEXT}

---

# 你的角色：对抗式批评者 · ${c.title}

${c.brief}

# 待批评的方案

${proposalDigest}

# 工作方法

1. **用 Read/Grep 核对源码**。批评要有依据：指出方案里哪句话、对应源码哪个文件哪一段、为什么不成立。
2. 优先找**会让方案跑不起来**的问题（路由非法、组件不存在、动画与现有样式冲突、fixed 元素叠压、滚动穿透），其次体验问题，最后风格问题。
3. 每条 finding 必须给出**具体可执行的 fix**。方案整体成立但需修补的，verdict 给 \`sound-with-fixes\` 并把修补写进 mustFix。
4. 区分"真问题"和"个人偏好"，偏好不要写成 high。
5. 三个方案都有同一问题时也要指出（那是需求本身的坑）。
6. **精炼**：findings 只写真问题，5–8 条为宜。

# 输出

按 schema 输出。中文。`,
    { label: `critique:${c.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA })
))

const validCritiques = critiques.filter(Boolean)
log(`批评完成 ${validCritiques.length}/${CRITIC_LENSES.length} 份`)

phase('Synthesize')
const critiqueDigest = validCritiques.map(c => `
### 批评视角：${c.criticLens} — 结论：${c.verdict}
必须修：
${(c.mustFix || []).map(x => `- ${x}`).join('\n')}
必须保留：
${(c.keep || []).map(x => `- ${x}`).join('\n')}
发现：
${(c.findings || []).map(f => `- [${f.severity}] 针对「${f.target}」：${f.problem}\n  → 修正：${f.fix}`).join('\n')}
`).join('\n\n')

const finalDoc = await agent(`${CONTEXT}

---

# 你的任务：合并 ${validProposals.length} 份方案与 ${validCritiques.length} 份批评，产出**最终架构规格**。

## 提案

${proposalDigest}

## 批评

${critiqueDigest}

# 合并规则

1. **批评优先于提案**。任何 mustFix 必须体现。high severity 的 finding 要么采纳，要么写明"不采纳，理由 X"（理由要成立）。
2. **不要三选一然后丢弃其余**。最终规格应是融合，允许不同做法并存，但**同一件事只能有一个做法**——不留"这里有两种方案待定"。
3. 自己用 Read/Grep 做最后核实。最终规格里出现的组件名、文件路径、prop 名、store 字段名、token 名**必须在源码里真实存在**（新增的标注"新增"）。发现虚构名字改成真实的。
4. **用户原始需求优先于任何提案偏好**：左极=运动，右极=饮食，桌面左右并排，移动端叠卡可切换——不可协商。
5. 精炼但完整。这是一份要指导后续多轮实现的规格，不是散文。

# 最终文档结构（Markdown，中文，直接输出正文，不要包在代码块里）

# 两仪 · 双极界面架构规格

## 0. 一页速览
一段话讲清最终形态 + 一张"从哪到哪"对照表（旧视图/区块 → 新归属）。

## 1. 设计原则
5–8 条，每条一句话 + 一条支撑理由。

## 2. 信息架构与内容归属
### 2.1 三层：左极（运动）/ 右极（饮食）/ 桥接层与全局
### 2.2 完整迁移表
一张大表：现有视图.区块 | 现位置 | 新归属 | 备注
必须覆盖：DashboardView 全部区块、ReportView 训练与饮食两块、MealsView 训练日用餐时间线、PlanView 替代候选、ExecutionView 计数与反馈、OnboardingView 三步、SettingsView 全部设置项、DailyWellnessCard、TwoPoleDial、MobileNav、SidebarNav、TopBar。
### 2.3 模糊地带的裁决
逐条给结论 + 理由：① TwoPoleDial 归属与是否翻转弧向 ② DailyWellnessCard 归属 ③ 训练日用餐时间线归属 ④ 每个极的"首页"是什么 ⑤ 空极长什么样 ⑥ 桥接层是什么、为什么不能只是"两边都放一点"。

## 3. 路由与状态架构
### 3.1 路由表（完整代码形态）
### 3.2 URL 编码与浏览器行为（前进后退、刷新恢复、旧 URL 兼容）
### 3.3 "另一极"如何渲染（当前 Vue Router 4 下的可行写法）
### 3.4 组件树（新增 / 改造 / 复用，标出文件名）
### 3.5 store 改动清单（字段名 + action 名 + 作用）

## 4. 桌面端分栏
### 4.1 栅格与列宽
### 4.2 列头（子导航）与中缝（seam）
### 4.3 滚动策略
### 4.4 768–1099px 的降级
### 4.5 骨架 CSS（含代码）

## 5. 移动端重叠切换
### 5.1 交互规格（层叠结构、露出量、热区、交换语义）
### 5.2 动画（transform 序列、时长、缓动、reduced-motion 降级）
### 5.3 与底部导航、弹层、Toast 的层级关系
### 5.4 键盘与读屏操作方式
### 5.5 骨架 CSS（含代码）

## 6. 两极之间的联系
### 6.1 推荐方案（说清为什么选它）
### 6.2 备选方案 2–3（价值/成本/落点对比表）
### 6.3 联动机制的实现位置（store / service / 组件）

## 7. 设计令牌改动
新增/调整的 CSS 变量清单（名字、值、用途），两极配色在深浅主题下的取值与对比度。

## 8. 实施路线（分阶段）
表格：阶段 | 产出 | 验收标准 | 可回滚性 | 依赖。至少 4 阶段，每阶段独立可跑。
**必须包含"返回旧版"开关的灰度方案**（调研 P2-12）。

## 9. 风险与不变式
### 9.1 不可破坏的不变量（业务口径 / 数据格式 / 硬件契约 / 无障碍）
### 9.2 改版风险表（风险 | 影响面 | 缓解 | 触发回滚的条件）
**必须包含**：训练时长秒/分钟单位错配、weekRules.plannedDays 不读 store.plans、跟练动作静默回落、TwoPoleDial 内联 --dial-size 压不过样式表。

## 10. 待用户确认的问题
3–6 个必须由产品决策拍板的问题，每条给出**推荐默认值**，用户可以直接说"就按你推荐的来"。

---

要求：具体、可施工、可验证。`,
  { label: 'synthesize:final-spec', phase: 'Synthesize' })

return { finalDoc, proposals: validProposals.map(p => p.approachName), critiques: validCritiques.length }
