# 两仪·TwoPoles - 前端UI

现代化的个性化运动与饮食协同助手前端界面

## ⚠️ 当前实现状态（请先读这一节）

本项目是**演示前端原型**，不是可用产品。实际状态如下：

| 范围 | 状态 |
|------|------|
| 页面视图 | **7 / 7 都有实际界面**（Onboarding / Dashboard / Plan / Execution / Meals / Report / Settings）。计数已与识别联动、计划版本与调整确认在本机落地；没有账号后端，模型请求经同源 Vite 代理转发 |
| 数据 | 档案、模式与切换历史、训练记录（含 RPE 反馈）、餐食记录、**计划版本与历史**、**本机"1 单位=几克"换算口径**、隐私偏好都存在 localStorage；可从设置页导出 JSON/CSV（含计划与换算口径）或一键清除 |
| 训练反馈 | ✅ 跟练结束可填 RPE（**0–10**，或留空=未记录）、不适、部分完成原因与备注，写回该条 session 并持久化 |
| 建档 | ✅ 三步表单写入 `store.updateProfile()`，含场地多选；12–17 岁与勾选孕期/伤病限制者只保留记录与手工录入，不生成自动推荐 |
| `npm run dev` / `npm run build` / `npm run typecheck` / `npm run selfcheck` | ✅ 全部通过（selfcheck 为 **229 项**纯逻辑断言，覆盖条件过滤、负荷缺失口径、类别推断、餐次时间窗、识别结果校验、计数状态机、计划版本与切换确认、常吃归并、目录搜索、单位↔克数换算与落盘）。`npm run build` 需要 esbuild 子进程，**在受限沙箱下会 `spawn EPERM`**，只在本机正常环境跑 |
| 摄像头 | **真联动 + 未实测**：实时摄像头分支由 MediaPipe 关键点角度驱动 `useRepCounter` 状态机计数（迟滞区间、最短阶段时长、3 帧平滑、遮挡冻结、停滞重置、抖动不计入），支持机位校准与手工修正，模型计数与修正值分别保留。**未在任何真机上验证过计数准确率**，90% 误差指标待隔离测试集实测；权限被拒、无设备或非安全上下文时自动退回"演示回放"，界面明确标注计数来源。取帧用 `requestVideoFrameCallback` 的真实帧时间戳，推理默认在经典 worker 内跑 **GPU delegate**（构建后实测生效），两者任一不可用则自动回落主线程 / CPU，状态文案如实显示实际后端 |
| 记录入口（调研 P1-6） | ✅ 饮食页只有一个主入口「记录饮食」：拍照/选图 → 项目已有模型（设置页或服务端默认，需支持图片输入；无模型时走端侧 EfficientDet 9 类）→ 按拍摄时间自动判餐次 → 默认直接保存。结果页不展示完整表单，低置信度/待确认项明确标出，想改再展开；保存后的记录仍保留查看、编辑、删除与常吃/搜索/单位↔克数换算。模型识别要求在拍照前勾选发送同意，原图不保存；失败不生成记录。 |
| 内容库 | 动作库 `services/exercises.ts` 27 条（含 1 条停用）带器材/场地/时长/强度/限制门槛与来源标注；食物目录 `services/foodComposition.ts` 56 条 + 22 种混合菜，全部 `verified: false` |
| 摄像头资产 | 需先执行 `cd UI && npm run camera:assets`（拉取 5.5 MB 模型 + 27 MB wasm，已被 .gitignore 排除）；且页面必须走 **https 或 localhost**（`vite --host` 的局域网 http 地址无法调用摄像头） |
| 模式切换 | ✅ **页头右侧的模式芯片**（UI 3.0 从侧栏迁来）与设置页切换都**先展示差异与未完成计划、确认后才生效**，取消则不改动任何数据；切换历史与当时未完成计划数落本机，旧模式计划仍可见（需明确复制才形成新模式计划） |
| 后端 | 无账号后端；`/api/llm/*` 是同源 Vite 代理，计划生成与照片识别共用这份模型配置。服务端默认模型的密钥只从 `LLM_DEFAULT_*` 读取；设置页自定义密钥只存本机 |

下方"核心功能"章节描述的是**设计目标**，剩余未实现项已逐项标注。**后续怎么做（拍照识别热量的取舍、后端与前端如何对接、里程碑顺序）见仓库根 [`../plan.md`](../plan.md)。**

