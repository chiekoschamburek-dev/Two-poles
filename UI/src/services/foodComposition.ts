// 食物参考值与热量粗估。
// 这些数字是内置的演示用近似值，未与《中国食物成分表》等权威资料逐项核对：
// 任何展示都要带上 FOOD_SOURCE_LABEL，并且只显示区间而不是单点。
import type { FoodCategory } from '@/types/domain'

export const FOOD_SOURCE_LABEL = '内置演示参考值（未与权威成分表核对）'

/** 单张照片估不出分量，所以单位→克数只是演示假设，并在区间上再加 ±25% */
export const UNIT_GRAMS: Record<string, number> = {
  碗: 200,
  盘: 180,
  份: 120,
  个: 100,
  杯: 240,
  片: 30,
  把: 50,
  克: 1
}

export const ESTIMATE_BAND = 0.25

export interface FoodRef {
  name: string
  category: FoodCategory
  energyKcalPer100g: number
  note: string
}

export const foodTable: FoodRef[] = [
  { name: '苹果', category: '水果类', energyKcalPer100g: 52, note: '带皮可食部' },
  { name: '香蕉', category: '水果类', energyKcalPer100g: 89, note: '可食部' },
  { name: '橙子', category: '水果类', energyKcalPer100g: 47, note: '可食部' },
  { name: '梨', category: '水果类', energyKcalPer100g: 51, note: '可食部' },
  { name: '葡萄', category: '水果类', energyKcalPer100g: 45, note: '带籽计可食部' },
  { name: '蓝莓', category: '水果类', energyKcalPer100g: 57, note: '' },
  { name: '番茄', category: '蔬菜类', energyKcalPer100g: 20, note: '' },
  { name: '西兰花', category: '蔬菜类', energyKcalPer100g: 34, note: '生重' },
  { name: '胡萝卜', category: '蔬菜类', energyKcalPer100g: 39, note: '' },
  { name: '菠菜', category: '蔬菜类', energyKcalPer100g: 28, note: '生重' },
  { name: '生菜', category: '蔬菜类', energyKcalPer100g: 15, note: '' },
  { name: '黄瓜', category: '蔬菜类', energyKcalPer100g: 16, note: '' },
  { name: '米饭', category: '谷薯类', energyKcalPer100g: 116, note: '熟重' },
  { name: '粥', category: '谷薯类', energyKcalPer100g: 41, note: '熟重，按白米粥' },
  { name: '燕麦粥', category: '谷薯类', energyKcalPer100g: 41, note: '熟重，牛奶煮会偏高' },
  { name: '馒头', category: '谷薯类', energyKcalPer100g: 223, note: '' },
  { name: '面包', category: '谷薯类', energyKcalPer100g: 246, note: '按全麦计' },
  { name: '面条', category: '谷薯类', energyKcalPer100g: 110, note: '煮后' },
  { name: '红薯', category: '谷薯类', energyKcalPer100g: 86, note: '蒸' },
  { name: '土豆', category: '谷薯类', energyKcalPer100g: 76, note: '蒸' },
  { name: '玉米', category: '谷薯类', energyKcalPer100g: 112, note: '甜玉米，煮' },
  { name: '鸡蛋', category: '蛋类', energyKcalPer100g: 144, note: '整蛋，1 个约 50 g' },
  { name: '牛奶', category: '奶类', energyKcalPer100g: 54, note: '' },
  { name: '酸奶', category: '奶类', energyKcalPer100g: 62, note: '无糖；加糖约 90' },
  { name: '鸡胸肉', category: '肉类', energyKcalPer100g: 167, note: '熟' },
  { name: '牛肉', category: '肉类', energyKcalPer100g: 106, note: '瘦，熟' },
  { name: '猪肉', category: '肉类', energyKcalPer100g: 240, note: '肥瘦相间，波动大' },
  { name: '鱼', category: '肉类', energyKcalPer100g: 130, note: '按白肉鱼，三文鱼约 139' },
  { name: '豆腐', category: '豆类', energyKcalPer100g: 81, note: '北豆腐；南豆腐更低' },
  { name: '豆浆', category: '豆类', energyKcalPer100g: 31, note: '无糖' },
  { name: '坚果', category: '坚果类', energyKcalPer100g: 560, note: '混合坚果，热量密度高' },
  { name: '沙拉油', category: '油脂类', energyKcalPer100g: 899, note: '任何烹调油都近似此值' },
  { name: '披萨', category: '谷薯类', energyKcalPer100g: 266, note: '芝士款，波动大' },
  { name: '热狗', category: '肉类', energyKcalPer100g: 290, note: '含面包，粗算' },
  { name: '甜甜圈', category: '其他', energyKcalPer100g: 430, note: '油炸加糖' },
  { name: '蛋糕', category: '其他', energyKcalPer100g: 350, note: '奶油款，波动大' }
]

/** 归一化匹配：去掉括号内容与数量前缀，让"苹果（半个）"也能命中 */
export function findFood(name: string): FoodRef | undefined {
  const key = name.replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').trim()
  if (!key) return undefined
  return foodTable.find(f => f.name === key) ?? foodTable.find(f => key.includes(f.name) || f.name.includes(key))
}

export interface EnergyEstimate {
  low: number
  high: number
  grams: number
  foodName: string
}

/** 份量缺失或食物未收录时返回 null —— 宁可不显示，也不编一个数 */
export function estimateEnergy(input: {
  foodName: string
  portionSize?: number
  portionUnit?: string
}): EnergyEstimate | null {
  const food = findFood(input.foodName)
  if (!food || !input.portionSize || input.portionSize <= 0) return null
  const unit = input.portionUnit && input.portionUnit in UNIT_GRAMS ? input.portionUnit : null
  if (!unit) return null
  const grams = input.portionSize * UNIT_GRAMS[unit]
  const base = (food.energyKcalPer100g * grams) / 100
  const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5)
  return {
    low: round5(base * (1 - ESTIMATE_BAND)),
    high: round5(base * (1 + ESTIMATE_BAND)),
    grams: Math.round(grams),
    foodName: food.name
  }
}

export function summarizeEnergy(items: { foodName: string; category: FoodCategory; portionSize?: number; portionUnit?: string }[]) {
  const estimates = items.map(i => estimateEnergy(i)).filter((e): e is EnergyEstimate => e !== null)
  if (!estimates.length) return null
  const counted = estimates.length
  return {
    low: estimates.reduce((s, e) => s + e.low, 0),
    high: estimates.reduce((s, e) => s + e.high, 0),
    counted,
    skipped: items.length - counted
  }
}
