// 用已 dump 的真实视频帧重跑引擎：换阈值/换策略后不必重推理。
// M0 起：读 truth/*.json，逐片报告动作/视角/计数/步态，可选 --gate 做回归门禁。
//
// 用法：
//   npm run eval:replay
//   npm run eval:replay -- --clip sit-to-stand
//   npm run eval:replay -- --oracle
//   npm run eval:replay -- --gate
//   npm run eval:replay -- --features            # 导出 M1 共享特征/质量/活跃区间（真实素材可复查）
//   npm run eval:replay -- --freeze scripts/motion-eval/baseline/v1-frozen.json
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  analyzeMotion,
  classifyTemplate,
  detectView,
  type MotionFrame
} from '@/services/motionAnalysis'
import { buildMotionFeatureSeries, detectActiveWindows, planAnalysisWindow } from '@/services/motion-engine'
import { coarseGridTimes } from '@/services/motion-engine/pipeline/precheck'
import type { AnalysisAction, AnalysisView } from '@/types/domain'

// esbuild 把产物放到 UI 根，import.meta.url 会失真；npm 脚本的 cwd 就是 UI 根
const BASELINE = resolve(process.cwd(), 'scripts/motion-eval/baseline')
const TRUTH_DIR = resolve(process.cwd(), 'scripts/motion-eval/truth')
const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const has = (name: string) => args.includes(`--${name}`)
const onlyClip = flag('clip', '')
const actionOverride = flag('action', '')
const viewOverride = flag('view', '')
const oracle = has('oracle')
const gate = has('gate')
const jsonOut = has('json')
const featuresOut = has('features')
const freezePath = flag('freeze', '')

type TruthView = 'side' | 'front' | 'oblique'

interface TruthRep {
  startMs: number
  bottomMs: number
  endMs: number
}

interface TruthPartial {
  startMs: number
  endMs: number
  kind: string
  note?: string
}

interface Truth {
  schemaVersion?: number
  clip: string
  annotationStatus?: 'pending' | 'provisional' | 'reviewed'
  annotator?: string | null
  reviewedBy?: string | null
  action?: string | null
  movementFamily?: 'strength' | 'locomotion' | 'isometric' | 'other' | null
  view?: TruthView | null
  viewNote?: string
  reps?: TruthRep[]
  partialRepetitions?: TruthPartial[]
  gaitCycles?: number | null
  gaitSubtype?: 'run' | 'walk' | null
  issues?: unknown[]
  angleKeys?: unknown[]
  notes?: string
}

interface ModeResult {
  action: string
  analysisAction: AnalysisAction
  view: TruthView | null
  analysisView: AnalysisView
  repCount: number | null
  gaitCycles: number | null
  findings: number
}

/** series.json 里只存了角度、可见度与 33 个 landmarks；重建 MotionFrame 需要坐标。 */
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
        shoulder: pair(11, 12),
        elbow: pair(13, 14),
        wrist: pair(15, 16),
        hip: pair(23, 24),
        knee: pair(25, 26),
        ankle: pair(27, 28),
        heel: pair(29, 30),
        toe: pair(31, 32)
      }
    }
  })
}

function loadTruth(): Map<string, Truth> {
  if (!existsSync(TRUTH_DIR)) return new Map()
  return new Map(readdirSync(TRUTH_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => [file.replace(/\.json$/, ''), JSON.parse(readFileSync(resolve(TRUTH_DIR, file), 'utf8')) as Truth]))
}

/** 旧版模板集合里没有 sit-to-stand / walk；M0 先用最接近的现有模板做下游计数。 */
function analysisActionFor(action: string | null | undefined, fallback: AnalysisAction): AnalysisAction {
  if (!action) return fallback
  if (action === 'sit-to-stand' || action === 'sit_to_stand') return 'squat'
  if (action === 'walk') return 'running'
  return action
}

function safeView(view: TruthView | null | undefined, fallback: AnalysisView = 'side'): AnalysisView {
  if (view === 'side' || view === 'front') return view
  return fallback
}

function canonicalAction(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'sit_to_stand') return 'sit-to-stand'
  if (value === 'run') return 'running'
  return value
}

function runMode(frames: MotionFrame[], fps: number, action: string, view: TruthView | null): ModeResult {
  const analysisAction = analysisActionFor(action, action)
  const analysisView = safeView(view)
  const result = analyzeMotion({ action: analysisAction, view: analysisView, fps, frames })
  return {
    action,
    analysisAction,
    view,
    analysisView,
    repCount: result.repCount,
    // 必须读管道实际产出的步态周期：如果自动分类成 curl，这里就是 null，
    // 不能另外调 analyzeGait 把「管道根本没跑步态」掩盖成通过。
    gaitCycles: result.gaitCycles,
    findings: result.findings.length
  }
}