## 🎨 设计特性

- **纸面 + 单一强调色**（UI 3.0）：底 `#f2f1ec` 中性纸面 + 白卡 + 1px 发丝线，圆角收到 6–16px；强调色只有 `#0f766e` 一种，第二极 `#24586f` 只给"饮食"这条数据线。状态一律**形状 + 文字双编码**（实心＝完整 / 半填＝部分 / 空心＝未记录），不靠颜色单独传达。7 条路由实测 0 项 WCAG AA 失败
- **数字是第一主角**：数字单独一套 `--font-num`（Bahnschrift → DIN 骨架），44–64px 等宽字；小标签统一 `.micro`（10px + `.17em` 大写）。指标从"四张等宽卡"改成一条 `StatStrip` 指标条，数字竖着能比
- **克制的表面**：全站只有两种表面——纸面（`BaseCard` 的 `default` / `flush`）与仪表面（`variant="ink"`，只给首页的双极环）。`body` 一层颗粒纹理（opacity .018，深色 .05）；悬停只交换边框色，不做位移、不做图标旋转
- **克制的动效**（按调研 P0-3 收敛）：无常驻循环动画、无入场错位延时；动效只在一次性入场与操作之后出现。仅两处循环且都在"操作进行中"才存在——演示回放边框扫光、休息阶段徽标呼吸。`prefers-reduced-motion` 全量降级（实测：概览等 6 页常驻无限动画 0，跟练页 1）
- **响应式设计**: 断点已定义（移动/平板/桌面），未在真实设备上逐一验证
- **双模式支持**: ✅ **页头模式芯片**与设置页切换都先展示差异与未完成计划、确认后才生效；运动员模式已接入距离/时长与 session-RPE 负荷、四周周期视图与训练日用餐时间线（周期计划的跨端录入仍待后端）
- **无障碍**: ⚠️ 布局与关键控件带 ARIA（抽屉 `aria-expanded`、模式菜单 `role=menu`、演示播报 `aria-live`），但"完整键盘导航"未整体核对
- **跟练计数**: 实时摄像头分支由端侧关键点状态机驱动计数（含机位校准、遮挡冻结与手工修正）；另有预设时间线的"演示回放"供无设备时讲解，界面标注当前计数来源

## 🚀 快速开始

### 安装依赖

```bash
cd UI
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173

### 构建生产版本

```bash
npm run build
```

### 类型检查

```bash
npm run typecheck
```

## 📁 项目结构

```
UI/
├── public/
│   ├── favicon.svg          # 品牌标记（圆角 Navy 底板版）
│   └── mediapipe/           # wasm + pose_landmarker_lite.task（npm run camera:assets 生成，不入库）
├── scripts/
│   └── fetch-camera-assets.mjs  # 拉取端侧推理资产
├── src/
│   ├── components/
│   │   ├── common/          # BaseButton / BaseCard / StatusBadge / InsightCard / ToastRegion
│   │   │                    # + TwoPoleDial（双极环）/ StatStrip（指标条）/ ShapeState（三态形状）
│   │   ├── meals/           # FoodCaptureDialog（拍照/同意/识别结果/轻量修改）+ MealForm（保存后的可选编辑）
│   │   └── layout/          # AppShell / TopBar（58px 纸面页头，含模式芯片）/ SidebarNav（86px 图标脊）/ MobileNav
│   ├── composables/         # usePoseCamera.ts + poseEngine.ts + poseInference.worker.ts（端侧姿态识别：worker/GPU 推理、骨架、可见度、关节角）· useRepCounter.ts（计数状态机）
│   ├── views/               # 7 个页面均有实际界面（Onboarding / Dashboard / Plan / Execution / Meals / Report / Settings）
│   ├── stores/              # app.ts（mode、profile、sessions、meals、privacy、toast）
│   ├── services/            # foodRecognition（云端/本机可替换识别）、mealRules（结构规则与餐次时间窗）、foodComposition（目录/估算）、llm（计划模型与代理）、planRules、weekRules、loadRules 等
│   ├── types/               # domain.ts
│   ├── utils/               # id.ts（非安全上下文 ID 兜底）、time.ts（日期/问候/日历偏移）
│   ├── styles/              # tokens.css（UI 3.0 令牌）/ globals.css（.micro .num .hairline）/ animations.css / gradients.css（只剩回放扫光）
│   ├── router/              # index.ts（7 条路由，全部懒加载）
│   ├── App.vue
│   └── main.ts
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

