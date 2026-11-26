# 动作分析：上传视频检查深蹲/硬拉/跑姿

> **2026-11-24 更新（动作模板扩展）**：分析页已改为“上传后自动识别，用户不预选”。自动识别覆盖深蹲、硬拉、跑姿、站姿弯举、平板支撑：前三个沿用步态/膝屈/躯干前倾判定，弯举用“肘角大幅往返、腿部稳定、躯干不过度前倾”，平板用“躯干接近水平、髋部静止、膝角伸直、保持够久”的通用特征；特征不够强时只预选候选并要求用户确认，不硬猜。可分析动作扩为上述五个；其中弯举与平板支撑只出测量值（`findingsReady=false`），不出关注项。权威清单与阈值来源见 `UI/src/services/motionTemplates.ts`；服务端已移除 `action` 的三值 CHECK，新增动作不再需要改数据库。视角判不准时由用户选择支持的视角；平板支撑因身体接近水平、自动视角容易误判，只在用户确认侧面后分析，结果标为低置信度。

## 1. 问题陈述

跟练只解决「做了几次」，不解决「做得怎么样」：

- `usePoseCamera.ts:20`、`useRepCounter.ts:1` 明确声明不判定动作是否标准；`ExecutionView.vue:393` 的校准提示写着「不是通用标准姿势判定」。用户练完之后，没有任何入口回看动作问题。
- 动作库 `exercises.ts:8` 的 30 条全部是自编演示条目、未经专业审核，没有分阶段要领，也没有可计算的标准区间。动作「标准」在这个项目里目前没有依据。
- 现有姿态链路只接受实时摄像头帧（`usePoseCamera.ts` 依赖 `getUserMedia`），没有视频文件输入；项目里也没有视频上传或长期留存实现。服务端只接收 2MB JSON（`plan.md` §2.1 原则 4、`UI/server/app.mjs`），不具备视频通道，也不应该有。
- 用户想复盘时，只能把视频发给教练或凭感觉回看；应用内没有「问题清单 + 关键帧 + 依据出处」这种可核对的反馈。

本次新增「动作分析」：从相册选一段视频，在端侧逐帧识别，按带文献出处的规则输出关注项与测量值，结果存为独立分析记录，供训练后复盘；深蹲、硬拉同时进入动作库与跟练计数，跑姿只做分析。

## 2. 方案概述

1. **独立分析页**：导航新增一级入口「分析」，包含发起分析流程（选动作 → 选视频 → 可分析性检查 → 端侧分析 → 结果）与历史分析记录列表；结果详情单独路由。
2. **端侧视频分析**：视频文件不上传、分析后即弃。复用现有 MediaPipe worker/模型（`poseEngine.ts`）与主线程降级路径，按媒体时间采样 10–30fps，逐帧提取单侧/双侧关键点，交给纯函数规则引擎。
3. **规则引擎与出处**：新增纯函数模块 `motionAnalysis.ts` 与规则配置 `motionRules.ts`。每条规则带文献出处；有可靠文献阈值的进「关注项」，没有的只进「测量值」。不下「标准/不标准」结论、不给总分。见 `docs/adr/0003-analysis-findings-not-verdicts.md`。
4. **独立分析记录**：新实体 `MotionAnalysis`，本机按类别 key 持久化，关键帧截图存 IndexedDB，结构化结果随账号同步（截图不传）。见 `docs/adr/0002-video-analysis-runs-on-device.md`。
5. **动作库扩展**：`exercise-catalog-v2` 新增深蹲、硬拉（类型「其他」），可被计划替换候选选用并支持跟练实时计数；跑姿不进动作库。

## 3. 用户故事

### A. 发起与可分析性检查

