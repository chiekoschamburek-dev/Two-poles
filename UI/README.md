# 两仪·TwoPoles - 前端UI

现代化的个性化运动与饮食协同助手前端界面

## ⚠️ 当前实现状态（请先读这一节）

本项目是**演示前端原型**，不是可用产品。实际状态如下：

| 范围 | 状态 |
|------|------|
| 页面视图 | **4 / 7 已实现**：Onboarding（建档）、Dashboard、Plan、Execution；Meals、Report、Settings 仍是两行占位页 |
| 训练反馈 | ✅ 跟练结束可填 RPE(1–10 或留空=未记录)、不适、部分完成原因与备注，写回该条 session 并持久化 |
| 建档 | ✅ 三步表单写入 `store.updateProfile()`；未建档时概览顶部有软引导横幅（不拦截） |
| `npm run dev` / `npm run build` / `npm run typecheck` | ✅ 全部通过（JS+CSS 约 280 KB gzipped；摄像头推理另需约 32 MB 端侧资产，见下） |
| 摄像头 | **半真**：点"实时摄像头"会用 MediaPipe Pose Landmarker 在本机推理出骨架、关键点可见度与膝/髋/肘角度；**但计数仍由演示时钟推进，识别与计数尚未联动**；权限被拒或无摄像头时自动退回"演示回放" |
| 摄像头资产 | 需先执行 `cd UI && npm run camera:assets`（拉取 5.5 MB 模型 + 27 MB wasm，已被 .gitignore 排除）；且页面必须走 **https 或 localhost**（`vite --host` 的局域网 http 地址无法调用摄像头） |
| 数据 | 界面演示数字仍为硬编码；**训练结果会写入 `localStorage`（`sessions`）**，可在跟练页汇总中看到 |
| 模式切换 | ✅ 侧边栏"当前模式"可切换大众/运动员模式，会落盘并触发 Toast |
| 后端 | 无 |

下方"核心功能"章节描述的是**设计目标**，剩余未实现项已逐项标注。

## 🎨 设计特性

- **现代渐变风格**: 使用精美的CSS渐变和玻璃态效果
- **丰富的微交互**: 页面级错位入场、Hero 渐变流光、按钮扫光、卡片悬浮景深、计数补间滚动与状态弹性（均走 `animations.css` 关键帧 + CSS 变量时序，无动画库依赖）
- **响应式设计**: 断点已定义（移动/平板/桌面），未在真实设备上逐一验证
- **双模式支持**: ✅ 侧边栏"当前模式"可切换大众/运动员模式，会写入 localStorage、给出差异说明并弹出 Toast；运动员模式目前仍只是展示层差异（周期计划、负荷与 RPE 未实现）
- **无障碍**: ⚠️ 布局与关键控件带 ARIA（抽屉 `aria-expanded`、模式菜单 `role=menu`、演示播报 `aria-live`），但"完整键盘导航"未整体核对
- **演示摄像头**: 预设的动作计数演示（未集成真实MediaPipe）

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
│   │   ├── common/          # BaseButton / BaseCard / MetricCard / StatusBadge / ToastRegion
│   │   └── layout/          # AppShell / TopBar / SidebarNav / MobileNav
│   ├── composables/         # usePoseCamera.ts（MediaPipe 端侧姿态识别：骨架、可见度、关节角）
│   ├── views/               # Onboarding / Dashboard / Plan / Execution 已实现；Meals / Report / Settings 为占位
│   ├── stores/              # app.ts（mode、profile、sessions、toast）
│   ├── services/            # demoCameraService.ts（按组的演示时间线 + summarizeSession）
│   ├── types/               # domain.ts
│   ├── utils/               # id.ts（非安全上下文 ID 兜底）、time.ts（日期/问候/日历偏移）
│   ├── styles/              # tokens.css / globals.css / animations.css / gradients.css
│   ├── router/              # index.ts（7 条路由，全部懒加载）
│   ├── App.vue
│   └── main.ts
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

> 仓库根另有 `brand/`（品牌标记的浅底/深底 SVG）。`components/journey|training|meals|reports/` 仍不存在——那是早期交付文档设想的规划结构，未落地。

## 🎯 核心功能

以下逐项标注真实状态。✅ 已实现 · ⚠️ 部分实现 · ❌ 未实现（仅设计目标）

### 1. 双模式系统
- ✅ 侧边栏"当前模式"下拉可切换，切换即写入 localStorage 并弹出 Toast
- ⚠️ **大众模式**: Dashboard / Plan 有两种模式的展示分支，但展示数据仍为硬编码
- ⚠️ **运动员模式**: 仅 Hero 区文案与指标数字不同；周期计划、负荷追踪、RPE 记录未实现
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
- ❌ **识别与计数尚未联动**: 实时模式下计数仍由下面的演示时钟推进，舞台下方提示语已明确写出这一点
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
- ❌ **MealsView 是两行占位页**，餐次时间线、食物类别确认、结构分析、"未记录"语义、训练日时间线全部未实现
- ⚠️ 仅 Dashboard 上有一张静态"已记录 2 餐"卡片

### 5. 数据完整性
- ⚠️ `TrainingSession`（含 `rpe: number | null` 与反馈字段）、`SessionFeedback`、`PlanItem`、`AlternativeExercise` 已被计划页与跟练页消费；`Meal`、`WeeklyReport`、`PrivacySettings`、`CameraSession` 仍只是类型定义
- ✅ 跟练结果在未记录 RPE 时存 `null`（不是 0），部分/全部完成用 `completionStatus` 区分；反馈里可写明未完成原因（`completionReason`）与备注
- ✅ 计划页休息日明确写"没有安排"，不等于"没有活动"
- ❌ 周报/图表不存在（ReportView 是占位页），"数据质量说明"未落地

