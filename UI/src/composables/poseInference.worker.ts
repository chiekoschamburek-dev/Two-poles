// 端侧姿态推理的工作线程：模型与推理都不占主线程，画面仍只在本机处理。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { computeMetrics } from './poseMath'
import type { PoseMetrics } from './poseMath'
import { createPoseLandmarker } from './poseLandmarkerFactory'
import type { PoseDelegate, PoseModelPaths, VisionFileset } from './poseLandmarkerFactory'

type WorkerRequest =
  | { type: 'init'; wasmPath: string; modelPath: string }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: 'close' }

export type WorkerResponse =
  | { type: 'ready'; delegate: PoseDelegate; gpuError: string | null }
  | { type: 'failed'; message: string }
  | { type: 'delegate'; delegate: PoseDelegate; gpuError: string | null }
  | { type: 'result'; id: number; landmarks: NormalizedLandmark[]; metrics: PoseMetrics }

const emit = (message: WorkerResponse) => {
  ;(globalThis as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(message)
}

const EMPTY_METRICS: PoseMetrics = { kneeAngle: null, hipAngle: null, elbowAngle: null, visibility: 0 }

let vision: VisionFileset | null = null
let landmarker: PoseLandmarker | null = null
let paths: PoseModelPaths | null = null
let delegate: PoseDelegate = 'CPU'

function disposeLandmarker() {
  try {
    landmarker?.close()
  } catch {
    // close 失败没有可挽回的动作，重建即可
  }
  landmarker = null
}

function bindCanvas(): OffscreenCanvas | null {
  return typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(640, 480)
}

async function handleInit(req: Extract<WorkerRequest, { type: 'init' }>) {
  paths = { wasmPath: req.wasmPath, modelPath: req.modelPath }
  try {
    vision = await FilesetResolver.forVisionTasks(req.wasmPath)
    const created = await createPoseLandmarker(vision, paths, bindCanvas())
    landmarker = created.landmarker
    delegate = created.delegate
    emit({ type: 'ready', delegate, gpuError: created.gpuError })
  } catch (err) {
    disposeLandmarker()
    emit({ type: 'failed', message: (err as Error)?.message || '端侧模型初始化失败' })
  }
}

/** GPU 图跑不动时降级重建：丢掉这一帧继续跑，不能让整条链路退成演示回放 */
async function downgradeToCpu(reason: string) {
  if (!vision || !paths) return
  disposeLandmarker()
  const created = await createPoseLandmarker(vision, paths, bindCanvas())
  landmarker = created.landmarker
  delegate = created.delegate
  emit({ type: 'delegate', delegate, gpuError: `${reason}；已退回 CPU` })
}

async function handleDetect(req: Extract<WorkerRequest, { type: 'detect' }>) {
  const landmarks: NormalizedLandmark[] = []
  let metrics = EMPTY_METRICS
  try {
    if (landmarker && vision) {
      const result = landmarker.detectForVideo(req.bitmap, req.timestamp)
      const first = result.landmarks[0] ?? []
      landmarks.push(...first)
      metrics = computeMetrics(first)
    }
  } catch (err) {
    const message = (err as Error)?.message || '推理失败'
    if (delegate === 'GPU') await downgradeToCpu(message)
  } finally {
    req.bitmap.close()
  }
  emit({ type: 'result', id: req.id, landmarks, metrics })
}

globalThis.addEventListener('message', (event: MessageEvent) => {
  const req = event.data as WorkerRequest
  if (req.type === 'init') {
    void handleInit(req)
    return
  }
  if (req.type === 'detect') {
    void handleDetect(req)
    return
  }
  disposeLandmarker()
})