function pct(value: number | null): string {
  return value === null ? '—' : String(value)
}

function mark(value: boolean | null): string {
  return value === null ? '?' : value ? '✓' : '✗'
}

const truth = loadTruth()
if (!existsSync(BASELINE)) {
  console.error('还没有基线序列，先跑 npm run eval:motion')
  process.exitCode = 1
} else {
  const files = readdirSync(BASELINE).filter(file => file.endsWith('.series.json') && (!onlyClip || file.startsWith(onlyClip)))
  const rows: Record<string, unknown>[] = []
  let failures = 0

  console.log('clip'.padEnd(18) + 'action T/A'.padEnd(22) + 'view T/A'.padEnd(18)
    + 'reps T/E'.padEnd(11) + 'gait T/E'.padEnd(11) + 'partial'.padEnd(9) + 'result')
  console.log('-'.repeat(100))

  for (const file of files) {
    const series = JSON.parse(readFileSync(resolve(BASELINE, file), 'utf8')) as {
      clip: string
      fps: number
      view?: TruthView | null
      action?: string
      frames: Record<string, unknown>[]
    }
    const clipTruth = truth.get(series.clip) ?? null
    const frames = framesFromSeries(series)
    const fps = series.fps

    const autoViewResult = detectView(frames)
    const autoView = (autoViewResult.view ?? series.view ?? null) as TruthView | null
    const autoClass = classifyTemplate(frames, fps)
    const autoAction = actionOverride || autoClass.action
    const chosenView = (viewOverride || autoView) as TruthView | null

    // M1：共享特征与活跃区间；--features 时导出，供人工复查真实素材的特征口径
    const featureSeries = featuresOut || jsonOut ? buildMotionFeatureSeries(frames, fps) : null
    const activeResult = featuresOut || jsonOut ? detectActiveWindows(frames, fps) : null
    // M2：模拟预检的两阶段规划——降采样到约 5fps 粗扫，再规划精扫区间
    const durationMs = frames.length ? frames[frames.length - 1].timeMs : 0
    const stride = Math.max(1, Math.round(fps / 5))
    const coarseFrames = frames.filter((_, index) => index % stride === 0)
        .map(frame => ({ ...frame, timeMs: Math.round(frame.timeMs) }))
    const plan = planAnalysisWindow(coarseFrames, 5, durationMs)
    const truthRepWindows = (clipTruth?.reps ?? []).map(rep => ({ startMs: rep.startMs, endMs: rep.endMs }))
    const rangeCoversTruth = truthRepWindows.length === 0
      ? null
      : truthRepWindows.every(window => window.startMs >= plan.range.startMs - 50 && window.endMs <= plan.range.endMs + 50)

    const auto = runMode(frames, fps, autoAction, chosenView)
    const truthActionAnalysis = clipTruth?.action ? runMode(frames, fps, clipTruth.action, chosenView) : null
    const truthFullAnalysis = clipTruth?.action
      ? runMode(frames, fps, clipTruth.action, (clipTruth.view ?? chosenView))
      : null

    const truthAction = canonicalAction(clipTruth?.action)
    const truthView = clipTruth?.view ?? null
    const actionMatch = truthAction === null ? null : truthAction === canonicalAction(autoAction)
    const viewMatch = truthView === null ? null : truthView === autoView

    const truthReps = clipTruth?.reps?.length ?? null
    const truthGait = clipTruth?.gaitCycles ?? null
    const countKind = truthGait !== null ? 'gait' : 'reps'
    const countMeasured = countKind === 'gait' ? auto.gaitCycles : auto.repCount
    const countTruth = countKind === 'gait' ? truthGait : truthReps
    const countMatch = countTruth === null ? null : countTruth === countMeasured
    const partials = clipTruth?.partialRepetitions?.length ?? null

    const resultLabel = [actionMatch === false ? 'action' : '', viewMatch === false ? 'view' : '', countMatch === false ? 'count' : '',
      rangeCoversTruth === false ? 'range' : '']
      .filter(Boolean).join('+') || 'ok'
    if (actionMatch === false || viewMatch === false || countMatch === false || rangeCoversTruth === false) failures++

    console.log(
      series.clip.padEnd(18)
      + `${truthAction ?? '—'}/${autoAction}${autoClass.confident ? '' : '?'}`.padEnd(22)
      + `${truthView ?? '—'}/${autoView ?? '—'}`.padEnd(18)
      + `${truthReps ?? '—'}/${countKind === 'reps' ? pct(countMeasured) : '—'}`.padEnd(11)
      + `${truthGait ?? '—'}/${countKind === 'gait' ? pct(countMeasured) : '—'}`.padEnd(11)
      + pct(partials).padEnd(9)
      + `${resultLabel} ${mark(actionMatch)}${mark(viewMatch)}${mark(countMatch)}`
    )

    if (oracle && clipTruth?.action) {
      console.log('  oracle: auto=' + JSON.stringify(auto)
        + ' truthAction=' + JSON.stringify(truthActionAnalysis)
        + ' truthFull=' + JSON.stringify(truthFullAnalysis))
    }

    if (featuresOut && featureSeries && activeResult) {
      const numbers = (values: (number | null)[]) => values.filter((value): value is number => value !== null)
      const knee = numbers(featureSeries.frames.map(frame => frame.kneeAngle))
      const hipHeight = numbers(featureSeries.frames.map(frame => frame.hipHeightNorm))
      const wrist = numbers(featureSeries.frames.map(frame => frame.wristBelowKnee))
      const round = (value: number) => Math.round(value)
      console.log('  features ' + series.clip
        + ` usable=${Math.round(featureSeries.quality.usableRatio * 100)}%`
        + ` meanRel=${featureSeries.quality.meanReliability}`
        + ` gaps=${featureSeries.quality.gaps.length}`
        + ` active=${JSON.stringify(activeResult.windows.map(window => [round(window.startMs), round(window.endMs)]))}`
        + ` plan=${plan.fallback ?? 'active'} [${round(plan.range.startMs)},${round(plan.range.endMs)}]`
        + ` knee=${round(Math.min(...knee))}~${round(Math.max(...knee))}`
        + ` hipHeight=${hipHeight.length ? `${Math.min(...hipHeight).toFixed(2)}~${Math.max(...hipHeight).toFixed(2)}` : '—'}`
        + ` wristBelowKnee=${wrist.length ? `${Math.min(...wrist).toFixed(2)}~${Math.max(...wrist).toFixed(2)}` : '—'}`)
    }

    rows.push({
      clip: series.clip,
      annotationStatus: clipTruth?.annotationStatus ?? 'pending',
      hasTruth: Boolean(clipTruth),
      truth: {
        action: truthAction,
        movementFamily: clipTruth?.movementFamily ?? null,
        view: truthView,
        viewNote: clipTruth?.viewNote ?? null,
        repCount: truthReps,
        gaitCycles: truthGait,
        gaitSubtype: clipTruth?.gaitSubtype ?? null,
        partialRepetitions: clipTruth?.partialRepetitions ?? [],
        notes: clipTruth?.notes ?? null
      },
      auto: {
        action: autoAction,
        actionConfident: autoClass.confident,
        view: autoView,
        viewConfidence: autoViewResult.confidence,
        mode: auto
      },
      match: { action: actionMatch, view: viewMatch, count: countMatch, range: rangeCoversTruth },
      plan: {
        range: plan.range,
        windows: plan.windows,
        coverage: Math.round(plan.coverage * 1000) / 1000,
        fallback: plan.fallback,
        threshold: plan.threshold,
        coversTruthReps: rangeCoversTruth
      },
      features: featureSeries && activeResult
        ? {
            version: featureSeries.version,
            quality: featureSeries.quality,
            activeWindows: activeResult.windows,
            activeThreshold: activeResult.threshold,
            scale: featureSeries.scale
          }
        : null,
      oracle: oracle && truthActionAnalysis && truthFullAnalysis
        ? { truthAction: truthActionAnalysis, truthFull: truthFullAnalysis }
        : null,
      seriesFps: fps
    })
  }

  if (!jsonOut) {
    console.log('\n注：T=真值（truth/*.json），E=当前引擎实测；reps 只数完整重复，partial 含半程/遮挡。')
    console.log('     action 列的 ? = 自动识别不自信；count 用管道实际产出，自动分成 curl 时步态周期为 —。')
    console.log('     action/view/count/range 任一 ✗ 时，--gate 会以非零退出码结束。')
  }

  const report = {
    generatedAt: new Date().toISOString(),
    engine: 'v1',
    caveats: [
      'truth 为 provisional：关键帧初标，尚未由用户逐条复核',
      '库存素材机位/人物任意，只能逐片报告，不能聚合成单一准确率',
      'reps 只含完整重复；partialRepetitions 单独记录，不参与计数',
      'sit-to-stand / walk 在 V1 没有模板，计数用最接近的 squat / running 模板代跑',
      'V1 生产入口是 classifyTemplate（含 curl/plank 模板）；历史 after-clock-fix.json 用的是 classifyAction，动作列不可直接对比'
    ],
    rows
  }

  if (jsonOut) console.log(JSON.stringify(report, null, 2))
  if (freezePath) {
    writeFileSync(resolve(process.cwd(), freezePath), JSON.stringify(report, null, 2))
    console.log(`\n已冻结报告：${resolve(process.cwd(), freezePath)}`)
  }
  if (gate && failures > 0) {
    console.error(`\n门禁失败：${failures} 条素材存在 action/view/count/range 不匹配`)
    process.exitCode = 1
  }
}