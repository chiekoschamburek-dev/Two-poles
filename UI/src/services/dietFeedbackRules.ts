// 饮食反馈的规则引擎：只看当天已记条目的「类别结构」——哪些类别出现过、主食占比、加餐次数。
// 不推断营养素克数，不评价健康程度，不下「吃得好/坏」的结论；检测在这里，表达分两层：
// 保底文案在本文件（LLM 不可用时直接展示），润色由 useDietFeedback 调模型完成。
import type { FoodCategory, Meal } from '@/types/domain'

export const DIET_RULE_VERSION = 'diet-feedback-v1'

/** 阈值集中在这里；调整门槛不需要改页面或组合式 */
export const DIET_THRESHOLDS = {
  /** R2 主食占比偏高：谷薯类条目数 / 当天已记条目数达到该比例 */
  stapleShare: 0.5,
  /** R2 生效所需的最少条目数：条目太少时占比不稳 */
  stapleMinItems: 4,
  /** R1/R3/R4 缺失类规则的触发时刻：该时刻前不催（早餐后没吃肉很正常） */
  missingAfter: '15:00',
  /** R5 加餐偏多：加餐餐次达到该数才提示 */
  snackCount: 3,
  /** R5 触发时刻 */
  snackAfter: '20:00',
  /** 即时反馈一次最多弹的条数（卡片不受限，始终列全部命中规则） */
  maxImmediate: 2,
  /** 即时反馈门槛：当天至少 1 餐正餐且条目总数 ≥ 该值 */
  immediateMinItems: 2,
  /** 晚间总结门槛：当天至少记录了几餐正餐 */
  summaryMinMeals: 2
} as const

/** 蛋白质类：四类只要出现一类即算有 */
const PROTEIN_CATEGORIES: FoodCategory[] = ['蛋类', '奶类', '肉类', '豆类']

export type DietRuleId = 'protein-missing' | 'staple-heavy' | 'veg-missing' | 'fruit-missing' | 'snack-heavy'

export const DIET_RULE_TITLES: Record<DietRuleId, string> = {
  'protein-missing': '蛋白质类还没出现',
  'staple-heavy': '主食占比偏高',
  'veg-missing': '蔬菜还没出现',
  'fruit-missing': '水果还没出现',
  'snack-heavy': '加餐次数偏多'
}

export interface DietFinding {
  id: DietRuleId
  /** 短标题，如「主食占比偏高」 */
  title: string
  /** 保底建议文案：规则引擎自带，模型不可用时直接展示 */
  advice: string
  /** 依据：让用户能核对这条结论来自哪些记录 */
  basis: string
  /** 优先级，小者先出 */
  priority: number
}

export interface DayIntakeFacts {
  date: string
  /** 正餐数（早餐/午餐/晚餐，不含加餐） */
  recordedMainMeals: number
  itemCount: number
  /** 出现过的类别（按 FOOD_CATEGORIES 之外的原始顺序去重） */
  categories: FoodCategory[]
  /** 谷薯类条目数 */
  stapleCount: number
  snackCount: number
  /** 摘要给模型/依据用的条目行，如「午餐：米饭（谷薯类）×1 碗」 */
  itemLines: string[]
}

export function dayIntakeFacts(meals: Meal[], date: string): DayIntakeFacts {
  const ofDay = meals.filter(m => m.date === date)
  const categories: FoodCategory[] = []
  const itemLines: string[] = []
  let stapleCount = 0
  let itemCount = 0
  for (const meal of ofDay) {
    for (const item of meal.items) {
      itemCount += 1
      if (!categories.includes(item.category)) categories.push(item.category)
      if (item.category === '谷薯类') stapleCount += 1
      const portion = item.portionSize !== undefined ? ` ×${item.portionSize}${item.portionUnit ?? ''}` : ''
      itemLines.push(`${meal.mealType === 'snack' ? '加餐' : meal.mealType}：${item.foodName}（${item.category}）${portion}`)
    }
  }
  return {
    date,
    recordedMainMeals: ofDay.filter(m => m.mealType !== 'snack').length,
    itemCount,
    categories,
    stapleCount,
    snackCount: ofDay.filter(m => m.mealType === 'snack').length,
    itemLines
  }
}