1. 分析页提供「发起分析」入口。2026-11-24 起改为上传后自动识别动作；识别不可信时（`actionConfident=false`）由用户在动作选择器中确认。自动识别覆盖深蹲/硬拉/跑姿/站姿弯举/平板支撑；弯举与平板的分类器用的是通用运动特征（肘角往返、水平静止等），不是动作名字。
2. 视频选择只接受 `video/mp4`、`video/webm`、`video/quicktime`；文件 > 200MB、时长 > 60 秒或 < 1 秒时，直接提示具体原因并停留在选择步骤，不进入分析。
3. 选择视频后执行可分析性预检：均匀抽约 24 帧，检测人体完整度、分析视角、动作匹配与（跑姿）步态周期数；预检期间显示进度。
4. 预检判定三种结果：`ok` 进入全量分析；`degraded` 允许继续但结果标「低置信度」并列出原因；`rejected` 不出结果、不生成记录，只显示拒绝原因与拍摄指引。
5. 视角只由系统识别为侧面或正面，不提供手动选择；视角无法判定时按拒绝处理。
6. 仅在证据明确时拒绝「动作与所选项不符」：选力量动作却检测到持续交替步态，或选跑姿却没有连续步态。深蹲与硬拉之间的区分不可靠，不据此拒绝，按所选动作分析并在低置信度原因中说明。
7. 人体部分遮挡、核心关节可见度低、跑姿步态周期不足 5 个、力量动作不足 1 次完整重复时，按降级处理：仍生成结果与记录，标注低置信度；不足 1 次重复时关注项为空，显示「未识别到完整重复」的说明。
8. 完全检测不到人体或视频无法解码时不生成结果与记录，提示更换视频；这是「无法分析」，与降级不同。
9. 全程不需要摄像头权限，不发起任何网络请求；界面明示「视频不会上传，分析完成后即丢弃」。

### B. 分析执行

10. 分析按媒体时间采样：深蹲、硬拉 15fps；跑姿 30fps 且最多处理前 20 秒。进度按「已处理时长 / 视频总时长」显示，可随时取消。
11. 取消或分析中关闭页面不生成记录；重新进入不会残留半成品。
12. 分析在端侧运行；worker 不可用时沿用主线程降级，页面不冻结，进度持续更新。
13. 模型缺失或解码失败时显示具体错误与重试入口，不生成记录；错误文案区分「模型未就绪（需运行 camera:assets）」与「视频无法解码」。
14. 分析完成后释放视频文件与帧缓存，不把视频写入 localStorage、IndexedDB 或服务端。

### C. 规则、结果与关键帧

15. 结果页分「关注项」与「测量值」两块：关注项逐条显示标题、实测值、阈值、发生时间点、关键帧、文献出处；测量值只显示名称与数值。
16. 关注项必须来自 `motionRules.ts` 中带文献出处的规则；找不到可靠出处的检查项只能作为测量值，不得进入关注项。
17. 结果页显示固定声明：「规则参考所列文献，阈值由本项目自行翻译，未经运动医学或体能专业人士审核；结果仅供复盘参考，不构成诊断或训练处方。」
18. 结果页不出现总分、星级、百分比评分或「标准/不标准」字样；允许显示「共 N 项关注」这类事实计数。
19. 每条关注项配 1 张关键帧截图，整份结果最多 8 张；截图在分析结束后按时间点二次定位截取，存本机 IndexedDB。
20. 结果页标明分析视角；同一动作的侧面与正面使用不同检查项集，互不混用。
21. 记录写入当时的规则版本；历史记录再次打开时按记录内结果展示，不用新规则重算。

### D. 分析记录与关联

22. 分析完成自动生成分析记录，分析列表按日期倒序显示动作、日期、视角、关注项数量与低置信度标记；空状态显示「还没有分析记录」。
23. 记录详情可删除，删除需二次确认，并同时删除该记录的关键帧截图。
24. 记录详情可手动关联一次训练记录，也可取消关联；选择器默认筛选同一天，可切换到其他日期。
25. 关联为弱引用：训练记录被删除后，分析详情显示「关联的训练记录已不存在」，允许重新关联，不回写训练记录。
26. 导航短标签为「分析」，页面标题为「动作分析」；移动底栏与桌面侧栏都提供入口。

### E. 动作库与跟练

27. `exercise-catalog-v2` 新增深蹲（徒手，无器材）与硬拉（哑铃），类型均为「其他」；`source` 沿用「自编演示条目 · 未经专业人士审核」。
28. 新动作不改变现有自动计划编排顺序：每日自动计划仍按原类型与目录顺序生成；深蹲、硬拉通过「替换候选」进入计划，并在手动调整路径可用。
29. 深蹲、硬拉出现在跟练页并支持摄像头实时计数：深蹲用膝角，硬拉用髋角；无演示视频时沿用现有「没有可用的准确真人演示视频」提示与剪影。
30. 跟练记录的 `exerciseName` 与分析动作名一致，训练记录可直接用于关联复盘。
31. 跑姿不进入动作库、计划与跟练，只出现在分析动作列表。

### F. 同步、导出与清除

