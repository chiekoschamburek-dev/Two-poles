# 两仪 · TwoPoles 前端审查报告

- 审查日期：2026-11-20（实施后修订：2026-11-20 晚）
- 审查对象：`UI/`（Vue 3.4 + Vite 5 + Pinia + vue-router 4 + Capacitor 8，`src/` 共 30,406 行 / 125 个文件：49 `.vue` + 72 `.ts` + 4 `.css`）
- 审查范围：性能、现代 Web API、交互体验、响应式（移动端优先）、工程质量
- 审查方式：全量读码 + 构建产物与资源实测 + `modern-web-guidance` 指南检索（7 份）
- **本次不修改任何代码**，只产出问题清单、依据、收益与实施计划

> 前置约束（贯穿全文）：不得改变动作识别与运动分析口径。所有涉及
> `composables/poseMath.ts`、`composables/repMachine.ts`、`composables/useRepCounter.ts`、
> `services/motionAnalysis.ts`、`services/motionRules.ts`、`services/motionKinematics.ts`
> 数值路径的建议，一律标注「需 eval 门禁」。

> **实施后勘误（2026-11-20）**：本报告初版有 3 处结论在实施阶段被实测推翻，已在正文对应位置更正，
> 并记录在 `FRONTEND-OPTIMIZATION-LOG.md`：
> 1. B9 称 `efficientdet_lite0.tflite` 「无任何引用」**是错的** —— 它被 `services/foodRecognition.ts:200`
>    用于端侧食物识别，不可删除。初版之所以误判，是因为当时根 `.gitignore` 第 68 行的反斜杠 glob
>    让 `grep`/`rg` 直接报错退出（见 C9c），检索引擎整体失效。
> 2. 初版「手机 PiP 用 138px 的框画 640×480 位图 ≈ 20 倍多余填充」**是错的** —— PiP 框约 126×207 CSS px，
>    在 DPR 3 下需要约 378×621 设备像素，而位图只有 640×480，实际是**轻微上采样**，不存在像素浪费。
>    该项真实收益只剩「每帧 `new DrawingUtils`」与「分辨率变化后位图不重同步」。
> 3. 初版构建尺寸（`index-*.js` 323.5 KB）取自仓库里 2026-11-18 的旧 `dist/`，与当前源码不同源。
>    用干净 HEAD worktree 重建后，真实基线是 **298.44 KB**。

---

## 1. 一句话结论

这个项目的实时链路（摄像头 → 端侧推理 → 关键点 → 关节角 → 状态机 → 语音/UI）在**数据正确性与线程架构上是成熟度很高**的：worker 推理 + `ImageBitmap` 零拷贝转移、`requestVideoFrameCallback` 取帧、media time 做单调时间戳、GPU→CPU 二次降级、以及代码分割（mediapipe 独立 148 KB chunk）都做对了。

它的主要矛盾只有一句话：**把「每帧要更新的东西」和「每秒要更新的东西」放在了同一条 Vue 响应式链路上**。由此派生出本次审查里 80% 的性能问题。其余问题集中在三处：移动端「运动中用手机」这一核心场景缺了几块原生能力（Wake Lock、墙钟计时、触控目标、焦点管理），以及 8 处手写模态框重复实现了一套不完整的可访问性逻辑。

---

## 2. 技术画像（审查基线）

| 维度 | 现状 |
| --- | --- |
| 路由 | 13 条，全部 `() => import()` 懒加载；`/`、`/movement`、`/nutrition` 复用 `TwoPolesView` |
| 状态 | 单 Pinia store（`stores/app.ts` 1,455 行），按域分区；本地持久化走 `services/storage.ts` 的 11 个 localStorage key |
| 实时链路 | `usePoseCamera`（rVFC 取帧 + 绘制）→ `poseInference.worker`（MediaPipe GPU/CPU）→ `useMotionSession` → `useRepCounter`（状态机） |
| 离线链路 | `useVideoAnalysis`（逐帧 `seek` + `createImageBitmap` + 同款引擎）→ `motionAnalysis` → `motionRules` / `motionKinematics` |
| 视觉 | 手写 CSS 令牌（`tokens.css` 290 行）+ scoped CSS；无 UI 框架、无 CSS 框架、无图表库（SVG 手绘曲线） |
| 构建 | `vue-tsc` + `vite build`；入口 `index-*.js` **298.44 KB**（raw，干净 HEAD 重建的基线），`vision_bundle` 152.2 KB，`poseInference.worker` 144.7 KB |
| 部署形态 | Web（PWA + SW）+ Capacitor Android APK |

### 已经做对、**不要动**的部分

避免后续优化时误伤，先明确保留项：

1. **推理在 worker，且 `postMessage(..., [bitmap])` 转移所有权**（`poseEngine.ts:67`）——没有结构化克隆拷贝。
2. **`requestVideoFrameCallback` 优先、rAF 回落**（`usePoseCamera.ts:81-92`），并用 `metadata.mediaTime` 而不是墙钟做时间戳（`poseMath.ts:151-157`），后台/掉帧不会污染帧间隔。
3. **帧级背压**：`busy` 标志 + `schedule()` 在函数开头就排下一帧（`onFrame:99-133`），推理慢时自动丢帧而不是堆积。
4. **GPU 失败二次降级**（`poseLandmarkerFactory.ts:35-52` + `poseInference.worker.ts:59-66`），且 delegate 如实上报到 UI，不谎报。
5. **首帧主题无闪烁**：`index.html:18-28` 在 `<head>` 内同步落 `data-theme`。
6. **代码分割**：mediapipe 独立 chunk，只在进跟练/分析时才下载。
7. **SW 策略设计正确**：导航 network-first、静态 cache-first、`/api/*`、`/apk/*`、带 `Range` 的请求全部放行（`public/sw.js:30-46`）。
8. **`prefers-reduced-transparency`**、`inert`（`TwoPolesView.vue:43,59`）、`focus-visible` 全局环（259 处 `aria-*` / 100 处 `role=`）——可访问性底子比一般项目好。

---

## 3. 问题清单总表

优先级定义：**P0 = 正确性或核心场景硬伤**；**P1 = 明显收益、低风险**；**P2 = 值得做但可延后**。

