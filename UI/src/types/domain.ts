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
  restrictions: string[]

  // Athlete-specific fields
  discipline?: string
  cyclePhase?: string
  cycleStartDate?: string
  cycleEndDate?: string
  targetEvent?: string
  weight?: number
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
}

export interface MealAnalysis {
  id: string
  mealId: string
  categoryCoverage: FoodCategory[]
  missingCategories: FoodCategory[]
  unknownItems: string[]
  hasNutritionEstimate: boolean
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
}

// === Toast Notifications ===

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  dismissible: boolean
}
