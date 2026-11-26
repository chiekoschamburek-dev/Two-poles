// 动作分析模板注册表：新增可分析动作时，只登记一条模板 + 一套规则；
// 通用几何、分段、事件、运动学与结果组装都留在共享引擎里。
//
// 安全边界（docs/adr/0003）：只有带可核验文献阈值的模板才能产出 finding；
// findingsReady=false 的模板只出测量值，界面必须明确说明，不能把测量值包装成结论。
import type { AnalysisView } from '@/types/domain'
import type { JointName } from '@/services/motionConfig'
import { configForId, repRuleFor } from '@/services/motionConfig'
import type { RepRule } from '@/composables/repMachine'

export const MOTION_TEMPLATES_VERSION = 'motion-templates-v1'

export type MotionCategory = 'strength' | 'bodyweight' | 'cardio' | 'core' | 'mobility'
export type MotionPattern = 'squat' | 'hinge' | 'push' | 'pull' | 'curl' | 'lunge' | 'core-hold' | 'gait' | 'sit-to-stand'
/** 分析形态：计次 / 步态 / 静态保持 */
export type AnalysisKind = 'reps' | 'gait' | 'hold'
export type TemplatePoint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe'

export interface TemplateSegmentation {
  joint: JointName
  neutral: number
  bottom: number
  hysteresis: number
  minStageMs: number
  /**
   * 单段最长时长覆盖：椅子起坐底部可能坐很久（组课/示范视频），
   * 沿用深蹲的 8 秒会把坐姿停留判成"动作中断"。
   */
  maxStageMs?: number
}

export interface MotionActionTemplate {
  id: string
  label: string
  category: MotionCategory
  /** 动作模式；未登记动作的兜底模板没有模式，不假装是深蹲 */
  pattern?: MotionPattern
  kind: AnalysisKind
  /** 该动作支持的拍摄视角；不支持的视角在预检阶段拒绝 */
  views: AnalysisView[]
  /** 预检要求清晰可见的关键点 */
  requiredPoints: TemplatePoint[]
  /** kind='reps' 时必填；阈值从 motionConfig 派生，实时与离线共用一份 */
  segmentation?: TemplateSegmentation
  /** 规则集 id；没有规则集时只跑通用测量 */
  ruleSet?: string
  /** 自动识别器；没有识别器的动作只能手动选择 */
  classifier?: 'squat-hinge' | 'gait' | 'elbow-curl' | 'static-hold'
  /** true 才能产出 finding；false 只出测量值（ADR-0003） */
  findingsReady: boolean
  /** 是否生成运动学曲线；当前只给既有三个动作，避免扩 motionKinematics 的关节类型 */
  kinematics: boolean
  /** 是否出现在分析动作选择器 */
  visible: boolean
  /** 与动作库/跟练的关联；没有对应条目时为 undefined（如跑姿） */
  exerciseId?: string
  /** 选择器里的一句说明 */
  note?: string
}

function segmentationFrom(exerciseId: string): TemplateSegmentation | undefined {
  const config = configForId(exerciseId)
  if (!config) return undefined
  return {
    joint: config.joint,
    neutral: config.neutral,
    bottom: config.bottom,
    hysteresis: config.hysteresis,
    minStageMs: config.timing.offline.minStageMs
  }
}

/**
 * 缺配置时不在模块加载期 throw：那会让整个应用启动即崩，而问题只是一个动作不能分析。
 * 这里降级返回 undefined，并把问题记下来，由 motionTemplateProblems() 与 selfcheck 报出来。
 */
const SEGMENTATION_PROBLEMS: string[] = []

function segmentationOrProblem(exerciseId: string): TemplateSegmentation | undefined {
  const segmentation = segmentationFrom(exerciseId)
  if (!segmentation) SEGMENTATION_PROBLEMS.push(`动作模板缺少计数配置：${exerciseId}`)
  return segmentation
}

/** 只覆盖单项时序（例如弯举的底部停留比深蹲短），关节与阈值仍来自统一配置 */
function segmentationWithMinStage(exerciseId: string, minStageMs: number): TemplateSegmentation | undefined {
  const base = segmentationOrProblem(exerciseId)
  return base ? { ...base, minStageMs } : undefined
}

/** 椅子起坐：允许坐姿停留更久（组课/示范视频会坐着讲解） */
function chairSitStandSegmentation(): TemplateSegmentation | undefined {
  const base = segmentationOrProblem('ex-chair-sitstand')
  return base ? { ...base, minStageMs: 220, maxStageMs: 20000 } : undefined
}

