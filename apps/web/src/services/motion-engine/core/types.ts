// Motion Engine V2 的公共数据契约。
// 纯类型 + 常量：不碰 DOM、不依赖 Vue，可被自我校验脚本直接导入。
//
// 设计约束（对应执行方案 §2/§3）：
// - 运动感知（感知层）与决策（结论层）分离：这里只描述"测到了什么"，不描述"应该怎么评价"；
// - 每一种可靠性单独表达，禁止用一个 confident 布尔值代表全部证据；
// - 允许未知：任何识别结果都必须能是 unknown，而不是硬塞进最近的动作。

/** 一级运动大类：先分物理模态，再类内细分，避免跨类误判（跑→硬拉这种） */
export type MotionFamily = 'strength' | 'locomotion' | 'isometric' | 'other' | 'unknown'

/** 引擎内部的视角表示；'unknown' 表示证据不足，不能强行套用视角规则 */
export type EngineView = 'side' | 'front' | 'oblique' | 'unknown'

/** 视角估计输出：连续量 + 离散类别 + 可靠性，不再只有单一投影比例 */
export interface ViewEstimate {
  category: EngineView
  /** 人体朝向相对相机的偏航角（度），只有 2D 证据时为 null，不硬编造 */
  yawDeg: number | null
  /** 0–1 质量分数：不是"正确概率"，未经校准不得当概率对外展示 */
  reliability: number
  /** 0–1 时序稳定性：同一段视频里视角是否基本不变 */
  temporalStability: number
  /** 逐区间视角：用户中途转身时不再把整片当一个机位 */
  segments: ViewSegment[]
  /** 各指标在当前视角下是否可观测（0–1） */
  observability: Record<string, number>
  /** 参与判定的证据条数与说明，便于排查 */
  evidence: ViewEvidence
}

export interface ViewSegment {
  startMs: number
  endMs: number
  category: EngineView
  reliability: number
}

export interface ViewEvidence {
  uprightFrames: number
  medianSeparationRatio: number | null
  medianFarSideVisibilityGap: number | null
  shoulderCrossings: number
  /** 只有底层模型给 worldLandmarks 时才有的辅助证据；缺失为 null */
  worldYawDeg: number | null
  problems: string[]
}

/** 逐帧共享特征：所有识别/分段/规则都从这里取数，不再各算一套 */
export interface MotionFeatureFrame {
  timeMs: number
  /** 8 点核心关节平均可见度，与 V1 帧级口径一致 */
  visibility: number
  /** 未取整关节角（度）；2D 投影角，不是 mocap 真值 */
  kneeAngle: number | null
  hipAngle: number | null
  elbowAngle: number | null
  /** 躯干与竖直夹角；正面/背向投影很弱，只作连续特征，不单独当结论 */
  trunkAngle: number | null
  /** 构成角的点可见度最小值（喂状态机口径） */
  kneeVisibility: number
  hipVisibility: number
  elbowVisibility: number
  /** 相机坐标系下的归一化 y（0=画面上缘，1=下缘）；y 越大越低 */
  hipMidY: number | null
  shoulderMidY: number | null
  ankleMidY: number | null
  kneeMidY: number | null
  wristMidY: number | null
  ankleYLeft: number | null
  ankleYRight: number | null
  /** 尺度归一化几何（除以当帧/中位躯干长，单位「躯干长」） */
  torsoLength: number | null
  /** 髋相对踝的高度，正值越大表示蹲得越低（右脚方向：y 向下） */
  hipHeightNorm: number | null
  /** (腕 y − 膝 y)/躯干长；正值 = 腕在膝下方，硬拉底部特征 */
  wristBelowKnee: number | null
  /** 膝盖相对髋的水平前移（胫骨前移代理），除以躯干长 */
  kneeForwardNorm: number | null
  /** 角速度（度/秒），Savitzky–Golay 平滑后求导；方向未统一，只作连续特征 */
  kneeVelocity: number | null
  hipVelocity: number | null
  elbowVelocity: number | null
  /** 帧级跟踪质量 0–1：可见度 + 骨长稳定 + 无跳变 + 无左右交换 */
  reliability: number
  /** 该帧上可用于测量的关节；false 的关节不得参与阈值判定 */
  jointReliable: Record<'knee' | 'hip' | 'elbow' | 'trunk', boolean>
}

