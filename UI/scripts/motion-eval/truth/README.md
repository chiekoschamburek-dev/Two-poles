# 真值标注目录

放 `<clip>.json`，文件名 = `run-eval.mjs` / `replay.ts` 里素材的 basename（如 `peso-muerto.json`、`test_squat.json`）。
没有对应文件时，报告会如实标 `untested` / `未标注`，不会编造准确率。

## 状态约定

- `annotationStatus`: `provisional`（关键帧初标，待用户抽查）| `reviewed`（用户确认后冻结）| `pending`（未标）。
- `annotator` / `reviewedBy`: 谁标的、谁复核的。`reviewedBy` 为 `null` 时不得当作最终真值对外引用。
- 库存素材只能逐片报告，**不要跨片聚合成一个“准确率”**。干净统计集需要固定机位自录。

## Schema（schemaVersion 2）

```json
{
  "schemaVersion": 2,
  "clip": "test_squat",
  "annotationStatus": "provisional",
  "annotator": "agent (keyframe review 2026-11-26)",
  "reviewedBy": null,
  "source": "data_demo/test_squat.mp4",
  "fps": 15,
  "durationSec": 9.93,
  "action": "squat",
  "movementFamily": "strength",
  "view": "front",
  "viewNote": "正面拍摄；深度类规则不适用",
  "activeIntervals": [{ "startMs": 0, "endMs": 9900 }],
  "reps": [{ "startMs": 500, "bottomMs": 1300, "endMs": 1800 }],
  "partialRepetitions": [{ "startMs": 8800, "endMs": 15200, "kind": "descent-only", "note": "只坐下未起身" }],
  "gaitCycles": null,
  "gaitSubtype": "run | walk | null",
  "issues": [{ "ruleId": "SQ-SE-01", "present": true, "repIndex": 3 }],
  "angleKeys": [
    { "timeMs": 1400, "joint": "knee", "side": "left", "refAngleDeg": 88.4, "method": "digitized" }
  ],
  "notes": "自由文本，记录反例与拍摄条件"
}
```

字段口径：

- `action`: `squat | deadlift | running | walk | sit-to-stand | curl | plank | ...`
- `movementFamily`: `strength | locomotion | isometric | other`
- `view`: `side | front | oblique`。背向/冠状面拍摄归 `front`（在 `viewNote` 说明）；3/4 机位归 `oblique`。
- `reps`: **只放完整重复**，必须能看出起始位 → 底部 → 回到起始位。
- `partialRepetitions.kind`: `ascent-only | descent-only | occluded-cycle`。半程与遮挡不得混入 `reps`。
- `gaitCycles`: 完整步态周期数；`gaitSubtype` 区分跑/走。
- `issues`: 只标你确认存在的问题；没有标注就留空，报告会标 `untested`。
- `angleKeys`: 人工点击数字化，精度约 ±3–5°；这是与人工读数的一致性，不是 mocap 绝对真值。

## 怎么标

1. `npm run dev`，浏览器打开 `http://127.0.0.1:5173/eval/motion-eval.html`
2. 选择视频 → 用 `±1 帧` 走到目标时刻
3. 角度真值：依次点三个关节点，右下角读出参考角，抄进 `angleKeys`
4. 次数 / 阶段 / 问题有无：目视逐帧判定，约 10 分钟一片
5. 标完先写 `annotationStatus: "provisional"`；用户抽查后再改 `reviewed` 并填 `reviewedBy`

## 当前 7 条的重点

- `sit-to-stand`: 只有坐下没有起身，`reps` 必须为空，另记 1 次 `descent-only`。
- `peso-muerto`: 第二次硬拉中段黑屏约 6 秒，记 `occluded-cycle`，不计完整次数。
- `deadlift-demo`: 首尾各一次半程，中间才是完整 1 次；视角为背向 3/4。
- `peso-muerto-sumo`: 实际是侧拍；相扑站距沿镜头轴展开，本片不可评估。
- `easy-run`: 背向跑，步频 121 低于旧 140 门槛，但仍是跑步。
- `brisk-walk`: 步行，不应套深蹲或跑姿结论。
- `test_squat`: 4 次浅蹲，V1 计数本来就是 4；它测的是分类/视角，不是计数。

## 口径说明

人工点击精度约 ±3–5°，所以 `angleAgreement` 的含义是**与人工数字化的一致性**，不是绝对真值。
绝对角度误差需要 mocap 或厂家标注，本项目没有，不要写成“角度误差 X°”。