export const MOTION_TEMPLATES: MotionActionTemplate[] = [
  {
    id: 'squat',
    label: '深蹲',
    category: 'strength',
    pattern: 'squat',
    kind: 'reps',
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle'],
    segmentation: segmentationOrProblem('ex-squat'),
    ruleSet: 'squat',
    classifier: 'squat-hinge',
    findingsReady: true,
    kinematics: true,
    visible: true,
    exerciseId: 'ex-squat',
    note: '膝主导的下蹲；侧面看深度与躯干，正面看膝内扣'
  },
  {
    id: 'deadlift',
    label: '硬拉',
    category: 'strength',
    pattern: 'hinge',
    kind: 'reps',
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle'],
    segmentation: segmentationOrProblem('ex-deadlift'),
    ruleSet: 'deadlift',
    classifier: 'squat-hinge',
    findingsReady: true,
    kinematics: true,
    visible: true,
    exerciseId: 'ex-deadlift',
    note: '髋主导的拉力；侧面看伸髋锁定与躯干'
  },
  {
    id: 'running',
    label: '跑姿',
    category: 'cardio',
    pattern: 'gait',
    kind: 'gait',
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    ruleSet: 'running',
    classifier: 'gait',
    findingsReady: true,
    kinematics: true,
    visible: true,
    note: '跑步机或直道；至少 5 个步态周期'
  },
  {
    id: 'curl',
    label: '站姿弯举',
    category: 'strength',
    pattern: 'curl',
    kind: 'reps',
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'elbow', 'wrist'],
    segmentation: segmentationWithMinStage('ex-stand-curl', 120),
    ruleSet: 'curl',
    classifier: 'elbow-curl',
    findingsReady: false,
    kinematics: false,
    visible: true,
    exerciseId: 'ex-stand-curl',
    note: '目前只提供次数、肘角幅度与节奏测量值，不出关注项'
  },
  {
    id: 'sit-to-stand',
    label: '椅子起坐',
    category: 'strength',
    pattern: 'sit-to-stand',
    kind: 'reps',
    // 斜侧只做计数/节律，不出矢状面/冠状面结论（视角-规则能力矩阵会拦住）
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle'],
    segmentation: chairSitStandSegmentation(),
    // 测量型模板：没有可核验的起坐文献阈值，只出次数与节奏
    findingsReady: false,
    kinematics: false,
    visible: true,
    exerciseId: 'ex-chair-sitstand',
    note: '坐下与起身各算半个动作；目前只提供次数、底部停留与节奏测量值，不出关注项'
  },
  {
    id: 'walk',
    label: '步行',
    category: 'cardio',
    pattern: 'gait',
    kind: 'gait',
    views: ['side', 'front', 'oblique'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    ruleSet: 'walk',
    classifier: 'gait',
    findingsReady: false,
    kinematics: false,
    // 不新增可见模板：识别到步行时只给基础节律测量，并提示跑姿专项规则不适用
    visible: false,
    note: '识别到步行：跑姿专项规则不适用，只给步频/触地等基础节律测量'
  },
  {
    id: 'plank',
    label: '平板支撑',
    category: 'core',
    pattern: 'core-hold',
    kind: 'hold',
    views: ['side'],
    requiredPoints: ['shoulder', 'hip', 'knee', 'ankle'],
    classifier: 'static-hold',
    findingsReady: false,
    kinematics: false,
    visible: true,
    exerciseId: 'ex-plank',
    note: '目前只提供保持时长、肩-髋-踝对齐与晃动测量值，不出关注项'
  }
]

const BY_ID = new Map(MOTION_TEMPLATES.map(template => [template.id, template]))

/** 未登记动作的兜底：只保证历史记录/未知 id 不崩，不假装能分析 */
export function templateFor(id: string): MotionActionTemplate {
  const found = BY_ID.get(id)
  if (found) return found
  return {
    id: id || 'unknown',
    label: id && id !== 'unknown' ? id : '未识别动作',
    category: 'strength',
    kind: 'reps',
    views: ['side', 'front'],
    requiredPoints: [],
    findingsReady: false,
    kinematics: false,
    visible: false,
    note: '未登记的动作模板'
  }
}

export function visibleTemplates(): MotionActionTemplate[] {
  return MOTION_TEMPLATES.filter(template => template.visible)
}

/** 只有带文献阈值的模板才进趋势；测量型动作不画“关注项恒为 0”的图 */
export function findingsTemplates(): MotionActionTemplate[] {
  return MOTION_TEMPLATES.filter(template => template.findingsReady)
}

/**
 * 模板注册表自检：缺计数配置、id 重复、没有视角、承诺出关注项却没有规则集。
 * 这些都不该让应用启动失败，而是要在构建期/自检里暴露；selfcheck 断言它恒为空。
 */
export function motionTemplateProblems(): string[] {
  const problems = [...SEGMENTATION_PROBLEMS]
  const ids = new Set<string>()
  for (const template of MOTION_TEMPLATES) {
    if (ids.has(template.id)) problems.push(`模板 id 重复：${template.id}`)
    ids.add(template.id)
    if (!template.views.length) problems.push(`模板没有可用视角：${template.id}`)
    if (template.kind === 'reps' && !template.segmentation) problems.push(`计次模板缺少分段配置：${template.id}`)
    if (template.findingsReady && !template.ruleSet) problems.push(`承诺出关注项却没有规则集：${template.id}`)
    if (template.visible && !template.note) problems.push(`选择器里的模板要有一句说明：${template.id}`)
  }
  return problems
}

/**
 * 动作未确认时是否必须先选一个动作。
 * 跑姿没有动作选择器，存疑档也允许按跑姿分析；其他动作必须由用户确认。
 */
export function requiresActionConfirmation(action: string, confirmed: boolean): boolean {
  // 跑姿/步行由步态特征判定且没有动作选择器，存疑档也允许按识别结果分析
  return !confirmed && action !== 'running' && action !== 'walk'
}

/** 离线分段规则：优先复用实时配置的同一份阈值 */
export function repRuleForTemplate(template: MotionActionTemplate): RepRule | null {
  if (!template.segmentation) return null
  const config = template.exerciseId ? configForId(template.exerciseId) : undefined
  if (config) {
    const rule = repRuleFor(config, 'offline')
    // 模板可覆盖单段时序（例如动态弯举的底部停留比深蹲短、椅子起坐允许久坐），关节/阈值仍来自统一配置
    return {
      ...rule,
      minStageMs: template.segmentation.minStageMs ?? rule.minStageMs,
      ...(template.segmentation.maxStageMs !== undefined ? { maxStageMs: template.segmentation.maxStageMs } : {})
    }
  }
  return {
    neutral: template.segmentation.neutral,
    bottom: template.segmentation.bottom,
    hysteresis: template.segmentation.hysteresis,
    minStageMs: template.segmentation.minStageMs,
    minRepMs: 500,
    maxStageMs: template.segmentation.maxStageMs ?? 8000,
    minVisibility: 0.5
  }
}