32. 登录状态下分析记录的结构化字段参与现有同步：本机新增/修改入 outbox，按幂等键上行；`/sync` 快照包含 analyses 及删除墓碑；冲突处理沿用现有 `_sync` 口径。
33. 未登录或离线时分析记录照常保存，登录后补传。
34. 关键帧截图不参与同步；在其他设备查看同一条记录时，关注项与出处正常显示，截图位置显示「截图仅保存在拍摄设备」。
35. 导出包含分析记录的结构化数据，不包含关键帧图片。
36. 「清除全部数据」与服务端账号清除同时删除分析记录与关键帧；本机清除后 IndexedDB 中的分析截图也被清空。

### G. 可访问性与响应式

37. 分析页在 393px、768px、1024px、1440px 宽度下无横向溢出；上传、进度、取消、删除、关联等操作可键盘到达。
38. 低置信度、关注项与测量值的区分不能只靠颜色，必须有文字标签。

## 4. 已定决策

| 决策点 | 结论 |
|---|---|
| 场景 | 本人训练后复盘，与实时跟练互补 |
| 输出 | 问题清单 + 关键帧；不给总分、不下二元结论 |
| 判定依据 | 文献出处逐条标注，自行翻译为阈值，界面明示未经专业审核 |
| 动作范围 | 深蹲、硬拉、跑姿 |
| 动作库关系 | 深蹲/硬拉进 `exercise-catalog-v2`，可计划 + 跟练计数；跑姿只分析 |
| 视频入口 | 相册选择 + 可分析性检查 |
| 分析位置 | 端侧 MediaPipe，视频不上传、分析后丢弃 |
| 机位 | 侧面 + 正面，单视频按识别出的视角切换规则，不手动选 |
| 分析深度 | 关键帧角度 + 节奏；跑姿加步频、触地时相与触地膝角 |
| 跑姿场景 | 跑步机为主，直道兼容；至少 5 个步态周期 |
| 视频上限 | 60 秒 / 200MB / mp4·webm·mov |
| 结果留存 | 独立分析记录，本机持久化；结构化结果可同步，截图不传 |
| 入口 | 导航新增一级「分析」页 |
| 边界 | 视角/动作不符 → 拒绝；遮挡、可见度低、周期/重复不足 → 降级并标低置信度 |
| 关联 | 可选手动关联训练记录 |
| 验收 | 全链路跑通、规则可追溯、边界路径可见 |

补充决策（规格层）：

- **不改变自动计划编排**：深蹲/硬拉通过替换候选进入计划；若要自动排入，需另立计划规则版本，不在本次范围。
- **无可靠出处即降级为测量值**：规则配置不允许出现「参考行业通行做法」这类无具体出处的关注项。
- **拒绝不产生记录**：只有 `ok` 与 `degraded` 产生分析记录。
- **跑姿正面只做对称类检查**：正面视角不做步频与触地时间的风险结论。
- **不新增视频素材资产**：跟练页沿用剪影与现有演示视频兜底；验收用真实用户视频在浏览器手工验证。

## 5. 接缝与数据形状

### 5.1 纯函数规则引擎 `src/services/motionAnalysis.ts`

不碰 DOM、不依赖 Vue，可在 selfcheck 直接断言。

```ts
export type AnalysisAction = 'squat' | 'deadlift' | 'running'
export type AnalysisView = 'side' | 'front'

export interface MotionPoint { x: number; y: number; visibility: number }
export interface MotionFrame {
  timeMs: number
  /** 左右分开保留，越到分析层越需要原始几何，不能只传一个“较好侧”角度 */
  points: {
    shoulder: { left: MotionPoint | null; right: MotionPoint | null }
    hip: { left: MotionPoint | null; right: MotionPoint | null }
    knee: { left: MotionPoint | null; right: MotionPoint | null }
    ankle: { left: MotionPoint | null; right: MotionPoint | null }
    heel: { left: MotionPoint | null; right: MotionPoint | null }
    toe: { left: MotionPoint | null; right: MotionPoint | null }
  }
  visibility: number
}

export interface MotionFramesInput {
  action: AnalysisAction
  fps: number
  frames: MotionFrame[]
}

export interface MotionFrameSeries extends MotionFramesInput {
  view: AnalysisView
}

export interface FindingDraft {
  ruleId: string
  title: string
  detail: string
  timeMs: number | null
  measured: number | null
  unit?: string
  thresholdLabel: string
  sourceLabel: string
  sourceUrl?: string
}

export interface MetricDraft {
  id: string
  label: string
  value: number | string
  unit?: string
}

export interface MotionAnalysisResult {
  findings: FindingDraft[]
  metrics: MetricDraft[]
  repCount: number | null
  gaitCycles: number | null
  usableRatio: number
}

export function extractMotionFrame(landmarks: NormalizedLandmark[], timeMs: number): MotionFrame

export function detectView(frames: MotionFrame[]): { view: AnalysisView | null; confidence: number }

export function precheckMotion(input: MotionFramesInput): {
  verdict: 'ok' | 'degraded' | 'rejected'
  reasons: string[]
  view: AnalysisView | null
  repCount: number | null
  gaitCycles: number | null
}

export function analyzeMotion(input: MotionFrameSeries): MotionAnalysisResult
```