| ID | 优先级 | 问题 | 位置 | 一句话收益 |
| --- | --- | --- | --- | --- |
| A1 | P0 | 训练计时用「帧钟」累加，切后台/熄屏时倒计时与时长冻结 | `src/views/ExecutionView.vue#L776-L825` | 时长、休息、负荷不再失真 |
| A2 | P0 | 顶部「结束」无确认直接丢弃本次记录 | `src/views/ExecutionView.vue#L13`、`#L1078-L1084` | 消除静默数据丢失 |
| A3 | P0 | 运动中无 Screen Wake Lock，30s 自动熄屏即中断摄像头与计数 | 全局（`wakeLock` 出现 0 次） | 实时跟练不再被打断 |
| A4 | P0 | 跟练页每帧驱动整页重渲染（结构上 60–100 次/秒） | `src/views/ExecutionView.vue#L784` + `#L743-L767` | 主线程每帧余量、耗电、INP |
| B1 | P1 | 骨架绘制每帧 `new DrawingUtils` + 画布分辨率与显示尺寸脱钩 | `src/composables/usePoseCamera.ts#L53-L72`、`#L287-L288` | 叠加层绘制量降一个数量级 |
| B2 | P1 | 无限 `background-position` 扫光 + 4 层 `backdrop-filter` 叠在播放中的视频上 | `src/styles/gradients.css`、`src/views/ExecutionView.vue#L148`、`#L1164`、`src/components/common/BaseCard.vue#L67-L71` | 去掉最贵的持续 GPU 开销 |
| B3 | P1 | 8 处手写 `div role="dialog"`：无焦点捕获、无初始/归还焦点、背景不 `inert` | 见 §5.3 | 可访问性正确性 + 少一份自研逻辑 |
| B4 | P1 | 每次状态变更同步序列化**全量**状态并写 11 个 localStorage key | `src/stores/app.ts#L162-L194`、`src/services/storage.ts#L205-L230` | 输入响应延迟，避免配额抖动 |
| B5 | P1 | 路由切换 `mode="out-in"`：新页面在 250 ms 后才挂载，总共 500 ms | `src/components/layout/AppShell.vue#L9-L13`、`#L112-L114` | 切页感知延迟减半 |
| B6 | P1 | 路由切换无焦点管理、无页面播报 | `src/main.ts#L41-L46` | SPA 键盘/读屏用户不丢上下文 |
| B7 | P1 | 移动端触控目标普遍 < 44 px；固定底栏无 `scroll-padding-bottom` | 见 §5.5 | 运动后抖动的手也能点准 |
| B8 | P1 | 手机 PiP 摄像头框压住演示画面的徽标区，且隐藏了机位校准入口 | `src/views/ExecutionView.vue#L1247-L1261` | 手机端不再遮挡关键反馈 |
| B9 | P1 | 姿态模型资源（13 MB wasm + 5.6 MB 模型）无预热；加载文案与实际体积不符 | `src/composables/poseLandmarkerFactory.ts#L8-L11`、`public/mediapipe/` | 首次开摄像头等待时间、部署体积 |
| C1 | P2 | 缺 `content-visibility` / `contain`，长页面（周报、饮食、分析历史）整页参与排版 | 全局（两者出现 0 次） | 长页首次渲染与交互 INP |
| C2 | P2 | 两个 15 s 全局定时器 + 1 s 视图时钟，无可见性门控 | `src/composables/useDietFeedback.ts#L324`、`src/composables/useSupplementReminders.ts#L610`、`src/views/SupplementsView.vue#L241` | 后台唤醒次数、电量 |
| C3 | P2 | 离线分析逐帧 `seek`（60 s × 15 fps = 900 次解码往返） | `src/composables/useVideoAnalysis.ts#L282-L311`、`#L182-L221` | 分析等待时间，**需 eval 门禁** |
| C4 | P2 | 首屏主包 323 KB 里含只有弹层才需要的组件 | `src/components/layout/AppShell.vue#L16-L18` | 首屏字节数 |
| C5 | P2 | SW 的 `cacheFirst` 在返回响应**前** `await` 写缓存；缓存上限按条目数不按字节 | `public/sw.js#L63-L85` | 首访大资源延迟、存储上限 |
| C6 | P2 | `will-change` 常驻；`body { overflow-x: hidden }`；`100vh` 与 `100dvh` 混用 | 见 §5.6 | 滚动/内存/移动端高度跳变 |
| C7 | P2 | `prefers-reduced-motion` 用全局 `animation-duration: 0.01ms !important` | `src/styles/animations.css#L93-L110` | 修正反模式，个别动画不再更刺眼 |
| C8 | P2 | 全站 `<img>` 无 `width`/`height`；演示视频无 `poster` | 见 §5.6 | 关键帧图与头像的 CLS |
| C9 | P2 | 18 处 `transition: all`；`--breakpoint-*` 等 5 组令牌 0 引用；根 `.gitignore` 第 68 行反斜杠 glob | 见 §5.7 | 可维护性、工具链可用性 |
| C10 | P2 | 全站 0 处容器查询，组件尺寸全按视口断点 | 全局（`@container` 0 次） | 侧栏收起/展开时组件自适应 |

---

## 4. P0 详解（先做这 4 项）

### A1 — 训练计时用「帧钟」，切后台/熄屏就冻结

**证据**

```ts
// src/views/ExecutionView.vue:776-825
function tick(ts: number) {
  rafId = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  const dt = Math.min(ts - lastTs, 250)   // ← 上限 250 ms
  lastTs = ts
  if (!paused.value && status.value === 'playing') {
    elapsedMs.value += dt                // ← 用帧增量求和得到「已用时长」
```

`elapsedMs` 同时是：界面「已用时长」（`durationLabel`，`#L655-L658`）、举铁类进度条（`setProgress`，`#L624-L628`）、以及**写入记录的训练时长**（`record()` → `summarizeSession({ elapsedMs })`，`#L906-L927`）。

**机制与后果**

- 标签页不可见时 rAF 停止回调，`elapsedMs` 不再增长；
- 回到前台时 `dt` 被钳到 250 ms，因此**丢失的全部后台时间不会被补回**；
- 读者场景：组间休息 90 s，用户切到微信看一眼，回来发现「休息还剩 88 秒」——休息实际已经结束，组间休息页卡住；
- 更严重的是记录侧：一次 25 分钟的训练若中途切走过几次，`durationMs` 会系统性偏小，而**训练负荷 = 时长 × RPE**（`CONTEXT.md:9`），周报口径因此失真。这不是分析算法问题，是**采集端数据问题**，修它不触碰任何识别逻辑。

**建议**

1. 计时基准从「累加帧增量」改为「墙钟差值」：进入 `playing`/`resting` 时记 `performance.now()` 基线，tick 里只做 `elapsedMs = now - baseMs - pausedAccumMs`。
2. 监听 `visibilitychange`：回到 `visible` 时立刻重算一次并同步 UI（顺便修好 A4 的「回来就刷新」）。
3. 休息倒计时改用同一套墙钟，`restLeft` 由时间差推导，而不是逐帧自减。

**依据**：这是「帧钟 vs 墙钟」的经典错误。时间语义必须来自 `Date.now()` / `performance.now()`；rAF 只用于「什么时候画」，不能用于「过了多久」。同类结论也适用于 `monotonic` 时间戳——项目在 `poseMath.ts` 里已经正确用了 media time 做**帧时间戳**，但把同样的「增量求和」思路误用到了**用户感知的时长**上。

**收益**：修复一类静默数据错误（影响周报/月报/长周期趋势的时长与负荷），并让组间休息在真实时间里推进。
**风险**：低。只换时钟来源，不涉及计数与判定。
**验证**：真机切后台 60 s 再回来，检查「已用时长」跳 +60、「休息剩余」正确；`eval:replay` 不涉及此处。

---

### A2 — 顶部「结束」无确认丢弃记录

**证据**

```html
<!-- ExecutionView.vue:13 -->
<BaseButton variant="secondary" :icon="X" @click="leave">结束</BaseButton>

<!-- ExecutionView.vue:238 —— 同一个 handler，但文案是「放弃本次记录」 -->
<BaseButton variant="ghost" size="sm" :icon="FileText" @click="leave">放弃本次记录</BaseButton>
```

```ts
// ExecutionView.vue:1078-1084 —— 没有 record()，也没有确认
function leave() {
  cancelAnimationFrame(rafId)
  status.value = 'idle'
  stopSpeech()
  stopCamera()
  router.push('/')
}
```

**机制与后果**：页面头部右上角的 `X` + 「结束」是移动端最容易被误触的位置（也是用户理解成「练完了，帮我存下来」的语义位置）；点下去直接丢弃本次记录，且没有任何 Toast 说明「本次记录已丢弃」。而同页存在另一个真正的「结束并记录」（`stopAndRecord`，`#L874-L878`），三个近似文案并存：结束 / 结束并记录 / 放弃本次记录。