/** 姿态质量汇总：告诉上层"哪些帧能信"，而不是只给一个全局均可见度 */
export interface PoseQualitySummary {
  frameCount: number
  usableFrames: number
  usableRatio: number
  reliableFrames: number
  meanReliability: number
  /** 推理缺口（按时间戳大于 maxGapMs 或关键点整帧缺失切段） */
  gaps: { startMs: number; endMs: number }[]
  gapMs: number
  /** 各骨段长度变异系数（越小越稳） */
  boneStability: Record<string, number>
  /** 关键点左右交换嫌疑帧数 */
  sideSwaps: number
  problems: string[]
}

/** 共享时序特征序列：M3–M6 的唯一输入底座 */
export interface MotionFeatureSeries {
  version: string
  fps: number
  durationSec: number
  frames: MotionFeatureFrame[]
  quality: PoseQualitySummary
  /** 尺度基准：躯干长中位数（归一化坐标单位）；无有效躯干时为 null */
  scale: { torsoLengthMedian: number | null }
}

/** 动作假设：分类器输出候选 + 分差 + 来源，不再直接给"就是某动作" */
export interface ActionHypothesis {
  action: string
  family: MotionFamily
  score: number
  /** 与第二名分差；只有一个候选时为 null */
  margin: number | null
  source: 'rule' | 'model' | 'user'
  /** 自动判定是否足够可信；false 时必须允许用户改判 */
  confident: boolean
}

/** 一次重复/步态周期/保持区间的统一事件表示 */
export interface RepEvent {
  startMs: number
  bottomMs: number
  endMs: number
  /** 不完整动作：只有下放或只有起身，单独记录，不混入完整次数 */
  partial: boolean
  partialKind?: 'ascent-only' | 'descent-only' | 'occluded-cycle'
  /** 该次动作的主关节角范围（度） */
  rangeDeg: number | null
}

/** 分析区间：预检/结果/持久化都记录"这一段结论覆盖了视频的哪些时间" */
export interface AnalyzedRange {
  startMs: number
  endMs: number
  /** 这个区间是怎么选出来的 */
  source: 'whole-clip' | 'active-window' | 'gait-window' | 'hold-window' | 'user'
}

/** 六层证据：逐层独立，最终结论必须能追溯到各层 */
export interface MotionEvidence {
  version: string
  pose: { usableRatio: number; meanReliability: number; gaps: number }
  action: { action: string; family: MotionFamily; score: number; margin: number | null; confident: boolean; source: ActionHypothesis['source'] }
  view: { category: EngineView; reliability: number; stability: number }
  event: { count: number; partialCount: number; confidence: number }
  metric: Record<string, { value: number | null; reliability: number; uncertainty: number | null }>
  finding: { produced: number; skippedRules: string[] }
  analyzedRange: AnalyzedRange | null
}

/** 逐区间视角可观测性矩阵：哪些指标在当前机位能评估 */
export interface ObservabilityMatrix {
  /** 矢状面角度类（下蹲深度、躯干前倾、髋锁定） */
  sagittalAngles: number
  /** 冠状面角度类（膝内扣、肩髋对称） */
  frontalAngles: number
  /** 计数/节律/时长类：与角度无关，几乎总是可评估 */
  rhythm: number
  /** 步态事件/步频类 */
  gaitEvents: number
  /** 静态保持时长 */
  holdDuration: number
}

export const EMPTY_POSE_QUALITY: PoseQualitySummary = {
  frameCount: 0,
  usableFrames: 0,
  usableRatio: 0,
  reliableFrames: 0,
  meanReliability: 0,
  gaps: [],
  gapMs: 0,
  boneStability: {},
  sideSwaps: 0,
  problems: []
}