实现约束：

- 分视角、分动作的规则在 `motionRules.ts` 配置，`analyzeMotion` 只做通用执行：分段、取关键帧指标、逐条评估、组装结果。
- 重复动作分段与实时计数共用同一套阈值状态机（见 5.9），避免「跟练算了 12 次、分析说 9 次」。
- 跑姿步态分段用踝点竖直速度过零与触地代理（踝/跟最低点），输出步频、触地时间代理、触地膝角、躯干角、左右触地时间差、垂直振幅代理。
- 输出顺序稳定（按规则配置顺序），同帧同规则的 finding 去重；关注项上限 20 条、测量值上限 30 条。

### 5.2 规则配置 `src/services/motionRules.ts`

```ts
export const MOTION_RULES_VERSION = 'motion-analysis-rules-v1'

export interface MotionRule {
  id: string
  action: AnalysisAction
  view: AnalysisView
  /** 有可靠文献阈值 → finding；否则只能是 metric */
  output: 'finding' | 'metric'
  title: string
  thresholdLabel: string
  /** 必须落到可核验的具体文献：作者/机构、年份、标题；有 DOI/ISBN 一并写入 */
  source: { label: string; url?: string }
  /** 从分段结果算指标并判定；纯函数 */
  evaluate(ctx: unknown): FindingDraft | MetricDraft | null
}
```

规则清单（阈值为草案，实现时以所引文献为准逐条核对；核对不上的降为 `metric` 或删除）：

| 规则 ID | 动作/视角 | 检查 | 草案阈值 / 输出 |
|---|---|---|---|
| SQ-SE-01 | 深蹲/侧 | 下蹲深度 | 最低点髋点不低于膝点（图像坐标）；关注项 |
| SQ-SE-02 | 深蹲/侧 | 底部膝角 | 约 70°–120°；关注项 |
| SQ-SE-03 | 深蹲/侧 | 躯干前倾 | 底部肩-髋连线与竖直夹角 ≤ 45°；关注项 |
| SQ-SE-04 | 深蹲/侧 | 离心时长与底部停顿 | 测量值 |
| SQ-FR-01 | 深蹲/正 | 膝内扣 | 底部膝间距/踝间距 < 0.8；关注项 |
| SQ-FR-02 | 深蹲/正 | 左右膝角差 | 测量值 |
| DL-SE-01 | 硬拉/侧 | 起拉躯干角稳定性 | 起始至离地阶段躯干角变化 ≤ 20°；关注项 |
| DL-SE-02 | 硬拉/侧 | 锁定过度后仰 | 锁定帧躯干后仰 ≤ 5°；关注项 |
| DL-SE-03 | 硬拉/侧 | 锁定伸髋完整性 | 锁定帧髋角 ≥ 165°；关注项 |
| DL-SE-04 | 硬拉/侧 | 髋膝伸展时序 | 测量值 |
| DL-FR-01 | 硬拉/正 | 双肩/双髋高度差 | 测量值 |
| RUN-SE-01 | 跑姿/侧 | 平均躯干前倾 | 约 5°–15°（过度前倾或后仰）；关注项 |
| RUN-SE-02 | 跑姿/侧 | 触地瞬间膝角 | 过伸阈值待文献落实；关注项 |
| RUN-SE-03 | 跑姿/侧 | 步频 | 测量值（步/分） |
| RUN-SE-04 | 跑姿/侧 | 触地时间代理 | 测量值 |
| RUN-SE-05 | 跑姿/侧 | 垂直振幅代理 | 测量值 |
| RUN-FR-01 | 跑姿/正 | 触地帧膝内扣 | 膝间/踝间距阈值；关注项 |
| RUN-FR-02 | 跑姿/正 | 肩髋左右对称 | 测量值 |

硬性约束：

