// 推理引擎的两种落地：优先工作线程，不可用时回落主线程；对外只暴露同一个 detect 形状。
import { FilesetResolver } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { computeMetrics } from './poseMath'
import type { PoseMetrics } from './poseMath'
import { createPoseLandmarker } from './poseLandmarkerFactory'
import type { PoseDelegate, PoseModelPaths } from './poseLandmarkerFactory'
import type { WorkerResponse } from './poseInference.worker'
// 必须是经典 worker：MediaPipe 的 wasm 加载器在 worker 里走 importScripts，
// 而 module worker 下 Vite 不会把 public/ 里的 glue 当模块解析（dev 直接 500）。
import PoseInferenceWorker from './poseInference.worker?worker'

export type PoseFrameResult = { landmarks: NormalizedLandmark[]; metrics: PoseMetrics }

export type PoseEngine = {
  state: { delegate: PoseDelegate; runsIn: 'worker' | 'main'; gpuError: string | null }
  detect(bitmap: ImageBitmap, timestamp: number): Promise<PoseFrameResult>
  close(): void
}

const DETECT_TIMEOUT_MS = 2000

async function createWorkerEngine(paths: PoseModelPaths): Promise<PoseEngine> {
  if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持工作线程')
  const worker = new PoseInferenceWorker()
  const state = { delegate: 'CPU' as PoseDelegate, runsIn: 'worker' as const, gpuError: null as string | null }
  const pending = new Map<number, { resolve: (r: PoseFrameResult) => void; reject: (e: Error) => void }>()
  let seq = 0

  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        state.delegate = message.delegate
        state.gpuError = message.gpuError
        resolve()
      } else if (message.type === 'failed') {
        reject(new Error(message.message))
      } else if (message.type === 'delegate') {
        state.delegate = message.delegate
        state.gpuError = message.gpuError
      } else {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        waiter?.resolve({ landmarks: message.landmarks, metrics: message.metrics })
      }
    }
    worker.onerror = () => reject(new Error('姿态推理线程启动失败'))
  })

  worker.postMessage({ type: 'init', wasmPath: paths.wasmPath, modelPath: paths.modelPath })
  await ready

  return {
    state,
    detect(bitmap, timestamp) {
      const id = ++seq
      return new Promise<PoseFrameResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('姿态推理超时'))
        }, DETECT_TIMEOUT_MS)
        pending.set(id, {
          resolve: result => { clearTimeout(timer); resolve(result) },
          reject: error => { clearTimeout(timer); reject(error) }
        })
        worker.postMessage({ type: 'detect', id, bitmap, timestamp }, [bitmap])
      })
    },
    close() {
      worker.postMessage({ type: 'close' })
      worker.terminate()
      pending.clear()
    }
  }
}

/** 回落路径：GPU 需要一块绑定用的 canvas，主线程这里仍按今天的行为只跑 CPU */
async function createMainThreadEngine(paths: PoseModelPaths): Promise<PoseEngine> {
  const vision = await FilesetResolver.forVisionTasks(paths.wasmPath)
  const created = await createPoseLandmarker(vision, paths, null)
  const state = { delegate: created.delegate, runsIn: 'main' as const, gpuError: created.gpuError }
  return {
    state,
    async detect(bitmap, timestamp) {
      try {
        const result = created.landmarker.detectForVideo(bitmap, timestamp)
        const landmarks = result.landmarks[0] ?? []
        return { landmarks, metrics: computeMetrics(landmarks) }
      } finally {
        bitmap.close()
      }
    },
    close() {
      try {
        created.landmarker.close()
      } catch {
        // 关闭失败无需处理，组件已卸载
      }
    }
  }
}

export async function createPoseEngine(paths: PoseModelPaths): Promise<PoseEngine> {
  // Vite dev 会把 ?worker 变成 module worker，MediaPipe 的 wasm loader 在 module worker 里
  // 会走 dynamic import，命中 /public 资源限制并弹 Vite 错误遮罩；开发时直接用主线程，
  // 构建产物是 classic worker，继续保留 worker/GPU 路径。
  if (import.meta.env.DEV) return createMainThreadEngine(paths)
  try {
    return await createWorkerEngine(paths)
  } catch (err) {
    console.warn('[pose] worker unavailable, falling back to main thread:', err)
    return createMainThreadEngine(paths)
  }
}

export async function createMainThreadPoseEngine(paths: PoseModelPaths): Promise<PoseEngine> {
  return createMainThreadEngine(paths)
}
