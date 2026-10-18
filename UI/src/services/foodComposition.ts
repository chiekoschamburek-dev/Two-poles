// 食物目录与热量粗估。
// 这些数值是内置的演示参考值：`verified: false` 表示未与《中国食物成分表》等权威资料逐项核对，
// 任何展示都要带上 FOOD_SOURCE_LABEL 与条目口径（basis），并且只显示区间而不是单点。
// 混合菜（MIXED_FOODS）一律不参与营养估算，只按主料给出待确认类别。
import type { FoodCategory } from '@/types/domain'

/** 目录版本随条目变化递增；历史餐次保留记录时使用的版本号 */
export const FOOD_CATALOG_VERSION = 'food-catalog-v2'

export const FOOD_SOURCE_LABEL = '内置演示参考值（未与权威成分表逐项核对）'

/** 单位→克数只是演示假设：单张照片估不出分量，所以区间上再加 ±25% */
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

/** 本机口径的 key 用目录里的规范名，避免"苹果（半个）"和"苹果"各存一份换算 */
export function unitKey(foodName: string, unit: string): string {
  return `${foodName}|${unit}`
}

/**
 * 1 个单位等于几克：优先用户在本机记下的口径，其次退回 UNIT_GRAMS 的演示假设。
 * own=true 表示这个数字来自用户自己填的换算，不是我们的假设；无法换算时返回 null。
 */
export function resolveUnitGrams(
  foodName: string,
  unit: string,
  overrides: Record<string, number> = {}
): { grams: number; own: boolean } | null {
  if (!unit) return null
  const own = overrides[unitKey(foodName, unit)]
  if (typeof own === 'number' && own > 0) return { grams: own, own: true }
  const demo = UNIT_GRAMS[unit]
  return typeof demo === 'number' ? { grams: demo, own: false } : null
}

export interface FoodRef {
  name: string
  category: FoodCategory
  energyKcalPer100g: number
  /** 数值口径，例："熟重"、"带皮可食部" */
  note: string
  /** 该条目是否已与权威成分表逐项核对；当前全部为 false */
  verified: false
}

