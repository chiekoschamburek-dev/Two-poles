// 合成关键点验证：可在纯 node 跑，隔离「几何数学误差」与「真实视频识别误差」。
// 真实视频的角度/问题识别准确率必须走 run-eval.mjs（浏览器 + MediaPipe），这里拿不到。
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { computeMetrics } from '@/composables/poseMath'
import { createRepMachine } from '@/composables/repMachine'
import {
  extractMotionFrame,
  measureJointAngle,
  measureTrunkAngle,
  type MotionFrame
} from '@/services/motionAnalysis'

const DEG = Math.PI / 180
const KNEE = { x: 0.5, y: 0.6 }
const SEGMENT = 0.2
const TORSO = 0.4
/** 大腿指向：图像坐标 y 向下，负角表示髋在膝上方 */
const THIGH_DEG = -82

interface SweepRow {
  truth: number
  realtime: number | null
  offline: number | null
}

/** 按已知膝角构造 BlazePose 关键点数组；真值就是构造角，无标注误差。 */
function landmarksForKnee(kneeDeg: number, opts: { visibility?: number; jitter?: number; seed?: number } = {}): NormalizedLandmark[] {
  const visibility = opts.visibility ?? 0.95
  const jitter = opts.jitter ?? 0
  let state = opts.seed ?? 1
  // 确定性伪随机：同一 seed 必须复现，否则 test–retest 数字没有意义
  const noise = () => {
    if (!jitter) return 0
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return ((state / 0x7fffffff) * 2 - 1) * jitter
  }
  const at = (deg: number, length: number) => ({
    x: KNEE.x + length * Math.cos(deg * DEG) + noise(),
    y: KNEE.y + length * Math.sin(deg * DEG) + noise(),
    z: 0,
    visibility
  })
  const hip = at(THIGH_DEG, SEGMENT)
  const ankle = at(THIGH_DEG + kneeDeg, SEGMENT)
  const shoulder = { x: hip.x, y: hip.y - TORSO, z: 0, visibility }
  const points: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  for (const index of [11, 12]) points[index] = { ...shoulder }
  for (const index of [23, 24]) points[index] = { ...hip }
  for (const index of [25, 26]) points[index] = { ...KNEE, z: 0, visibility }
  for (const index of [27, 28]) points[index] = { ...ankle }
  // 肘/腕给可见值，避免实时侧 6 点均值被无关关节拖低
  for (const index of [13, 14]) points[index] = { x: shoulder.x, y: shoulder.y + 0.15, z: 0, visibility }
  for (const index of [15, 16]) points[index] = { x: shoulder.x, y: shoulder.y + 0.3, z: 0, visibility }
  return points
}

function sweep(opts: { visibility?: number; jitter?: number } = {}): SweepRow[] {
  const rows: SweepRow[] = []
  for (let truth = 60; truth <= 180; truth += 5) {
    const landmarks = landmarksForKnee(truth, { ...opts, seed: truth })
    const frame: MotionFrame = extractMotionFrame(landmarks, 0)
    rows.push({
      truth,
      realtime: computeMetrics(landmarks).kneeAngle,
      offline: measureJointAngle(frame, 'knee').angle
    })
  }
  return rows
}

function errors(rows: SweepRow[], key: 'realtime' | 'offline'): number[] {
  return rows.filter(row => row[key] !== null).map(row => Math.abs((row[key] as number) - row.truth))
}

const max = (values: number[]) => values.length ? Math.max(...values) : NaN
const mean = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN
function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

