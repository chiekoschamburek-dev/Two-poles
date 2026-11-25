// ===== Domain Type Definitions =====

export type SyncState = 'pending' | 'synced' | 'conflict'

export type MealCompleteness = 'complete' | 'partial' | 'unknown'

export type FoodCategory =
  | '谷薯类'
  | '蔬菜类'
  | '水果类'
  | '蛋类'
  | '奶类'
  | '肉类'
  | '豆类'
  | '坚果类'
  | '油脂类'
  | '其他'

export type TrainingType =
  | '跑步'
  | '动态热身'
  | '坐站训练'
  | '站姿弯举'
  | '舒缓整理'
  | '其他'

export type ExercisePhase = 'idle' | 'ready' | 'down' | 'up' | 'occluded' | 'complete'

// === Motion Analysis ===

/**
 * 分析动作 id。权威列表在 services/motionTemplates.ts（MOTION_TEMPLATES）；
 * 这里用 string 是为了让同步回来的新动作/历史记录不因旧客户端的联合类型而崩，
 * 界面展示一律走 templateFor()，对未登记 id 有明确兜底。
 */
export type AnalysisAction = string
export type AnalysisView = 'side' | 'front'
export type AnalysisStatus = 'completed' | 'low-confidence'

export interface MotionAnalysisFinding {
  id?: string
  ruleId: string
  title: string
  detail: string
  timeMs: number | null
  measured: number | null
  unit?: string
  thresholdLabel: string
  sourceLabel: string
  sourceUrl?: string
  /** 本机 IndexedDB 引用；同步到其他设备后取不到图 */
  keyframeRef?: string
  /** 0–1，由关键点质量×视角置信×越界幅度×基线强度推出；findings 是无模式 JSON，服务端原样透传 */
  confidence?: number
}

export interface MotionAnalysisMetric {
  id: string
  label: string
  value: number | string
  unit?: string
}

export interface MotionAnalysisResult {
  findings: MotionAnalysisFinding[]
  metrics: MotionAnalysisMetric[]
  repCount: number | null
  gaitCycles: number | null
  /** 静态保持型动作的分析区间秒数；计次/步态动作为 null */
  holdSeconds?: number | null
  usableRatio: number
  /** 本次分析的实际采样帧率；曲线断线判定与缺口阈值都依赖它 */
  fps: number
  /** 逐次摘要；此前算完即丢，现在留给一致性规则、曲线与留存用 */
  reps?: RepAnalysisRecord[]
  /** 逐帧角度序列；曲线与关键帧定位用 */
  angles?: MotionAngleSample[]
  /** 由逐帧角度/髋部位置派生的运动学序列；只在本机会话与可选留存里使用 */
  kinematics?: MotionKinematics
}

/** 与 motionAnalysis.RepAnalysis 同形，放这里避免 types 反向依赖 services */
export interface RepAnalysisRecord {
  index: number
  startMs: number
  endMs: number
  bottomMs: number
  bottomKneeAngle: number | null
  bottomHipAngle: number | null
  bottomTrunkAngle: number | null
  endKneeAngle: number | null
  endHipAngle: number | null
  endTrunkAngle: number | null
  depthOffset: number | null
  leftKneeAngle: number | null
  rightKneeAngle: number | null
  kneeAnkleRatio: number | null
  shoulderHeightDiff: number | null
  hipHeightDiff: number | null
  eccentricMs: number | null
  bottomHoldMs: number | null
  visibilityMean: number | null
  /** 通用分段口径：本次实际用的主关节与底部/结束角度；旧记录没有这些字段 */
  primaryJoint?: 'knee' | 'hip' | 'elbow'
  bottomPrimaryAngle?: number | null
  endPrimaryAngle?: number | null
  rangeOfMotion?: number | null
  bodyAlignment?: number | null
  leftPrimaryAngle?: number | null
  rightPrimaryAngle?: number | null
}

export interface MotionAngleSample {
  timeMs: number
  visibility: number
  kneeAngle: number | null
  hipAngle: number | null
  trunkAngle: number | null
  /** 弯举等上肢动作的肘角；下肢动作通常为 null */
  elbowAngle?: number | null
}

// === Motion Kinematics ===
// 只存派生序列，不存视频/画面。角量单位 °/s、°/s²；线量按躯干长归一化，
// 单位「躯干长/秒」，不是 m/s——单目世界坐标以髋为原点，给不出对地速度。

export interface MotionKinematicsSample {
  timeMs: number
  /** 平滑后的角度，度 */
  angle: number | null
  /** 角速度，度/秒；正=角度增大（伸展），负=角度减小（屈曲） */
  angularVelocity: number | null
  /** 角加速度，度/秒² */
  angularAcceleration: number | null
}

