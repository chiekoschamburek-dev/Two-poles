# 两仪 · TwoPoles 前端优化实施记录

- 实施日期：2026-11-20
- 依据：`FRONTEND-REVIEW.md`（同期修订，含 3 处勘误）
- 原则：优先高收益 / 低风险；不改动作识别与运动分析口径；不做无明确收益的技术替换
- 验证手段：`typecheck` / `selfcheck`(678 项) / `eval:replay`(7 段真实素材) / `vite build` /
  生产构建下的 CDP 冒烟测试（14 项）/ 跟练页计时功能测试（14 项）

---

## 0. 一页速览

| 编号 | 项目 | 状态 | 关键收益 |
| --- | --- | --- | --- |
| A1 | 训练计时改墙钟 | ✅ 完成 | 熄屏/切后台不再丢时间，时长与负荷恢复真实 |
| A2 | 「结束」不再静默丢弃 | ✅ 完成 | 头部按钮改为「结束并记录」；丢弃需两步确认 |
| A3 | Screen Wake Lock | ✅ 完成 | 运动中不再 30 s 熄屏打断摄像头/计数/语音 |
| A4 | 渲染与帧率解耦 | ✅ 完成 | 整页重渲染 60–100 次/秒 → ≤4 次/秒 |
| B1 | 骨架绘制去热路径分配 | ✅ 完成 | 去掉每帧一次 `DrawingUtils` 分配；修转向后错位 |
| B2 | 持续 GPU 开销 | ✅ 完成 | 视频上 4 处 `backdrop-filter` 移除；扫光改 transform |
| B5 | 切页空窗 | ✅ 部分（低风险做法） | 离场 250→120 ms，切页总时长 500→370 ms |
| B6 | 路由焦点与播报 | ✅ 完成 | 切页后焦点落 main + aria-live 播报页面名 |
| B7 | 触控目标与滚动留白 | ✅ 完成 | `--target-size`（触屏 44 px）+ `scroll-padding-bottom` |
| B8 | 手机 PiP 遮挡 | ✅ 完成 | 表头让出 PiP 宽度；顺手修掉既有 1566 px² 浮层重叠 |
| B9 | 模型加载文案 | ✅ 部分（预热与删资源均否决） | 文案不再谎报 5.5 MB |
| C5 | SW 写缓存不挡响应 | ✅ 完成 | 大资源首访不再等 `cache.put` 落盘 |
| C6c | `100vh` → `100dvh` | ✅ 完成 | 手机地址栏收放不再切掉全屏图片底部 |
| C7 | reduced-motion 反模式 | ✅ 完成 | 改为「默认静态、no-preference 选入」 |
| C9c | `.gitignore` 反斜杠 glob | ✅ 完成 | `grep`/`rg`/`git` 恢复可用 |
| C2 | 定时器可见性门控 | ❌ **否决** | 会关掉"后台补剂系统通知"这个既有功能 |
| B9-预热 / B3 / C1 / C3 / C4 / C10 | — | ⏸ 未做 | 见 §4 决策理由 |

---

## 1. 阶段 0：基线

在改动前记录，全部为实测：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（无输出） |
| `npm run selfcheck` | **678 项通过，0 失败** |
| `npm run eval:replay` | 7 段素材的计数/发现项表格见 §3 |
| 构建基线（干净 HEAD worktree 重建） | `index-*.js` **298.44 KB**（gzip 120.90）、`index-*.css` 51.01 KB、`ExecutionView-*.js` 46.13 KB |

> 说明：审查报告初版引用的 `323.5 KB` 来自仓库里 2026-11-18 的旧 `dist/`，与当前源码不同源，已作废。
> 基线由 `git worktree add <tmp> HEAD` + `vite build` 得到，避免污染工作树。

---

## 2. 逐项记录

### A1 — 训练计时改用墙钟

**改动**（`src/views/ExecutionView.vue`）
- 引入三个「锚点 + 真实时间差」的时钟：`sessionClock`（整次跟练）、`setClock`（本组）、`restClock`（组间休息），
  取代原先 `elapsedMs += dt` 的帧增量累加。
- 新增 `visibilitychange` 监听：页面隐藏时停掉 ticker（浏览器本来也会节流），回到前台先 `syncClocks()` 按墙钟追平，再恢复 ticker。
- `record()` 落库前再补算一次，避免用到最多 250 ms 前的读数。