- 每个 `finding` 的 `source.label` 必须是一条可核验的具体文献条目；候选来源包括 NSCA《Essentials of Strength Training and Conditioning》、ACSM《Guidelines for Exercise Testing and Prescription》、深蹲与跑步生物力学综述。**不得编造页码或 DOI**；核对不上就降为测量值。
- 每条 finding 的 `thresholdLabel` 与文献一致，不能自行放宽而不记录。
- 界面声明统一引用 `sourceLabel`，不出现「权威认证」「专业标准」等超出依据的措辞。

### 5.3 视频分析管线 `src/composables/useVideoAnalysis.ts`

- `load(file): Promise<VideoMeta>`：校验格式/大小/时长；创建 `<video muted playsinline>`，不挂可见 DOM，读取元数据后暂停。
- `precheck(action): Promise<PrecheckResult>`：均匀抽约 24 帧，复用 `createPoseEngine`（`poseLandmarkerFactory` 的 GPU→CPU 降级），产出 `MotionFrameSeries` 交给 `precheckMotion`。
- `analyze(action, view): Promise<MotionAnalysisResult>`：按固定媒体时间间隔 seek 取帧（深蹲/硬拉 15fps；跑姿 30fps 且 ≤ 前 20 秒），逐帧 `detect(bitmap, timestamp)`，时间戳严格递增（复用 `nextTimestamp`）。每次 seek 等待 `seeked` 事件，串行处理，不并发堆积。
- 进度用 `processedMs / durationMs`；`cancel()` 中止后续帧并释放资源。
- 结束后 `captureKeyframes(findings)`：按 `timeMs` 二次 seek、绘制 canvas、`toBlob('image/jpeg', 0.8)`，最多 8 张，返回本地 `keyframeRef`。
- 错误映射：模型加载失败 →「模型未就绪，请运行 `npm run camera:assets` 后重试」；解码失败 →「当前浏览器无法解码该视频，请转码为 H.264 MP4 后重试」；seek 超时 → 重试一次后中止并提示。
- 页面卸载时终止 video/engine，不留下后台播放。

### 5.4 关键帧存储 `src/services/analysisKeyframes.ts`

仿 `mealPhotos.ts`：IndexedDB 库 `twopoles_analysis_keyframes`，store `keyframes`，v1。

- `saveAnalysisKeyframe(ref: string, blob: Blob): Promise<void>`
- `getAnalysisKeyframe(ref: string): Promise<Blob | null>`
- `deleteAnalysisKeyframes(refs: string[]): Promise<void>`
- `clearAnalysisKeyframes(): Promise<void>`

不参与同步；`clearAllData()` 调用 `clearAnalysisKeyframes()`。

### 5.5 数据模型与持久化

`src/types/domain.ts`：

```ts
export type AnalysisStatus = 'completed' | 'low-confidence'

export interface MotionAnalysisFinding {
  id: string
  ruleId: string
  title: string
  detail: string
  timeMs: number | null
  measured: number | null
  unit?: string
  thresholdLabel: string
  sourceLabel: string
  sourceUrl?: string
  /** 本机 IndexedDB 引用；同步到其他设备后取不到图 */
  keyframeRef?: string
}

export interface MotionAnalysisMetric {
  id: string
  label: string
  value: number | string
  unit?: string
}

export interface MotionAnalysis {
  id: string
  userId: string
  date: string
  action: AnalysisAction
  exerciseName: string
  view: AnalysisView
  status: AnalysisStatus
  lowConfidenceReasons: string[]
  findings: MotionAnalysisFinding[]
  metrics: MotionAnalysisMetric[]
  repCount: number | null
  gaitCycles: number | null
  sessionId?: string
  ruleVersion: string
  createdAt: string
  clientId?: string
  serverId?: string
  updatedAt?: string
  _sync?: SyncState
}
```

- `storage.ts`：`StoredState.analyses`、`KEYS.analyses = 'twopoles.v1.analyses'`；load/save/clear 同步接入。
- `stores/app.ts`：新增 `analyses` 状态、`persistState` 纳入、`init` 读取、增量函数 `addAnalysis` / `removeAnalysis` / `linkAnalysisToSession`、`getUploadBatch` 纳入、`applyRemoteSnapshot` 合并与墓碑、`markAnalysisSynced`、`queueAnalysisSync`、`clearAllData` 清空并清关键帧。
- `outbox.ts`：新增 `'analysis'` kind 及合并分支（创建+更新合并、删除吸收）。
- `sync.ts`：`UploadBatch.analyses`、`SyncHandlers.analysis`、`executeOp` 分支、`conflictKind`。
- 删除记录：本机软删以 `deletedAt` 语义走现有墓碑机制（参考 sessions/meals 的 `deleted` 集合），本机即时移除列表项。