**建议**

- 头部按钮语义改为「结束并记录」（走 `stopAndRecord`），保留卡内那颗明确的「放弃本次记录」作为唯一的丢弃入口；
- 丢弃时若 `status !== 'idle'` 或已有计数，加一次确认（可复用现有的「两步确认」模式，`onRestSkipClick`，`#L589-L599`，不必引入新弹层）；
- 丢弃后给一条 `store.showToast` 反馈，与 `record()` 的「已保存到本地记录」对称。

**依据**：破坏性操作与其撤销成本不匹配（WCAG 3.3.4 精神 + 产品内已有一致的两步确认先例）。
**收益**：消除最高频的静默数据丢失路径。
**风险**：低。需注意别让「结束并记录」在 `status==='idle'` 时重复写记录（`record()` 已有 `recorded` 幂等闸，`#L907`）。

---

### A3 — 运动中缺 Screen Wake Lock

**证据**：全仓 `wakeLock` 出现 **0 次**；`screen.orientation` 0 次。

**机制与后果**：iOS 默认 30 s、Android 依厂商设置熄屏。做一组 45 s 的平板支撑或一组 12 次深蹲时，屏幕锁掉会同时导致：rAF 停（A1 的时长冻结）、摄像头页面进入后台（部分浏览器会挂起 `getUserMedia`）、语音播报中断。用户必须频繁点亮屏幕——这在一个「正在运动、双手不便」的场景里是核心体验缺陷。

**建议**：进入摄像头跟练时 `navigator.wakeLock.request('screen')`，退出/暂停/页面隐藏时 `release()`；`visibilitychange` 回前台时重新申请（锁在页面隐藏时会被浏览器自动释放）。

**依据**：Screen Wake Lock API 正是为「页面上有持续运动/训练内容、不希望熄屏」设计；不支持时特性检测后静默跳过即可，不改变任何业务行为。
**收益**：直接消除实时跟练最大的中断源，同时顺带减少 A1 的触发频率。
**风险**：低（需在 `https`/`localhost`，项目已是安全上下文，`usePoseCamera.ts:251` 已经在检查 `window.isSecureContext`）。低电量模式下浏览器可能拒绝，需静默降级。
**待确认**：Capacitor Android WebView 对 Wake Lock 的支持需真机验证（系统 WebView 可更新，一般 Chrome 84+ 即支持）。

---

### A4 — 跟练页每帧驱动整页重渲染

这是本次审查**最值得做的一项性能优化**。

**证据链**

1. `tick()` 每帧执行 `elapsedMs.value += dt`（`#L784`）。
2. `durationLabel` 读 `elapsedMs`（`#L655-L658`），模板第 68 行渲染它 → **整份 1,275 行模板的 render 函数每帧重新执行**。
3. 同一帧内还可能写 `holdLeft`（`#L788`/`#L792`）、`restLeft`（`#L817`）、`message`（`#L789`/`#L793`/`#L818`）。
4. 叠加第二条渲染源：`watch(pose.sample, ..., { flush: 'sync' })`（`#L743-L767`）在每次推理回调里写 `confidence`（`#L756`）→ 又一个渲染触发点。

于是摄像头跟练时，页面处在 **rAF 60 Hz + 推理 15–30 Hz** 两个独立触发源的叠加下：结构上每一次「帧」和每一次「新采样」都会排一次组件更新，量级在 **60–100 次/秒**，而屏幕上的数值只有 1 秒分辨率（`strip-num` 的秒数）在变。（开工前请在 Vue DevTools 里数一次真实值，作为 A4 的改前基线。）

**为什么这不是「Vue 会自动优化」能解决的**：Vue 的 patch 会跳过未变化的静态节点，但 render 函数本身（含 15 个 computed 求值、数十个 `:class`/`:style` 绑定对象创建）每帧都跑；再加上 `.strip-fill` 的 `transition: width 400ms`（`#L1123`）与每帧写入的新 `width` 互相打架——每帧都触发一次过渡重启，实际视觉效果与性能都不对。

**建议（按性价比排序，可只做前两条）**

1. **拆时钟**：把「已用时长 / 剩余秒 / 休息秒」交给一个 `setInterval(1000)`（或 `setTimeout` 自校正），`elapsedMs` 只在整秒变化时才写。rAF 循环如果只剩「进度条」，干脆删掉。
2. **量化 confidence**：徽标只区分 high/medium/low（`getConfidenceLevel`），当前却把 0–1 的浮点每帧写进 `ref`。改成「等级变化才写」或按 ~4 Hz 节流，渲染触发点直接从 30 次/秒降到偶发。
3. **进度条交给合成器**：`width` 过渡改 `transform: scaleX()` + `transform-origin: left`，或直接用 CSS 自定义属性写在一个不变的元素上，避免布局。
4. **`readonly` / `shallowRef` 化高频数据**：`fps`、`delegate`、`runsIn`、`landmarks` 这类「给调试看的」值不需要进 template 的响应式图；`fps` 已经 1 Hz 刷新（`usePoseCamera.ts:122-127`）尚可，`delegate`/`runsIn` 却是每帧写（`#L120-L121`），虽然 Vue 会因值相同跳过，但仍是每帧两次 setter 调用——改成只在变化时写更干净。

**依据**（modern-web-guidance `performance`）：*"DO debounce or throttle rapid event listeners: Limit the execution frequency of handlers attached to `scroll`, `resize`, or rapid `input` events."* 同一原则适用于「高频帧回调驱动 UI」：把 UI 更新频率与渲染频率解耦，是 INP 的基本功。

**收益（结构性、可数验证，不依赖基准机器）**
- 组件更新次数：**60–100 次/秒 → 1–4 次/秒**（可在 Vue DevTools 的 Performance 面板直接计数）；
- 主线程每帧省下 render + patch 的时间，直接在长时间训练（20–40 min）里换成更低的发热、更稳的摄像头 FPS；
- 输入响应（暂停/跳过/校准）不再排在每帧的 render 之后。

**风险**：低。唯一要小心的是「秒数跳变」的观感——用 `setTimeout` 对齐到下一个整秒边界，比 `setInterval` 更不容易累积漂移。
**验证**：Performance 面板录制 10 s 跟练，对比主线程任务条与 Update 次数；真机测 10 分钟训练的表面温度/掉帧。

---

## 5. P1 详解

### 5.1 B1 — 骨架绘制：每帧一次分配 + 画布分辨率错配

**证据**

```ts
// usePoseCamera.ts:53-72
function draw(landmarks: NormalizedLandmark[]) {
  const ctx = canvas.getContext('2d')          // 每帧取
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const utils = new DrawingUtils(ctx)          // 每帧 new，30 次/秒
  utils.drawConnectors(...); utils.drawLandmarks(...)
}
// usePoseCamera.ts:287-288
canvas.width = videoEl.videoWidth || 640       // 固定跟随视频源，不跟随显示尺寸 × DPR
canvas.height = videoEl.videoHeight || 480
```

**机制与后果**

1. `DrawingUtils` 每帧实例化，30 次/秒 × 训练 25 分钟 ≈ **4.5 万次多余分配**，直接进 GC；
2. 画布位图尺寸只在 `start()` 里设一次，**不跟随** `videoWidth` 变化。设备转向或相机切换分辨率后，
   视频与 canvas 的宽高比不再一致，关键点会整体错位 —— 这是真实的健壮性缺陷，不只是性能项。
3. （初版"20 倍多余填充"的结论已作废，见文首勘误：实测 PiP 下位图反而是轻微上采样。）

**建议**（实施时的最终取舍）

