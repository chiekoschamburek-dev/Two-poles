// ===== Domain Type Definitions =====

export type Mode = 'public' | 'athlete'

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
  mode: Mode
  modeChangedAt: string

  // Common fields
  nickname?: string
  age: number
  goal: string
  experience: string
  availableTimes: string[]
  equipment: string[]
  /** 常训练的场地，供 F04 过滤；旧档案可能没有这个字段 */
  availableVenues?: string[]
  restrictions: string[]

  // 身体数据（两种模式都可用，选填）
  /** 身高 cm */
  height?: number
  /** 体重 kg；旧档案里已有这个字段，继续沿用 */
  weight?: number

  // Athlete-specific fields
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
}

// === Plan & Versioning ===

export interface Plan {
  id: string
  userId: string
  version: number
  createdAt: string
  mode: Mode
  reason: string
  weekStartDate: string
  weekEndDate: string
  items: PlanItem[]
  locked: boolean
  /** 计划来源：规则生成与模型生成在界面上的口径不同 */
  source?: 'rules' | 'llm'
}

export interface PlanItem {
  id: string
  planId: string
  date: string
  exerciseId?: string
  exerciseName: string
  type: TrainingType
  plannedDuration?: number // minutes
  plannedDistance?: number // meters
  plannedSets?: number
  plannedReps?: number
  note?: string
  locked: boolean
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

export interface PlanAdjustment {
  id: string
  planId: string
  createdAt: string
  reason: string
  changes: PlanChange[]
  status: 'pending' | 'accepted' | 'rejected'
}

export interface PlanChange {
  itemId: string
  type: 'unchanged' | 'changed' | 'locked'
  oldValue?: Partial<PlanItem>
  newValue?: Partial<PlanItem>
}

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
  manualCorrections: number
  confidence?: number

  createdAt: string
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

export interface Meal {
  id: string
  userId: string
  date: string
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  time: string
  completeness: MealCompleteness
  items: MealItem[]
  analyzed: boolean
  analysis?: MealAnalysis
  createdAt: string
}

export interface MealItem {
  id: string
  mealId: string
  foodId: string
  foodName: string
  category: FoodCategory
  portionSize?: number
  portionUnit?: string
  confirmed: boolean
  /** 条目来源：手动填写或端侧照片识别后由用户确认 */
  source?: 'manual' | 'photo'
  /** 照片识别时的最高置信度 */
  photoConfidence?: number
}

/** 表单里的一行草稿：类别有默认值，份量允许留空（留空即"部分记录"） */
export interface MealDraft {
  foodName: string
  category: FoodCategory
  portionSize: number | ''
  portionUnit: string
  source?: 'manual' | 'photo'
  photoConfidence?: number
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
  plannedSessions: number
  completedSessions: number
  totalDuration: number
  totalDistance: number

  // Load summary (athlete mode)
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

export interface PoseKeypoint {
  x: number
  y: number
  confidence: number
  name: string
}

export interface PoseFrame {
  keypoints: PoseKeypoint[]
  timestamp: number
  phase: ExercisePhase
  confidence: number
}

export interface CameraSession {
  exerciseName: string
  exerciseType: TrainingType
  startTime: string
  events: DemoEvent[]
  totalCount: number
  totalDuration: number
  manualCorrections: number
  averageConfidence: number
}

// === Settings & Privacy ===

export interface PrivacySettings {
  cameraEnabled: boolean
  saveVideoLocally: boolean
  dataRetentionDays: number
  exportFormat: 'json' | 'csv'
  /** 热量粗估默认关闭：单张照片估不出分量，只在用户主动打开时才显示区间 */
  showEnergyEstimate: boolean
}

/** 三态而不是开关：调研指出"半适配深色"和"强制深色"都是高频差评，默认跟随系统 */
export type ThemePreference = 'system' | 'light' | 'dark'

// === Toast Notifications ===

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  dismissible: boolean
}
