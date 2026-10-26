import { ref, onUnmounted } from 'vue'
import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { createPoseEngine, createMainThreadPoseEngine } from './poseEngine'
import type { PoseEngine } from './poseEngine'
import { nextTimestamp } from './poseMath'
import type { PoseMetrics } from './poseMath'

export type PoseCameraStatus = 'idle' | 'starting' | 'live' | 'unsupported' | 'denied' | 'error'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/pose_landmarker_lite.task'
const MODEL_PATHS = { wasmPath: WASM_PATH, modelPath: MODEL_PATH }

const EMPTY_METRICS: PoseMetrics = { kneeAngle: null, hipAngle: null, elbowAngle: null, visibility: 0 }

/**
 * 只负责"看见"：拉摄像头、跑端侧姿态推理、输出关键点与关节角。
 * 推理在工作线程里跑（不支持时回落主线程），骨架绘制仍留在主线程。
 * 不判定动作是否标准——计数由 useRepCounter 拿这里的关节角自己做。
 */
export function usePoseCamera() {
  const status = ref<PoseCameraStatus>('idle')
  const errorMessage = ref('')
  const fps = ref(0)
  const kneeAngle = ref<number | null>(null)
  const hipAngle = ref<number | null>(null)
  const elbowAngle = ref<number | null>(null)
  const visibility = ref(0)
  /** 实际生效的后端与推理落点，供界面如实显示，不猜 */
  const delegate = ref<'GPU' | 'CPU' | null>(null)
  const runsIn = ref<'worker' | 'main' | null>(null)
  /** starting 时区分卡在哪一步：请求相机 / 加载模型 */
  const startingStage = ref<'camera' | 'model' | null>(null)

  let engine: PoseEngine | null = null
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let rvfcHandle = 0
  let rafHandle = 0
  let lastTs = 0
  let busy = false
  let frames = 0
  let fpsClock = 0
  let downgraded = false
  /** start/stop 竞态保护：切回演示或关闭页面后，晚到的相机/模型不能再把链路点亮 */
  let startSeq = 0

  function draw(landmarks: NormalizedLandmark[]) {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!landmarks.length) return
    const utils = new DrawingUtils(ctx)
    // canvas 的 fillStyle/strokeStyle 不解析 CSS 变量，这里只能写字面色值
    utils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: 'rgba(79, 209, 197, 0.85)',
      lineWidth: 3
    })
    utils.drawLandmarks(landmarks, {
      color: '#ffffff',
      fillColor: '#0f766e',
      lineWidth: 1,
      radius: 3
    })
  }

  function applyMetrics(metrics: PoseMetrics) {
    visibility.value = metrics.visibility
    kneeAngle.value = metrics.kneeAngle
    hipAngle.value = metrics.hipAngle
    elbowAngle.value = metrics.elbowAngle
  }

  function usesFrameCallbacks() {
    return !!video && typeof video.requestVideoFrameCallback === 'function'
  }

  function schedule() {
    if (!video || status.value !== 'live') return
    if (usesFrameCallbacks()) {
      rvfcHandle = video.requestVideoFrameCallback((now, metadata) => void onFrame(now, metadata))
    } else {
      rafHandle = requestAnimationFrame(now => void onFrame(now))
    }
  }

  /** 帧自己的媒体时间（秒）——RVFC 给的是这一帧真正被呈现的时刻，rAF 只能退回 currentTime */
  function mediaTimeSeconds(metadata?: VideoFrameCallbackMetadata) {
    return metadata?.mediaTime ?? video?.currentTime ?? 0
  }

  async function onFrame(now: number, metadata?: VideoFrameCallbackMetadata) {
    schedule()
    if (!engine || !video || busy || status.value !== 'live' || video.readyState < 2) return
    const ts = nextTimestamp(mediaTimeSeconds(metadata) * 1000, lastTs)
    if (ts === null) return
    lastTs = ts
    busy = true
    try {
      const { landmarks, metrics } = await engine.detect(await createImageBitmap(video), ts)
      applyMetrics(metrics)
      draw(landmarks)
      delegate.value = engine.state.delegate
      runsIn.value = engine.state.runsIn
      frames++
      if (now - fpsClock >= 1000) {
        fps.value = frames
        frames = 0
        fpsClock = now
      }
    } catch (err) {
      await recover((err as Error)?.message || '未知错误')
    } finally {
      busy = false
    }
  }

  /** 线程活着但推理出错时，先退回主线程继续跑，而不是整条链路退回演示回放 */
  async function recover(reason: string) {
    const seq = startSeq
    if (!downgraded) {
      downgraded = true
      engine?.close()
      engine = null
      try {
        const next = await createMainThreadPoseEngine(MODEL_PATHS)
        if (seq !== startSeq) {
          next.close()
          return
        }
        engine = next
        delegate.value = engine.state.delegate
        runsIn.value = engine.state.runsIn
        return
      } catch {
        // 主线程也起不来，走下面的错误分支
      }
    }
    if (seq !== startSeq) return
    errorMessage.value = `端侧推理失败：${reason}，已退回演示模式`
    stop()
    status.value = 'error'
  }

  function stopStream() {
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    if (video) video.srcObject = null
  }

  function stop() {
    startSeq++
    if (video && rvfcHandle && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(rvfcHandle)
    }
    rvfcHandle = 0
    if (rafHandle) cancelAnimationFrame(rafHandle)
    rafHandle = 0
    engine?.close()
    engine = null
    stopStream()
    applyMetrics(EMPTY_METRICS)
    fps.value = 0
    delegate.value = null
    runsIn.value = null
    startingStage.value = null
    lastTs = 0
    busy = false
    frames = 0
    if (status.value === 'live') status.value = 'idle'
  }

  async function openCameraStream(): Promise<MediaStream> {
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false }
    ]
    let lastError: unknown = null
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        lastError = err
        const name = (err as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') break
      }
    }
    throw lastError instanceof Error ? lastError : new Error('无法打开摄像头')
  }

  async function waitForVideoMetadata(videoEl: HTMLVideoElement): Promise<void> {
    if (videoEl.readyState >= 1) return
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('摄像头没有返回画面，请检查设备是否被占用'))
      }, 8000)
      const done = () => { cleanup(); resolve() }
      const fail = () => { cleanup(); reject(new Error('摄像头画面无法播放')) }
      const cleanup = () => {
        window.clearTimeout(timer)
        videoEl.removeEventListener('loadedmetadata', done)
        videoEl.removeEventListener('error', fail)
      }
      videoEl.addEventListener('loadedmetadata', done)
      videoEl.addEventListener('error', fail)
    })
  }

  function cameraErrorMessage(err: unknown): { status: PoseCameraStatus; message: string } {
    const name = (err as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return { status: 'denied', message: '摄像头权限被拒绝。请在浏览器地址栏允许摄像头，或到系统设置里检查。' }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { status: 'error', message: '没有找到可用的摄像头设备。请确认摄像头已连接并启用。' }
    }
    if (name === 'NotReadableError') {
      return { status: 'error', message: '摄像头被其他应用占用，暂时无法读取。关闭占用摄像头的应用后重试。' }
    }
    return { status: 'error', message: `摄像头启动失败：${(err as Error)?.message || name || '未知错误'}` }
  }

  async function start(videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) {
    stop()
    const seq = startSeq
    status.value = 'starting'
    startingStage.value = 'camera'
    errorMessage.value = ''
    downgraded = false
    if (!window.isSecureContext) {
      status.value = 'unsupported'
      errorMessage.value = '摄像头需要 https 或 localhost。当前页面不是安全上下文。'
      startingStage.value = null
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.value = 'unsupported'
      errorMessage.value = '当前浏览器不支持摄像头，或页面没有通过 localhost / https 打开。'
      startingStage.value = null
      return
    }

    // 先把画面接上，权限/设备错误能立刻显示；模型加载放在后面，不占用用户手势
    try {
      const media = await openCameraStream()
      if (seq !== startSeq) {
        media.getTracks().forEach(t => t.stop())
        return
      }
      stream = media
      video = videoEl
      canvas = canvasEl
      videoEl.srcObject = media
      await waitForVideoMetadata(videoEl)
      if (seq !== startSeq) return
      await videoEl.play()
      if (seq !== startSeq) return
      canvas.width = videoEl.videoWidth || 640
      canvas.height = videoEl.videoHeight || 480
    } catch (err) {
      if (seq !== startSeq) return
      const mapped = cameraErrorMessage(err)
      status.value = mapped.status
      errorMessage.value = mapped.message
      stop()
      return
    }

    startingStage.value = 'model'
    try {
      const created = await createPoseEngine(MODEL_PATHS)
      if (seq !== startSeq) {
        created.close()
        stopStream()
        return
      }
      engine = created
    } catch (err) {
      if (seq !== startSeq) return
      status.value = 'error'
      errorMessage.value = `相机已连接，但端侧姿态模型加载失败：${(err as Error)?.message || '请确认已运行 npm run camera:assets'}`
      stop()
      return
    }
    delegate.value = engine.state.delegate
    runsIn.value = engine.state.runsIn
    status.value = 'live'
    startingStage.value = null
    lastTs = 0
    frames = 0
    fpsClock = performance.now()
    schedule()
  }

  onUnmounted(() => {
    stop()
  })

  return {
    status,
    errorMessage,
    fps,
    kneeAngle,
    hipAngle,
    elbowAngle,
    visibility,
    delegate,
    runsIn,
    startingStage,
    start,
    stop
  }
}