export const foodTable: FoodRef[] = [
  // ===== 水果类 =====
  { name: '苹果', category: '水果类', energyKcalPer100g: 52, note: '带皮可食部', verified: false },
  { name: '香蕉', category: '水果类', energyKcalPer100g: 89, note: '可食部', verified: false },
  { name: '橙子', category: '水果类', energyKcalPer100g: 47, note: '可食部', verified: false },
  { name: '梨', category: '水果类', energyKcalPer100g: 51, note: '可食部', verified: false },
  { name: '葡萄', category: '水果类', energyKcalPer100g: 45, note: '带籽计可食部', verified: false },
  { name: '蓝莓', category: '水果类', energyKcalPer100g: 57, note: '鲜果', verified: false },
  { name: '猕猴桃', category: '水果类', energyKcalPer100g: 61, note: '可食部', verified: false },
  { name: '西瓜', category: '水果类', energyKcalPer100g: 31, note: '红瓤可食部', verified: false },
  { name: '草莓', category: '水果类', energyKcalPer100g: 32, note: '去蒂', verified: false },
  { name: '桃子', category: '水果类', energyKcalPer100g: 42, note: '可食部', verified: false },

  // ===== 蔬菜类 =====
  { name: '番茄', category: '蔬菜类', energyKcalPer100g: 20, note: '生', verified: false },
  { name: '西兰花', category: '蔬菜类', energyKcalPer100g: 34, note: '生重', verified: false },
  { name: '胡萝卜', category: '蔬菜类', energyKcalPer100g: 39, note: '生', verified: false },
  { name: '菠菜', category: '蔬菜类', energyKcalPer100g: 28, note: '生重', verified: false },
  { name: '生菜', category: '蔬菜类', energyKcalPer100g: 15, note: '叶', verified: false },
  { name: '黄瓜', category: '蔬菜类', energyKcalPer100g: 16, note: '生', verified: false },
  { name: '南瓜', category: '蔬菜类', energyKcalPer100g: 22, note: '蒸', verified: false },
  { name: '茄子', category: '蔬菜类', energyKcalPer100g: 21, note: '生重；过油后数值明显升高', verified: false },
  { name: '青椒', category: '蔬菜类', energyKcalPer100g: 22, note: '生', verified: false },
  { name: '蘑菇', category: '蔬菜类', energyKcalPer100g: 24, note: '鲜品', verified: false },

  // ===== 谷薯类 =====
  { name: '米饭', category: '谷薯类', energyKcalPer100g: 116, note: '熟重', verified: false },
  { name: '粥', category: '谷薯类', energyKcalPer100g: 41, note: '熟重，按白米粥', verified: false },
  { name: '小米粥', category: '谷薯类', energyKcalPer100g: 46, note: '熟重，稠粥偏高', verified: false },
  { name: '燕麦粥', category: '谷薯类', energyKcalPer100g: 41, note: '熟重，牛奶煮会偏高', verified: false },
  { name: '燕麦片', category: '谷薯类', energyKcalPer100g: 377, note: '干重，冲煮后按吸水稀释', verified: false },
  { name: '馒头', category: '谷薯类', energyKcalPer100g: 223, note: '蒸制', verified: false },
  { name: '面包', category: '谷薯类', energyKcalPer100g: 246, note: '按全麦计', verified: false },
  { name: '面条', category: '谷薯类', energyKcalPer100g: 110, note: '煮后', verified: false },
  { name: '红薯', category: '谷薯类', energyKcalPer100g: 86, note: '蒸', verified: false },
  { name: '土豆', category: '谷薯类', energyKcalPer100g: 76, note: '蒸', verified: false },
  { name: '玉米', category: '谷薯类', energyKcalPer100g: 112, note: '甜玉米，煮', verified: false },
  { name: '山药', category: '谷薯类', energyKcalPer100g: 57, note: '蒸；作蔬菜时按同值粗算', verified: false },

  // ===== 蛋类 / 奶类 =====
  { name: '鸡蛋', category: '蛋类', energyKcalPer100g: 144, note: '整蛋，1 个约 50 g', verified: false },
  { name: '牛奶', category: '奶类', energyKcalPer100g: 54, note: '全脂液态奶', verified: false },
  { name: '酸奶', category: '奶类', energyKcalPer100g: 62, note: '无糖；加糖约 90', verified: false },
  { name: '奶酪', category: '奶类', energyKcalPer100g: 328, note: '硬质干酪，按片计偏高', verified: false },

  // ===== 肉类 / 豆类 / 坚果类 =====
  { name: '鸡胸肉', category: '肉类', energyKcalPer100g: 167, note: '熟', verified: false },
  { name: '鸡腿肉', category: '肉类', energyKcalPer100g: 181, note: '带皮熟', verified: false },
  { name: '牛肉', category: '肉类', energyKcalPer100g: 106, note: '瘦，熟', verified: false },
  { name: '猪肉', category: '肉类', energyKcalPer100g: 240, note: '肥瘦相间，波动大', verified: false },
  { name: '鱼', category: '肉类', energyKcalPer100g: 130, note: '按白肉鱼，三文鱼约 139', verified: false },
  { name: '虾仁', category: '肉类', energyKcalPer100g: 93, note: '熟', verified: false },
  { name: '豆腐', category: '豆类', energyKcalPer100g: 81, note: '北豆腐；南豆腐更低', verified: false },
  { name: '豆腐干', category: '豆类', energyKcalPer100g: 140, note: '卤制，按压干水分计', verified: false },
  { name: '豆浆', category: '豆类', energyKcalPer100g: 31, note: '无糖', verified: false },
  { name: '黄豆', category: '豆类', energyKcalPer100g: 390, note: '干豆；泡发后按吸水稀释', verified: false },
  { name: '坚果', category: '坚果类', energyKcalPer100g: 560, note: '混合坚果，热量密度高', verified: false },
  { name: '花生', category: '坚果类', energyKcalPer100g: 567, note: '炒，带皮', verified: false },
  { name: '核桃', category: '坚果类', energyKcalPer100g: 646, note: '干仁', verified: false },

  // ===== 油脂类 =====
  { name: '沙拉油', category: '油脂类', energyKcalPer100g: 899, note: '任何烹调油都近似此值', verified: false },
  { name: '黄油', category: '油脂类', energyKcalPer100g: 888, note: '动物油脂', verified: false },
  { name: '芝麻酱', category: '油脂类', energyKcalPer100g: 630, note: '纯酱；稀释成品更低', verified: false },

  // ===== 端侧识别命中的西式条目（归"其他"，类别由用户确认） =====
  { name: '披萨', category: '谷薯类', energyKcalPer100g: 266, note: '芝士款，波动大', verified: false },
  { name: '热狗', category: '肉类', energyKcalPer100g: 290, note: '含面包，粗算', verified: false },
  { name: '甜甜圈', category: '其他', energyKcalPer100g: 430, note: '油炸加糖', verified: false },
  { name: '蛋糕', category: '其他', energyKcalPer100g: 350, note: '奶油款，波动大', verified: false }
]

