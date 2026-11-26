import { ref, onUnmounted } from 'vue'
import { createMainThreadPoseEngine, createPoseEngine } from './poseEngine'
import type { PoseEngine } from './poseEngine'
import { POSE_MODEL_PATHS, POSE_ASSETS_HINT } from './poseLandmarkerFactory'
import { isPoseTimeoutError, poseInputSize } from '@/services/analysisRuntime'
import {
  analyzeGait,
  analyzeMotion,
  extractMotionFrame,
  precheckMotion,
  type MotionFrame
} from '@/services/motionAnalysis'
import { templateFor } from '@/services/motionTemplates'
import {
  coarseGridTimes,
  fineGridTimes,
  planAnalysisWindow,
  type AnalysisWindowPlan
} from '@/services/motion-engine/pipeline/precheck'
import { mostActiveSpan } from '@/services/motion-engine/temporal/activeWindow'
import type { MotionEnergyFrame } from '@/services/motion-engine/temporal/activeWindow'
import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisResult,
  MotionPrecheckResult
} from '@/types/domain'

const MODEL_PATHS = POSE_MODEL_PATHS
const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const ALLOWED_EXTS = ['.mp4', '.webm', '.mov']
const MAX_BYTES = 200 * 1024 * 1024
const MIN_DURATION_SECONDS = 1
const MAX_DURATION_SECONDS = 60
/**
 * V2 采样策略：全片 5fps 粗扫 → 活跃区间 15fps 精扫（步态候选 30fps）。
 * 粗扫点刻意落在 15fps 网格上，精扫时直接命中缓存，总推理次数不超过 V1。
 */
const COARSE_FPS = 5
/** 计次/静态保持的精扫帧率；15fps 足够覆盖 minStageMs=200ms 的状态机 */
const ANALYSIS_FPS = 15
/** 步态事件需要更高时间分辨率 */
const GAIT_FPS = 30
const RUNNING_MAX_SECONDS = 20
const SEEK_TIMEOUT_MS = 4000

export type VideoAnalysisErrorCode =
  | 'invalid-type' | 'too-large' | 'too-long' | 'too-short'
  | 'decode' | 'model' | 'seek-timeout' | 'cancelled'

export class VideoAnalysisError extends Error {
  constructor(public code: VideoAnalysisErrorCode, message: string) {
    super(message)
  }
}

export interface VideoMeta {
  duration: number
  width: number
  height: number
}

interface AnalysisPlanState {
  range: { startMs: number; endMs: number; source: string }
  fps: number
  frames: MotionFrame[]
  coarseTimes: number[]
  energy: MotionEnergyFrame[]
  durationMs: number
}

function waitEvent(target: HTMLVideoElement, name: 'loadedmetadata' | 'loadeddata', timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new VideoAnalysisError('decode', message))
    }, timeoutMs)
    const done = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new VideoAnalysisError('decode', '视频无法解码，请转码为 H.264 MP4 后重试'))
    }
    function cleanup() {
      window.clearTimeout(timer)
      target.removeEventListener(name, done)
      target.removeEventListener('error', fail)
    }
    target.addEventListener(name, done)
    target.addEventListener('error', fail)
  })
}