> 仓库根另有 `brand/`（品牌标记的浅底/深底 SVG）与 `redesign-shots/`（改版前后的真机截图）。`components/journey|training|meals|reports/` 仍不存在——那是早期交付文档设想的规划结构，未落地。

## 🎯 核心功能

以下逐项标注真实状态。✅ 已实现 · ⚠️ 部分实现 · ❌ 未实现（仅设计目标）

### 1. 双模式系统
- ✅ **页头右侧的模式芯片**可切换（UI 3.0 从侧栏迁来），切换前先列差异与未完成计划，确认后写入 localStorage 并弹 Toast
- ✅ **大众模式**: 概览、计划、周报、饮食四处的取数与文案都按模式分支，数据来自本机 store
- ✅ **运动员模式**: 除了文案与指标，还接了周期阶段、四周周期视图、session-RPE 负荷、距离/时长与训练日用餐时间线
- ❌ 差异对比对话框、切换前的历史数据保留说明

### 2. 训练计划
- ✅ 可视化日历：按真实年月生成（星期一为首列，2026-10-01 正确落在"四"列）、今天高亮、上一月/下一月可翻页、休息日与训练日区分
- ✅ 选中日期驱动右侧详情；过去日期显示"已过去"，休息日显示"未安排"而非"没有活动"
- ⚠️ 计划版本管理：可"新建计划"递增版本号并提示草稿，但没有版本对比与回滚
- ✅ 锁定训练项：坐站训练标记 `locked`，替换动作会跳过锁定项
- ✅ 替代动作建议：站姿弯举可替换为弹力带弯举 / 水瓶弯举，附理由
- ✅ "四周周期" tab 有独立的周期阶段视图（负荷条为演示数据）
- ✅ 调整预览与确认：可查看"周六→周日搬移"的预览并接受/保持原计划（单次演示，不写入持久化计划）

### 3. 摄像头跟练
- ✅ **实时摄像头（半真）**: "实时摄像头"chip 走 MediaPipe 端侧推理，把真实骨架、关键点可见度与膝/髋/肘角度叠在画面上；权限被拒或无设备时自动退回"演示回放"
- ✅ **识别与计数已联动**: 实时模式下计数由 `useRepCounter` 的关节角状态机驱动（迟滞区间、最短阶段时长、3 帧平滑、遮挡冻结、停滞重置、抖动不计入），并支持机位校准；界面明确标注当前计数来源
- ✅ **演示模式**: `requestAnimationFrame` 增量回放预设计数事件
- ✅ 两个动作都有入口（页内 chip 与 `?exercise=` 查询参数）：坐站 2×8、弯举 2×10
- ✅ 组数会推进，组间 6 秒休息倒计时，进度条按 组数 + 本组次数 计算
- ✅ **暂停与后台安全**: 累计时间增量而非墙钟，单帧增量钳制在 250ms，恢复或切回标签页不会跳计数
- ✅ 跳过本组、结束并记录、手动修正（计入 `manualCorrections`）均可用
- ✅ 结果经 `summarizeSession()` 写入 `store.sessions` 并持久化；汇总卡显示组数/次数/平均置信度/修正次数/完成状态
- ✅ 计数与 reps 小格经 320ms 补间滚动出现（`prefers-reduced-motion` 下直接落位）
- ✅ 实时置信度指示器（初始值为 0，进入页面会先显示"识别较差"）
- ⚠️ 骨架图是按阶段位移的 SVG 示意（叠加 shimmer 光带），不是真实关键点渲染
- ❌ 手动记录降级表单（"放弃本次记录"直接返回概览，不产生记录）
- ✅ 隐私优先的本地处理说明文案