let failed = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`)
  else { failed++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}

const report: Record<string, unknown> = { generatedBy: 'synthetic.ts', note: '合成几何，非真实视频准确率' }

console.log('\nS1. 角度扫描 60–180°（无噪声）：隔离几何数学误差')
const clean = sweep()
const cleanRealtime = errors(clean, 'realtime')
const cleanOffline = errors(clean, 'offline')
// 两条路径都用 Math.round 到整度，理论最大误差 0.5°
ok('实时几何最大误差 ≤ 0.5°', max(cleanRealtime) <= 0.5, `实测 ${max(cleanRealtime)}°`)
ok('离线几何最大误差 ≤ 0.5°', max(cleanOffline) <= 0.5, `实测 ${max(cleanOffline)}°`)
ok('两条路径逐点一致', clean.every(row => row.realtime === row.offline))
ok('扫描覆盖 25 个角度且无 null', clean.length === 25 && clean.every(r => r.realtime !== null && r.offline !== null))
report.angleSweepClean = {
  samples: clean.length,
  realtime: { maxError: max(cleanRealtime), meanError: mean(cleanRealtime) },
  offline: { maxError: max(cleanOffline), meanError: mean(cleanOffline) },
  parityMismatches: clean.filter(r => r.realtime !== r.offline).length
}

console.log('\nS2. 关键点抖动鲁棒性（±0.005 归一化坐标噪声）')
const jittered = sweep({ jitter: 0.005 })
const jitterErrors = errors(jittered, 'offline')
ok('抖动下 p95 误差 ≤ 6°', percentile(jitterErrors, 0.95) <= 6, `实测 ${percentile(jitterErrors, 0.95)}°`)
ok('抖动下无 null 角度', jittered.every(r => r.offline !== null))
report.angleSweepJitter = {
  jitterNormalized: 0.005,
  maxError: max(jitterErrors),
  meanError: mean(jitterErrors),
  p95Error: percentile(jitterErrors, 0.95)
}

console.log('\nS3. 低可见度：角度仍算得出，但质量门控必须拦住')
const dim = sweep({ visibility: 0.2 })
ok('低可见度仍返回角度（几何与门控解耦）', dim.every(r => r.offline !== null))
const dimFrame = extractMotionFrame(landmarksForKnee(100, { visibility: 0.2 }), 0)
ok('帧级可见度反映低可见度', dimFrame.visibility < 0.5, `实测 ${dimFrame.visibility}`)
ok('关节可见度取三点最小值', measureJointAngle(dimFrame, 'knee').visibility <= 0.2 + 1e-9)
report.lowVisibility = { frameVisibility: dimFrame.visibility, jointVisibility: measureJointAngle(dimFrame, 'knee').visibility }

console.log('\nS4. 缺失关键点：可见度口径不得把缺失当成可见')
const missing = landmarksForKnee(100)
missing[24] = { x: 0, y: 0, z: 0, visibility: 0 }
const missingFrame = extractMotionFrame(missing, 0)
ok('离线帧级可见度因缺失下降', missingFrame.visibility < 0.95, `实测 ${missingFrame.visibility}`)
report.missingLandmark = { offlineFrameVisibility: missingFrame.visibility, realtimeFrameVisibility: computeMetrics(missing).visibility }

console.log('\nS5. 躯干前倾角：已知倾角对照')
const trunkRows: { truth: number; measured: number | null }[] = []
for (let lean = 0; lean <= 60; lean += 10) {
  const hip = { x: 0.5, y: 0.6, visibility: 0.95 }
  const shoulder = { x: hip.x + TORSO * Math.sin(lean * DEG), y: hip.y - TORSO * Math.cos(lean * DEG), visibility: 0.95 }
  trunkRows.push({ truth: lean, measured: measureTrunkAngle(shoulder, hip) })
}
const trunkErrors = trunkRows.filter(r => r.measured !== null).map(r => Math.abs((r.measured as number) - r.truth))
ok('躯干角最大误差 ≤ 0.5°', max(trunkErrors) <= 0.5, `实测 ${max(trunkErrors)}°`)
report.trunkSweep = { samples: trunkRows.length, maxError: max(trunkErrors) }

console.log('\nS6. 状态机计数：已知次数的合成序列')
const SQUAT_RULE = { neutral: 172, bottom: 95, hysteresis: 8, minStageMs: 200, minRepMs: 500, maxStageMs: 8000, minVisibility: 0.5 }
/** 每次：5 帧起始位 → 8 帧下降 → 5 帧底部 → 8 帧上升 → 5 帧回位，15fps */
function squatFrames(reps: number, bottomKnee: number, fps = 15): MotionFrame[] {
  const frames: MotionFrame[] = []
  const step = 1000 / fps
  let t = 0
  const push = (angle: number) => {
    frames.push(extractMotionFrame(landmarksForKnee(angle), Math.round(t)))
    t += step
  }
  for (let rep = 0; rep < reps; rep++) {
    for (let i = 0; i < 5; i++) push(172)
    for (let i = 1; i <= 8; i++) push(172 + (bottomKnee - 172) * (i / 8))
    for (let i = 0; i < 5; i++) push(bottomKnee)
    for (let i = 1; i <= 8; i++) push(bottomKnee + (172 - bottomKnee) * (i / 8))
    for (let i = 0; i < 5; i++) push(172)
  }
  return frames
}
function countReps(frames: MotionFrame[], rule = SQUAT_RULE): number {
  const machine = createRepMachine(rule)
  for (const frame of frames) {
    const sample = measureJointAngle(frame, 'knee')
    machine.feed(sample.angle, sample.visibility, frame.timeMs)
  }
  return machine.snapshot().count
}
const countRows: { truth: number; counted: number }[] = []
for (const reps of [1, 3, 5, 10]) {
  const counted = countReps(squatFrames(reps, 90))
  countRows.push({ truth: reps, counted })
  ok(`合成 ${reps} 次深蹲计数准确`, counted === reps, `实测 ${counted}`)
}
report.repCountSynthetic = { rows: countRows, exactMatch: countRows.every(r => r.truth === r.counted) }

console.log('\nS7. 遮挡冻结：中途丢关键点不得虚增次数')
const occluded = squatFrames(3, 90)
for (let i = 40; i < 50; i++) {
  occluded[i] = { ...occluded[i], visibility: 0.1, points: Object.fromEntries(
    Object.entries(occluded[i].points).map(([joint, sides]) => [joint, {
      left: sides.left ? { ...sides.left, visibility: 0.1 } : null,
      right: sides.right ? { ...sides.right, visibility: 0.1 } : null
    }])
  ) } as MotionFrame
}
const occludedCount = countReps(occluded)
ok('遮挡段不计入次数', occludedCount <= 3, `实测 ${occludedCount}`)
report.occlusion = { truth: 3, counted: occludedCount }

console.log('\nS8. 时序常量策略对比：offline(200/500/8000) vs realtime(250/700/6000)')
const REALTIME_RULE = { ...SQUAT_RULE, minStageMs: 250, minRepMs: 700, maxStageMs: 6000 }
const policyRows: { reps: number; bottom: number; offline: number; realtime: number }[] = []
for (const reps of [1, 3, 5, 10]) {
  for (const bottom of [90, 110, 130]) {
    const frames = squatFrames(reps, bottom)
    policyRows.push({ reps, bottom, offline: countReps(frames, SQUAT_RULE), realtime: countReps(frames, REALTIME_RULE) })
  }
}
const policyDelta = policyRows.filter(r => r.offline !== r.realtime)
console.log(`  两种策略在 ${policyRows.length} 组合中有 ${policyDelta.length} 组计数不同`)
report.timingPolicyComparison = { rows: policyRows, divergent: policyDelta }

console.log('\nS9. 最低点自遮挡回归：真实深蹲在底部可见度会掉到 0.5 以下')
// 这是实测 sit-to-stand.mp4 暴露的结构性缺陷：旧实现一遮挡就 clearMovement，
// 把「必须到达底部才计数」的那一段抹掉，真实视频恒计 0 次；而合成夹具把可见度写死 0.95，永远测不出来。
function flexionDipFrames(reps: number, dipFrames: number, fps = 15): MotionFrame[] {
  const frames: MotionFrame[] = []
  const step = 1000 / fps
  let t = 0
  const push = (angle: number, visibility: number) => {
    const landmarks = landmarksForKnee(angle, { visibility })
    frames.push(extractMotionFrame(landmarks, Math.round(t)))
    t += step
  }
  for (let rep = 0; rep < reps; rep++) {
    for (let i = 0; i < 5; i++) push(172, 0.95)
    for (let i = 1; i <= 8; i++) push(172 + (90 - 172) * (i / 8), 0.95)
    // 底部自遮挡：可见度掉到 0.45，角度同时变得不可信（实测就是 5°/82°/37° 这种乱跳）
    for (let i = 0; i < dipFrames; i++) push(i % 2 ? 82 : 35, 0.45)
    for (let i = 1; i <= 8; i++) push(90 + (172 - 90) * (i / 8), 0.95)
    for (let i = 0; i < 5; i++) push(172, 0.95)
  }
  return frames
}
const dip800 = flexionDipFrames(3, 12) // 12 帧 @15fps ≈ 800ms，接近实测 867ms
const dipCount = countReps(dip800)
ok('底部遮挡 800ms 仍能数满 3 次', dipCount === 3, `实测 ${dipCount}`)
const dipLong = flexionDipFrames(3, 30) // 2 秒，超出宽限期
const dipLongCount = countReps(dipLong)
ok('底部遮挡 2s 超宽限期则放弃该次', dipLongCount < 3, `实测 ${dipLongCount}`)
const noGrace = countReps(dip800, { ...SQUAT_RULE, maxOcclusionMs: 0 })
ok('宽限期设 0 复现旧行为（恒计 0）', noGrace === 0, `实测 ${noGrace}`)
report.flexionOcclusion = {
  dipMs: 800, truth: 3, withGrace: dipCount, withoutGrace: noGrace,
  overGraceDipMs: 2000, overGraceCount: dipLongCount
}

console.log('\nS10. 遮挡宽限期扫描：确认取值不是对单一片子过拟合')
const graceRows: { graceMs: number; dipMs: number; counted: number }[] = []
for (const graceMs of [0, 300, 600, 1000, 1500]) {
  for (const dipFrames of [6, 12, 18]) {
    graceRows.push({
      graceMs, dipMs: Math.round(dipFrames * 1000 / 15),
      counted: countReps(flexionDipFrames(3, dipFrames), { ...SQUAT_RULE, maxOcclusionMs: graceMs })
    })
  }
}
report.graceSweep = graceRows
console.log(`  ${graceRows.length} 组合已记录（见 JSON graceSweep）`)

console.log(`\n合成验证：失败 ${failed} 项`)
console.log('\n=== JSON ===')
console.log(JSON.stringify(report, null, 2))
if (failed) process.exitCode = 1