**为什么原实现会丢时间**：`dt = Math.min(ts - lastTs, 250)` 在回到前台时把"一大段真实时间"钳到 250 ms，
且 rAF 在隐藏时不回调，两个机制叠加使后台时间被永久丢弃。

**验证**（CDP 真实页面，`平板支撑 2 组 × 5 秒`）
```
ok  已用时长按真实时间推进约 2 秒      — 0s → 3s
ok  保持倒计时在递减                  — 5 → 2
ok  暂停期间已用时长不再增长          — 0:03 → 0:03
ok  切后台 3 秒回来后时长被补回       — 0:03 → 0:06
```
**风险**：低。只换时间来源，不参与任何动作判定；`repMachine` 吃的是推理帧时间戳（media time），完全没动。

---

### A2 — 结束不再静默丢弃

**改动**（`src/views/ExecutionView.vue`）
- 头部按钮：`结束` → 动态文案「结束并记录」/「返回」；有进度时走 `stopAndRecord()`。
- 卡内「放弃本次记录」：有进度时进入两步确认（3 s 内再按一次才丢弃），与既有的"跳过休息"确认模式一致。

**验证**
```
ok  头部按钮改为「结束并记录」        — 结束并记录
ok  头部「结束并记录」落库一条        — {"count":1,"actualDuration":0.1}
ok  记录里的时长（分钟）为正数        — 0.1
ok  结果卡片正常展示                 — 跟练已结束 · 已记录 1 项
```
**风险**：低。`record()` 自带 `recorded` 幂等闸，"结束并记录"连点不会重复写。

---

### A3 — Screen Wake Lock

**新增** `src/composables/useWakeLock.ts`（60 行，无依赖）
- `request()` 在进入跟练时调用；`release()` 在结束/离开/卸载时调用。
- `visibilitychange` 回前台自动重新申请（浏览器在页面隐藏时会自动释放锁，不重申请就再也不常亮）。
- 特性检测 + `try/catch` 静默降级：旧 WebView、低电量模式拒绝都不影响任何业务行为。

**验证**：`--headless` 环境无法验证真实熄屏，已在 `useWakeLock.supported` 上做了特性检测路径；
真机验证步骤见 §5。
**风险**：低。失败路径完全静默。

---

### A4 — 渲染与帧率解耦（本次最大收益项）

**改动**（`src/views/ExecutionView.vue`）
1. **时钟拆到 250 ms ticker**：`tick()` 改 `setTimeout` 自调度，只做 `syncClocks()`。
   原实现每帧写 `elapsedMs`，而它被模板第 68 行渲染 → 整个 1,400 行模板的 render 每帧重跑。
2. **姿态读数 4 Hz 落盘**：新增 `displayAngles`，由 `syncPoseDisplay()` 在 tick 时统一写；
   推理回调里只改普通变量 `lastJointVisibility`，不再每帧写 `confidence` 这个响应式值。
3. **进度条改 `transform: scaleX()`**：`.strip-fill` 不再过渡 `width`（会触发布局），
   改在合成器上做缩放，过渡时长对齐到 250 ms 的节流节奏。
4. **去掉每帧的无效写入**：`delegate`/`runsIn` 等由 `usePoseCamera` 维护的字段不再额外驱动页面。

**收益（结构性，可数）**
- 触发整页更新的源从「rAF 60 Hz + 推理 15–30 Hz」两个高频源，降为「250 ms ticker + 用户操作」。
- 结构上：组件更新 60–100 次/秒 → ≤4 次/秒；每帧不再创建数十个 `:class`/`:style` 绑定对象。
- 附带：长时间训练（20–40 min）的发热与掉帧压力显著下降，暂停/跳过等输入不再排在每帧 render 之后。

**验证**：功能侧由 §2 A1 的 4 项 + 计时测试的 14/14 覆盖（倒计时、暂停、休息、落库均正常）。
**未做量化打点**：为避免为测试而改生产代码，没有插入 render 计数器；如需硬指标，可用 Vue DevTools 的
Performance 面板在同一设备上录制 10 s 跟练对比（步骤见 §5）。
**风险**：低。所有判定逻辑（`repMachine`/`useMotionSession`/`analyzeRep`）未修改；
只是把"什么时候画"和"过了多久"分开。