function minuteOfDay(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

function after(time: string, threshold: string): boolean {
  return minuteOfDay(time) >= minuteOfDay(threshold)
}

/** 即时反馈门槛：至少 1 餐正餐且条目够少判断不过于单薄 */
export function meetsImmediateGate(facts: DayIntakeFacts): boolean {
  return facts.recordedMainMeals >= 1 && facts.itemCount >= DIET_THRESHOLDS.immediateMinItems
}

/** 晚间总结门槛：正餐记够才回顾全天，否则不生成（写进免责说明） */
export function meetsSummaryGate(facts: DayIntakeFacts): boolean {
  return facts.recordedMainMeals >= DIET_THRESHOLDS.summaryMinMeals
}

function categoryLine(categories: FoodCategory[]): string {
  return categories.length ? categories.join('、') : '暂无'
}

/**
 * 跑全部规则。time 为 HH:mm，决定缺失类规则是否到点；summary=true 是晚间回顾：
 * 不限条数、以回顾语气给文案。返回按优先级排序的命中清单。
 */
export function dietFindings(facts: DayIntakeFacts, time: string, opts: { summary?: boolean } = {}): DietFinding[] {
  if (opts.summary ? !meetsSummaryGate(facts) : !meetsImmediateGate(facts)) return []
  const summary = opts.summary === true
  const findings: DietFinding[] = []

  if (after(time, DIET_THRESHOLDS.missingAfter) && !PROTEIN_CATEGORIES.some(c => facts.categories.includes(c))) {
    findings.push({
      id: 'protein-missing',
      title: DIET_RULE_TITLES['protein-missing'],
      advice: summary
        ? '今天蛋、奶、肉、豆这几类一直没出现，明天记得补上一份蛋白质类。'
        : '今天到现在还没出现蛋、奶、肉、豆这类食物，下一餐建议加一份。',
      basis: `已记 ${facts.itemCount} 项，类别只有：${categoryLine(facts.categories)}`,
      priority: 1
    })
  }

  if (
    facts.itemCount >= DIET_THRESHOLDS.stapleMinItems &&
    facts.stapleCount / facts.itemCount >= DIET_THRESHOLDS.stapleShare
  ) {
    findings.push({
      id: 'staple-heavy',
      title: DIET_RULE_TITLES['staple-heavy'],
      advice: summary
        ? '今天谷薯类占比到了一半以上，下一顿可以少一点主食、多配蔬菜或蛋白质。'
        : '谷薯类在今天的记录里占了一半以上，下一餐建议减一点主食，加蔬菜或蛋白质类。',
      basis: `谷薯类 ${facts.stapleCount} / 已记 ${facts.itemCount} 项`,
      priority: 2
    })
  }

  if (after(time, DIET_THRESHOLDS.missingAfter) && !facts.categories.includes('蔬菜类')) {
    findings.push({
      id: 'veg-missing',
      title: DIET_RULE_TITLES['veg-missing'],
      advice: summary ? '今天蔬菜类没有出现，明天三餐里配上一份就好。' : '今天还没吃蔬菜，晚餐建议加一份。',
      basis: `已记 ${facts.itemCount} 项，类别只有：${categoryLine(facts.categories)}`,
      priority: 3
    })
  }

  if (after(time, DIET_THRESHOLDS.missingAfter) && !facts.categories.includes('水果类')) {
    findings.push({
      id: 'fruit-missing',
      title: DIET_RULE_TITLES['fruit-missing'],
      advice: summary ? '今天没有水果记录，明天可以加餐时补一份。' : '今天还没有水果，可以加一份水果作加餐。',
      basis: `已记 ${facts.itemCount} 项，类别只有：${categoryLine(facts.categories)}`,
      priority: 4
    })
  }

  if (after(time, DIET_THRESHOLDS.snackAfter) && facts.snackCount >= DIET_THRESHOLDS.snackCount) {
    findings.push({
      id: 'snack-heavy',
      title: DIET_RULE_TITLES['snack-heavy'],
      advice: summary ? '今天加餐记了 3 次以上，正餐吃得更饱一点，加餐自然会少。' : '今天加餐已经 3 次了，正餐尽量吃饱，减少额外加餐。',
      basis: `加餐 ${facts.snackCount} 次`,
      priority: 5
    })
  }

  return findings.sort((a, b) => a.priority - b.priority)
}

/** 即时反馈取前 N 条（卡片始终展示全部，只有限 Toast 条数用这个） */
export function limitImmediate(findings: DietFinding[]): DietFinding[] {
  return findings.slice(0, DIET_THRESHOLDS.maxImmediate)
}
