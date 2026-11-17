// 动作感知引擎的统一配置表：实时跟练与离线分析共用同一份关节/阈值定义。
// 纯函数接缝：不碰 DOM、不依赖 Vue，selfcheck 可直接断言。
//
// 之前 realtime 读 exercises.ts 的 CameraConfig（4 字段）+ ExecutionView 里 4 个硬编码，
// offline 在 motionAnalysis.ts 里另写两个 RepRule 字面量。这里收成一处。
import type { AnalysisAction } from '@/types/domain'
import type { RepRule } from '@/composables/repMachine'

export type JointName = 'knee' | 'hip' | 'elbow'
/** 剪影/相位文案类别；hip 是本次新增，此前硬拉借用 knee 导致文案说「下蹲/起身」 */
export type MotionFigureKind = 'knee' | 'elbow' | 'shoulder' | 'calf' | 'hip'
export type MotionMode = 'realtime' | 'offline'

export interface RepTiming {
  minStageMs: number
  minRepMs: number
  maxStageMs: number
  minStartMs?: number
  maxGapMs?: number
}

export interface CalibrationConfig {
  windowMs: number
  pollMs: number
  minSamples: number
  /** 校准姿势离行程末端太近时拒绝，取 max(bottomGuardDeg, hysteresis × hysteresisGuardFactor) */
  bottomGuardDeg: number
  hysteresisGuardFactor: number
}

export interface MotionExerciseConfig {
  exerciseId: string
  /** 兼容 PlanItem.exerciseName / demoExercises / demoVideos 的既有名字 join */
  name: string
  joint: JointName
  neutral: number
  bottom: number
  hysteresis: number
  minVisibility: number
  /**
   * 时序常量按模式分开：实时面对噪声相机、无 seek 精度，取值更严以防幻影计数。
   * 合成序列上两种策略计数完全一致（见 eval:synthetic S8），但干净数据无法触发时序门控，
   * 因此合并与否要等真实噪声视频的实测结果，不在这里拍脑袋统一。
   */
  timing: Record<MotionMode, RepTiming>
  /** 只有实时允许按用户起始姿势校准；离线必须保持文献固定阈值，否则绝对阈值规则失去意义 */
  calibratable: boolean
  calibration: CalibrationConfig
  countable: boolean
  /** 受服务端 CHECK 约束，只有 squat/deadlift/running 三个值，不可扩 */
  analysisAction?: AnalysisAction
  figureKind: MotionFigureKind
  phaseText: { down: string; up: string }
}

const DEFAULT_CALIBRATION: CalibrationConfig = {
  windowMs: 900, pollMs: 60, minSamples: 4, bottomGuardDeg: 20, hysteresisGuardFactor: 2
}

export const DEFAULT_MOTION_CALIBRATION = DEFAULT_CALIBRATION

export { DEFAULT_CALIBRATION }

const REALTIME_TIMING = { minRepMs: 700, maxStageMs: 6000 }
const OFFLINE_TIMING = { minStageMs: 200, minRepMs: 500, maxStageMs: 8000 }

const PHASE_TEXT: Record<MotionFigureKind, { down: string; up: string }> = {
  knee: { down: '下蹲', up: '起身' },
  elbow: { down: '弯起', up: '还原' },
  shoulder: { down: '下摆', up: '上举' },
  calf: { down: '落下', up: '提起' },
  hip: { down: '俯身', up: '站直' }
}

interface ConfigSeed {
  exerciseId: string
  name: string
  joint: JointName
  neutral: number
  bottom: number
  minStageMs: number
  figureKind?: MotionFigureKind
  analysisAction?: AnalysisAction
  countable?: boolean
}

function build(seed: ConfigSeed): MotionExerciseConfig {
  const figureKind = seed.figureKind ?? (seed.joint === 'elbow' ? 'elbow' : seed.joint === 'hip' ? 'hip' : 'knee')
  return {
    exerciseId: seed.exerciseId,
    name: seed.name,
    joint: seed.joint,
    neutral: seed.neutral,
    bottom: seed.bottom,
    hysteresis: 8,
    minVisibility: 0.5,
    timing: {
      realtime: { minStageMs: seed.minStageMs, ...REALTIME_TIMING },
      offline: { ...OFFLINE_TIMING }
    },
    calibratable: true,
    calibration: { ...DEFAULT_CALIBRATION },
    countable: seed.countable ?? true,
    analysisAction: seed.analysisAction,
    figureKind,
    phaseText: PHASE_TEXT[figureKind]
  }
}