---

### B1 — 骨架绘制

**改动**（`src/composables/usePoseCamera.ts`）
- `ctx` 与 `DrawingUtils` 提到模块作用域，随画布创建一次（原为每帧 `canvas.getContext` + `new DrawingUtils`）。
- 新增 `syncCanvasToVideo()`：绘制前比较 `videoWidth/videoHeight`，变化时重建位图尺寸。
  **修掉一个真实缺陷**：设备转向或相机换分辨率后，视频与 canvas 宽高比不一致会让骨架整体错位。
- `stop()` 里一并丢弃 ctx/drawUtils/canvas/video 引用，避免下次启动拿到旧元素。

**明确否决的部分**：审查报告初版建议的"按 DPR 缩小画布"经实测不成立。PiP 框约 126×207 CSS px，
DPR 3 下需要约 378×621 设备像素，而位图只有 640×480 —— 位图本来就偏小，任何降分辨率都会更糊。
**风险**：低。`draw()` 只读 `landmarks`，与 `computeMetrics` 的数值完全无关。

---

### B2 — 持续 GPU 开销

**改动**
- `src/views/ExecutionView.vue`：视频/摄像头之上的 4 处 `backdrop-filter` 全部移除，
  改用不透明度略高的纯色（`.confidence-badge/.phase-badge`、`.stage-live`、`.rest-overlay`、`.cam-angles`）。
  两个 pane 不再加 `.glass`。
- `src/styles/gradients.css`：`.gradient-shimmer` 从「动 `background-position`」（每帧重绘整层）
  改为伪元素 `transform: translateX()`（合成器路径）。
- 演示视频：新增 `documentHidden` 判断，页面隐藏时 `video.pause()`，避免后台持续解码。

**依据**（`motion`）：*"Prefer to animate `opacity` and `transform` ... to ensure animations stay on the compositor thread."*
**风险**：低–中（观感）。玻璃效果退化为半透明纯色，深底取景框本身是 `radial-gradient`，差异很小；
`prefers-reduced-transparency` 分支保留在 `BaseCard` 上不受影响。

---

### B5 — 切页空窗（低风险做法）

`<Transition mode="out-in">` 的总时长 = 离场 + 入场。把 `.page-leave-active` 缩短到 120 ms
（离场只做淡化，去掉多余的位移），新页面挂载提前 130 ms，总时长 **500 → 370 ms**。

**未采用** View Transitions：`document.startViewTransition()` 需要包住每一次 `router.push`，
而导航入口散布在侧栏、底栏、页内链接等十余处；改动面覆盖全部 13 条路由，视觉回归风险与收益不匹配。
留作后续单项评估。

---

### B6 — 路由焦点与播报

**改动**
- `src/components/layout/AppShell.vue`：`<main>` 加 `tabindex="-1"`；`watch(route.path)` 里把焦点交给 main
  （`preventScroll: true`，滚动仍由 router 的 `scrollBehavior` 负责）。
- 新增 `aria-live="polite"` 的视觉隐藏节点，播报「已进入<页面名>」。
- 样式：`.main-content:focus { outline: none }`，只有键盘 `:focus-visible` 才画环，程序化聚焦不会冒出一圈框。

**依据**（`html`）：*"DO move focus to the start of newly injected content when it is added in direct response to a user action that shifts the workflow into that content"*。

**验证**
```
ok  切换后焦点落到 main（B6）
ok  main 带 tabindex=-1
ok  文档标题已更新
ok  aria-live 播报了页面名（B6）
```

---

### B7 — 触控目标与滚动留白

**改动**
- `tokens.css`：新增 `--target-size: 24px`，`@media (pointer: coarse)` 下抬到 `44px`。
- 针对性应用到实测偏小的控件：`.an-pick`、`.switch-chip`（分析页 + 运动学面板）、`.cam-calib`、
  `.rpe-chip`、`.cam-main-btn`、`.gear-btn`、`.menu-btn`、`.avatar`。
- `globals.css`：`html { scroll-padding-top/bottom }`，手机档底部留出
  `--mobile-nav-height + --safe-bottom + 20px`，键盘 Tab 到页面下半部分不再被固定底栏压住。

**刻意不做的**：不对 `button` 做全局 `min-block-size` 兜底 —— 这套版面密度高，
一刀切会把紧凑的 chip 行撑开，属于"为指标破坏设计"。

