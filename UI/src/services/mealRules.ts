// 餐食记录的结构规则：只判断"类别是否出现"，不推断摄入量、不评价健康程度。
import type { FoodCategory, Meal, MealAnalysis, MealCompleteness, MealItem, MealType } from '@/types/domain'
import { ESTIMATE_BAND, findFood, FOOD_CATALOG_VERSION, inferCategory, isMixedFood } from './foodComposition'

export const RULE_VERSION = 'diet-rules-v2'

/** 类别推断：命中目录用目录类别；混合菜与未命中返回 null，由用户确认 */
export function suggestCategory(foodName: string): FoodCategory | null {
  return inferCategory(foodName)
}

export const isMixed = isMixedFood

export const FOOD_CATEGORIES: FoodCategory[] = [
  '谷薯类',
  '蔬菜类',
  '水果类',
  '蛋类',
  '奶类',
  '肉类',
  '豆类',
  '坚果类',
  '油脂类',
  '其他'
]

/** 一天里期望出现的类别；油脂类与其他不做要求 */
const EXPECTED_CATEGORIES: FoodCategory[] = [
  '谷薯类',
  '蔬菜类',
  '水果类',
  '蛋类',
  '奶类',
  '肉类',
  '豆类',
  '坚果类'
]

export const MEAL_SLOTS = [
  { id: 'breakfast' as const, label: '早餐', defaultTime: '08:00' },
  { id: 'lunch' as const, label: '午餐', defaultTime: '12:00' },
  { id: 'dinner' as const, label: '晚餐', defaultTime: '18:30' }
]

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

export const MEAL_TYPE_OPTIONS = (Object.keys(MEAL_TYPE_LABELS) as MealType[]).map(id => ({
  id,
  label: MEAL_TYPE_LABELS[id]
}))

export function mealTypeLabel(type: MealType): string {
  return MEAL_TYPE_LABELS[type] ?? '加餐'
}

/** 餐次窗口按本地时间闭区间判断；不落在任何正餐窗口里的都记为加餐 */
export interface MealTimeWindow {
  type: Exclude<MealType, 'snack'>
  start: string
  end: string
}

/** 阈值集中在这里，调整餐次边界不需要改页面或识别服务 */
export const MEAL_TIME_WINDOWS: MealTimeWindow[] = [
  { type: 'breakfast', start: '05:00', end: '10:29' },
  { type: 'lunch', start: '10:30', end: '14:59' },
  { type: 'dinner', start: '15:00', end: '21:00' }
]

function minuteOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function inferMealType(at: Date | string, windows: MealTimeWindow[] = MEAL_TIME_WINDOWS): MealType {
  const minutes = at instanceof Date
    ? at.getHours() * 60 + at.getMinutes()
    : minuteOfDay(at)
  if (minutes === null) return 'snack'
  for (const win of windows) {
    const start = minuteOfDay(win.start)
    const end = minuteOfDay(win.end)
    if (start === null || end === null) continue
    if (minutes >= start && minutes <= end) return win.type
  }
  return 'snack'
}

/**
 * 免责清单必须与实际出的数一致：以前无论有没有开热量粗估都写"没有热量估算"，
 * 而 store 在开关打开时会把 hasNutritionEstimate 置 true——同屏自相矛盾。
 * @param hasEstimate 本次分析是否真的产出了热量区间
 */
export function buildLimitations(hasEstimate: boolean): string[] {
  return [
    '只统计类别是否出现过，不判断分量、烹调方式与油盐糖用量。',
    hasEstimate
      ? `本次含热量区间粗估（±${Math.round(ESTIMATE_BAND * 100)}%）：依赖所填份量与 ${FOOD_CATALOG_VERSION} 的演示参考值（未与权威成分表逐项核对），只在设置里主动开启才显示。`
      : '不给出营养素摄入量数值，也没有热量估算（hasNutritionEstimate = false）。',
    '混合菜未拆分成原料时不参与营养估算，类别保持"待确认"。',
    '未记录的餐次一律标为"未记录"，不代表没有吃。',
    `规则版本 ${RULE_VERSION}；规则变更后历史记录不会自动重算。`
  ]
}

/** 默认按"不含估算"渲染；有估算时调用方传 hasEstimate */
export const LIMITATIONS = buildLimitations(false)