- 把 `ctx`、`DrawingUtils` 提到模块作用域，随画布创建一次；
- **不做** `ResizeObserver + DPR` 缩放：实测所有场景下 640×480 位图都小于渲染面积（手机 PiP 需要 378×621 设备像素，
  桌面取景框需要更大），任何"降分辨率"都会让骨架更糊，**属于没有收益的改动**；
- 改为在每帧绘制前比较 `videoWidth/videoHeight`，变化时重建位图尺寸（`syncCanvasToVideo()`），
  用两次整数比较换掉一个真实的对齐缺陷。

**依据**：绘制是**纯显示层**，与 `computeMetrics` 的数值无关（`draw()` 只吃 `landmarks`），因此这一项**不触碰识别准确性**。
把不变量移出热路径是常规优化；而"缩小位图"的前提（位图远大于显示面积）经实测不成立，故不实施。
**收益**：消除每帧一次的对象分配与 GC 抖动；修掉转向/换分辨率后的骨架错位。
**风险**：低。绘制仍读同一组归一化关键点，CSS 的 `object-fit: cover` + `scaleX(-1)` 映射不变。

---

### 5.2 B2 — 持续 GPU 开销：无限扫光 + 多层 `backdrop-filter` 叠在播放中的视频上

**证据**

| 项 | 位置 |
| --- | --- |
| 无限 `background-position` 扫光（repaint，非合成） | `styles/gradients.css`（`animation: shimmerGradient 2s ... infinite`）+ `ExecutionView.vue:148` 的 `.frame-sheen`，条件是「计次模式 && 未结束 && 未暂停」→ 训练全程 |
| `.glass` = `backdrop-filter: blur(14px) saturate(1.4)` | `common/BaseCard.vue:67-71`，被 `ExecutionView.vue:103,174` 两个 pane 使用 |
| `.stage-live` = `backdrop-filter: blur(8px)` | `ExecutionView.vue:1164`，压在视频上方 |
| `.confidence-badge/.phase-badge` = `backdrop-filter: blur(8px)` | `#L1159` |
| `.cam-angles` = `backdrop-filter: blur(6px)` | `#L1202`，压在摄像头流上方 |

**机制与后果**：`backdrop-filter` 的模糊必须在**背景每变一帧时重算一次**。这里背景恰好是正在播放的 `<video>`（演示视频循环 + 摄像头流），于是每个视频帧都触发一次全区域高斯模糊 + 重新合成。叠 2–3 层时，中端安卓机的 GPU 会被这一项吃掉相当一部分预算；`background-position` 扫光是**必须 repaint** 的属性，等于每帧再全量重绘一次 540 px 高的覆盖层。

**建议**

1. 视频之上的面板一律去掉 `backdrop-filter`，改用已有的深色底 + 半透明纯色（设计语言里 `.demo-frame` 本来就是 `radial-gradient` 深底，视觉差异极小）；
2. 扫光改成 `transform: translateX()` 作用于一个带 `mask-image` 的渐变条（合成器路径），或仅在「演示进行中且用户未要求在 reduce」时保留，训练暂停时一并移除（现在只判断了 `paused`/`finished`，已接近正确）；
3. `.card.glass` 在跟练页换成 `.card`（纸面），保留 `prefers-reduced-transparency` 分支。

**依据**（`motion`）：*"Prefer to animate `opacity` and `transform` ... to ensure animations stay on the compositor thread."*；`performance` 亦要求把 paint 限制在受影响区域内。`backdrop-filter` 本身不在任何「便宜」清单里，它与「背景在动」叠加是典型的最坏组合。
**收益**：去掉实时页最贵的一项持续 GPU 开销；预计中端机摄像头 FPS 更稳、发热下降（**需实测**：DevTools Rendering → Paint flashing / Layer borders）。
**风险**：低-中。会改变 4 处面板的观感，需要用截图对照；建议先改 `backdrop-filter`，扫光单独一版，便于回滚。

**附带（同属媒体能耗）**：演示视频是 `autoplay loop`（`#L111-113`），单个文件 300 KB–4.5 MB，`preload="metadata"` 已经做对；但**页面隐藏时没有暂停**。加一个 `visibilitychange` → `video.pause()/play()` 与 IntersectionObserver 门控，可避免后台持续解码。
**依据**（`performance`）：*"DON'T auto-play large video files at all: Rely on user intent before downloading large files."* —— 这里的 autoplay 是产品必需（动作示范），因此不做移除，只做「不可见即暂停」的最小化处理。

---

### 5.3 B3 — 8 处手写模态框，缺焦点捕获 / 焦点归还 / 背景 `inert`

**证据**：全部为 `div` + `role="dialog" aria-modal="true"`：

| 组件 | 行 |
| --- | --- |
| `components/common/InstallAppDialog.vue` | 3–4 |
| `components/common/PlanDraftDialog.vue` | 3–4 |
| `components/meals/FoodCaptureDialog.vue` | 4 |
| `components/meals/MealPhotoViewer.vue` | 4 |
| `components/poles/BridgeDialog.vue` | 8–9 |
| `components/wellness/WellnessDock.vue` | 10–11、40–41 |
| `views/SupplementsView.vue` | 109 |

每个都自己实现了 `Esc`（如 `InstallAppDialog.vue:215-230` 挂 `window.addEventListener('keydown')`）、遮罩点击、以及统一的身体滚动锁（`services/scrollLock.ts`）。**缺的是**：打开时把焦点移进弹层、Tab 循环限制在弹层内、关闭后把焦点还给触发按钮、背景内容从 tab 顺序与无障碍树里移除。`aria-modal="true"` 只是「告诉」了读屏器，并不能真的拦住 Tab。

**建议**：改用原生 `<dialog>` + `showModal()`：

```html
<dialog ref="dlg" class="dlg" @close="emit('close')" closedby="any">
  <form method="dialog"><button value="close" aria-label="关闭">✕</button></form>
  …
</dialog>
```

- `showModal()` 自带焦点捕获、`Esc`、`::backdrop`、顶层渲染（彻底绕开 z-index 与祖先 `overflow/transform` 的层级问题）；
- 背景自动 inert 化，不再需要手写 `aria-modal`；
- 用 `::backdrop` 替代现在的 `div.scrim`，少一层 `backdrop-filter`；
- 保留 `services/scrollLock.ts`（滚动锁仍然是必要的，因为 `<dialog>` 不锁 body 滚动）。

**依据**（`html`）：*"DO use `<dialog>` for modal overlays (requires JS `.showModal()`) to automatically trap focus, dim backgrounds, and support dismissing via `Esc`. Use the `closedby="any"` attribute to enable native "light-dismiss" (closing on backdrop click) without custom JavaScript."* 以及 *"DO use the global `inert` attribute for entire hidden sections (off-screen menus, background while custom modal is open) to remove them from tab flows and accessibility trees."*

**收益**：一次改动同时修好 8 个组件的键盘/读屏体验；删掉重复的 `Esc` 监听与遮罩层；Vue 侧只需 `watch(open => open ? dlg.showModal() : dlg.close())`。
**风险**：中低。`<dialog>` 是顶层元素，`v-if` 与 `showModal()` 的时序要改成「元素常驻 + 方法控制」；`MealPhotoViewer` 的全屏图片布局需重新确认。建议先迁 1 个（`InstallAppDialog`，逻辑最独立）做样板。
**兼容性**：三大引擎 2022 年起支持，本项目 PWA/APK 目标均满足，无需回退。

---

### 5.4 B4 — 全量同步持久化

**证据**

