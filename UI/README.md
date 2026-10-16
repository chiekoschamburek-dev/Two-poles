# 两仪·TwoPoles - 前端UI

现代化的个性化运动与饮食协同助手前端界面

## ⚠️ 当前实现状态（请先读这一节）

本项目是**演示前端原型**，不是可用产品。实际状态如下：

| 范围 | 状态 |
|------|------|
| 页面视图 | **3 / 7 已实现**：Dashboard、Plan、Execution；Onboarding、Meals、Report、Settings 仅为两行占位页 |
| `npm run dev` / `npm run build` / `npm run typecheck` | ✅ 全部通过（构建产物 JS+CSS 约 74 KB gzipped） |
| 摄像头 | 纯脚本回放预设时间线，**未接入任何姿态识别**；两个动作（坐站 2×8、弯举 2×10）都可切换，组数会推进，暂停与后台切换不会跳计数 |
| 数据 | 界面演示数字仍为硬编码；**训练结果会写入 `localStorage`（`sessions`）**，可在跟练页汇总中看到 |
| 模式切换 | ✅ 侧边栏"当前模式"可切换大众/运动员模式，会落盘并触发 Toast |
| 后端 | 无 |

下方"核心功能"章节描述的是**设计目标**，剩余未实现项已逐项标注。

## 🎨 设计特性

- **现代渐变风格**: 使用精美的CSS渐变和玻璃态效果
- **丰富的微交互**: 流畅的动画和过渡效果
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
├── public/                  # 空目录（当前无静态资源，index.html 也未引用 favicon）
├── src/
│   ├── components/
│   │   ├── common/          # BaseButton / BaseCard / MetricCard / StatusBadge / ToastRegion
│   │   └── layout/          # AppShell / TopBar / SidebarNav / MobileNav
│   ├── views/               # Dashboard / Plan / Execution 已实现；Onboarding / Meals / Report / Settings 为占位
│   ├── stores/              # app.ts（mode、profile、sessions、toast）
│   ├── services/            # demoCameraService.ts（按组的演示时间线 + summarizeSession）
│   ├── types/               # domain.ts
│   ├── utils/               # id.ts（非安全上下文兜底）、time.ts（日期/问候/日历）、animations.ts（⚠️ 7 个导出当前均无调用方）
│   ├── styles/              # tokens.css / globals.css / animations.css / gradients.css
│   ├── router/              # index.ts（7 条路由，全部懒加载）
│   ├── App.vue
│   └── main.ts
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

> 没有 `src/composables/`，也没有 `components/journey|training|meals|reports/` 目录——那些是早期交付文档设想的规划结构，未落地。

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

### 3. 摄像头演示
- ✅ **演示模式**: `requestAnimationFrame` 增量回放预设计数事件
- ✅ 两个动作都有入口（页内 chip 与 `?exercise=` 查询参数）：坐站 2×8、弯举 2×10
- ✅ 组数会推进，组间 6 秒休息倒计时，进度条按 组数 + 本组次数 计算
- ✅ **暂停与后台安全**: 累计时间增量而非墙钟，单帧增量钳制在 250ms，恢复或切回标签页不会跳计数
- ✅ 跳过本组、结束并记录、手动修正（计入 `manualCorrections`）均可用
- ✅ 结果经 `summarizeSession()` 写入 `store.sessions` 并持久化；汇总卡显示组数/次数/平均置信度/修正次数/完成状态
- ✅ 实时置信度指示器（初始值为 0，进入页面会先显示"识别较差"）
- ⚠️ 骨架图是按阶段位移的 SVG 示意，不是真实关键点渲染
- ❌ 手动记录降级表单（"放弃本次记录"直接返回概览，不产生记录）
- ✅ 隐私优先的本地处理说明文案

### 4. 饮食记录
- ❌ **MealsView 是两行占位页**，餐次时间线、食物类别确认、结构分析、"未记录"语义、训练日时间线全部未实现
- ⚠️ 仅 Dashboard 上有一张静态"已记录 2 餐"卡片

### 5. 数据完整性
- ⚠️ `TrainingSession`（含 `rpe: number | null`）、`PlanItem`、`AlternativeExercise` 已被计划页与跟练页消费；`Meal`、`WeeklyReport`、`PrivacySettings`、`CameraSession` 仍只是类型定义
- ✅ 跟练结果在未记录 RPE 时存 `null`（不是 0），部分/全部完成用 `completionStatus` 区分
- ✅ 计划页休息日明确写"没有安排"，不等于"没有活动"
- ❌ 周报/图表不存在（ReportView 是占位页），"数据质量说明"未落地

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
- Slow (400ms): 数字滚动、图表动画
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

## 🔄 未来集成

### MediaPipe集成路径
当前使用演示数据。要集成真实的姿态识别：

1. 安装MediaPipe Tasks Vision
```bash
npm install @mediapipe/tasks-vision
```

2. 新建 `src/composables/usePoseAdapter.ts`（**该文件目前不存在**，现在只有 `services/demoCameraService.ts` 里的写死时间线）
3. 定义并保持一致的帧/事件接口（`types/domain.ts` 里的 `PoseFrame`、`DemoEvent` 可作为起点）
4. 替换 `ExecutionView.vue` 中的 `getDemoEvents()` 调用与 `tick()` 循环
5. UI 结构基本无需大改，但计数、组数、暂停补偿逻辑要在真实现里重写

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
- ⚠️ `updateProfile()` 仍没有调用方（Onboarding 页是占位），因此 `profile` 除了昵称等字段外基本为空
- ✅ ID 生成走 `utils/id.ts` 的 `newId()`，在没有 `crypto.randomUUID` 的非安全上下文（http + 局域网 IP）会退回时间戳+随机数
- 展示用的训练/饮食数字仍是视图内的硬编码常量，只有跟练结果进入 store

### 样式约定
- 优先使用CSS变量（`var(--color-teal)`）
- 组件内使用scoped样式
- 复用tokens.css中的设计令牌
- 渐变效果使用gradients.css中的类

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

**注意**: 这是一个演示前端。7 个页面中只有 3 个（Dashboard / Plan / Execution）有实际界面，其余 4 个是占位页。摄像头功能为脚本回放，未集成真实的 MediaPipe。模式与跟练结果会写入 localStorage，但界面上的进度/餐食等数字仍是硬编码演示值。项目当前**不在 git 版本控制下**。