### 5.6 服务端

`UI/server/db.mjs` 新增表（SCHEMA 末尾 + 索引）：

```sql
CREATE TABLE IF NOT EXISTS motion_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  date TEXT NOT NULL,
  action TEXT NOT NULL,
  exercise_name TEXT NOT NULL,
  view TEXT NOT NULL,
  status TEXT NOT NULL,
  low_confidence_reasons TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  metrics TEXT NOT NULL DEFAULT '[]',
  rep_count INTEGER,
  gait_cycles INTEGER,
  session_id TEXT,
  rule_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_motion_analyses_user_date ON motion_analyses(user_id, date);
```

`UI/server/app.mjs` 新增：

| 方法 | 路径 | 用途 | 要点 |
|---|---|---|---|
| POST | `/analyses` | 新建 | `Idempotency-Key` = clientId；重复 clientId 返回首次结果；校验 action/view/status/字段长度；findings/metrics 各限 20/30 条 |
| GET | `/analyses?from&to` | 列表 | 软删过滤；按 `date DESC, created_at DESC` |
| PATCH | `/analyses/:id` | 关联训练记录 | 只接受 `{ sessionId: string \| null }`；session 必须归属当前用户且未删除 |
| DELETE | `/analyses/:id` | 软删 | 写 `deleted_at` |

- `/sync` 响应增加 `analyses[]` 与 `deleted.analyses[]`，since 过滤同现有口径。
- `/export` 与导出 worker 的 payload 增加 analyses。
- `/data/wipe`、`/auth/delete-account` 删除该用户 analyses 行。
- 服务端不接收、不存储任何视频或关键帧图片。

### 5.7 动作库与跟练

- `exercises.ts`：`EXERCISE_CATALOG_VERSION = 'exercise-catalog-v2'`；新增：
  - 深蹲（id `ex-squat`）：`type: '其他'`，`equipment: []`，`minutes: 3`，`sets: 3`，`reps: 10`，强度「中」，`camera: { joint: 'knee', neutral: 172, bottom: 95, minStageMs: 250 }`。
  - 硬拉（id `ex-deadlift`）：`type: '其他'`，`equipment: ['哑铃']`，`minutes: 4`，`sets: 3`，`reps: 8`，强度「中」，`camera: { joint: 'hip', neutral: 165, bottom: 95, minStageMs: 250 }`。
  - 两条 `howto` 只写动作说明，不写「标准姿势」结论；`source` 沿用自编条目声明。
- `CameraConfig['joint']` 扩展为 `'knee' | 'elbow' | 'hip'`；`PoseMetrics` 增加 `hipVisibility` / `hipSide`（按左右可见度择优，与膝/肘同口径）；`ExecutionView` 的 `camJoint` 与 `jointLabel` 支持髋角。
- `CAMERA_COUNTABLE` 增加「深蹲」「硬拉」。
- `demoCameraService.ts` 的 `demoExercises` 增加两条 `makeExercise`：深蹲 3×10、硬拉 3×8，`kind: 'knee'`，动作完成计入 `up` 阶段；不新增演示视频，沿用剪影与缺失提示。
- `motionRules.ts` 分析动作映射：`squat → 深蹲`、`deadlift → 硬拉`、`running → 跑姿`；分析动作列表独立于动作库，跑姿不对应 `Exercise`。
- 计划编排不改：`planRules.ts` 的 `mainTypes` 与目录顺序保持；新条目通过 `alternativesFor`（同类型、时长 ≤ 原项 + 2 分钟）进入替换候选。`PLAN_RULES_VERSION` 保持 `plan-rules-v3`。

### 5.8 UI 与路由

- `router/index.ts`：新增 `/analysis`（`AnalysisView.vue`，标题「动作分析」）与 `/analysis/:id`（`AnalysisDetailView.vue`，标题「分析详情」）。
- `SidebarNav.vue`、`MobileNav.vue`：新增「分析」入口，沿用现有图标与分组样式。
- `AnalysisView.vue`：历史列表 + 发起入口；发起流程用页内步骤或对话框（选动作 → 选文件 → 预检结果 → 进度 → 完成跳转详情），不引入向导依赖。
- 详情页：关注项卡片（含关键帧、出处、阈值、时间点）、测量值表、低置信度横幅、免责声明、关联训练记录选择器、删除入口。
- 复用现有按钮、表单、卡片、toast 与 tokens；不引入新依赖与图表库。
- 文案统一使用 CONTEXT.md 术语：动作分析、分析记录、分析视角、关注项、测量值、可分析性检查、低置信度结果。