/**
 * 单餐只判断"这餐出现了哪些类别"；missingCategories 是记完这餐后**当天**仍缺的类别，
 * 需要传入当天已有的类别（早餐不该被要求覆盖水果和奶类）。
 * @param hasEstimate 调用方是否已产出热量区间，决定免责清单怎么写
 */
export function analyzeMeal(
  items: MealItem[],
  dayCategories: FoodCategory[] = [],
  hasEstimate = false
): Omit<MealAnalysis, 'id' | 'createdAt'> {
  const present = new Set<FoodCategory>()
  const unknown: string[] = []

  for (const item of items) {
    // 混合菜即使被归到某个类别，也只是按主料猜的，进"待确认"
    if (item.category === '其他' || isMixedFood(item.foodName)) {
      if (!unknown.includes(item.foodName)) unknown.push(item.foodName)
      if (item.category !== '其他') present.add(item.category)
      continue
    }
    present.add(item.category)
  }

  const dayPresent = new Set<FoodCategory>([...dayCategories, ...present])
  const coverage = EXPECTED_CATEGORIES.filter(c => present.has(c))
  return {
    mealId: '',
    categoryCoverage: coverage,
    missingCategories: EXPECTED_CATEGORIES.filter(c => !dayPresent.has(c)),
    unknownItems: unknown,
    hasNutritionEstimate: false,
    ruleVersion: `${RULE_VERSION} / ${FOOD_CATALOG_VERSION}`,
    limitations: buildLimitations(hasEstimate)
  }
}

/** 有食物但份量不全时算部分记录 */
export function deriveCompleteness(items: MealItem[]): MealCompleteness {
  if (!items.length) return 'unknown'
  return items.every(i => i.confirmed && i.portionSize !== undefined) ? 'complete' : 'partial'
}

export interface DaySummary {
  slots: { id: Meal['mealType']; label: string; meal: Meal | null }[]
  recorded: number
  planned: number
  completeCount: number
  partialCount: number
  unknownCount: number
  coverage: FoodCategory[]
  missing: FoodCategory[]
  snackCount: number
}

export function summarizeDay(meals: Meal[], date: string): DaySummary {
  const ofDay = meals.filter(m => m.date === date)
  const slots = MEAL_SLOTS.map(s => ({
    id: s.id,
    label: s.label,
    meal: ofDay.find(m => m.mealType === s.id) ?? null
  }))
  const allItems = ofDay.flatMap(m => m.items)
  const present = new Set<FoodCategory>(allItems.map(i => i.category))

  return {
    slots,
    recorded: ofDay.filter(m => m.mealType !== 'snack').length,
    planned: MEAL_SLOTS.length,
    completeCount: ofDay.filter(m => m.completeness === 'complete').length,
    partialCount: ofDay.filter(m => m.completeness === 'partial').length,
    unknownCount: MEAL_SLOTS.length - ofDay.filter(m => m.mealType !== 'snack').length,
    coverage: EXPECTED_CATEGORIES.filter(c => present.has(c)),
    missing: EXPECTED_CATEGORIES.filter(c => !present.has(c)),
    snackCount: ofDay.filter(m => m.mealType === 'snack').length
  }
}

export interface FrequentFood {
  /** 目录里的规范名；目录没收录的就用用户当时写的名字 */
  name: string
  category: FoodCategory
  portionSize?: number
  portionUnit: string
  count: number
  lastDate: string
}

/**
 * 常吃：把本机历史条目按目录规范名归并（"苹果（半个）"与"苹果"算同一条），
 * 出现次数多的排前面，份量沿用最近一次那条记录。混合菜不进常吃——它们的类别与热量本就待确认。
 */
export function frequentFoods(meals: Meal[], limit = 8): FrequentFood[] {
  const map = new Map<string, FrequentFood>()
  for (const meal of meals) {
    for (const item of meal.items) {
      const std = findFood(item.foodName)?.name ?? item.foodName.trim()
      if (!std || isMixedFood(std)) continue
      const hit = map.get(std)
      if (hit) {
        hit.count += 1
        if (meal.date > hit.lastDate) {
          hit.lastDate = meal.date
          hit.category = item.category
          hit.portionSize = item.portionSize
          hit.portionUnit = item.portionUnit ?? '份'
        }
      } else {
        map.set(std, {
          name: std,
          category: item.category,
          portionSize: item.portionSize,
          portionUnit: item.portionUnit ?? '份',
          count: 1,
          lastDate: meal.date
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)).slice(0, limit)
}
