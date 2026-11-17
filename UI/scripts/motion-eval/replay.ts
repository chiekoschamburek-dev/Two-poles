// 用已 dump 的真实视频帧重跑引擎：换阈值/换策略后不必重推理。
// 用法：npm run eval:replay [-- --grace 1000] [-- --clip sit-to-stand]
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRepMachine } from '@/composables/repMachine'
import { configForAction, repRuleFor } from '@/services/motionConfig'
import { analyzeMotion, type MotionFrame } from '@/services/motionAnalysis'
import type { AnalysisAction, AnalysisView } from '@/types/domain'

// esbuild 把产物放到 UI 根，import.meta.url 会失真；npm 脚本的 cwd 就是 UI 根
const BASELINE = resolve(process.cwd(), 'scripts/motion-eval/baseline')
const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const graceArg = flag('grace', '')
const onlyClip = flag('clip', '')

/** series.json 里只存了角度与可见度，重建 MotionFrame 需要坐标；这里用 landmarks 反推。 */
function framesFromSeries(series: { frames: Record<string, unknown>[] }): MotionFrame[] {
  const point = (landmarks: { x: number; y: number; v: number }[], index: number) => {
    const raw = landmarks[index]
    return raw ? { x: raw.x, y: raw.y, visibility: raw.v } : null
  }
  return series.frames.map(row => {
    const landmarks = row.landmarks as { x: number; y: number; v: number }[]
    const pair = (left: number, right: number) => ({ left: point(landmarks, left), right: point(landmarks, right) })
    return {
      timeMs: row.timeMs as number,
      visibility: row.visibility as number,
      points: {
        shoulder: pair(11, 12), hip: pair(23, 24), knee: pair(25, 26),
        ankle: pair(27, 28), heel: pair(29, 30), toe: pair(31, 32)
      }
    }
  })
}

function countWith(frames: MotionFrame[], action: AnalysisAction, graceMs: number | null): number {
  const config = configForAction(action)
  if (!config) return 0
  const rule = repRuleFor(config, 'offline')
  const machine = createRepMachine(graceMs === null ? rule : { ...rule, maxOcclusionMs: graceMs })
  for (const frame of frames) {
    // 与 segmentReps 同口径：取驱动关节的三点可见度最小值
    const joint = config.joint === 'hip' ? 'hip' : 'knee'
    const sides = frame.points[joint]
    const side = sides.right && sides.left
      ? (sides.right.visibility > sides.left.visibility ? 'right' : 'left')
      : (sides.right ? 'right' : 'left')
    const hip = frame.points.hip[side]
    const knee = frame.points.knee[side]
    const ankle = frame.points.ankle[side]
    const shoulder = frame.points.shoulder[side]
    const a = joint === 'hip' ? shoulder : hip
    const v = knee
    const b = joint === 'hip' ? knee : ankle
    let angle: number | null = null
    let visibility = 0
    if (a && v && b) {
      const u = { x: a.x - v.x, y: a.y - v.y }
      const w = { x: b.x - v.x, y: b.y - v.y }
      const mag = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)
      if (mag) angle = Math.round(Math.acos(Math.min(1, Math.max(-1, (u.x * w.x + u.y * w.y) / mag))) * 180 / Math.PI)
      visibility = Math.min(a.visibility, v.visibility, b.visibility)
    }
    machine.feed(angle, visibility, frame.timeMs)
  }
  return machine.snapshot().count
}

if (!existsSync(BASELINE)) { console.error('还没有基线序列，先跑 npm run eval:motion'); process.exitCode = 1 }
else {
  const files = readdirSync(BASELINE).filter(f => f.endsWith('.series.json') && (!onlyClip || f.startsWith(onlyClip)))
  console.log('clip'.padEnd(20) + 'action'.padEnd(10) + 'view'.padEnd(8) + 'grace=0'.padEnd(9) + 'grace=1000'.padEnd(12) + 'engine'.padEnd(8) + 'findings')
  for (const file of files) {
    const series = JSON.parse(readFileSync(resolve(BASELINE, file), 'utf8'))
    const frames = framesFromSeries(series)
    const action = series.action as AnalysisAction
    const view = (series.view ?? 'side') as AnalysisView
    const old = countWith(frames, action, 0)
    const now = countWith(frames, action, graceArg ? Number(graceArg) : 1000)
    const result = analyzeMotion({ action, view, fps: series.fps, frames })
    console.log(
      series.clip.padEnd(20) + action.padEnd(10) + String(view).padEnd(8)
      + String(old).padEnd(9) + String(now).padEnd(12)
      + String(result.repCount ?? result.gaitCycles ?? '—').padEnd(8) + String(result.findings.length)
    )
  }
  console.log('\n注：grace=0 复现修复前行为；engine 列是统一几何后 analyzeMotion 的实际计数。')
}