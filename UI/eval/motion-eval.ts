// 验证夹具页面：只被 dev server 与 EVAL=1 构建产物使用，正常生产构建不含此入口。
// 两条通道：(a) 纯函数管道逐帧 dump，(b) 真实 useVideoAnalysis 端到端，用于交叉校验接线。
import { createApp, h } from 'vue'
import { createPoseEngine } from '@/composables/poseEngine'
import { useVideoAnalysis } from '@/composables/useVideoAnalysis'
import { computeMetrics } from '@/composables/poseMath'
import {
  extractMotionFrame,
  measureJointAngle,
  measureTrunkAngle,
  analyzeMotion,
  precheckMotion,
  classifyTemplate,
  detectView,
  type MotionFrame
} from '@/services/motionAnalysis'
import { estimateView } from '@/services/motion-engine/view/estimate'
import type { AnalysisAction, AnalysisView } from '@/types/domain'

const MODEL_PATHS = { wasmPath: '/mediapipe/wasm', modelPath: '/mediapipe/models/pose_landmarker_lite.task' }
const fileInput = document.getElementById('file') as HTMLInputElement
const canvas = document.getElementById('cv') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const out = document.getElementById('out')!
const readout = document.getElementById('readout')!

const video = document.createElement('video')
video.muted = true
video.playsInline = true
video.preload = 'auto'

let engine: Awaited<ReturnType<typeof createPoseEngine>> | null = null
let engineClock = 0
/** 每段视频/每趟扫描加一个巨大基数，趟内按真实帧间隔递增，避免时间被压成 1ms/帧 */
let passBase = 0
let modelLoadMs = 0
const inferenceMs: number[] = []
let clicked: { x: number; y: number }[] = []
let lastLandmarks: { x: number; y: number; visibility?: number }[] = []

// useVideoAnalysis 用了 onUnmounted，需要一个真实组件作用域
let pipeline!: ReturnType<typeof useVideoAnalysis>
createApp({ setup() { pipeline = useVideoAnalysis(); return () => h('div') } }).mount('#app')

function log(value: unknown) {
  out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

async function ensureEngine() {
  if (engine) return engine
  const start = performance.now()
  engine = await createPoseEngine(MODEL_PATHS)
  modelLoadMs = Math.round(performance.now() - start)
  return engine
}

function seek(sec: number): Promise<void> {
  const target = Math.max(0, Math.min(sec, Math.max(0, video.duration - 0.001)))
  if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('seek timeout')) }, 8000)
    const done = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error('decode failed')) }
    function cleanup() { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail) }
    video.addEventListener('seeked', done)
    video.addEventListener('error', fail)
    video.currentTime = target
  })
}

function drawFrame() {
  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 480
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  // 骨架叠加：canvas 不解析 CSS 变量，用字面色（与 usePoseCamera 一致）
  const pairs = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]]
  ctx.strokeStyle = '#a34d28'
  ctx.lineWidth = 2
  for (const [a, b] of pairs) {
    const p = lastLandmarks[a]; const q = lastLandmarks[b]
    if (!p || !q) continue
    ctx.beginPath()
    ctx.moveTo(p.x * canvas.width, p.y * canvas.height)
    ctx.lineTo(q.x * canvas.width, q.y * canvas.height)
    ctx.stroke()
  }
  ctx.fillStyle = '#0f766e'
  for (const index of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = lastLandmarks[index]
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#a5261a'
  for (const p of clicked) {
    ctx.beginPath()
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, Math.PI * 2)
    ctx.stroke()
  }
}

async function detectAt(sec: number): Promise<MotionFrame> {
  await seek(sec)
  const bitmap = await createImageBitmap(video)
  const pose = await ensureEngine()
  const timeMs = Math.round(sec * 1000)
  engineClock = Math.max(passBase + timeMs, engineClock + 1)
  const start = performance.now()
  const result = await pose.detect(bitmap, engineClock)
  inferenceMs.push(performance.now() - start)
  lastLandmarks = result.landmarks
  const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined
  return extractMotionFrame(result.landmarks, timeMs, aspect)
}

function angleFromClicks(): number | null {
  if (clicked.length !== 3) return null
  const [a, v, b] = clicked
  const u = { x: a.x - v.x, y: a.y - v.y }
  const w = { x: b.x - v.x, y: b.y - v.y }
  const mag = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)
  if (!mag) return null
  const cos = Math.min(1, Math.max(-1, (u.x * w.x + u.y * w.y) / mag))
  return Math.round((Math.acos(cos) * 180) / Math.PI * 10) / 10
}

canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect()
  clicked.push({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
  if (clicked.length > 3) clicked = clicked.slice(-3)
  drawFrame()
  const reference = angleFromClicks()
  readout.textContent = ` t=${video.currentTime.toFixed(2)}s · 点击 ${clicked.length}/3 · 参考角 ${reference ?? '—'}°`
})
document.getElementById('clearPts')!.addEventListener('click', () => { clicked = []; drawFrame(); readout.textContent = '' })
document.getElementById('seekBack')!.addEventListener('click', () => void seek(video.currentTime - 1 / 30).then(drawFrame))
document.getElementById('seekFwd')!.addEventListener('click', () => void seek(video.currentTime + 1 / 30).then(drawFrame))

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  video.src = URL.createObjectURL(file)
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true })
    video.addEventListener('error', reject, { once: true })
  })
  await seek(0)
  passBase += 10_000_000
  engineClock = 0
  await detectAt(0)
  drawFrame()
  log({ loaded: file.name, duration: video.duration, width: video.videoWidth, height: video.videoHeight, modelLoadMs })
})

const pctl = (values: number[], p: number) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 100) / 100
}

// CDP 驱动入口。返回结构化数据，不做人类可读渲染。
;(window as unknown as Record<string, unknown>).__eval = {
  ready: () => Boolean(video.src && video.readyState >= 2),
  meta: () => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }),
  seek: async (ms: number) => { await seek(ms / 1000); await detectAt(ms / 1000); drawFrame(); return { timeMs: ms } },
  referenceAngle: () => angleFromClicks(),
  clicks: () => clicked,
  setClicks: (points: { x: number; y: number }[]) => { clicked = points; drawFrame(); return angleFromClicks() },

  /** 通道 a：纯函数管道，逐帧 dump landmarks + 角度，供角度误差与阶段评估 */
  async captureSeries(fps: number, maxSeconds: number) {
    inferenceMs.length = 0
    passBase += 10_000_000
    engineClock = 0
    const step = 1 / fps
    const span = Math.min(video.duration, maxSeconds)
    const frames: MotionFrame[] = []
    const rows: unknown[] = []
    for (let time = step; time <= span - step / 2; time += step) {
      const frame = await detectAt(time)
      frames.push(frame)
      const knee = measureJointAngle(frame, 'knee')
      const hip = measureJointAngle(frame, 'hip')
      const side = knee.visibility >= hip.visibility ? 'knee' : 'hip'
      void side
      rows.push({
        timeMs: frame.timeMs,
        visibility: frame.visibility,
        kneeAngle: knee.angle,
        kneeVisibility: knee.visibility,
        hipAngle: hip.angle,
        trunkAngle: measureTrunkAngle(frame.points.shoulder.left, frame.points.hip.left),
        realtimeVisibility: computeMetrics(lastLandmarks as never).visibility,
        landmarks: lastLandmarks.map(p => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4, v: Math.round((p.visibility ?? 0) * 1e4) / 1e4 }))
      })
    }
    const view = detectView(frames)
    // 通道 a 必须用生产同一条分类入口（classifyTemplate），否则会漏掉弯举/平板等模板级判定。
    const classification = classifyTemplate(frames, fps)
    return {
      fps, frames: rows, frameCount: frames.length,
      aspect: video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null,
      view: view.view, viewConfidence: view.confidence,
      viewEstimate: estimateView(frames, fps, { aspect: video.videoWidth / video.videoHeight }),
      action: classification.action, actionConfident: classification.confident,
      signals: classification.signals,
      precheck: precheckMotion({ fps, frames }),
      timing: { modelLoadMs, inferenceP50: pctl(inferenceMs, 0.5), inferenceP95: pctl(inferenceMs, 0.95), samples: inferenceMs.length },
      engineState: engine?.state ?? null
    }
  },

  /** 通道 b：真实 composable 端到端，交叉校验接线与纯管道一致 */
  async runPipeline(fps: number, maxSeconds: number) {
    const file = fileInput.files?.[0]
    if (!file) throw new Error('no file')
    const wallStart = performance.now()
    await pipeline.prepare(file)
    const pre = await pipeline.precheck()
    if (!pre.view || !pre.action) return { precheck: pre, rejected: true }
    const result = await pipeline.analyze(pre.action as AnalysisAction, pre.view as AnalysisView)
    void fps; void maxSeconds
    return {
      precheck: pre, rejected: false, result,
      wallMs: Math.round(performance.now() - wallStart),
      engineState: engine?.state ?? null
    }
  },

  /** 用已 dump 的帧重跑规则，便于换阈值/换策略后不重推理 */
  analyzeFrames(frames: MotionFrame[], action: AnalysisAction, view: AnalysisView, fps: number) {
    return analyzeMotion({ action, view, fps, frames })
  }
}

log('就绪：选择视频后可由 CDP 驱动，或手动点击关键帧做角度数字化。')