```ts
// stores/app.ts:162-194 —— 30 处 persistState() 调用点之一
function persistState() {
  const state = { profile, sessions, meals, analyses, plans, planHistory, … }
  const failed = saveStoredState(state)      // 同步
}

// services/storage.ts:205-230 —— 11 次 JSON.stringify + 11 次 setItem，全部同步
const writes: [string, unknown][] = [[KEYS.meta, meta], [KEYS.profile, …], …]
for (const [key, value] of writes) { if (!writeJson(key, value)) failed.push(key) }
```

`meals` 里含 256 px 缩略图 data URL（`services/mealPhotos.ts:1` 注释说明），`sessions`/`analyses` 只增不减。也就是说：**勾一个复选框、点一次「完成本组」，都会在输入事件里同步 JSON 序列化全部历史数据并落 11 个 key。**

**建议**

1. **按脏片写**：`persistState('meals')` 只写 `meals`；调用点已经天然知道改的是哪个域。
2. **合并 + 延后**：用 trailing debounce（~200 ms）+ `requestIdleCallback`（回退 `setTimeout`），并在 `pagehide`/`visibilitychange:hidden` 强制 flush。这一条同时消掉「同一帧内多次 persist」。
3. **大数组换存储**：`meals`（带缩略图）与 `sessions` 迁 IndexedDB（项目已有 IDB 使用先例 `mealPhotos.ts`），localStorage 只留偏好与元数据。这一条可以放到阶段 3。

**依据**（`performance`）：*"DO break up long tasks: Any JavaScript execution exceeding 50ms should be split."* / *"DO separate UI updates from heavy computations"*。持久化属于典型的「与 UI 无关的重活」，不该占输入事件的那一帧。
**收益**：输入到下一帧的延迟显著下降；避免大数据量下的配额失败与 toast 抖动。**需实测**：Performance 面板看 `persistState` 在 click 任务中的占比，以及在「500 条 sessions + 200 张缩略图」数据下的耗时。
**风险**：中。**必须**保证 unload 前 flush，否则丢数据；建议同时保留现有「写入失败」toast（`#L179-L190`）。

---

### 5.5 B5 / B6 — 切页体验与焦点

**B5（过渡串行）**

```html
<!-- AppShell.vue:9-13 -->
<Transition name="page" mode="out-in">   <!-- 旧页 250ms 淡出完成后，新页才挂载 -->
```
```css
/* AppShell.vue:112-114 */
.page-enter-active,.page-leave-active { transition: opacity 250ms, transform 250ms }
```

`mode="out-in"` 意味着新页面在 **t=250 ms 才开始进入**，到 500 ms 才安定。对一个「用户点开就要开始练」的应用，这段空窗是可感的。

**建议**：改用同文档 View Transitions（`document.startViewTransition()` 包住 `router.push`），两条快照交叉淡入淡出，无空窗；不支持时退回现在的 CSS 过渡（一行 `if (!document.startViewTransition)`）。

**依据**（`same-document-transitions`）：*"Browsers that do not support it will simply execute the DOM update immediately without animation."*（渐进增强零成本）；Baseline 状态：*"Newly available. It's been Baseline since 2025-10-14. Supported by: Chrome 111 …, Firefox 144 …, and Safari 18"*。
**收益**：切页感知延迟从 ~500 ms 降到 ~200 ms 且无空白。
**风险**：低。**不要**在这一步做共享元素 morph（会牵动 DOM 结构，违反「不做无意义重构」）。

**B6（焦点与播报）**

`src/main.ts:41-46` 的 `router.afterEach` 只改 `document.title`，没有把焦点移到新页标题、也没有 live region 播报。键盘用户点侧栏后焦点仍停在侧栏链接上；读屏用户不会被告知页面已变。

**建议**：`RouterView` 外层加 `tabindex="-1"` 的容器，`afterEach` 里 `nextTick` 后 `focus()`，并配一个 `aria-live` 的页面名播报；`document.title` 已经写好了，播报直接复用它。

**依据**（`html`）：*"DO move focus to the start of newly injected content when it is added in direct response to a user action that shifts the workflow into that content (e.g., opening a dialog or navigating to a new view)"*；（`same-document-transitions`）：*"MANDATORY Accessibility Routing: View transitions morph page layouts dynamically but do not manage programmatic focus."*
**注意**：`TwoPolesView.vue:211-215` 已有 `sheet?.focus({ preventScroll: true })`；`html` 指南提醒 *"DON'T use `node.focus({ preventScroll: true })` without usability validation; it can hide the focused element off-screen."* —— 该处是切换前后卡片，位置由布局保证，风险可接受，但值得在真机上确认一次（尤其是 768–1023 px 的叠卡模式）。

---

### 5.6 响应式与移动端

**B7（触控目标 + 固定底栏）** — 实测尺寸（CSS 声明值）：

| 控件 | 当前高度 | 位置 |
| --- | --- | --- |
| `.an-pick`「选择视频」 | 29 px | `AnalysisView.vue:687` |
| `.switch-chip`（动作改判/物理量切换） | ~22 px | `AnalysisView.vue:668-679`、`KinematicsPanel.vue:330` |
| `.an-chip` | 23 px | `AnalysisView.vue:633-648` |
| `.chip`（计数方式） | 30 px 左右（但 `counting-controls` 里有 `min-height:44px` 兜底，`ExecutionView.vue:1131`） | `ExecutionView.vue:1110` |
| `.cam-calib`「校准机位」 | 36 px | `ExecutionView.vue:1203` |
| `.menu-btn` / `.gear-btn` / `.avatar` | 32 / 32 / 30 px | `TopBar.vue:136-178` |
| `.cycle-chip` | 28 px | `TopBar.vue:123-132` |
| `.rpe-chip`（RPE 0–10） | 34 px | `ExecutionView.vue:1231` |

训练主控（暂停/跳过/结束）是 52 px，没问题；**问题集中在「刚练完、手在抖」时要点的分析页与 RPE 评分**。RPE 是训练负荷的唯一输入，点错会直接污染报表。

**建议**：按 `form-factor-adaptation` 给出的模式，用一枚令牌统一，而不是逐个组件改高度：

```css
:root { --target: 24px; }
@media (pointer: coarse) { :root { --target: 44px; } }
:where(button, [role="button"], nav a) { min-block-size: var(--target); }
```
图标按钮保持视觉紧凑，用 `::after { inset: -10px }` 扩命中区。

**依据**（`form-factor-adaptation`）：*"Make every control at least 24×24 CSS pixels (WCAG 2.5.8), and at least 44×44 on touch screens, where a fingertip is less precise than a mouse pointer (WCAG 2.5.5)."*

**固定底栏遮挡**：`MobileNav` 是 `position: fixed; bottom: calc(10px + var(--safe-bottom))`（`MobileNav.vue:100-117`），`AppShell` 给主区加了底部 padding（`AppShell.vue:121-124`），但**没有 `scroll-padding-bottom`** → Tab 到靠近底部的元素时会被底栏盖住。

**依据**（同上）：*"Set `scroll-padding-bottom` … on the scroll container to at least the bar's height, including its safe-area padding, so the browser scrolls focused elements clear of the bar (WCAG 2.4.11 Focus Not Obscured (Minimum))"*。

**B8（PiP 遮挡）** — 手机端摄像头小窗：

```css
/* ExecutionView.vue:1247-1261 */
.pane-cam{position:absolute;top:8px;right:8px;width:min(138px,40vw);z-index:7}
.pane-cam .cam-angles,.pane-cam .cam-calib{display:none}
```