/** 顺序与原 CAMERA_COUNTABLE 一致，避免跟练入口匹配顺序变化 */
export const MOTION_CONFIGS: MotionExerciseConfig[] = [
  build({ exerciseId: 'ex-chair-sitstand', name: '坐站训练', joint: 'knee', neutral: 168, bottom: 100, minStageMs: 220 }),
  build({ exerciseId: 'ex-stand-curl', name: '站姿弯举', joint: 'elbow', neutral: 170, bottom: 55, minStageMs: 180 }),
  build({ exerciseId: 'ex-band-curl', name: '弹力带弯举', joint: 'elbow', neutral: 170, bottom: 55, minStageMs: 180 }),
  build({ exerciseId: 'ex-bottle-curl', name: '水瓶替代弯举', joint: 'elbow', neutral: 170, bottom: 55, minStageMs: 180 }),
  build({ exerciseId: 'ex-band-row', name: '弹力带划船', joint: 'elbow', neutral: 168, bottom: 80, minStageMs: 200 }),
  build({ exerciseId: 'ex-mark-march', name: '高抬腿走', joint: 'knee', neutral: 172, bottom: 100, minStageMs: 150 }),
  build({ exerciseId: 'ex-lunge-twist', name: '动态弓步转体', joint: 'knee', neutral: 175, bottom: 105, minStageMs: 200 }),
  build({ exerciseId: 'ex-step-up', name: '台阶上下', joint: 'knee', neutral: 175, bottom: 100, minStageMs: 220 }),
  build({ exerciseId: 'ex-squat', name: '深蹲', joint: 'knee', neutral: 172, bottom: 95, minStageMs: 250, analysisAction: 'squat' }),
  build({ exerciseId: 'ex-deadlift', name: '硬拉', joint: 'hip', neutral: 165, bottom: 95, minStageMs: 250, analysisAction: 'deadlift' }),
  // 跑步实时走 DeviceMotion 步数，不做姿态计数；映射存在只为让趋势把跑步 session 与跑姿分析关联
  build({ exerciseId: 'ex-easy-run', name: '轻松跑', joint: 'knee', neutral: 172, bottom: 100, minStageMs: 200, analysisAction: 'running', countable: false }),
  build({ exerciseId: 'ex-brisk-walk', name: '快走', joint: 'knee', neutral: 172, bottom: 100, minStageMs: 200, analysisAction: 'running', countable: false })
]

const BY_NAME = new Map(MOTION_CONFIGS.map(config => [config.name, config]))
const BY_ID = new Map(MOTION_CONFIGS.map(config => [config.exerciseId, config]))

export function configForName(name: string): MotionExerciseConfig | undefined {
  return BY_NAME.get(name)
}

export function configForId(exerciseId: string): MotionExerciseConfig | undefined {
  return BY_ID.get(exerciseId)
}

export function configsForAction(action: AnalysisAction): MotionExerciseConfig[] {
  return MOTION_CONFIGS.filter(config => config.analysisAction === action)
}

/** 离线分析的动作入口：同名动作取第一个（深蹲/硬拉唯一，跑步取轻松跑） */
export function configForAction(action: AnalysisAction): MotionExerciseConfig | undefined {
  return configsForAction(action)[0]
}

export function repRuleFor(config: MotionExerciseConfig, mode: MotionMode): RepRule {
  const timing = config.timing[mode]
  return {
    neutral: config.neutral,
    bottom: config.bottom,
    hysteresis: config.hysteresis,
    minVisibility: config.minVisibility,
    minStageMs: timing.minStageMs,
    minRepMs: timing.minRepMs,
    maxStageMs: timing.maxStageMs,
    ...(timing.minStartMs !== undefined ? { minStartMs: timing.minStartMs } : {}),
    ...(timing.maxGapMs !== undefined ? { maxGapMs: timing.maxGapMs } : {})
  }
}

export function phaseTextFor(kind: MotionFigureKind): { down: string; up: string } {
  return PHASE_TEXT[kind] ?? PHASE_TEXT.knee
}