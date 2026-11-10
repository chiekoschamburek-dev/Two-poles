import { ref, onUnmounted } from 'vue'
import { createPoseEngine } from './poseEngine'
import type { PoseEngine } from './poseEngine'
import { analyzeMotion, extractMotionFrame, precheckMotion, type MotionFrame } from '@/services/motionAnalysis'
import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisResult,
  MotionPrecheckResult
} from '@/types/domain'

const MODEL_PATHS = {
  wasmPath: '/mediapipe/wasm',
  modelPath: '/mediapipe/models/pose_landmarker_lite.task'
}
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
      throw new VideoAnalysisError('model', `端侧姿态模型加载失败：${(err as Error)?.message || '未知错误'}。请确认已运行 npm run camera:assets 后重试`)
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

  async function detectAt(timeSec: number, seq?: number): Promise<MotionFrame> {
    const element = video
    if (!element) throw new VideoAnalysisError('decode', '视频尚未准备好')
    await seekTo(timeSec)
    throwIfCancelled(seq)
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(element)
    } catch {
      throw new VideoAnalysisError('decode', '视频解码失败，请转码为 H.264 MP4 后重试')
    }
    const pose = await ensureEngine()
    engineClock = Math.max(Math.floor(timeSec * 1000), engineClock + 1)
    try {
      const result = await pose.detect(bitmap, engineClock)
      return extractMotionFrame(result.landmarks, Math.round(timeSec * 1000))
    } catch (err) {
      throw new VideoAnalysisError('model', `端侧推理失败：${(err as Error)?.message || '请重试'}`)
    }
  }

  async function precheck(action: AnalysisAction): Promise<MotionPrecheckResult> {
    if (!video || !duration.value) throw new VideoAnalysisError('decode', '请先选择视频')
    const seq = beginRun()
    phase.value = 'precheck'
    progress.value = 0
    statusText.value = '正在检查视频是否可分析……'
    try {
      const fps = action === 'running' ? 15 : 10
      const span = Math.min(duration.value, action === 'running' ? 10 : 8)
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
      return precheckMotion({ action, fps, frames })
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
    try {
      const fps = action === 'running' ? RUNNING_FPS : STRENGTH_FPS
      const maxSeconds = action === 'running' ? Math.min(duration.value, RUNNING_MAX_SECONDS) : duration.value
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

  return { phase, progress, statusText, duration, prepare, precheck, analyze, captureKeyframes, cancel, dispose }
}