/**
 * 混合菜：一份里含多种原料与烹调油，单靠名称无法确定可食部比例。
 * 按文档口径不参与营养估算，类别也只给"待确认"，由用户人工拆分。
 */
export const MIXED_FOODS = [
  '饺子', '包子', '馄饨', '汤圆', '盖饭', '炒饭', '炒面', '汉堡', '三明治',
  '咖喱饭', '卤肉饭', '沙拉', '火锅', '麻辣烫', '米线', '螺蛳粉', '披萨饼',
  '肉夹馍', '煎饼', '馅饼', '团子', '便当'
]

export function isMixedFood(name: string): boolean {
  const key = normalize(name)
  if (!key) return false
  return MIXED_FOODS.some(m => key.includes(m))
}

/** 归一化匹配：去掉括号内容与数量前缀，让"苹果（半个）"也能命中 */
function normalize(name: string): string {
  return name.replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').trim()
}

export function findFood(name: string): FoodRef | undefined {
  const key = normalize(name)
  if (!key) return undefined
  return foodTable.find(f => f.name === key) ?? foodTable.find(f => key.includes(f.name) || f.name.includes(key))
}

/** 目录搜索：按名称或类别子串匹配；关键字为空时返回空列表，不预置一屏候选 */
export function searchFoods(query: string, limit = 8): FoodRef[] {
  const key = normalize(query)
  if (!key) return []
  return foodTable.filter(f => f.name.includes(key) || f.category.includes(key) || key.includes(f.name)).slice(0, limit)
}

/**
 * 类别推断：命中目录用目录类别；混合菜或未命中返回 null（落"其他"并进 unknownItems）。
 * 手输"苹果"不再固定落谷薯类——这是改造前就存在的数据缺陷。
 */
export function inferCategory(name: string): FoodCategory | null {
  if (isMixedFood(name)) return null
  return findFood(name)?.category ?? null
}

export interface EnergyEstimate {
  low: number
  high: number
  grams: number
  foodName: string
  /** 条目口径 + 来源标签，渲染时必须一起显示 */
  basis: string
  source: string
  /** 这次估算用的"1 单位 = 几克" */
  gramsPerUnit: number
  /** true = 用户本机记下的换算；false = UNIT_GRAMS 的演示假设 */
  unitOwn: boolean
  /** 记录时用的单位，'克' 时不存在换算假设 */
  unit: string
}

/**
 * 份量缺失、单位无法换算、食物未收录、混合菜时返回 null —— 宁可不显示，也不编一个数。
 * 出数条目一律带 basis 与 source（`verified: false` 的演示参考值标签），
 * 所以界面必须同屏显示口径与"未与权威成分表核对"，并且只显示区间。
 * `unitGrams` 是本机自定的"1 单位=几克"，没填的仍按演示假设并在 basis 里标明。
 */
export function estimateEnergy(input: {
  foodName: string
  portionSize?: number
  portionUnit?: string
  unitGrams?: Record<string, number>
}): EnergyEstimate | null {
  const food = findFood(input.foodName)
  if (!food) return null
  if (isMixedFood(input.foodName)) return null
  if (!input.portionSize || input.portionSize <= 0) return null
  const unit = input.portionUnit && input.portionUnit in UNIT_GRAMS ? input.portionUnit : null
  if (!unit) return null
  const per = resolveUnitGrams(food.name, unit, input.unitGrams)
  if (!per) return null
  const grams = input.portionSize * per.grams
  const base = (food.energyKcalPer100g * grams) / 100
  const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5)
  return {
    low: round5(base * (1 - ESTIMATE_BAND)),
    high: round5(base * (1 + ESTIMATE_BAND)),
    grams: Math.round(grams),
    foodName: food.name,
    basis: `${food.note || '按常见口径'} · ${food.energyKcalPer100g} kcal/100 g · ${
      unit === '克' ? '按克记录' : `1 ${unit}=${per.grams} g（${per.own ? '本机口径' : '演示假设'}）`
    }`,
    source: FOOD_SOURCE_LABEL,
    gramsPerUnit: per.grams,
    unitOwn: per.own,
    unit
  }
}

export function summarizeEnergy(items: { foodName: string; category: FoodCategory; portionSize?: number; portionUnit?: string }[], unitGrams?: Record<string, number>) {
  const estimates = items.map(i => estimateEnergy({ ...i, unitGrams })).filter((e): e is EnergyEstimate => e !== null)
  if (!estimates.length) return null
  const counted = estimates.length
  return {
    low: estimates.reduce((s, e) => s + e.low, 0),
    high: estimates.reduce((s, e) => s + e.high, 0),
    counted,
    skipped: items.length - counted
  }
}