### 4. 饮食记录
- ✅ **拍照即记录**：饮食页只有一个主入口「记录饮食」，点击后直接拍照或选图；不再进入四个餐次卡，也不再要求先选早餐/午餐/晚餐/加餐。识别结果页默认只做展示，主操作是「保存记录」，想改再展开轻量编辑器。
- ✅ **餐次按拍摄时间自动判断**：`mealRules.MEAL_TIME_WINDOWS` 集中配置阈值（05:00–10:29 早餐 / 10:30–14:59 午餐 / 15:00–21:00 晚餐 / 其余加餐），结果页和已保存记录都提供轻量修改入口，不依赖模型猜餐次。
- ✅ **可替换识别层**：`services/foodRecognition.ts` 统一输入输出。模型识别复用项目现有的 `/api/llm/chat` 代理与设置页模型配置（服务端默认模型或用户自己的接口），模型需要支持 `image_url` 图片输入；没有可用模型或用户选择本机时走 EfficientDet-Lite0（6.9 MB，CPU，COCO 9 个可食类）。两条路径都不保存原图。
- ✅ **发送前同意**：检测到模型可用时，拍照/选图按钮在勾选"照片会发送到识别服务"前不可用；弹窗里同时提供「仅本机识别」和「手动补录」。旧版"照片不上传"文案已从 Dashboard / 表单 / README 移除。
- ✅ **严格校验、失败不造假**：模型输出必须含食物名称与 0–1 置信度；类别缺失时只允许按本机目录推断或落"其他"，份量/营养无效就留空。非 JSON、空条目、全部字段缺失、网络/代理失败都进入错误态，不生成记录；低置信度与不确定项明确标注，但不强迫逐项确认。
- ✅ **数据结构兼容**：仍写入原有 `Meal` / `MealItem` / `MealAnalysis`；仅追加可选的 `uncertain` 与 `modelEnergy`。旧记录照常显示、编辑、删除，周报与首页统计沿用原口径。
- ✅ 结构规则 `diet-rules-v2`：给出本餐出现的类别，并算"记完这餐后当天仍缺的类别"（期望 8 类；油脂类与"其他"不作要求）。
- ✅ 热量粗估**默认关闭**：开启后本地参考表区间带 `basis` 与来源；识别模型提供的热量区间单独标"模型粗估（未与成分表核对）"，两者都不会伪装成精确值。份量没估、食物不在参考表或混合菜 → 不显示，而不是给 0。
- ✅ 没记录的餐次显示"未记录"，概览与周报同一口径。
- ✅ **食物库与搜索 / 常吃 / 单位↔克数**：仍在保存后的编辑表单里可用；`searchFoods()` 过 56 条内置目录，混合菜另有 22 条；`frequentFoods()` 按目录规范名归并本机历史；单位换算先只影响本行，点"记住"才落本机。
- ✅ **运动员模式的训练日用餐时间线**：保留在饮食页，把当天餐次与训练按时间排在一起。
- ⚠️ 本机识别只覆盖 9 类（中餐大多认不出）；模型识别覆盖取决于所选模型，且模型必须支持图片输入。模型判不出份量时显示"份量未估"，不猜克数。

### 5. 数据完整性
- ✅ `Meal` / `MealItem` / `MealAnalysis` / `WeeklyReport` / `PrivacySettings` / `SessionFeedback` / `TrainingSession` / `PlanItem` / `AlternativeExercise` 都由真实数据流消费；只剩 `CameraSession`、`PoseFrame`、`PlanAdjustment`、`PlanChange` 停留在定义层
- ✅ 跟练结果在未记录 RPE 时存 `null`（不是 0），部分/全部完成用 `completionStatus` 区分；反馈里可写明未完成原因（`completionReason`）与备注
- ✅ 负荷只在 RPE 有记录的日子计算；缺 RPE 的日子在周报里画成斜纹"未记录"
- ✅ 计划页休息日、餐食"未记录"、周报数据质量说明三处都区分"未记录"与"没有发生"

### 6. 建档（Onboarding）
- ✅ 三步：选择使用方式 → 基本情况（昵称/年龄/目标/经验/可用时间/器材/需要避开）→ 专项信息（运动员）或回顾（大众）
- ✅ 写入 `store.updateProfile()`，档案含 id，跟练记录的 `userId` 会指向它；再次进入为编辑模式并回填
- ✅ 校验：年龄 12–90、目标与经验必选、周期开始不晚于结束；错误用 `role="alert"` 就地提示
- ✅ 未建档不拦截：概览顶部一条软引导横幅，其余演示内容照常可见
- ⚠️ 这些条件目前只用于称呼与文案口径，尚未真正驱动推荐算法（无后端）

