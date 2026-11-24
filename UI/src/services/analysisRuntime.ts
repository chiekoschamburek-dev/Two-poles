// 端侧分析运行时的纯策略：单帧推理预算、超时降级判定、送模型前的帧尺寸。
// 不碰 DOM、不依赖 Vue，selfcheck 可直接断言；浏览器侧的编排在
// `composables/poseEngine.ts` 与 `composables/useVideoAnalysis.ts`。

/**
 * 常规帧的推理预算。GPU 上单帧通常只要几十毫秒，留 8 秒是给驱动抖动/后台节流的余量，
 * 超了就当 GPU 图已经不可信，交给调用方换 CPU 重跑。
 */
export const POSE_DETECT_TIMEOUT_MS = 8_000

/**
 * 首帧单独放宽：worker 里第一次 `detectForVideo` 要建 GL 图、编译 shader、上传纹理，
 * Windows/ANGLE 上 1–3 秒很常见。原来固定 2 秒会把「首帧慢」误判成「模型坏了」。
 */
export const POSE_FIRST_DETECT_TIMEOUT_MS = 12_000

/**
 * 模型输入只有 256×256，1080p 原图送进去纯属浪费带宽与显存；
 * 逐帧分析前先缩到这个宽度（只缩宽，高按比例，landmark 是归一化坐标，不受影响）。
 */
export const POSE_INPUT_MAX_WIDTH = 960

/** 推理超时的专用错误：调用方据此决定「换 CPU 重跑这一帧」而不是整段失败 */
export class PoseTimeoutError extends Error {
  constructor(message = '姿态推理超时') {
    super(message)
    this.name = 'PoseTimeoutError'
  }
}

/**
 * 只认自己抛的类型。worker 错误经 `postMessage` 回来会丢原型链，所以再兜一层 name 判断；
 * 其它错误（模型初始化失败、decoder 报错）不允许被当成超时降级。
 */
export function isPoseTimeoutError(err: unknown): err is PoseTimeoutError {
  return err instanceof PoseTimeoutError || (err instanceof Error && err.name === 'PoseTimeoutError')
}

/** 需要缩放时返回目标宽高；已经在阈值内或尺寸非法时返回 null */
export function poseInputSize(
  width: number,
  height: number,
  maxWidth: number = POSE_INPUT_MAX_WIDTH
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || width <= maxWidth) return null
  const scale = maxWidth / width
  return { width: Math.round(width * scale), height: Math.max(1, Math.round(height * scale)) }
}