### 6. 建档（Onboarding）
- ✅ 三步：选择使用方式 → 基本情况（昵称/年龄/目标/经验/可用时间/器材/需要避开）→ 专项信息（运动员）或回顾（大众）
- ✅ 写入 `store.updateProfile()`，档案含 id，跟练记录的 `userId` 会指向它；再次进入为编辑模式并回填
- ✅ 校验：年龄 12–90、目标与经验必选、周期开始不晚于结束；错误用 `role="alert"` 就地提示
- ✅ 未建档不拦截：概览顶部一条软引导横幅，其余演示内容照常可见
- ⚠️ 这些条件目前只用于称呼与文案口径，尚未真正驱动推荐算法（无后端）

## 🎨 设计系统

### 颜色
- Navy: `#16334b` - 主导航和标题
- Teal: `#087e80` - 主操作和积极进度
- Blue: `#2468a0` - 计划对比和次要强调
- Background: `#f2f6f9` - 页面背景

### 渐变增强
- 导航栏: Navy渐变背景
- 按钮: Teal渐变填充，hover时位移和缩放
- 卡片: 悬停时渐变边框发光
- 图表: 渐变填充条形图

### 动画时序
- Fast (150ms): Hover状态、焦点环
- Base (250ms): 页面切换、模态框
- Slow (400ms): 进度与位移过渡
- Slower (600ms): 页面加载错位效果

## 🔧 技术栈

- **Vue 3**: 组合式API
- **TypeScript**: 严格类型检查
- **Vite**: 快速构建工具
- **Vue Router**: 路由管理
- **Pinia**: 状态管理
- **Lucide Icons**: 图标库
- **CSS Variables**: 设计令牌系统

## 📱 响应式断点

- **Mobile**: < 768px - 底部导航 + 汉堡抽屉（遮罩可关闭，选中导航项自动收起），垂直堆叠卡片
- **Tablet**: 768px - 1099px - 侧边栏收起为抽屉，双列卡片
- **Desktop**: ≥ 1100px - 固定侧边栏，多列布局

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

### 已接入：端侧姿态识别（显示层）
`src/composables/usePoseCamera.ts` 已把 MediaPipe Tasks Vision 跑通：`FilesetResolver.forVisionTasks('/mediapipe/wasm')` + `PoseLandmarker`（`pose_landmarker_lite.task`，CPU delegate，VIDEO 模式，numPoses=1），用 `detectForVideo(video, performance.now())` 逐帧取 33 个关键点，`DrawingUtils` 把骨架与连线画到与视频同尺寸的 canvas 上（画面与叠加层都 `scaleX(-1)` 镜像），并算出膝/髋/肘三个关节角与关键点平均可见度。**画面不出本机，无上传。**

准备资产（一次性，产物不入库）：
```bash
cd UI
npm run camera:assets
```

运行前提：`https` 或 `localhost`。用 `vite --host` 得到的局域网 http 地址里 `navigator.mediaDevices` 不存在，会走 "unsupported" 分支并退回演示模式。

### 尚未接入：识别 → 计数联动
现在计数仍由 `demoCameraService.ts` 的预设时间线推进，页面提示语已明说"两者尚未联动"。要做真计数还需要：

1. 以关节角序列写状态机（如坐站：膝角 >160° 视为站立、<100° 视为坐下，一次 down→up 记 1 次；需带迟滞与最短间隔，避免抖动重复计数）
2. 用 `visibility` 做门控：关键点不可见或人半身出镜时暂停计数（对应产品要求"不输出姿势安全结论"）
3. 用真实的开始/结束时间替换 `tick()` 里的事件回放，保留已经测过的暂停补偿与组数逻辑
4. 在真机上按人群调阈值（小幅动作最容易误计数）

### 后端API集成
`src/services/` 目前只有 `demoCameraService.ts` 一个纯本地演示模块，**没有 API 层、没有请求客户端、没有错误与加载态处理**。要连接真实API：

1. 创建API客户端（axios/fetch）
2. 更新服务实现
3. 保持相同的返回类型
4. 添加错误处理和加载状态

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
- 优先使用CSS变量（`var(--color-teal)`）
- 组件内使用scoped样式
- 复用tokens.css中的设计令牌
- 渐变效果使用gradients.css中的类
- ⚠️ 同一个元素别既挂全局动画工具类（`.animate-*`、`.gradient-animated`）又在 scoped 里写 `animation`/`background` 简写：两者都是简写属性，`gradients.css` 在 `animations.css` 之后加载会整条覆盖，`background` 简写还会把 `background-size` 重置回 `auto`。要多段动画就在同一处用逗号并列（见 `DashboardView` 的 `.hero`）

## 🧪 测试建议

### 手动测试清单

> 以下清单**尚未系统执行过**。其中"运动员模式完整流程""模式切换保留数据""手动记录降级可用"三项依赖尚不存在的功能，当前无法通过。

- [ ] 大众模式完整流程
- [ ] 运动员模式完整流程
- [ ] 模式切换保留数据
- [ ] 摄像头演示运行流畅
- [ ] 手动记录降级可用
- [ ] 缺失RPE显示正确
- [ ] 缺失餐次显示正确
- [ ] 响应式在所有断点工作
- [ ] 键盘导航完整
- [ ] 深色模式文字可读（如果添加）

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

**注意**: 这是一个演示前端。7 个页面中有 4 个有实际界面（Onboarding / Dashboard / Plan / Execution），其余 3 个（Meals / Report / Settings）是占位页。摄像头识别为端侧实时、但尚未与计数联动。档案、模式、训练与反馈存在 localStorage，界面上的进度/餐食等数字仍是硬编码演示值。