### 7. 周报（Report）
- ✅ 按周（周一起算）聚合本机记录：计划场次 / 有记录场次 / 总时长 / 负荷合计 / 餐食记录数，可翻上一周与下一周
- ✅ 内联 SVG / 纯 CSS 图表，零图表库依赖：每日负荷条形图（已计算＝实心、缺 RPE＝斜纹、**未记录＝只描边而不画 0**）+ 8 类食物出现次数点阵
- ✅ 训练明细表含时长、次数/组数、RPE、负荷与完成状态；无记录时是空白状态而不是 0
- ✅ "这份报告没说的三件事"：列出缺 RPE 的条目、计划与实际的差距、餐食未记录的天数与规则版本

### 8. 设置与数据（Settings）
- ✅ 模式切换、档案摘要与入口；隐私偏好（摄像头开关、是否存原始画面、保留天数、导出格式）写入 `store.privacy` 并落盘
- ✅ 跟练页会尊重"允许使用摄像头"：关掉后"实时摄像头"chip 置灰并说明原因
- ✅ 导出：JSON（完整结构）或 CSV（含 BOM，表格软件可直接打开），由浏览器本地生成下载
- ✅ 清除全部数据：两步确认（不用 `window.confirm`），清空档案/模式/训练/餐食/偏好，完成后按钮回到禁用态
- ⚠️ 诚实标注的两个"当前无实际效果"的偏好：`saveVideoLocally`（本版本没有录制功能）、`dataRetentionDays`（没有自动清理逻辑）

## 🎨 设计系统（UI 3.0「编辑式仪表盘」）

> 这一节此前写的是 Navy / Teal / Blue 三色与"渐变增强"。那套在第十一轮就废弃了，第十八轮又把纸面、圆角、字体整体换掉。以下为当前值，令牌以 `src/styles/tokens.css` 为准。

### 颜色
- 纸面 `--color-bg: #f2f1ec` · 卡 `--color-card: #ffffff` · 墨 `--color-ink: #11161a`
- 强调色 `--color-accent: #0f766e`（全站唯一）；第二极 `--color-brand-pole-b: #24586f` 只给"饮食"这条数据线
- 发丝线三档 `--hair / --hair-soft / --hair-strong`（rgba(17,22,26,.10 / .06 / .18)）
- 深色主题整组覆盖同名令牌：底 `#14171a`、卡 `#1c2126`、强调 `#3ec9b6`（前景翻深字 `#08201d`）

### 表面与排版
- 表面只有两种：纸面（`BaseCard` 的 `default` / `flush`）与仪表面（`variant="ink"`）；面板内距走 `--card-pad`，父子组件不再抢 `padding`
- 字体：正文系统字族；数字与小标签走 `--font-num`（Bahnschrift → DIN 骨架）
- 圆角 6 / 8 / 10 / 12 / 16；投影只留给弹层、Toast 这类真的浮起来的东西
- 布局：`--sidebar-width: 86px` 图标脊 + `--topbar-height: 58px` 纸面页头 + ≤767px 浮动胶囊底栏

### 动效时序
- Fast (150ms): Hover状态、焦点环
- Base (250ms): 页面切换、模态框
- Slow (400ms): 进度与位移过渡
- Slower (600ms): 覆盖层与条形的宽度过渡（入场已无错位延时）

## 🔧 技术栈

- **Vue 3**: 组合式API
- **TypeScript**: 严格类型检查
- **Vite**: 快速构建工具
- **Vue Router**: 路由管理
- **Pinia**: 状态管理
- **Lucide Icons**: 图标库
- **CSS Variables**: 设计令牌系统

## 📱 响应式断点

- **Mobile**: < 768px - 底部 4 Tab（今日 / 记录 / 图表 / 我的，选中项带 `aria-current`，触控目标实测 64×57px）+ 汉堡抽屉（计划、跟练等完整导航仍在抽屉里；遮罩可关闭，选中导航项自动收起），垂直堆叠卡片
- **Tablet**: 768–1099px - 图标脊收起为 **244px 抽屉**；汉堡按钮与抽屉**同档出现**（这是第十八轮修掉的旧 bug：此前 768–1099 之间没有任何导航入口）
- **Desktop**: ≥ 1100px - 固定 **86px 图标脊**（文字标签 10px，`title` 给全称），内容区多列布局

## ♿ 无障碍现状

已落地：

