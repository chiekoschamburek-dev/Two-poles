# 真值标注目录

放 `<clip>.json`，文件名 = `run-eval.mjs` 里素材的 basename（如 `peso-muerto.json`、`test_squat.json`）。
没有对应文件时，报告会如实标 `untested` / `未标注`，不会编造准确率。

## Schema

```json
{
  "clip": "test_squat",
  "sha256": "…（data_demo/selected/manifest.json 里有就填）",
  "fps": 15,
  "view": "front",
  "action": "squat",
  "reps": [{ "startMs": 0, "endMs": 2400, "bottomMs": 1400 }],
  "gaitCycles": null,
  "phases": [{ "startMs": 200, "endMs": 900, "label": "descent" }],
  "angleKeys": [
    { "timeMs": 1400, "joint": "knee", "side": "left", "refAngleDeg": 88.4, "method": "digitized" }
  ],
  "issues": [{ "ruleId": "SQ-SE-01", "present": true, "repIndex": 3 }]
}
```

- `phases.label`：`top | descent | bottom | ascent`
- `angleKeys.joint`：`knee | hip | trunk`
- `angleKeys.method`：目前只支持 `digitized`（在 `eval/motion-eval.html` 上依次点 髋→膝→踝 得到）

## 怎么标

1. `npm run dev`，浏览器打开 `http://127.0.0.1:5173/eval/motion-eval.html`
2. 选择视频 → 用 `±1 帧` 走到目标时刻
3. 角度真值：依次点三个关节点，右下角读出参考角，抄进 `angleKeys`
4. 次数 / 阶段 / 问题有无：目视逐帧判定，约 10 分钟一片

## 口径说明

人工点击精度约 ±3–5°，所以 `angleAgreement` 的含义是**与人工数字化的一致性**，不是绝对真值。
绝对角度误差需要 mocap 或厂家标注，本项目没有，不要写成"角度误差 X°"。

库存素材（Pexels / Wikimedia）机位、人物、速度都不受控，**只能逐片报告**，
不要跨片聚合成一个"计数准确率"。干净的多次重复真值得用固定机位自录。
