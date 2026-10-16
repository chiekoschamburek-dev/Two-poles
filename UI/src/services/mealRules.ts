// 餐食记录的结构规则：只判断"类别是否出现"，不推断摄入量、不评价健康程度。
import type { FoodCategory, Meal, MealAnalysis, MealCompleteness, MealItem } from '@/types/domain'

export const RULE_VERSION = 'diet-rules-v1'

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

export const LIMITATIONS = [
  '只统计类别是否出现过，不判断分量、烹调方式与油盐糖用量。',
  '不给出营养素摄入量数值，也没有热量估算（hasNutritionEstimate = false）。',
  '未记录的餐次一律标为"未记录"，不代表没有吃。',
  `规则版本 ${RULE_VERSION}；规则变更后历史记录不会自动重算。`
]

/**
 * 单餐只判断"这餐出现了哪些类别"；missingCategories 是记完这餐后**当天**仍缺的类别，
 * 需要传入当天已有的类别（早餐不该被要求覆盖水果和奶类）。
 */
export function analyzeMeal(items: MealItem[], dayCategories: FoodCategory[] = []): Omit<MealAnalysis, 'id' | 'createdAt'> {
  const present = new Set<FoodCategory>()
  const unknown: string[] = []

  for (const item of items) {
    if (item.category === '其他') {
      if (!unknown.includes(item.foodName)) unknown.push(item.foodName)
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
    ruleVersion: RULE_VERSION,
    limitations: [...LIMITATIONS]
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