- ✅ 布局组件带 `aria-label` / `aria-live`（TopBar、AppShell、SidebarNav、MobileNav、ToastRegion）
- ✅ 汉堡按钮有 `aria-expanded`，模式菜单用 `role=menu` / `role=menuitem`，日历 tab 用 `role=tab` + `aria-selected`
- ✅ Execution 的提示语位于 `aria-live="polite"` 区域；控件按钮有 `aria-label`，禁用态用 `disabled`
- ✅ Dashboard 的"记录这一餐"改为 `RouterLink`，可聚焦可回车
- ✅ `globals.css` 有 `:focus-visible` 焦点环；`BaseButton` 最小高度 44px
- ✅ `prefers-reduced-motion` 在 `tokens.css` 与 `animations.css` 中均有降级处理

尚未达成（"完整键盘导航/屏幕阅读器支持"仍需实测核对）：

- ⚠️ 触控目标与对比度未按 WCAG AA 逐项检查（`BaseButton` 之外的自绘按钮存在低于 44px 的，如日历 tab、chip）
- ⚠️ 计数与置信度仍主要靠视觉呈现，`aria-live` 只播报提示文案
- ⚠️ 未在读屏软件与真实设备上验证

## 🔄 摄像头识别现状与剩余工作

### 已接入：端侧姿态识别 → 计数联动

`useRepCounter` 以关节角序列驱动计数（迟滞区间、最短阶段时长、3 帧平滑、遮挡冻结、停滞重置、抖动不计入），支持机位校准；`demoCameraService` 的预设时间线只在演示回放分支上用，界面标明计数来源。

推理管线（本轮改造，`npm run build` 后实测）：

- **取帧**：`video.requestVideoFrameCallback()` 一帧一次回调，喂给 `detectForVideo` 的时间戳用**帧自己的媒体时间**（`metadata.mediaTime`），RVFC 不可用时回落 rAF + `video.currentTime` 去重；重复帧直接跳过，不再靠墙钟猜。
- **推理落点**：优先经典 worker（`composables/poseInference.worker.ts`），每帧 `createImageBitmap(video)` transfer 过去、推理完 `bitmap.close()`；worker 起不来或单次推理超 2 秒时，**自动回落主线程推理**，不退回演示回放。
- **后端**：`delegate: 'GPU'` 绑一块专用 `OffscreenCanvas`（`VisionTaskOptions.canvas`），初始化或推理抛错就重建为 CPU。实测 worker 内 GPU 生效（console：`GL version: 3.0 (WebGL 2.0 …)` + `Graph successfully started running`）。实际生效的后端与推理落点如实显示在跟练页状态文案里。
- **绘制仍留主线程**：`DrawingUtils` 要的是 DOM canvas 的 2D 上下文与现有 CSS 镜像（画面与叠加层都 `scaleX(-1)`）。**画面不出本机，无上传。**

两条已知边界：

- ⚠️ **`npm run dev` 下走的是主线程回落**：module worker 里 `importScripts` 不可用，而 Vite 不把 `public/` 里的 wasm glue 当模块解析（对 `/mediapipe/wasm/vision_wasm_internal.js?import` 返回 500）。功能不减，但线程收益只有 `npm run build && npm run preview` 才拿得到。
- ⚠️ 本环境无摄像头，RVFC 的取帧分支与真机 FPS、计数准确率**均未实测**（`plan.md` §5.1）。
- ✅ 修掉一个真 bug：可见度原来把 11–27 共 17 个关键点的 `visibility` 求和后除以 6，能到 2.8，使状态机的遮挡门控恒成立；现改为参与算角的 6 点均值，`npm run selfcheck` 第 8 节有断言。

准备资产（一次性，产物不入库）：
```bash
cd UI
npm run camera:assets
```

运行前提：`https` 或 `localhost`。用 `vite --host` 得到的局域网 http 地址里 `navigator.mediaDevices` 不存在，会走 "unsupported" 分支并退回演示模式。

### 后端API集成
`src/services/` 现在是四个纯本机模块（`demoCameraService`、`mealRules`、`planRules`、`weekRules`），**没有 API 层、没有请求客户端、没有错误与加载态处理**，所有数据只进 localStorage。

接后端的完整设计（API 面、令牌放置、ID 与幂等、同步与冲突、`services/api/` 落点、服务端表结构、错误包体、安全清单、B0–B5 里程碑）见仓库根 [`plan.md`](../plan.md) §2。最关键的一条约束：**`VITE_API_BASE_URL` 未配置时必须保持今天这套纯本机行为**，后端上线不能把离线可用性弄没。

## 📝 开发说明

### 添加新页面
1. 在`src/views/`创建Vue组件
2. 在`src/router/index.ts`添加路由
3. 在侧边导航中添加链接