`.stage-overlay`（演示画面顶部的置信度/组数徽标）在 `.demo-frame` 内 `top:16px;left:16px;right:16px`（`#L1155`），与右上角 138 px 的小窗**几何重叠**。同时小窗里把 `cam-calib`（校准机位）与角度读数都 `display:none` 了——手机用户看不到自己有没有校准成功，只能靠 Toast。

**建议**：小窗锚定到演示框的**左下角**（避开徽标），或给 `.stage-overlay` 加 `padding-right: calc(138px + 16px)`；校准按钮改成一个 44 px 的悬浮按钮（现在在 `counting-controls` 里有一颗 `calib-chip`，`#L80-L81`，手机上可见——这条链路是通的，但没有把「校准结果」显示在小窗里）。

**C6 附带（布局单位）**

- `AppShell.vue:89` `.shell{min-height:100vh}`、`#L92` `calc(100vh - …)`，而 `#L98` 用的是 `100dvh` → 移动端同一页面里两种视口单位混用，地址栏收起/展开时会出现高度跳变或底部多出空白；
- `MealPhotoViewer.vue:152,154` 全屏看图层用 `100vh` —— 正是最需要 `100dvh` 的地方（否则图片底部被地址栏切掉）；
- 建议统一 `100dvh`，用 `@supports not (height: 100dvh)` 回退到 `100vh`（`dvh` Safari 15.4+/Chrome 108+，本项目目标满足，回退只是保险）。

---

### 5.7 资源与加载策略

**B9（模型资源）**

| 资源 | 体积 | 现状 |
| --- | --- | --- |
| `public/mediapipe/wasm/vision_wasm_internal.wasm` | 13.2 MB | 首次开摄像头时才请求（`usePoseCamera.ts:300`） |
| `public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm` | 12.3 MB | 同上，SIMD 不支持时才用 |
| `public/mediapipe/models/pose_landmarker_lite.task` | 5.6 MB | 同上 |
| `public/mediapipe/models/efficientdet_lite0.tflite` | 7.0 MB | 被 `services/foodRecognition.ts:200` 的端侧食物识别使用（初版误判为 0 引用，见文首勘误） |

用户点「开启摄像头」到真正出画，要等权限 + ~5.6 MB 模型 + ~13 MB wasm（并行度取决于 MediaPipe 内部加载器）。UI 只有一句「首次约 5.5 MB」（`ExecutionView.vue:192`，与实际 18 MB 不符）。

**建议**（实施时的最终取舍）

1. **修正文案**（已实施）：原文案「首次约 5.5 MB」与实际的 ~18 MB（wasm + 模型）不符，改为不承诺具体体积的表述。
2. **进页面即预热 → 不实施**。核对 MediaPipe 的加载方式后发现：`FilesetResolver.forVisionTasks()` 只取回加载器 JS，
   13 MB 的 `.wasm` 是在编译期由加载器内部 `fetch` 的；要真正预热必须**显式** `fetch` 具体 wasm 文件，
   而 `vision_wasm_internal.wasm` 与 `vision_wasm_nosimd_internal.wasm` 哪个生效取决于 SIMD 探测——
   两个都拉就是 25 MB 的移动流量，只拉一个则有约一半概率白拉。**收益不确定、代价明确，故不做。**
3. ~~清理 `efficientdet_lite0.tflite`~~ —— 该文件是端侧食物识别的模型，**不可删除**（初版误判，见文首勘误）。

**依据**（`performance`）：resource hint 表 *"`prefetch` | Assets needed for next-page navigation"* —— 提示明确是"下一页需要"，而这里连"哪个文件会被用到"都无法在预热时确定。
**收益**：文案修正消除了错误预期（实际收益）。
**风险**：无（仅文案）。

**C5（SW 细节）**

```js
// public/sw.js:63-74 + 76-85
const response = await fetch(request)
if (response.status === 200 && usable(response)) await putInCache(request, response.clone())
return response          // ← 等缓存写完才把响应交给页面
```
`putInCache` 内部 `await cache.put(...)` 会完整读一遍 body 再落盘；对 13 MB 的 wasm 而言，这段 await 直接加在首访延迟上。改成 `void putInCache(...)` / `event.waitUntil(...)` 即可。另外上限是 `RUNTIME_CACHE_LIMIT = 200` 条（按数量），13 MB × 2 的 wasm 与 4.5 MB 的演示视频按条数计很容易撑爆移动端配额——建议对 `/mediapipe/`、`/demo-videos/` 单独设策略（或按字节估算总大小淘汰）。

---

## 6. P2 清单（成组说明）

### C1 — 长页面的渲染隔离

`content-visibility` / `contain` 全仓 0 次。候选：`WeekReport.vue`（20.9 KB）、`MealsView.vue`（735 行 + 列表）、`AnalysisView` 的历史分析列表、`SettingsView`（843 行）。

**关键判断（避免盲目套用）**：`content-visibility: auto` 对**已经可见**的元素不会跳过渲染，它的收益来自自动附带的 containment（`interactions-in-complex-layouts`：*"For visible elements, the browser **does not** skip rendering. Instead, the performance benefit comes entirely from the CSS containments that the property automatically enforces"*）。因此：

- **屏幕外的长列表项** → `content-visibility: auto` + `contain-intrinsic-size`（用 `lh`/`rem` 推估，别用 `px`）；
- **屏幕内的重区域（工作台两栏、跟练页两块 pane）** → 直接用 `contain: layout style paint`，收益立刻生效且不依赖新特性；
- **不要**给首屏内容加（`performance`：*"DON'T apply `content-visibility: auto` to above-the-fold content"*）。

**兼容性提醒**：`content-visibility` 的 Baseline 是 2025-09-15（Safari 26），**当前多数 iPhone 拿不到收益**（但也不会坏）；`contain` 早在 Safari 15.4 就有。所以 iOS 侧的收益应主要靠 `contain` 与 C2/A4，别把 KPI 押在 `content-visibility` 上。

另可配合 `efficient-background-processing`：如果给某个重区域上了 `content-visibility: auto`，可用 `contentvisibilityautostatechange` 事件在「被跳过」时暂停内部工作（**注意**：该事件不冒泡，必须直接监听该元素或 `{capture: true}`）。

### C2 — 定时器治理 → **实施时否决**

`useDietFeedback.ts:324` 与 `useSupplementReminders.ts:610` 各有一个 15 s 的 `setInterval`，从 `AppShell.onMounted` 起常驻；`SupplementsView.vue:241` 另有 1 s 视图时钟。

**原建议**是「tick 开头 `if (document.hidden) return`」。实施前逐行核对后发现**这条建议会破坏现有功能**：

```ts
// useSupplementReminders.ts:576-580
// 原生端系统通知由 syncNativeSchedule 预约的系统闹钟负责，页面只做页内提示，
// 避免系统闹钟与页面定时器在同一分钟各发一条
if (!isNative && (document.visibilityState !== 'visible' || !document.hasFocus())) {
  void sendSupplementNotification(title, message, `supplement-${reminder.id}-${time}`)
}
```

补剂调度器**恰恰要在页面不可见时继续运行**，才能通过 Service Worker 补发系统通知。页面隐藏就停 tick，等于把"后台补剂提醒"这个功能关掉。两个 tick 都已挂好 `visibilitychange` 补算，本身设计是对的。

**结论：不实施。** 顺带把「`SupplementsView` 的 1 s 视图时钟」也保留 —— 它只驱动一行倒计时文本，成本可忽略，而暂停它会让回到前台的那一刻显示过期时间。

