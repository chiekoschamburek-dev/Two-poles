import { ref, onUnmounted } from 'vue'
import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PoseCameraStatus = 'idle' | 'starting' | 'live' | 'unsupported' | 'denied' | 'error'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/pose_landmarker_lite.task'

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }

function angleAt(a: NormalizedLandmark, vertex: NormalizedLandmark, b: NormalizedLandmark): number | null {
  const v1x = a.x - vertex.x
  const v1y = a.y - vertex.y
  const v2x = b.x - vertex.x
  const v2y = b.y - vertex.y
  const magnitude = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!magnitude) return null
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / magnitude))
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

/**
 * 只负责"看见"：拉摄像头、跑端侧姿态推理、输出关键点与关节角。
 * 不判定动作是否标准，也不产生计数——计数仍由页面的演示时钟驱动。
 */
export function usePoseCamera() {
  const status = ref<PoseCameraStatus>('idle')
  const errorMessage = ref('')
  const fps = ref(0)
  const kneeAngle = ref<number | null>(null)
  const hipAngle = ref<number | null>(null)
  const elbowAngle = ref<number | null>(null)
  const visibility = ref(0)

  let landmarker: PoseLandmarker | null = null
  let stream: MediaStream | null = null
  let video: HTMLVideoElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let frames = 0
  let fpsClock = 0
  let lastTs = -1

  async function ensureLandmarker(): Promise<PoseLandmarker> {
    if (landmarker) return landmarker
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1
    })
    return landmarker
  }

  function draw(landmarks: NormalizedLandmark[]) {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!landmarks.length) return
    const utils = new DrawingUtils(ctx)
    utils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
      color: 'rgba(77, 216, 192, 0.85)',
      lineWidth: 3
    })
    utils.drawLandmarks(landmarks, {
      color: '#ffffff',
      fillColor: '#0a9b9d',
      lineWidth: 1,
      radius: 3
    })
  }

  function readPose(landmarks: NormalizedLandmark[]) {
    if (landmarks.length < 28) {
      visibility.value = 0
      return
    }
    const knee = landmarks[LEFT.knee]
    const score = landmarks.slice(LEFT.shoulder, LEFT.ankle + 1)
      .reduce((sum, p) => sum + (p.visibility ?? 1), 0) / 6
    visibility.value = score
    kneeAngle.value = angleAt(landmarks[LEFT.hip], knee, landmarks[LEFT.ankle])
    hipAngle.value = angleAt(landmarks[LEFT.shoulder], landmarks[LEFT.hip], knee)
    elbowAngle.value = angleAt(landmarks[LEFT.shoulder], landmarks[LEFT.elbow], landmarks[LEFT.wrist])
  }

  function loop(now: number) {
    if (!landmarker || !video || status.value !== 'live') return
    if (video.readyState >= 2 && now !== lastTs) {
      lastTs = now
      const result = landmarker.detectForVideo(video, now)
      const landmarks = result.landmarks[0] ?? []
      draw(landmarks)
      readPose(landmarks)
      frames++
      if (now - fpsClock >= 1000) {
        fps.value = frames
        frames = 0
        fpsClock = now
      }
    }
    raf = requestAnimationFrame(loop)
  }

  async function start(videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) {
    stop()
    status.value = 'starting'
    errorMessage.value = ''
    try {
      landmarker = await ensureLandmarker()
    } catch (err) {
      status.value = 'error'
      errorMessage.value = `端侧模型加载失败：${(err as Error)?.message || '请确认已运行 npm run camera:assets'}`
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.value = 'unsupported'
      errorMessage.value = '当前浏览器或访问方式不支持摄像头（需要 https 或 localhost）'
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      })
      video = videoEl
      canvas = canvasEl
      videoEl.srcObject = stream
      await videoEl.play()
      canvas.width = videoEl.videoWidth || 640
      canvas.height = videoEl.videoHeight || 480
      status.value = 'live'
      fpsClock = performance.now()
      raf = requestAnimationFrame(loop)
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        status.value = 'denied'
        errorMessage.value = '摄像头权限被拒绝，已退回演示模式'
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        status.value = 'error'
        errorMessage.value = '没有可用的摄像头设备，已退回演示模式'
      } else {
        status.value = 'error'
        errorMessage.value = `摄像头启动失败：${(err as Error)?.message || name || '未知错误'}`
      }
      stopStream()
    }
  }

  function stopStream() {
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    if (video) video.srcObject = null
  }

  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
    stopStream()
    kneeAngle.value = null
    hipAngle.value = null
    elbowAngle.value = null
    visibility.value = 0
    fps.value = 0
    if (status.value === 'live') status.value = 'idle'
  }

  onUnmounted(() => {
    stop()
    landmarker?.close()
    landmarker = null
  })

  return {
    status,
    errorMessage,
    fps,
    kneeAngle,
    hipAngle,
    elbowAngle,
    visibility,
    start,
    stop
  }
}