### 添加新组件
1. 选择合适的文件夹（common/journey/training等）
2. 使用`<script setup lang="ts">`语法
3. 导入类型从`@/types/domain`
4. 遵循现有的样式模式

### 状态管理
- 全局应用状态在`stores/app.ts`（`mode`、`profile`、`sessions`、`toasts`）
- ✅ 切换模式与结束跟练都会写入 localStorage（`twopoles_state`），刷新后保持；`clearAllData()` 可清空
- ✅ `switchMode()` 与 `updateProfile()` 都有真实调用方了（侧边栏模式菜单 / 建档页），跟练与反馈会写入 `sessions`
- ✅ ID 生成走 `utils/id.ts` 的 `newId()`，在没有 `crypto.randomUUID` 的非安全上下文（http + 局域网 IP）会退回时间戳+随机数
- 展示用的训练/饮食数字仍是视图内的硬编码常量，只有跟练结果进入 store

### 样式约定
- 优先使用 CSS 变量（如 `var(--color-ink)`、`var(--hair)`、`var(--radius-md)`）
- 组件内使用 scoped 样式
- 复用 `tokens.css` 中的设计令牌；面板内距用 `--card-pad`，不要和 `BaseCard` 抢 `padding`
- 需要深色仪表面板时用 `BaseCard variant="ink"`，不要自己再写一套网格与渐变
- `gradients.css` 现在只剩跟练回放边框那一条 `.gradient-shimmer`，没有背景类可"顺手加个渐变"
- ⚠️ 同一个元素别既挂全局动画工具类（`.animate-*`）又在 scoped 里写 `animation` 简写：两者都是简写属性，会被整条覆盖。要多段动画就在同一处用逗号并列

## 🧪 测试建议

### 手动测试清单

> 2026-10-16 那轮在浏览器里逐项目测过的标 ✅；未跑过的保持 [ ]。**深色模式已经实现（第十六轮，三态：跟随系统/浅色/深色）**，第十八轮又跟着新令牌重新取值。

- [x] 建档三步流程（校验、回顾、写入 localStorage）
- [x] 模式切换生效并落盘（含运动员模式展示分支）
- [x] 跟练：跳过 / 结束记录 / 手动修正 / RPE 反馈 / 结果落盘
- [x] 整轮 50 秒自然播放完成并入库（暂停冻结已实测）
- [x] 餐食：录入、部分记录判定、类别与缺失类别、删除
- [x] 周报：计划 vs 实际、负荷条与"缺 RPE"斜纹、翻页、数据质量说明
- [x] 设置：隐私开关（含跟练页置灰联动）、CSV 导出、两步确认清除
- [ ] 响应式在 375px / 真实移动设备上（仅测过 723px 与隐藏页；第十八轮补了 1440 / 1024 / 390 三个断点的无头截图，但不是真机）
- [x] 深色主题（第十六轮：7 页 388 个文本节点 0 项 AA 失败；浅色同样 0 项）
- [ ] 键盘导航完整（对比度已由深色审计覆盖，键盘路径未逐项点过）
- [ ] 真实摄像头下的骨架对齐与关节角数值（本环境无设备）

### 浏览器测试

目标覆盖范围（**尚未实测**，目前只在 Chromium 内核的内置浏览器里验证过 dev server 渲染无报错）：
- Chrome/Edge (latest)
- Firefox (latest)
- Safari 14+
- 移动端Safari和Chrome

## 📄 许可

本项目为教学演示项目。

## 👥 贡献

这是一个课程项目的前端UI实现。

---

**注意**: 这是一个无后端的本机演示前端。7 个页面都有实际界面；档案、模式、训练与反馈、餐食记录、隐私偏好都存在 localStorage。
视觉为 UI 3.0（纸面 + 单一强调色 + 双极仪表），静态外观以 `../redesign-shots/` 的真机截图为唯一事实来源。
主要缺口：

1. **真机摄像头未验证**——姿态识别与计数**已经联动**（`useRepCounter` 由关节角驱动），但没有在任何真机上量过计数准确率。
2. **计划调整只在界面层生效**，且旧版本只在 `planHistory` 里可看、没有回滚入口。
3. **推荐口径未按档案真正计算**：`planRules` 会按器材/场地/时长/禁忌过滤动作库，但"为什么给你这份计划"的那段文字仍是规则拼出来的，不是模型推的。
