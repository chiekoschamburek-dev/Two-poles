import { ref, onUnmounted } from 'vue'
import { createMainThreadPoseEngine, createPoseEngine } from './poseEngine'
import type { PoseEngine } from './poseEngine'
import { POSE_MODEL_PATHS, POSE_ASSETS_HINT } from './poseLandmarkerFactory'
import { isPoseTimeoutError, poseInputSize } from '@/services/analysisRuntime'
import { analyzeMotion, extractMotionFrame, precheckMotion, type MotionFrame } from '@/services/motionAnalysis'
import { templateFor } from '@/services/motionTemplates'
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
const STRENGTH_FPS = 15
const RUNNING_FPS = 30
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
   * 可分析性检查 + 动作自动识别。动作不再由用户预选：
   * 统一按 15fps 采一段样帧（最多 10 秒，兼顾步态检测的时间分辨率），
   * 判定出的动作随结果返回，全帧分析再按动作各自的帧率跑。
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
      const fps = 15
      const span = Math.min(duration.value, 10)
      const count = Math.max(12, Math.floor(span * fps))
      const frames: MotionFrame[] = []
      for (let index = 0; index < count; index++) {
        throwIfCancelled(seq)
        const time = (index + 0.5) / fps
        if (time >= duration.value - 0.01) break
        frames.push(await detectAt(time, seq))
        progress.value = (index + 1) / count
        statusText.value = `正在检查 ${index + 1} / ${count} 帧`
      }
      return precheckMotion({ fps, frames, ...(templateId ? { templateId } : {}) })
    } finally {
      if (seq === runSeq) {
        phase.value = 'idle'
        progress.value = 0
        statusText.value = ''
      }
    }
  }

  async function analyze(action: AnalysisAction, view: AnalysisView): Promise<MotionAnalysisResult> {
    if (!video || !duration.value) throw new VideoAnalysisError('decode', '请先选择视频')
    const seq = beginRun()
    phase.value = 'analyzing'
    progress.value = 0
    beginPass()
    try {
      const template = templateFor(action)
      const fps = template.kind === 'gait' ? RUNNING_FPS : STRENGTH_FPS
      const maxSeconds = template.kind === 'gait' ? Math.min(duration.value, RUNNING_MAX_SECONDS) : duration.value
      const step = 1 / fps
      const times: number[] = []
      for (let time = step; time <= maxSeconds - step / 2; time += step) times.push(time)
      const frames: MotionFrame[] = []
      for (let index = 0; index < times.length; index++) {
        throwIfCancelled(seq)
        frames.push(await detectAt(times[index], seq))
        progress.value = times.length ? (index + 1) / times.length : 1
        statusText.value = `正在分析 ${times[index].toFixed(0)} / ${maxSeconds.toFixed(0)} 秒`
      }
      lastFrames = frames
      lastFps = fps
      return analyzeMotion({ action, view, fps, frames })
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
    phase.value = 'idle'
    progress.value = 0
    statusText.value = ''
    duration.value = 0
  }

  onUnmounted(dispose)

  return { phase, progress, statusText, duration, prepare, precheck, analyze, captureKeyframes, cancel, dispose,
    capturedFrames: () => lastFrames, capturedFps: () => lastFps }
}