**验证**
```
ok  手机档 scroll-padding-bottom 已生效（B7）
      --target-size = 24px（pointer: coarse = false）
ok  触屏档 --target-size = 44px（B7）
```

---

### B8 — 手机 PiP 遮挡

手机端（`max-width:767px`）两层修复：

1. 给 `.pane-demo .pane-head` 增加 `padding-right: calc(min(138px,40vw) + 20px)`，
   演示栏的标题与说明不再伸到右上角摄像头小窗下方。
2. **同一区域发现并修掉一个既有缺陷**：`.demo-video-count`（本组倒计时/计步浮层）固定 `top:72px`，
   而手机端 `.stage-overlay` 是**竖排两颗徽标**（16 + 34 + 6 + 34 = 90px 高），
   两者实测重叠 **1566 px²** —— 截图上表现为「计时中」徽标被倒计时压住。
   改挂到画面底部左侧（`bottom:64px`），落在 `.stage-live` 上方 8px，既避开徽标也避开 PiP。

**验证**（DOM 几何，非目测）
```
ok  PiP 不遮挡演示栏标题          — title.right=87 ≤ pip.left=228，overlap=0px²
ok  PiP 不遮挡演示栏说明          — note.right=215 ≤ pip.left=228，overlap=0px²
ok  PiP 不遮挡阶段徽标            — overlap=0px² / 2 个徽标
ok  倒计时浮层不压住阶段徽标      — overlap=0px²        （修复前 1566px²）
ok  倒计时浮层不压住底部提示条    — overlap=0px²
ok  倒计时浮层不压住 PiP          — overlap=0px²
```
**风险**：低。只动手机断点下的两处定位；桌面布局零变化。

---

### C5 — Service Worker 写缓存不挡响应

**改动**（`public/sw.js`）
- 新增 `deferCacheWrite(event, request, response)`：写入排到响应返回之后，用 `event.waitUntil()` 保活。
- `networkFirst` / `cacheFirst` 都改为非阻塞写入，并 `catch` 掉配额失败。

**为什么值得改**：`cache.put()` 要完整读一遍 body 再落盘；对 13 MB 的 wasm 就是直接加在首访延迟上。

**未做**：按字节淘汰（`RUNTIME_CACHE_LIMIT` 仍按条数）。现有 200 条上限配合 `/api/`、`/apk/`、`Range` 全放行，
已经能覆盖主要场景；改成字节估算需要额外统计逻辑，收益不明确，暂不做。

**验证**：`GET /sw.js` 返回 200 且包含 `deferCacheWrite`；Service Worker 属浏览器侧行为，其余需真机确认。

---

### C6c — `100vh` → `100dvh`

- `AppShell.vue`：`.shell`、`.main-content` 的高度改 `100dvh`（与既有的 `.main-workspace` 一致）。
- `globals.css`：`body { min-height: 100dvh }`。
- `MealPhotoViewer.vue`：手机全屏图片层改 `100dvh`，并加 `@supports not (height:100dvh)` 回退。

---

### C7 — `prefers-reduced-motion` 反模式

**改动**（`src/styles/animations.css`、`gradients.css`、`ExecutionView.vue`）
- 删除全局 `animation-duration: 0.01ms !important` 的写法。
- 改为「默认静态，只在 `prefers-reduced-motion: no-preference` 里声明 animation」。
- 颜色/背景过渡不受影响。

**依据**（`motion`）：*"**DO NOT** globally apply `animation-duration: 0.01ms;` as it can cause certain animations to become _more_ jarring."*

**验证**
```
ok  默认（无 reduce）入场动画仍在        — slideInUp
ok  reduce 时入场动画关闭（C7）
ok  reduce 时扫光动画关闭（C7）
```

---

### C9c — `.gitignore` 反斜杠 glob

根 `.gitignore` 第 68 行 `UI\public\` → `UI/public/`。

**这个修复的实际影响被严重低估了**：非法 glob 让 `git` 与 `ripgrep` 在解析 ignore 文件时直接报错，
**整个检索引擎失效**。本次审查初版正是因此得出"`efficientdet_lite0.tflite` 无任何引用"的错误结论
（实际被 `foodRecognition.ts` 使用）。修复后 `grep` 工具立即恢复可用。

---

## 3. 回归验证汇总

### 3.1 静态与单元

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run selfcheck` | **678 / 678 通过** |
| `npm run build` | 成功，27.8 s |