export function useVideoAnalysis() {
  const phase = ref<'idle' | 'precheck' | 'analyzing'>('idle')
  const progress = ref(0)
  const statusText = ref('')
  const duration = ref(0)

  let video: HTMLVideoElement | null = null
  let objectUrl = ''
  let engine: PoseEngine | null = null
  let engineClock = 0
  let cancelled = false
  let runSeq = 0
  /** 最近一次全帧分析的原始帧；供本机留存与事件流用，视频本身仍然丢弃 */
  let lastFrames: MotionFrame[] = []
  let lastFps = 0
  /** 本次视频的预检规划；改动作/改视角时复用它，不重新解码整段视频 */
  let lastPlan: AnalysisPlanState | null = null
  /**
   * 逐帧推理缓存：键为毫秒时间戳。粗扫帧与精扫帧共用同一份，
   * 改动作/改视角只补推理缺的帧（验收要求"缓存改判 < 50ms"的前提）。
   */
  const frameCache = new Map<number, MotionFrame>()
  const stats = { inferences: 0, cacheHits: 0 }
  /**
   * 每趟扫描（precheck / analyze）都要从 t=0 重采样，但 MediaPipe 的 VIDEO 模式要求
   * 时间戳跨调用严格递增。做法：每趟加一个巨大的基数，趟内按真实帧间隔递增。
   * 之前只做 engineClock+1 的 nudge，导致第二趟的引擎时间每帧只前进 1ms，
   * 引擎内部时序平滑彻底失真——同一段视频纯管道数到 4 次，走 composable 却数到 0 次。
   */
  let passBase = 0
  function beginPass() {
    passBase += 10_000_000
    engineClock = 0
  }

  function beginRun(): number {
    cancelled = false
    return ++runSeq
  }

  function throwIfCancelled(seq?: number) {
    if (cancelled || (seq !== undefined && seq !== runSeq)) {
      throw new VideoAnalysisError('cancelled', '已取消分析')
    }
  }

  function resetAnalysisState() {
    frameCache.clear()
    lastPlan = null
    lastFrames = []
    lastFps = 0
    stats.inferences = 0
    stats.cacheHits = 0
  }

  function validateFile(file: File) {
    const dot = file.name.lastIndexOf('.')
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTS.includes(ext)) {
      throw new VideoAnalysisError('invalid-type', '只支持 mp4、webm、mov 视频')
    }
    if (file.size > MAX_BYTES) {
      throw new VideoAnalysisError('too-large', '视频超过 200MB，请裁剪后再试')
    }
  }

  function releaseVideo() {
    if (!video) return
    try {
      video.pause()
    } catch {
      // 未开始播放时 pause 可能直接抛错，忽略
    }
    video.removeAttribute('src')
    try {
      video.load()
    } catch {
      // 卸载阶段 load 失败无关紧要
    }
    video = null
  }

  async function prepare(file: File): Promise<VideoMeta> {
    validateFile(file)
    cancelled = true
    runSeq++
    releaseVideo()
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = ''
    }
    resetAnalysisState()
    cancelled = false
    progress.value = 0
    statusText.value = '正在读取视频……'
    const element = document.createElement('video')
    element.muted = true
    element.playsInline = true
    element.preload = 'auto'
    objectUrl = URL.createObjectURL(file)
    element.src = objectUrl
    video = element
    await waitEvent(element, 'loadedmetadata', 15000, '视频元数据读取失败，请确认文件完整')
    await waitEvent(element, 'loadeddata', 15000, '视频画面无法读取，请转码为 H.264 MP4 后重试')
    const seconds = element.duration
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new VideoAnalysisError('decode', '读不到视频时长，请换一个文件')
    }
    if (seconds > MAX_DURATION_SECONDS) {
      throw new VideoAnalysisError('too-long', `视频时长 ${seconds.toFixed(0)} 秒，超过 60 秒上限，请裁剪后再试`)
    }
    if (seconds < MIN_DURATION_SECONDS) {
      throw new VideoAnalysisError('too-short', '视频太短，请至少拍摄 1 秒')
    }
    duration.value = seconds
    statusText.value = ''
    return { duration: seconds, width: element.videoWidth, height: element.videoHeight }
  }

  async function ensureEngine(): Promise<PoseEngine> {
    if (engine) return engine
    try {
      engine = await createPoseEngine(MODEL_PATHS)
    } catch (err) {
      throw new VideoAnalysisError('model', `端侧姿态模型加载失败：${(err as Error)?.message || '未知错误'}。${POSE_ASSETS_HINT}后重试`)
    }
    return engine
  }

  function seekTo(target: number): Promise<void> {
    const element = video
    if (!element) return Promise.reject(new VideoAnalysisError('decode', '视频尚未准备好'))
    const el = element
    const clamped = Math.max(0, Math.min(target, Math.max(0, el.duration - 0.001)))
    if (Math.abs(el.currentTime - clamped) < 0.0005 && el.readyState >= 2) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new VideoAnalysisError('seek-timeout', '视频定位超时，请重试'))
      }, SEEK_TIMEOUT_MS)
      const done = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const fail = () => {
        if (settled) return
        settled = true
        cleanup()
        reject(new VideoAnalysisError('decode', '视频解码失败，请转码为 H.264 MP4 后重试'))
      }
      function cleanup() {
        window.clearTimeout(timer)
        el.removeEventListener('seeked', done)
        el.removeEventListener('error', fail)
      }
      el.addEventListener('seeked', done)
      el.addEventListener('error', fail)
      try {
        el.currentTime = clamped
      } catch {
        fail()
      }
    })
  }

  /** 送进模型前先把 1080p 缩到 960 宽：模型输入只有 256，原图白烧解码和显存 */
  async function createAnalysisBitmap(): Promise<ImageBitmap> {
    const element = video
    if (!element) throw new VideoAnalysisError('decode', '视频尚未准备好')
    const target = poseInputSize(element.videoWidth, element.videoHeight)
    if (target) {
      try {
        return await createImageBitmap(element, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'medium'
        })
      } catch {
        // 个别内核不支持对视频源缩放，退回原图；不能因此判成解码失败
      }
    }
    try {
      return await createImageBitmap(element)
    } catch {
      throw new VideoAnalysisError('decode', '视频解码失败，请转码为 H.264 MP4 后重试')
    }
  }

  /**
   * GPU 图卡死时 detect 既不返回也不抛错，只会超时；这时 worker 已经不可信。
   * 关掉它、换主线程 CPU 引擎，把当前帧重跑一次；只有 CPU 也起不来/也失败才向上报错。
   */
  async function downgradeToCpuEngine(seq?: number): Promise<PoseEngine> {
    engine?.close()
    engine = null
    let next: PoseEngine
    try {
      next = await createMainThreadPoseEngine(MODEL_PATHS)
    } catch (err) {
      throw new VideoAnalysisError('model', `端侧姿态模型加载失败：${(err as Error)?.message || '未知错误'}。${POSE_ASSETS_HINT}后重试`)
    }
    if (cancelled || (seq !== undefined && seq !== runSeq)) {
      next.close()
      throw new VideoAnalysisError('cancelled', '已取消分析')
    }
    engine = next
    return next
  }

  async function detectAt(timeSec: number, seq?: number): Promise<MotionFrame> {
    if (!video) throw new VideoAnalysisError('decode', '视频尚未准备好')
    await seekTo(timeSec)
    throwIfCancelled(seq)
    const timeMs = Math.round(timeSec * 1000)
    const pose = await ensureEngine()
    // 两个时钟刻意分开：engineClock 只喂 MediaPipe（趟内按真实帧间隔递增），
    // 帧记录用真实视频时间——状态机拿它判 minStageMs/minRepMs，绝不能是伪造时间。
    engineClock = Math.max(passBase + timeMs, engineClock + 1)
    let bitmap = await createAnalysisBitmap()
    try {
      const result = await pose.detect(bitmap, engineClock)
      return extractMotionFrame(result.landmarks, timeMs)
    } catch (err) {
      bitmap.close()
      if (!isPoseTimeoutError(err)) {
        throw new VideoAnalysisError('model', `端侧推理失败：${(err as Error)?.message || '请重试'}`)
      }
      // 首帧把 GPU 图跑死：换 CPU 引擎重跑这一帧，别让整段分析直接失败
      const cpuEngine = await downgradeToCpuEngine(seq)
      bitmap = await createAnalysisBitmap()
      try {
        const result = await cpuEngine.detect(bitmap, engineClock)
        return extractMotionFrame(result.landmarks, timeMs)
      } catch (retryErr) {
        bitmap.close()
        throw new VideoAnalysisError('model', `端侧推理失败：${(retryErr as Error)?.message || '请重试'}`)
      }
    }
  }

  /**
   * 按时间点扫描：命中缓存的帧直接复用，缺的才推理。
   * 调用方必须按时间升序传点，保证喂给 MediaPipe 的时间戳递增。
   */
  async function scanTimes(
    timesMs: number[],
    seq: number,
    onProgress?: (done: number, total: number) => void
  ): Promise<MotionFrame[]> {
    const frames: MotionFrame[] = []
    for (let index = 0; index < timesMs.length; index++) {
      throwIfCancelled(seq)
      const timeMs = timesMs[index]
      const cached = frameCache.get(timeMs)
      if (cached) {
        stats.cacheHits++
        frames.push(cached)
      } else {
        const frame = await detectAt(timeMs / 1000, seq)
        frameCache.set(timeMs, frame)
        stats.inferences++
        frames.push(frame)
      }
      onProgress?.(index + 1, timesMs.length)
    }
    return frames
  }

  /** 粗扫判定"这是不是步态候选"：命中则精扫用 30fps，否则 15fps */
  function isGaitCandidate(coarseFrames: MotionFrame[], fps: number, templateId?: string): boolean {
    if (templateId && templateFor(templateId).kind === 'gait') return true
    const gait = analyzeGait(coarseFrames, fps)
    // 步频只作连续特征/候选条件，不再是一票否决的硬门槛
    return (gait.alternating && gait.footStrikes >= 4 && (gait.cadence ?? 0) >= 100)
      || (gait.alternating && gait.footStrikes >= 6)
  }

  /**
   * 两阶段预检：全片 5fps 粗扫找活跃区间 → 区间内 15/30fps 精扫。
   * 动作识别、视角、计数都只在"精扫帧"上做；不再用视频前 10 秒代表整段。
   */
  async function precheck(templateId?: string): Promise<MotionPrecheckResult> {
    if (!video || !duration.value) throw new VideoAnalysisError('decode', '请先选择视频')
    const seq = beginRun()
    phase.value = 'precheck'
    progress.value = 0
    statusText.value = templateId
      ? `正在按「${templateFor(templateId).label}」检查视频……`
      : '正在检查视频是否可分析……'
    beginPass()
    try {
      const durationMs = Math.round(duration.value * 1000)
      const coarseTimes = coarseGridTimes(durationMs, COARSE_FPS)
      const coarseFrames = await scanTimes(coarseTimes, seq, (done, total) => {
        progress.value = total ? 0.35 * done / total : 0.35
        statusText.value = `正在粗扫全片 ${done} / ${total} 帧`
      })
      const plan: AnalysisWindowPlan = planAnalysisWindow(coarseFrames, COARSE_FPS, durationMs)
      let range = plan.range
      const gaitCandidate = isGaitCandidate(coarseFrames, COARSE_FPS, templateId)
      if (gaitCandidate) {
        // 跑姿只分析"最活跃的一段"（最多 20 秒），不再默认截取视频开头
        const span = mostActiveSpan(plan.energy, { startMs: 0, endMs: durationMs }, Math.min(durationMs, RUNNING_MAX_SECONDS * 1000))
        if (span) range = span
      }
      const fineFps = gaitCandidate ? GAIT_FPS : ANALYSIS_FPS
      const fineTimes = fineGridTimes(range.startMs, range.endMs, fineFps, coarseTimes)
      const frames = await scanTimes(fineTimes, seq, (done, total) => {
        progress.value = total ? 0.35 + 0.6 * done / total : 0.95
        statusText.value = `正在精扫 ${(range.startMs / 1000).toFixed(1)}–${(range.endMs / 1000).toFixed(1)} 秒 ${done} / ${total} 帧`
      })
      lastPlan = { range, fps: fineFps, frames, coarseTimes, energy: plan.energy, durationMs }
      lastFrames = frames
      lastFps = fineFps
      progress.value = 1
      statusText.value = '正在判定动作与视角'
      return precheckMotion({
        fps: fineFps,
        frames,
        range,
        ...(templateId ? { templateId } : {})
      })
    } finally {
      if (seq === runSeq) {
        phase.value = 'idle'
        progress.value = 0
        statusText.value = ''
      }
    }
  }

  /**
   * 正式分析：复用预检的活跃区间与逐帧缓存，只补缺失帧。
   * 用户改动作/视角时走这里，不重新解码整段视频。
   */
  async function analyze(action: AnalysisAction, view: AnalysisView): Promise<MotionAnalysisResult> {
    if (!video || !duration.value) throw new VideoAnalysisError('decode', '请先选择视频')
    const seq = beginRun()
    phase.value = 'analyzing'
    progress.value = 0
    beginPass()
    try {
      const template = templateFor(action)
      const fps = template.kind === 'gait' ? GAIT_FPS : ANALYSIS_FPS
      const durationMs = Math.round(duration.value * 1000)
      let range = lastPlan?.range ?? { startMs: 0, endMs: durationMs, source: 'whole-clip' }
      if (template.kind === 'gait' && lastPlan) {
        const span = mostActiveSpan(
          lastPlan.energy,
          { startMs: 0, endMs: durationMs },
          Math.min(durationMs, RUNNING_MAX_SECONDS * 1000)
        )
        if (span) range = span
      }
      const times = fineGridTimes(range.startMs, range.endMs, fps, lastPlan?.coarseTimes ?? [])
      statusText.value = `正在分析 ${(range.startMs / 1000).toFixed(1)}–${(range.endMs / 1000).toFixed(1)} 秒`
      const frames = await scanTimes(times, seq, (done, total) => {
        progress.value = total ? done / total : 1
        statusText.value = `正在分析 ${(range.startMs / 1000).toFixed(1)}–${(range.endMs / 1000).toFixed(1)} 秒 ${done} / ${total} 帧`
      })
      lastFrames = frames
      lastFps = fps
      return analyzeMotion({ action, view, fps, frames, range })
    } finally {
      if (seq === runSeq) {
        phase.value = 'idle'
        progress.value = 0
        statusText.value = ''
      }
    }
  }

  async function captureKeyframes(timesMs: number[]): Promise<(Blob | null)[]> {
    const blobs: (Blob | null)[] = []
    for (const timeMs of timesMs) {
      try {
        await seekTo(timeMs / 1000)
        const element = video
        if (!element) {
          blobs.push(null)
          continue
        }
        const canvas = document.createElement('canvas')
        canvas.width = element.videoWidth || 640
        canvas.height = element.videoHeight || 480
        const context = canvas.getContext('2d')
        if (!context) {
          blobs.push(null)
          continue
        }
        context.drawImage(element, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
        blobs.push(blob)
      } catch {
        blobs.push(null)
      }
    }
    return blobs
  }

  function cancel() {
    cancelled = true
    runSeq++
    phase.value = 'idle'
    progress.value = 0
    statusText.value = ''
  }

  function dispose() {
    cancelled = true
    runSeq++
    releaseVideo()
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = ''
    }
    engine?.close()
    engine = null
    resetAnalysisState()
    phase.value = 'idle'
    progress.value = 0
    statusText.value = ''
    duration.value = 0
  }

  onUnmounted(dispose)

  return {
    phase, progress, statusText, duration, prepare, precheck, analyze, captureKeyframes, cancel, dispose,
    capturedFrames: () => lastFrames,
    capturedFps: () => lastFps,
    /** 本次分析的采样统计：推理帧数 / 缓存命中。用于性能验收与排查 */
    scanStats: () => ({ ...stats }),
    /** 最近一次预检的活跃区间规划，供界面展示"分析区间" */
    analyzedRange: () => lastPlan?.range ?? null
  }
}