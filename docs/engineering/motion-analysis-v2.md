# 动作分析引擎 v2

本页说明 `apps/web/src/services/motion-engine/` 的口径、版本与真值边界。代码以纯函数为主，不碰 DOM；离线分析（视频）与实时跟练共用同一套时序特征。

## 一句话定位

**本机 2D 单目测量，逐帧看动作，不评分。** 输出三类东西：测量值、关注项（有文献阈值且通过准入门槛）、参考观察（证据不足时只提示）。不生成"正确/错误"判词，也不把测量值包装成结论。

## 管线

```
视频 → 抽帧（MediaPipe Pose）
     → 姿态质量（可用帧占比、关键点可见度）
     → 全片粗扫 + 活跃区间（替代旧的"只看前 10 秒"）
     → 区间精扫（15fps 力量动作 / 30fps 步态）
     → 视角估计（多证据：肩髋投影、躯干朝向、左右对称、时序稳定性；输出 side/front/oblique + 置信）
     → 动作识别（大类分流 → 软打分 → 未知拒识；跑步/走路/坐站/深蹲/硬拉/弯举/平板）
     → 分段与计数（自适应状态机：浅蹲/半程/遮挡、目标切换只认位置持续迁移）
     → 逐次测量 + 规则准入（ruleRequirementFailure / applyRecurrenceGate）
     → 六层证据打包（evidence）→ 结果页 / 本机记录 / 服务端 evidence 列
```

## 模块

| 目录 | 职责 |
|---|---|
| `core/` | 类型与版本常量（engine / feature / config / rules / model） |
| `pose/quality.ts` | 姿态质量：可用帧、关键点可见度、问题清单 |
| `features/series.ts` | 共享时序特征层（角度、速度、幅度、相位） |
| `recognition/features.ts` | 动作特征（膝屈深度、髋铰链占比、踝膝位移、左右交替…） |
| `recognition/family.ts` | 大类分流（力量 / 步态 / 核心保持 / 上臂） |
| `recognition/actions.ts` | 软打分与候选分差，**不再用"膝角 ≤100 就是深蹲"这类硬二值** |
| `view/estimate.ts` | 多证据视角估计 + 斜侧准入 |
| `segmentation/reps.ts` | 自适应分段与计数（半程/遮挡/目标切换） |
| `temporal/` | 活跃区间、峰值、相关性、步态事件 |
| `evidence/evidence.ts` | 六层证据 JSON（compact 后 ≤6KB/条） |
| `pipeline/precheck.ts` | 预检结论（ok / degraded / rejected 的原因） |

`motionAnalysis.ts` 仍是编排层（读帧 → 调引擎 → 组结果 → 规则），但**新增逻辑应优先放进 `motion-engine/`**，不要再让它变胖。

## 六层证据

`pose → action → view → event → metric → finding`，每层记录"测到了什么、为什么这么判、哪些没评"。用途：

- 结果页解释为什么某个关注项没给出（证据不足 vs 未越界）；
- 本机历史记录与服务端 `motion_analyses.evidence` 列可复查；
- 趋势按 `ruleVersion` + `engineVersion` 断线，口径变了不混算。

## 真值与评测

- `apps/web/scripts/motion-eval/truth/*.json`：7 条真实素材的人工标注，`annotationStatus: provisional`、`reviewedBy: null`（**agent 标注，未人工复核**）。
- `apps/web/scripts/motion-eval/fixtures/`：冻结的逐帧序列 + `manifest.json`（sha256）；`--gate` 先校验再评测，防止改真值让测试变绿。
- 命令：`npm run eval:replay -- --gate`。当前 7/7 通过。
- **容差**：步态周期允许 ±1–2（2D 姿态下人工标注不确定度，写在 truth 的 `gaitCyclesTolerance` 与 notes）；**重复次数仍要求精确**。

## 已知限制

- 2D 单目角度受机位与透视影响，绝对角度误差通常 ±10–20°；因此规则带不确定带，证据不足时降级为"参考观察"。
- 斜侧（oblique）机位只做准入与对称性参考，不给深度类结论。
- 真值为 provisional：`eval:replay` 全绿只代表"引擎与标注一致"，**不等于**人体工效学准确率，对外不要这样表述。
- 尚无学习模型；`modelVersion` 为 `rule-baseline-0` 占位。

## 改动规则

1. 改阈值/权重前先跑 `npm run eval:replay -- --gate`，再跑 `npm run selfcheck`；
2. 新增动作模板要在 `motionTemplates.ts` 登记 `views / requiredPoints / findingsReady`，没有可核验文献阈值时 `findingsReady: false`（只出测量值，见 ADR-0003）；
3. 规则版本或引擎版本变化时升 `MOTION_RULES_VERSION` / `MOTION_ENGINE_VERSION`，趋势会自动断线。