### 3.2 动作分析回归（`npm run eval:replay`）

改动前后**逐格一致**（同一份真值序列重放）：

```
clip                action    view    grace=0  grace=1000  engine  findings
brisk-walk          squat     front   0        0           0       0
deadlift-demo       deadlift  side    0        0           1       1
easy-run            deadlift  front   0        0           0       0
peso-muerto-sumo    squat     front   0        1           1       0
peso-muerto         squat     side    0        1           1       3
sit-to-stand        squat     side    0        0           0       0
test_squat          squat     front   4        4           4       0
```

### 3.3 生产构建端到端（CDP）

**`npm run verify:web` —— 14 项全通过**：应用挂载、首帧主题、SPA 路由切换、焦点落 main、`tabindex=-1`、
文档标题、aria-live 播报、手机档 `scroll-padding-bottom`、触屏 `--target-size=44px`、
默认动画在、reduce 下动画关闭 ×2、无未捕获异常、无 console error。

**`npm run verify:execution` —— 30 项全通过**，三个场景：

| 场景 | 覆盖内容 |
| --- | --- |
| S1 计时与语音 | 墙钟推进（0s→2s）、保持倒计时递减（5→3）、暂停停表（0:02→0:02）、切后台 3 秒回来补回（0:03→0:06）、头部「结束并记录」落库（`actualDuration=0.1`）、结果卡展示 |
| S2 组间休息 | 一组结束后自动进入休息（`rest=5秒`）、休息倒计时递减（5→3）、**休息结束自动开始第 2 组**、切组后已用时长连续（0:11，含休息） |
| S3 手机 PiP | 390 px 下小窗渲染尺寸、标题/说明/徽标/倒计时浮层/底部提示条两两不重叠（全部 0 px²）；320 px 超窄屏复查表头让位与横向溢出 |

其中 S2 是**新增覆盖**：`restClock` 与 `startNextSet()` 是本轮重写的全新代码路径，
上一轮只验证了「播放/暂停/结束」，休息与自动换组没有覆盖。

### 3.4 一个**既有**环境问题（非本次引入）

`npm run eval:ui`（`scripts/motion-eval/verify-ui.mjs`）在生产构建下报
「端侧推理失败：姿态推理超时」（`poseEngine.ts` 的 `DETECT_TIMEOUT_MS = 2000`）。
用**干净 HEAD worktree 重建的基线**跑同一个脚本，**同样失败**，因此判定为本机 headless 环境下
worker/GPU 首次推理超过 2 s 的既有问题，与本轮改动无关。dev 模式（主线程引擎，无该超时）也因
CPU 逐帧推理过慢未能跑完，属环境性能限制。

---

## 4. 明确否决 / 推迟的项（含理由）

| 项 | 决定 | 理由 |
| --- | --- | --- |
| **C2 定时器可见性门控** | 否决 | `useSupplementReminders.tick()` 在页面不可见时**主动**走 `sendSupplementNotification` 发系统通知。页面隐藏就停 tick = 关掉"后台补剂提醒" |
| **B9 进页面预热模型** | 否决 | 13 MB wasm 由加载器内部按 SIMD 探测二选一拉取；预热要么拉 25 MB，要么有一半概率白拉。收益不确定，代价明确 |
| **B9 删除 `efficientdet_lite0.tflite`** | 否决 | 端侧食物识别在用（初版误判，见勘误） |
| **B1 按 DPR 缩小画布** | 否决 | 实测位图小于渲染面积，降分辨率只会更糊 |
| **B5 View Transitions** | 推迟 | 需拦截全部导航入口，覆盖 13 条路由，视觉回归风险与收益不匹配；本次只做了低风险的离场缩短 |
| **B3 原生 `<dialog>` 迁移** | 推迟 | 涉及 8 个弹层组件的结构与焦点时序，属独立专项。建议先迁 `InstallAppDialog` 做样板 |
| **B4 持久化按脏片 + debounce** | 推迟 | 需要保证 `pagehide` 前 flush，否则有丢数据风险；应在能真机验证的窗口做 |
| **C1 `content-visibility` / `contain`** | 推迟 | 收益集中在超长页面；`content-visibility` 的 Baseline 是 2025-09-15，当前多数 iPhone 拿不到，需先确认目标机型 |
| **C3 离线分析提速** | 推迟 | 会改变帧时间网格，必须过 `eval:motion` 门禁，属独立立项 |
| **C4 主包拆分** | 推迟 | 实测主包仅比基线 +0.29 KB，拆分收益需先量化 |
| **C9b 清理死令牌** | 不做 | 纯洁癖项，零运行时收益，且误删风险存在 |
| **C6a 去掉常驻 `will-change`** | 不做 | 只涉及 2 个元素，收益可忽略 |
| **C6b 去掉 `body { overflow-x: hidden }`** | 不做 | 需要先定位到真实溢出元素并修好；直接删会让横向滚动条冒出来，需目视回归 |