### 5.9 计数状态机复用

- 从 `useRepCounter.ts` 抽出纯函数 `src/composables/repMachine.ts`：输入 `(angle, visibility, ts)` 与规则，输出阶段、是否完成一次、门禁文案；不含 Vue ref、不含 `performance.now` 校准循环。
- `useRepCounter` 改为薄包装，保持现有返回形状与行为不变；现有 selfcheck 第 5、24 节全部继续通过。
- 视频分析用同一状态机在 `MotionFrameSeries` 上顺序喂帧，得到重复次数与每次起止时间，供规则取关键帧指标。
- `poseMath.ts` 的 `computeMetrics` 保持不变；新增的逐侧提取放在 `motionAnalysis.ts` 的 `extractMotionFrame`，避免影响实时路径。

### 5.10 运动学指标（v1）

在关注项与测量值之外，新增纯函数运动学引擎 `src/services/motionKinematics.ts`，从已有逐帧角度与髋部位置派生：

- 膝/髋/躯干角速度（°/s）与角加速度（°/s²）；
- 髋部竖直速度/加速度，按躯干长度归一化，单位「躯干长/秒」「躯干长/秒²」；
- 每次重复的离心/向心峰值角速度与组内首次/末次对比。

实现口径：

- 用 `angleAtExact` / `trunkAngleAt` 的未取整角度，避免 1° 量化在二阶导数上放大；
- 每个关节整段固定一侧（按可见度累计择优），不做逐帧换侧；
- Savitzky–Golay 局部二次最小二乘，窗口 0.5 秒；缺口、低可见度、重复/倒退时间戳处切段，不插值、不补 0；二阶导数只在完整对称窗口内输出；
- 力量动作的峰值只统计识别到的完整重复区间，视频首尾准备/离开画面不计入；跑姿无 rep 结构，对全程取峰值；
- 运动学只生成 `kin-` 前缀测量值，不生成 finding、不设阈值；聚合指标进 `MotionAnalysis.metrics` 并同步；
- 逐帧 `kinematics` 只随 `MotionSeriesRecord` 存本机 IndexedDB，且仅在用户开启「保存动作数据」时写入；详情页无曲线时明确说明；
- 线速度不是 m/s：MediaPipe 世界坐标以髋中点为原点、不含整体平移，不能支撑对地速度。

`MotionAnalysisResult` 增加 `fps: number` 与 `kinematics?: MotionKinematics`；`MotionSeriesRecord` 增加可选 `kinematics`；`MotionKinematics` 字段见 `src/types/domain.ts`。

## 6. 测试决策

### 6.1 selfcheck（纯逻辑，必须）

在 `scripts/selfcheck.ts` 新增章节：

**视频分析规则（合成帧序列，不依赖真实视频）**
- `detectView`：构造侧/正/模糊三组合成帧，判定正确、`unknown` 不误判为侧面。
- 深蹲：完整 3 次、深度不足、膝角过小、躯干前倾过大、正面膝内扣、左右差测量值。
- 硬拉：起拉躯干角突变、锁定后仰、锁定不完整、髋角测量值。
- 跑姿：5 个步态周期步频计算、周期不足 4 个 → 降级、触地膝角、躯干角、左右触地时间差。
- 预检：视角未知 → rejected；力量动作检测到交替步态 → rejected；遮挡帧占比高 → degraded；重复 0 次 → degraded 且 `findings` 为空。
- 规则配置：每条 finding 规则的 `source.label` 非空且不是占位文案；finding 与 metric 的 `output` 分类稳定；关注项/测量值上限生效。
- 结果顺序稳定、同规则去重、规则版本写入。

**分析记录与同步**
- 分类 key 落盘 `twopoles.v1.analyses`；旧状态无该 key 按空处理。
- outbox：analysis 创建+更新合并、删除吸收、重复入队不重复。
- `getUploadBatch` 包含 pending analyses；`applyRemoteSnapshot` 合并与墓碑不丢记录。
- 清除全部数据后 analyses 清空（关键帧清空用 mock 断言调用）。

**计数状态机回归**
- 抽取 `repMachine` 后，现有第 5、24 节全部通过；新增「视频帧序列离线喂养」与实时喂养结果一致。

### 6.2 服务端 `server/api.test.mjs`

- POST /analyses 幂等重放返回首次结果；同 clientId 不产生第二行。
- 字段校验：action/view/status 非法、findings 超限被拒。
- GET 列表按日期倒序、软删过滤。
- PATCH 关联：只能关联本人未删 session；他人 session 拒绝。
- DELETE 软删后 `/sync` 返回墓碑；账号隔离；wipe 清空。
- 既有测试全部通过（sessions/meals/plans/sync/export）。

