// PoseLandmarker 的创建：worker 与主线程两条路共用，GPU 探测与 CPU 回落只写一处。
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

export type PoseDelegate = 'GPU' | 'CPU'
export type PoseModelPaths = { wasmPath: string; modelPath: string }
/** WasmFileset 没有从包里导出，只能从 forVisionTasks 的返回值取 */
export type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
export type CreatedPoseLandmarker = {
  landmarker: PoseLandmarker
  delegate: PoseDelegate
  gpuError: string | null
}

function buildOptions(paths: PoseModelPaths, delegate: PoseDelegate, canvas?: HTMLCanvasElement | OffscreenCanvas) {
  return {
    baseOptions: { modelAssetPath: paths.modelPath, delegate },
    ...(canvas ? { canvas } : {}),
    runningMode: 'VIDEO' as const,
    numPoses: 1
  }
}

/**
 * GPU delegate 要绑定一块**专用** canvas：任务会在它上面初始化 WebGL 上下文，
 * 失败即抛错（见 @mediapipe/tasks-vision 的 VisionTaskOptions.canvas 注释），
 * 而且不能复用已经有 2D 上下文的叠加层。绑不上就整体退回 CPU，不谎报。
 */
export async function createPoseLandmarker(
  vision: VisionFileset,
  paths: PoseModelPaths,
  gpuCanvas: HTMLCanvasElement | OffscreenCanvas | null
): Promise<CreatedPoseLandmarker> {
  if (gpuCanvas) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(vision, buildOptions(paths, 'GPU', gpuCanvas))
      return { landmarker, delegate: 'GPU', gpuError: null }
    } catch (err) {
      const gpuError = (err as Error)?.message || 'GPU 上下文初始化失败'
      const landmarker = await PoseLandmarker.createFromOptions(vision, buildOptions(paths, 'CPU'))
      return { landmarker, delegate: 'CPU', gpuError }
    }
  }
  const landmarker = await PoseLandmarker.createFromOptions(vision, buildOptions(paths, 'CPU'))
  return { landmarker, delegate: 'CPU', gpuError: '当前环境没有可用的 GPU 绑定 canvas' }
}