export interface MotionKinematicsJoint {
  joint: 'knee' | 'hip' | 'trunk'
  side: 'left' | 'right' | null
  samples: MotionKinematicsSample[]
  /** 有效角速度样本 / 总帧数 */
  validRatio: number
}

export interface MotionKinematicsLinearSample {
  timeMs: number
  /** 向上为正，单位：躯干长/秒 */
  velocity: number | null
  acceleration: number | null
}

export interface MotionKinematicsLinear {
  unit: '躯干长/秒'
  /** 归一化用的躯干长度（2D 归一化单位），仅供诊断 */
  scaleLength: number
  samples: MotionKinematicsLinearSample[]
  validRatio: number
}

export interface MotionKinematicsRep {
  index: number
  startMs: number
  bottomMs: number
  endMs: number
  /** 离心段（角度减小）峰值速度，正值 */
  peakFlexionVelocity: number | null
  /** 向心段（角度增大）峰值速度，正值 */
  peakExtensionVelocity: number | null
  peakAngularAcceleration: number | null
  peakAccelerationTimeMs: number | null
}

export interface MotionKinematics {
  version: string
  primaryJoint: 'knee' | 'hip'
  joints: MotionKinematicsJoint[]
  linear: MotionKinematicsLinear | null
  reps: MotionKinematicsRep[]
  quality: {
    smoothing: 'savitzky-golay'
    windowSec: number
    order: number
    validRatio: number
  }
}

export interface MotionPrecheckResult {
  /** view-unclear：人体与动作都识别到了，只是机位判不准，交给用户点一下视角 */
  verdict: 'ok' | 'degraded' | 'view-unclear' | 'rejected'
  reasons: string[]
  view: AnalysisView | null
  /** 视角判不准时按分离度给出的就近建议，只用于界面预选，不直接当结论 */
  suggestedView?: AnalysisView | null
  repCount: number | null
  gaitCycles: number | null
  /** 静态保持型动作在预检区间内检测到的秒数；其他类型为 null/缺省 */
  holdSeconds?: number | null
  /** 自动识别的动作；连人体都没过时为 null */
  action: AnalysisAction | null
  /** false = 自动识别特征不明确，需要用户确认或改选动作 */
  actionConfident: boolean
}

export interface MotionAnalysis {
  id: string
  userId: string
  date: string
  action: AnalysisAction
  exerciseName: string
  view: AnalysisView
  status: AnalysisStatus
  lowConfidenceReasons: string[]
  findings: MotionAnalysisFinding[]
  metrics: MotionAnalysisMetric[]
  repCount: number | null
  gaitCycles: number | null
  /** 可用帧占比：影响结果可信度，趋势里据此标注 */
  usableRatio?: number
  sessionId?: string
  ruleVersion: string
  createdAt: string
  clientId?: string
  serverId?: string
  updatedAt?: string
  _sync?: SyncState
}

// === User & Profile ===

/** 目标类型：比赛目标与周期目标二选一，但两边的已填内容都要留住 */
export type GoalType = 'competition' | 'cycle'

/** 一条 PB。成绩存用户输入的原文，比较时再解析成秒 / 米 */
export interface PersonalBest {
  id: string
  /** 项目名，可以是预设项也可以是自定义 */
  event: string
  /** 径赛按时间、田赛按距离 */
  track: boolean
  /** 原始输入：11.23 / 2:05.3 / 6.85 m */
  result: string
  date?: string
  notes?: string
}

/** 健身房极限数据。kind 区分"实测 1RM"与"训练中最高重量"，不互相反推 */
export interface GymRecord {
  id: string
  lift: string
  weight: number
  reps?: number
  kind: '1rm' | 'working'
  date?: string
}

export interface UserProfile {
  id: string

  // Common fields
  nickname?: string
  avatarDataUrl?: string
  age: number
  goal: string
  experience: string
  availableTimes: string[]
  equipment: string[]
  /** 常训练的场地，供 F04 过滤；旧档案可能没有这个字段 */
  availableVenues?: string[]
  restrictions: string[]

  // 身体数据（选填）
  /** 身高 cm */
  height?: number
  /** 体重 kg；旧档案里已有这个字段，继续沿用 */
  weight?: number