**依据**（`performance`）：*"DON'T block the thread with recurring timers: Avoid heavy polling with `setInterval` that starves the main thread."* —— 本条针对的是**重轮询**；这里的 15 s tick 是每小时 240 次轻量比较，不构成主线程饥饿。

### C3 — 离线分析链路（需 eval 门禁，单独评估）

`analyze()` 按 `1/fps` 生成时间网格，逐点 `seekTo()` 等 `seeked` → `createImageBitmap` → `detect`。60 s / 15 fps = 900 次「seek + 解码 + 推理」的串行往返；`RUNNING_FPS = 30` 且上限 20 s = 600 次。

可探索两条路：

1. **`requestVideoFrameCallback` 顺播采样**：以 1×~2× 播放，用 `metadata.mediaTime` 把帧对齐到目标时间网格，按最近邻取用。速度快一个量级，但会引入「取到的是最近呈现帧而非精确 seek 帧」的偏差；
2. **WebCodecs `VideoDecoder` + 解复用**（需要 mp4box 之类的 demuxer）：最精确也最快，但引入新依赖与新失败面。

**判定**：两者都**可能改变帧时间网格**，进而影响 `minStageMs`/`minRepMs` 与 `Savitzky–Golay` 窗口（`motionKinematics`）。因此必须：先用 `npm run eval:motion` 记录当前基线，改动后逐条比对 `eval/` 里的 truth 标注与 `baseline/` 报告，**只有计数与关注项完全一致才可合入**。如果收益不足以支撑这个验证成本，**建议不做**（这也是「不进行无意义重构」的一条）。

### C4 — 主包拆分

`AppShell.vue:16-18` 静态引入 `WellnessDock`、`PlanDraftDialog`、`ToastRegion`，它们进主包。`WellnessDock` 与 `PlanDraftDialog` 都是「有数据/有触发时才需要」的弹层，可 `defineAsyncComponent`，并等 `store.init()` 之后再挂。预计省 20–60 KB（**需实测**：`vite build` 后对比 `index-*.js`）。

### C6 / C7 / C8 / C9 / C10 — 见下表