### 6.3 构建与浏览器

- `npm run typecheck`、`npm run selfcheck`、`npm run build` 全通过。
- `npm run dev` 与 `npm run preview` 各验证一次；393/768/1024/1440 宽度无横向溢出。
- 用三条真实视频（深蹲侧拍、硬拉侧拍、跑姿跑步机侧拍）手工验证：上传 → 预检 → 分析 → 关注项/测量值 → 关键帧 → 落库 → 历史回看。
- 边界：超大文件、超时长、非视频文件、无人视频、正面/侧面各一条、遮挡视频、跑姿周期不足、取消分析、模型缺失。
- 同步：登录后上行、换设备/清缓存后拉回（关键帧显示「仅保存在拍摄设备」）、导出包含 analyses、清除全部数据后列表与 IndexedDB 均空。
- 动作库：深蹲/硬拉出现在计划替换候选；跟练页可启动并用摄像头计数；跑姿不出现在计划与跟练。

### 6.4 验收标准（用户已确认）

1. **全链路跑通**：深蹲、硬拉、跑姿各至少 1 条真实视频，从上传 → 可分析性检查 → 分析 → 问题清单 → 落库 → 回看全链路可用。
2. **规则可追溯**：每个关注项都显示文献出处与「未经专业审核」声明；无出处的项不出现在关注项。
3. **边界路径可见**：拒绝、低置信度降级、超限、无人/解码失败都有明确文案与重拍/转码指引，不出现误导性结果。

## 7. 明确不做

- 不上传视频、不做服务端视频存储/分析、不做账号外分享与教练端。
- 不做手动选择分析视角；不自动识别动作种类（用户先选）。
- 不做卧推、引体、跳跃等其他动作；不做一条视频里自动切换动作。2026-11-24 新增的站姿弯举、平板支撑只做测量，不生成关注项；卧推/引体/跳跃仍不做。
- 不做综合评分、星级、百分比或「标准/不标准」结论。
- 不做视频留存与回放；不改变 `privacy.saveVideoLocally`（该设置仍未实现）。
- 不做骨骼叠加回放、时间轴播放器、逐帧浏览。
- 不做双机位合并报告（侧面、正面分别分析两条视频）。
- 不做历史趋势/进步对比图；不做与报告页的聚合。
- 不做足底压力、落地方式精确分类（足部关键点精度不足，只做代理测量）。
- 不做 m/s 绝对速度、对地速度、跑动整体位移；不接入摄像机标定、已知尺度参照物或地面坐标系重建。
- 不做实时跟练的速度反馈；运动学引擎本次只接离线分析。
- 不做跨会话速度趋势图；只做单次分析内的逐次峰值对比。
- 不做实时摄像头录制后分析；实时路径继续只计数。
- 不新增定时清理关键帧的保留期作业；只在删除记录和清除全部数据时清理。
- 不改变自动计划编排（深蹲/硬拉只进替换候选）；不改 `plan-rules-v3`。
- 不做饮食、报告、计划的联动推断。

## 8. 迁移与边界

- 旧 localStorage 没有 `twopoles.v1.analyses` / outbox 中无 analysis kind：按空处理。
- 旧服务端数据无 `motion_analyses` 表：`openDatabase` 用 `CREATE TABLE IF NOT EXISTS` 自动建表。
- 新增动作只影响替换候选与跟练入口；历史计划与历史记录不改写。`EXERCISE_CATALOG_VERSION` 升到 `v2`，历史训练记录只存动作名，无需迁移。
- `useRepCounter` 抽取纯状态机属于行为保持不变的重构；以现有 selfcheck 为回归门槛。
- 视频编码支持取决于浏览器：HEVC/MOV 在部分浏览器无法解码，按「无法解码」提示转码；不内置转码。
- 多人画面沿用 `numPoses: 1` 的现状，只分析模型返回的主要人体；预检不通过多人场景的质量判定。
- 跑姿采样 30fps 仅覆盖前 20 秒；超过部分不分析，进度与结果页注明分析区间。
- 触地时间、垂直振幅、步频为姿态代理指标，标注「代理测量，非测力台/传感器数据」。
- 分析结果不是诊断，也不能替代教练或康复师；文案不得暗示医疗建议。
- 关键帧仅存单帧截图，不含音频与连续视频；清除记录即删图。