  // 专项与周期字段（选填，所有用户都可填写）
  /** 专项 / 主项，可多选；空数组与没填同义。旧档案的 discipline 由 profileRules.disciplinesOf() 迁入 */
  disciplines?: string[]
  /** 旧档案的单选专项。只用于读取历史数据，保存时不再写这个字段 */
  discipline?: string
  cyclePhase?: string
  cycleStartDate?: string
  cycleEndDate?: string
  targetEvent?: string
  /** 目标类型，只决定档案页先展开哪一块 */
  goalType?: GoalType
  /** 比赛目标：日期与目标成绩 */
  targetEventDate?: string
  targetResult?: string
  /** 周期目标：这一阶段的重点 */
  cycleFocus?: string
  /** PB 与健身房极限都是追加式历史，不覆盖 */
  personalBests?: PersonalBest[]
  gymRecords?: GymRecord[]
  /** 最近一次本地修改时间；用于与同步层做 last-write-wins */
  updatedAt?: string
}

// === Plan & Versioning ===

export interface Plan {
  id: string
  userId: string
  version: number
  createdAt: string
  /** 给用户看的一句话说明；技术版本号放在 ruleVersion，不拼进这里 */
  reason: string
  /** 生成/调整该计划所用的规则版本；只在数据层使用，界面不展示代号 */
  ruleVersion?: string
  weekStartDate: string
  weekEndDate: string
  items: PlanItem[]
  source?: 'rules' | 'llm' | 'image'
  clientId?: string
  serverId?: string
  updatedAt?: string
  _sync?: SyncState
}

export interface PlanItem {
  id: string
  serverId?: string
  planId: string
  date: string
  exerciseId?: string
  exerciseName: string
  type: TrainingType
  plannedDuration?: number // minutes
  plannedDistance?: number // meters
  plannedSets?: number
  plannedReps?: number
  /** time 模式每组保持秒数；旧计划没有这个字段时回退动作库默认 */
  plannedHoldSeconds?: number
  /** steps 模式目标分钟；旧计划没有这个字段时回退动作库默认 */
  plannedTargetMinutes?: number
  note?: string
  completed: boolean
  alternatives?: AlternativeExercise[]
}

export interface AlternativeExercise {
  id: string
  name: string
  reason: string
  duration?: number
  sets?: number
  reps?: number
}

export interface PlanChange {
  itemId: string
  type: 'unchanged' | 'changed'
  oldValue?: Partial<PlanItem>
  newValue?: Partial<PlanItem>
}

export type AdjustmentResolutionStatus = 'accepted' | 'dismissed'

/**
 * 一条已处理的调整建议。带 updatedAt 是为了跨设备合并：
 * 同一条建议在两台设备上都点过时，按时间取较新的那次，而不是谁后同步谁赢。
 */
export interface AdjustmentResolutionEntry {
  status: AdjustmentResolutionStatus
  /** ISO 时间；旧版本记录没有该字段时为 '' */
  updatedAt: string
}

/**
 * 已处理的调整建议 key → 用户当时的选择。
 * key 里的场次用 clientId（跨设备稳定），计划项用 item.id（服务端按 client_item_id 回传，同样稳定），
 * 因此同一批证据在不同设备上算出的 key 一致，可以安全同步。
 */
export type AdjustmentResolutions = Record<string, AdjustmentResolutionEntry>

// === Training & Sessions ===

export interface TrainingSession {
  id: string
  userId: string
  planItemId?: string
  date: string
  exerciseName: string
  type: TrainingType

  // Execution data
  actualDuration?: number // minutes
  actualDistance?: number // meters
  actualSets?: number
  actualReps?: number

  // Feedback
  completionStatus: 'completed' | 'partial' | 'skipped'
  completionReason?: string
  rpe: number | null // 0-10, null if not recorded
  discomfort: boolean
  notes?: string

  // Camera demo metadata
  cameraUsed: boolean
  /** 摄像头实际确认的次数；actualReps 保留用户修正后的记录值。 */
  countedReps?: number
  manualCorrections: number
  confidence?: number
  /** 实时跟练按个人起始姿势校准后的中立位；离线分析不带（固定文献阈值），趋势据此区分口径 */
  calibratedNeutral?: number

  createdAt: string
  clientId?: string
  serverId?: string
  updatedAt?: string
  _sync?: SyncState
}

export interface SessionFeedback {
  sessionId: string
  duration?: number
  distance?: number
  rpe: number | null
  discomfort: boolean
  reason?: string
  notes?: string
}

// === Meals & Nutrition ===

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface Meal {
  id: string
  userId: string
  date: string
  mealType: MealType
  time: string
  completeness: MealCompleteness
  items: MealItem[]
  analyzed: boolean
  analysis?: MealAnalysis
  createdAt: string
  /** 本机压缩缩略图（data URL）；旧记录没有这个字段 */
  photoThumb?: string
  /** 本机原图在 IndexedDB 里的 key；旧记录没有这个字段 */
  photoId?: string
  clientId?: string
  serverId?: string
  updatedAt?: string
  _sync?: SyncState
}

/** 照片识别模型给出的粗估热量；不是权威成分表数值，只作可选展示 */
export interface ModelEnergyEstimate {
  low: number
  high: number
  note?: string
}