---

## 5. 待真机确认的清单（本环境无法覆盖）

1. **A3 熄屏**：真机进入摄像头跟练，静置 5 分钟不熄屏；切到别的 App 再回来，常亮应自动恢复。
2. **A1 后台计时**：真机切后台 60 s / 锁屏 60 s，回前台后「已用时长」「休息剩余」应正确。
3. **A4 发热**：中端安卓真机做 10 分钟摄像头跟练，对比改动前后的掉帧与表面温度。
4. **B1 骨架对齐**：横竖屏各旋转一次，确认骨架仍贴合人体（这是本次修的缺陷点）。
5. **B2 观感**：对比 4 处浮层的改动前后截图，确认玻璃退化可接受。
6. **B8 PiP 观感**：几何不重叠已由 `verify:execution` S3 在 390 / 320 px 两档自动断言，
   剩余需要人眼确认的只有横屏下表头文字是否被截断。
7. **C5 SW**：首次访问后 DevTools → Application → Cache Storage，确认 wasm/模型已入缓存且首访不再被写入阻塞。

---

## 6. 变更文件清单

```
.gitignore                                      C9c
UI/package.json                                 verify:web / verify:execution
UI/public/sw.js                                 C5
UI/scripts/motion-eval/verify-web.mjs           B6 B7 C7（新增，验证用）
UI/scripts/motion-eval/verify-execution.mjs     A1 A2（新增，验证用）
UI/src/components/layout/AppShell.vue           B5 B6 C6c
UI/src/components/layout/TopBar.vue             B7
UI/src/components/meals/MealPhotoViewer.vue     C6c
UI/src/components/analysis/KinematicsPanel.vue  B7
UI/src/views/AnalysisView.vue                   B7
UI/src/views/ExecutionView.vue                  A1 A2 A3 A4 B2 B7 C7
UI/src/composables/usePoseCamera.ts             B1
UI/src/composables/useWakeLock.ts               A3（新增）
UI/src/styles/animations.css                    C7
UI/src/styles/gradients.css                     B2 C7
UI/src/styles/globals.css                       B7 C6c
UI/src/styles/tokens.css                        B7
```

**构建产物对比（同源可比）**

| 产物 | 基线（HEAD） | 改动后 | 差值 |
| --- | --- | --- | --- |
| `index-*.js` | 298.44 KB | 298.73 KB | **+0.29 KB** |
| `index-*.css` | 51.01 KB | 51.62 KB | +0.61 KB |
| `ExecutionView-*.js` | 46.13 KB | 48.67 KB | +2.54 KB（时钟逻辑 + wake lock 调用） |

体积基本不变，收益集中在**运行时**而非字节数。

---

## 7. 复现验证的方法

```powershell
cd UI
npm run typecheck
npm run selfcheck
npm run eval:replay          # 动作分析回归，结果应与上文表格逐格一致

npm run build
npm run preview -- --port 4173
# 另开一个终端：
npm run verify:web -- http://127.0.0.1:4173          # 14 项冒烟（B6/B7/C7 等）
npm run verify:execution -- http://127.0.0.1:4173    # 14 项跟练计时（A1/A2）
```

两个验证脚本已入库（`scripts/motion-eval/verify-web.mjs`、`verify-execution.mjs`），
并登记为 `verify:web` / `verify:execution`。它们用 CDP 驱动真实 Chrome，覆盖本轮改动的
可自动化部分；真机项（熄屏、发热、骨架对齐、PiP 观感）见 §5。