| ID | 证据 | 建议 | 依据 |
| --- | --- | --- | --- |
| C6a | `TwoPolesView.vue:423` `.sheet{will-change:transform}` 常驻（≤1023 px 全时） | 只在切换动画期间加类，动画结束移除 | `performance`: *"DON'T overuse `will-change` globally: Indiscriminately applying `will-change: transform` to multiple elements consumes excessive VRAM"* |
| C6b | `globals.css:30` `body{overflow-x:hidden}` | 定位真实溢出元素并修好，去掉这条 | `form-factor-adaptation`: *"DO NOT set `overflow-x: hidden` or `clip` on `html` or `body` … content past the edge is cut off and users can't scroll to it."* |
| C6c | `globals.css:25` `background-attachment: fixed` + `:34-42` 全屏固定颗粒层 | 渐变本身不随滚动变化，`fixed` 无视觉收益，移动端反而每帧重绘；去掉 `background-attachment`，颗粒层已由 `position: fixed` 承担 | 同上（paint 范围最小化） |
| C7 | `animations.css:93-110` 全局 `animation-duration:.01ms!important` | 改为「默认静态，在 `prefers-reduced-motion: no-preference` 里启用动画」；`ease`/颜色类过渡保留 | `motion`: *"**DO NOT** globally apply `animation-duration: 0.01ms;` as it can cause certain animations to become _more_ jarring."* |
| C8a | 全站 10 处 `<img>`，0 处 `width`/`height`（如 `AnalysisView.vue:189-195` 关键帧图、`TopBar.vue:32` 头像） | 补 `width`/`height`（关键帧是 canvas 导出的 JPEG，导出时已知尺寸，可一并写入记录）；单图加 `decoding="async"` | `html`: *"DO specify `width` and `height` on all `<img>` tags to preserve aspect ratio and prevent Layout Shifts (CLS)."* |
| C8b | `ExecutionView.vue:111-113` `<video autoplay loop preload="metadata">` 无 `poster` | 用 `sharp`（已是依赖）为每个 demo 生成首帧 poster，避免首帧黑底 | `performance`: *"DO provide a `poster` image fallback"* |
| C9a | 18 处 `transition: all` | 改显式属性列表 | 可维护性 + 避免意外过渡 `width/height` |
| C9b | `tokens.css:198-201` `--breakpoint-*`、`#L188-190` `--site-footer-*`、`--motion-slower`、`--easing-elastic` 均 0 引用（`var(--breakpoint*` 0 次） | 删除或补注释说明「仅供文档」；顺带修正 `tokens.css:188` 关于「页脚」的过期注释（`AppShell` 已无 footer） | 死令牌会误导后续开发者，尤其 `--breakpoint-*` 容易被误以为能用于媒体查询（CSS 变量不能用于 `@media`） |
| C9c | 根 `.gitignore:68` 为 `UI\public\`（反斜杠） | 改为 `UI/public/` | 现状会导致 `git`/`ripgrep` 解析该 ignore 文件时报错并整体失效（本次审查中已复现：`rg` 直接拒绝运行） |
| C10 | `@media` 74 处 / `@container` 0 处 | 先给 2 个真正「同组件、不同容器宽度」的组件上容器查询：跟练页的摄像头 pane（桌面整栏 / 手机 PiP 是同一个组件）、`KinematicsPanel` 的开关组 | `form-factor-adaptation`: *"Use container queries instead of viewport-width media queries for component layout, so a component adapts wherever it is placed."* |

---

## 7. 分阶段实施计划

排期按「1 名熟悉本项目的工程师」估算，含自测，不含真机回归评审。

### 阶段 0 — 建立基线（0.5 天，必做）

没有基线就无法证明收益，也无法保证不回退识别准确性。

1. **测量环境**：`npm run build && npm run preview`。**不要用 `npm run dev` 测性能**——`poseEngine.ts:108` 在 DEV 下强制走主线程（`if (import.meta.env.DEV) return createMainThreadEngine(paths)`），dev 的性能数字与线上不是一个量级。
2. **记录现状**：Chrome DevTools Performance 录 10 s 摄像头跟练（记录 long task、Update 次数、FPS）+ Rendering 面板开 Paint flashing / Layer borders 截图 + 中端安卓真机 10 分钟训练的温度与掉帧。
3. **算法基线**：`npm run selfcheck`、`npm run eval:motion`、`npm run typecheck`、`npm run test:api` 全绿并留存报告。
4. **产出**：一张「改前」对照表（FPS、long task 总时长、Update 次数、首次开摄像头耗时、分析 60 s 视频耗时）。

### 阶段 1 — P0（1.5–2 天）

| 项 | 动作 | 验收 |
| --- | --- | --- |
| A1 | 计时改墙钟 + `visibilitychange` 重算 | 切后台 60 s 回来，已用时长 +60、休息剩余正确；记录里的 `durationMs` 与秒表误差 < 1 s |
| A2 | 头部按钮改「结束并记录」；丢弃加两步确认 + Toast | 误触不再丢数据；`record()` 幂等不重复写 |
| A3 | Wake Lock 申请/释放 + 特性检测 + 失败静默 | 真机 5 分钟不熄屏；离开页面后锁被释放（`navigator.wakeLock` 观察） |
| A4 | 时钟拆到 1 Hz；confidence 量化；进度条改 `transform` | Update 次数 60–100/s → ≤4/s；进度条视觉不回退 |

阶段 1 结束必须复跑阶段 0 的全部门禁。

### 阶段 2 — P1（3–4 天）

| 批次 | 项 | 备注 |
| --- | --- | --- |
| 2a 渲染 | B1、B2 | 纯显示层，可与 B9 并行；改完立即对比 paint flashing 截图 |
| 2b 形态 | B3（先迁 `InstallAppDialog` 做样板，再批量）、B5、B6 | B3 一批一 PR，便于回滚 |
| 2c 数据/网络 | B4（先做「按脏片 + debounce」，IDB 迁移留到阶段 3）、B9、C5 | B4 必须验证 `pagehide` flush |
| 2d 移动端 | B7、B8、C6 | 用 320 px / 375 px / 414 px 三档 + `pointer: coarse` 模拟验证 |

### 阶段 3 — P2（2–3 天，可与阶段 2 交叉）

C1（先 `contain`，后 `content-visibility`）、C2、C4、C7、C8、C9、C10。

**C3（离屏分析）单独立项**：只有阶段 0 的基线显示「分析等待时间」是用户痛点时才做，且必须先跑 `eval:motion` 一致性验证。

### 建议的提交切分

1. `perf(execution): decouple clock from rAF`（A4）
2. `fix(execution): wall-clock timer + visibility resync`（A1）
3. `feat(execution): hold screen wake lock during session`（A3）
4. `fix(execution): confirm before discarding session`（A2）
5. `perf(pose): hoist drawing utils and size canvas to DPR`（B1）
6-8. B2 / B3 / B4 各自独立
9+ P2 按目录分。

---

## 8. 不做清单（明确拒绝的「优化」）

写下来是为了避免下一轮再讨论一遍：

| 提案 | 为什么不做 |
| --- | --- |
| 换 UI 框架 / 引入组件库 / Tailwind | 现有 scoped CSS + 令牌体系已经能表达设计语言；换框架是重写，收益不抵风险 |
| 引入图表库（ECharts/Chart.js）替换手绘 SVG 曲线 | 现有 `MotionCurve` 已经做了缺失帧断线、不补 0、`role="img"` + `aria-label`，这些都很难在通用库里保留；引入等于丢掉分析口径的可读性 |
| 拆分 1,455 行的 Pinia store | 它按域分区且被 40+ 处调用；拆分的收益是「好看」，风险是同步/持久化逻辑分散 |
| 用 `idle` 下调推理帧率/降分辨率来省电 | 会改变计数与运动学输入 —— **这是不能碰的红线**，除非走 `eval:motion` 门禁 |
| 全面迁 View Transitions 做共享元素 morph | 需要改 DOM 结构（`view-transition-name` 唯一性约束），属于重构；阶段 2 只做 cross-fade |
| 上 SSR / SSG | PWA + 纯本机数据模型，首屏是登录后的个性化内容，SSR 收益接近于 0 |
| 全面 polyfill / 降级到旧浏览器 | 目标是 Capacitor WebView + 现代移动浏览器；按 Baseline 使用并在各条目里标注回退方式即可 |

---

## 9. 兼容性与回退策略（逐项）

| API / 特性 | Baseline | 不支持时 | 本报告中的使用位置 |
| --- | --- | --- | --- |
| Screen Wake Lock | Chrome 84 / Safari 16.4（需 HTTPS） | 静默跳过，仅少省电收益 | A3 |
| View Transitions（同文档） | Chrome 111 / Safari 18 / Firefox 144，Baseline 2025-10-14 | 直接执行 DOM 更新（现有效果） | B5 |
| `<dialog>` + `showModal()` | 三大引擎 2022 起 | 无需回退（目标环境均满足） | B3 |
| `content-visibility` | Chrome 108 / Safari 26 / Firefox 130，Baseline 2025-09-15 | 属性被忽略，正常渲染 | C1（iOS 侧靠 `contain`） |
| `contain: layout style paint` | Safari 15.4 / Chrome 52 | 被忽略 | C1、长页 |
| 容器查询 | Safari 16 / Chrome 105 | 回退到现有视口断点 | C10 |
| `dvh` | Safari 15.4 / Chrome 108 | `@supports` 回退 `vh` | C6c |
| `prefers-reduced-transparency` | Safari 17 / Chrome 118 | 忽略，保留玻璃面 | 已有 |
| `text-wrap: balance` | Safari 17.5 / Chrome 114 | 正常换行 | 已有 |

> 建议把这张表固化成 `AGENTS.md` / `CLAUDE.md` 里的 **Browser Support policy**，后续就不必每次重新论证。

---

## 10. 验证方法索引

| 目标 | 方法 |
| --- | --- |
| 渲染次数下降（A4） | Vue DevTools → Performance / 或临时计数 render（改前改后各 10 s） |
| 主线程余量（A4/B2） | DevTools Performance：long task（>50 ms）条数与总时长 |
| GPU 绘制（B1/B2） | Rendering → Paint flashing、Layer borders、Frame rendering stats |
| 计时正确（A1） | 真机切后台/锁屏，秒表对照 |
| 熄屏（A3） | 真机静置 5 min |
| 输入延迟（B4） | Performance：click → next paint；在大数据量（500 sessions）下测 |
| 切页（B5） | Performance：navigation → paint；与改前对比 |
| 触控（B7） | DevTools 设备模拟 + `pointer: coarse`；真机手指测试 |
| 可访问性（B3/B6） | 键盘 Tab 全流程、VoiceOver/TalkBack 朗读、`axe` 类检查 |
| 识别准确性（任何涉及 A/B/C3 的改动） | `npm run selfcheck` + `npm run eval:motion` + 逐条比对 truth 标注 |

---

## 11. 附：本次审查的量化底数

便于后续对比（均为本次统计/实测，**构建尺寸取自仓库内现有的 `dist/`（构建于 2026-11-18）**，正式基线请在阶段 0 重新 `npm run build` 后记录）：

- `src/` 总行数：**30,406**（`.vue` + `.ts` + `.css`，125 文件）
- 最大文件：`stores/app.ts` 1,455 行、`views/ExecutionView.vue` 1,201 行、`poles/MovementPole.vue` 1,071 行
- `@media` 74 处 / `@container` 0 处 / `content-visibility` 0 处 / `contain` 0 处
- `aria-*` 259 处 / `role=` 100 处 / `focus-visible` 16 处
- `backdrop-filter` 25 处（14 个文件）；`transition: all` 18 处；`will-change` 1 处（常驻）
- `IntersectionObserver` 0 处 / `ResizeObserver` 0 处 / `requestIdleCallback` 0 处
- `wakeLock` 0 处 / `:has(` 0 处 / `screen.orientation` 0 处
- 构建产物（干净 HEAD 重建的基线）：`index-*.js` 298.44 KB、`index-*.css` 51.01 KB、`vision_bundle` 152.2 KB、`poseInference.worker` 144.7 KB
- `public/`：wasm 13.2 + 12.3 MB、pose 模型 5.6 MB、食物识别模型 `efficientdet_lite0.tflite` 7.0 MB（在用）、demo 视频合计 ~27 MB、dist 总计 71.4 MB

---

## 12. 结语：如果只能做 3 件事

1. **A4 + A1**（时钟与渲染解耦）——一次性解决「跟练页卡顿」「时长失真」「休息倒计时不准」三个问题，改动集中在 `ExecutionView.vue` 的一个函数里。
2. **B1 + B2**（骨架绘制与持续 GPU 开销）——实时页剩下的性能问题主要在这两处，且都是纯显示层，零算法风险。
3. **B3 + B6**（原生 `<dialog>` 与路由焦点）——一次把可访问性欠账补上大半，同时删掉一段自研模态逻辑。

其余项的价值是「更稳、更省、更好维护」，可以按排期推进，不必抢在发布前。