export interface MealItem {
  id: string
  serverId?: string
  mealId: string
  foodId: string
  foodName: string
  category: FoodCategory
  portionSize?: number
  portionUnit?: string
  confirmed: boolean
  /** 条目来源：手动填写或照片识别后由用户确认 */
  source?: 'manual' | 'photo'
  /** 照片识别时的最高置信度 */
  photoConfidence?: number
  /** 识别模型明确标记不确定，或类别只能落到"其他" */
  uncertain?: boolean
  /** 用户已逐项确认过；覆盖低置信度与"其他"类别的待确认标记 */
  userConfirmed?: boolean
  /** 识别模型给出的粗略热量区间，旧记录没有这个字段 */
  modelEnergy?: ModelEnergyEstimate
}

/** 表单里的一行草稿：类别有默认值，份量允许留空（留空即"部分记录"） */
export interface MealDraft {
  foodName: string
  category: FoodCategory
  portionSize: number | ''
  portionUnit: string
  source?: 'manual' | 'photo'
  photoConfidence?: number
  uncertain?: boolean
  /** 用户已明确确认这一项（识别结果或手动录入） */
  userConfirmed?: boolean
  modelEnergy?: ModelEnergyEstimate
}

export interface EnergyEstimateRef {
  foodName: string
  low: number
  high: number
  grams: number
  /** 数值口径，例："熟重 · 116 kcal/100 g · 1 碗=250 g（本机口径）" */
  basis: string
  source: string
  /** 记录当时的"1 单位=几克"；改造前的历史记录没有这几个字段 */
  gramsPerUnit?: number
  unitOwn?: boolean
  unit?: string
}

export interface MealAnalysis {
  id: string
  mealId: string
  categoryCoverage: FoodCategory[]
  missingCategories: FoodCategory[]
  unknownItems: string[]
  hasNutritionEstimate: boolean
  /** 仅当用户在设置里打开热量粗估时才有值；一律以区间呈现 */
  estimateRefs?: EnergyEstimateRef[]
  ruleVersion: string
  limitations: string[]
  createdAt: string
}

// === Reports ===

export interface WeeklyReport {
  userId: string
  weekStartDate: string
  weekEndDate: string

  // Training summary
  /** 计划场次：计划条目所在的天数 */
  plannedSessions: number
  /** 有记录场次：本周有训练记录的天数，含非计划日 */
  completedSessions: number
  /** 计划日中有记录的天数：completionRate 的分子，单独给出来才能被复算 */
  recordedPlannedSessions?: number
  /** 有记录但不在计划日的天数 */
  offPlanSessions?: number
  totalDuration: number
  totalDistance: number

  // Load summary
  totalLoad: number | null
  loadByDay: (number | null)[]
  missingSessions: string[]

  // Meal summary
  totalMeals: number
  recordedMeals: number
  completeMeals: number
  categoryCoverage: Record<FoodCategory, number>

  // Meta
  dataQuality: string[]
  ruleVersion: string
}

// === Camera Demo ===

export interface DemoEvent {
  time: number // milliseconds from start
  state: ExercisePhase
  confidence: number
  count?: number
  message?: string
}

// === Settings & Privacy ===

export interface PrivacySettings {
  cameraEnabled: boolean
  exportFormat: 'json' | 'csv'
  /** 热量粗估默认关闭：单张照片估不出分量，只在用户主动打开时才显示区间 */
  showEnergyEstimate: boolean
  /** 饮食记录里保存压缩缩略图（仅本机，用于回看这次拍的照片） */
  saveFoodPhotoLocally: boolean
  /**
   * 默认关闭：开启后跟练与动作分析的关节角度/关键点坐标会存进本机 IndexedDB 供回看曲线。
   * 画面与视频本身始终不落盘；派生几何数据仍属运动生物特征邻近数据，故需显式同意。
   */
  saveMotionSeriesLocally: boolean
  /** 最近一次本地修改时间；用于与同步层做 last-write-wins */
  updatedAt?: string
}

/** F19 语音节奏播报：默认关闭，避免与读屏的 aria-live 提示双声道同时发声 */
export interface SpeechSettings {
  enabled: boolean
  /** 本机中文音色的 voiceURI；空串 = 用枚举到的第一个中文音色 */
  voiceURI: string
}

/** 三态而不是开关：调研指出"半适配深色"和"强制深色"都是高频差评，默认跟随系统 */
export type ThemePreference = 'system' | 'light' | 'dark'

/** 计划项标记完成后的整行显示方式 */
export type PlanCompletionStyle = 'highlight' | 'strike'

// === Toast Notifications ===

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  dismissible: boolean
}
