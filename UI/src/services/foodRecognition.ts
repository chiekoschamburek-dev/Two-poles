// 照片食物识别层：页面只依赖这里的类型与函数。
// 模型识别复用项目现有的 /api/llm/chat 与设置页模型配置；没有可用模型时回落本机 EfficientDet。
// 所有模型输出都必须经过 validateRecognitionObject，缺字段或格式错误时整条结果作废，不补猜。
import type { FoodCategory, ModelEnergyEstimate } from '@/types/domain'
import { FOOD_CATEGORIES, isMixed, suggestCategory } from '@/services/mealRules'
import { UNIT_GRAMS } from '@/services/foodComposition'
import { callLlmChat, extractJson } from '@/services/llm'
import type { LlmConfig } from '@/services/llm'

export type RecognitionProvider = 'cloud' | 'local'

/** 低于这个置信度的条目要在界面上明确标出；不强迫用户逐项确认 */
export const LOW_CONFIDENCE = 0.6

/** 1024 足够认食物，也能控制通过文本代理上传的体积 */
export const MAX_IMAGE_EDGE = 1024
export const MAX_INPUT_BYTES = 12 * 1024 * 1024

export interface RecognizedFood {
  foodName: string
  category: FoodCategory
  portionSize?: number
  portionUnit?: string
  /** 0–1，模型原始置信度 */
  confidence: number
  /** 模型说不确定、置信度低，或类别只能落到"其他" */
  uncertain: boolean
  /** 模型提供的粗略热量区间；没有就是没有，不补数 */
  nutrition?: ModelEnergyEstimate
}

export interface FoodRecognitionResult {
  items: RecognizedFood[]
  provider: RecognitionProvider
  model: string
  warnings: string[]
}

export type RecognitionErrorCode = 'image' | 'network' | 'not_configured' | 'upstream' | 'invalid_output' | 'empty'

export class FoodRecognitionError extends Error {
  code: RecognitionErrorCode
  warnings: string[]

  constructor(message: string, code: RecognitionErrorCode = 'invalid_output', warnings: string[] = []) {
    super(message)
    this.name = 'FoodRecognitionError'
    this.code = code
    this.warnings = warnings
  }
}

const LOCAL_CLASSES: Record<string, { zh: string; category: FoodCategory }> = {
  apple: { zh: '苹果', category: '水果类' },
  banana: { zh: '香蕉', category: '水果类' },
  orange: { zh: '橙子', category: '水果类' },
  broccoli: { zh: '西兰花', category: '蔬菜类' },
  carrot: { zh: '胡萝卜', category: '蔬菜类' },
  pizza: { zh: '披萨', category: '谷薯类' },
  'hot dog': { zh: '热狗', category: '肉类' },
  donut: { zh: '甜甜圈', category: '其他' },
  cake: { zh: '蛋糕', category: '其他' }
}

export const LOCAL_MODEL_LABEL = '本机 EfficientDet-Lite0'
export const LOCAL_CLASS_COUNT = Object.keys(LOCAL_CLASSES).length

/**
 * 把用户选/拍的照片缩到最长边 1280 并转成 JPEG data URL。
 * 只在内存里处理：data URL 用于这次识别和预览，不写入 localStorage。
 */
export async function prepareFoodPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new FoodRecognitionError('请选择图片文件（JPEG / PNG / WebP）。', 'image')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new FoodRecognitionError('这张照片超过 12 MB，请换一张更小的图片。', 'image')
  }
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new FoodRecognitionError('浏览器无法处理这张图片，请换一张再试。', 'image')
    // 透明背景转 JPEG 会变黑，先铺白底
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch (err) {
    if (err instanceof FoodRecognitionError) throw err
    throw new FoodRecognitionError('这张图片无法读取，请换一张 JPEG / PNG / WebP 照片。', 'image')
  } finally {
    bitmap?.close()
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法创建画布')
    ctx.drawImage(bitmap, 0, 0)
    return canvas
  } finally {
    bitmap.close()
  }
}

const FOOD_RECOGNITION_SYSTEM = [
  '你是食物照片识别助手。只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。',
  'JSON 结构：{"items":[{"foodName":"苹果","category":"水果类","portionSize":1,"portionUnit":"个","confidence":0.86,"uncertain":false,"energy":{"low":45,"high":70,"note":"按一个中等大小苹果粗估"}}]}',
  '要求：',
  '1. 只列照片里可见的食物，不编造没出现的食物；照片里没有食物就返回 {"items":[]}。',
  `2. 每项必须给出 foodName、category、confidence（0–1）与 uncertain。category 只能是：${FOOD_CATEGORIES.join('、')}。`,
  `3. 份量只在能合理判断时给出；portionUnit 只能是：${Object.keys(UNIT_GRAMS).join('、')}。看不清就省略这两个字段。`,
  '4. energy 是可选的粗略热量区间（kcal），不确定就省略；不要为看不清的食物编造营养数值。',
  '5. 餐次由客户端按拍摄时间判断，你不要推测早餐/午餐/晚餐。',
  '6. 不给医疗、治疗、减重或竞技营养建议，不评价吃得多不多。'
].join('\n')

/**
 * 通过项目现有的模型代理识别照片：设置页自定义模型优先，否则用服务端默认模型。
 * 模型必须支持 image_url 输入；不支持时会返回上游错误，由页面提示换模型或改本机识别。
 */
export async function recognizeFoodWithModel(dataUrl: string, cfg: LlmConfig): Promise<FoodRecognitionResult> {
  const res = await callLlmChat(cfg, [
    { role: 'system', content: FOOD_RECOGNITION_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: '识别这张照片里的食物，只输出 JSON。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }
  ], { temperature: 0.1 })
  if (res.error) {
    const code: RecognitionErrorCode = res.error.includes('没有配置') || res.error.includes('缺少 base_url')
      ? 'not_configured'
      : res.error.includes('连不上本地代理') ? 'network' : 'upstream'
    throw new FoodRecognitionError(res.error, code)
  }
  if (!res.text.trim()) {
    throw new FoodRecognitionError('模型返回了空内容，没有生成记录。', 'empty')
  }
  const check = validateRecognitionText(res.text)
  if (!check.items.length) {
    throw new FoodRecognitionError(check.error, 'invalid_output', check.warnings)
  }
  return {
    items: check.items,
    provider: 'cloud',
    model: res.model || cfg.model || '模型服务',
    warnings: check.warnings
  }
}

let detectorPromise: Promise<import('@mediapipe/tasks-vision').ObjectDetector> | null = null

async function ensureLocalDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      return ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/mediapipe/models/efficientdet_lite0.tflite', delegate: 'CPU' },
        scoreThreshold: 0.35,
        maxResults: 16
      })
    })()
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

/** 端侧只覆盖 COCO 里真实存在的 9 个可食类；认不出就报空，不猜。 */
export async function recognizeLocally(dataUrl: string): Promise<FoodRecognitionResult> {
  try {
    const detector = await ensureLocalDetector()
    const canvas = await dataUrlToCanvas(dataUrl)
    const result = detector.detect(canvas)
    const merged = new Map<string, RecognizedFood>()
    for (const detection of result.detections) {
      const best = [...detection.categories].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
      const hit = LOCAL_CLASSES[(best?.categoryName ?? '').toLowerCase().trim()]
      if (!hit) continue
      const confidence = Math.max(0, Math.min(1, best?.score ?? 0))
      const existing = merged.get(hit.zh)
      if (existing) {
        existing.confidence = Math.max(existing.confidence, confidence)
        existing.uncertain = existing.uncertain || confidence < LOW_CONFIDENCE
      } else {
        merged.set(hit.zh, {
          foodName: hit.zh,
          category: hit.category,
          confidence,
          uncertain: confidence < LOW_CONFIDENCE || hit.category === '其他'
        })
      }
    }
    const items = [...merged.values()].sort((a, b) => b.confidence - a.confidence)
    if (!items.length) {
      throw new FoodRecognitionError(
        `这张照片里没有认出可对照的食物。本机模型只覆盖 ${LOCAL_CLASS_COUNT} 类常见食物，可以换一张照片或手动补录。`,
        'empty'
      )
    }
    return {
      items,
      provider: 'local',
      model: LOCAL_MODEL_LABEL,
      warnings: ['本机模型只覆盖 9 类常见食物，份量与营养无法从照片得出，留给后续补充。']
    }
  } catch (err) {
    if (err instanceof FoodRecognitionError) throw err
    throw new FoodRecognitionError(
      `本机识别失败：${(err as Error)?.message || '模型加载未完成'}。可以重试或手动补录。`,
      'upstream'
    )
  }
}

export interface RecognitionValidation {
  items: RecognizedFood[]
  warnings: string[]
  error: string
}

/** 模型输出必须先过这一层：名称、类别、置信度、不确定标记都要有，否则不生成记录。 */
export function validateRecognitionText(text: string): RecognitionValidation {
  const raw = extractJson(text)
  if (!raw) {
    return { items: [], warnings: [], error: '识别结果不是可解析的 JSON，没有生成记录。' }
  }
  return validateRecognitionObject(raw)
}

export function validateRecognitionObject(raw: unknown): RecognitionValidation {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { items: [], warnings, error: '识别结果不是 JSON 对象，没有生成记录。' }
  }
  const obj = raw as Record<string, unknown>
  const rawItems = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.foods) ? obj.foods : []
  if (!rawItems.length) {
    return { items: [], warnings, error: '模型没有返回任何食物条目，没有生成记录。' }
  }
  if (rawItems.length > 12) warnings.push('模型返回的条目超过 12 个，只保留前 12 个。')

  const allowedUnits = new Set(Object.keys(UNIT_GRAMS))
  const seen = new Map<string, RecognizedFood>()

  for (const entry of rawItems.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') {
      warnings.push('忽略了一条格式不正确的项目。')
      continue
    }
    const row = entry as Record<string, unknown>
    const nameRaw = typeof row.foodName === 'string' ? row.foodName : typeof row.name === 'string' ? row.name : ''
    const name = nameRaw.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!name) {
      warnings.push('忽略了一条没有食物名称的项目。')
      continue
    }

    // 置信度是必填项：缺失时不能用一个编造的数字补上
    const confidenceRaw = typeof row.confidence === 'number' ? row.confidence : Number(row.confidence)
    let confidence = confidenceRaw
    if (Number.isFinite(confidence) && confidence > 1 && confidence <= 100) confidence = confidence / 100
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      warnings.push(`「${name}」缺少有效的置信度，已忽略。`)
      continue
    }

    const categoryRaw = typeof row.category === 'string' ? row.category.trim() : ''
    let category: FoodCategory | null = FOOD_CATEGORIES.includes(categoryRaw as FoodCategory)
      ? categoryRaw as FoodCategory
      : null
    if (!category) {
      category = suggestCategory(name)
      if (category) warnings.push(`「${name}」的类别按本机目录推断为${category}。`)
    }
    if (!category) {
      category = '其他'
      warnings.push(`「${name}」的类别无法确认，标为"其他"。`)
    }

    let portionSize: number | undefined
    let portionUnit: string | undefined
    const portion = row.portion && typeof row.portion === 'object' ? row.portion as Record<string, unknown> : null
    const sizeRaw = typeof row.portionSize === 'number' ? row.portionSize : portion?.size
    const unitRaw = typeof row.portionUnit === 'string' ? row.portionUnit : portion?.unit
    const size = typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw)
    const unit = typeof unitRaw === 'string' ? unitRaw.trim() : ''
    if (sizeRaw !== undefined || unitRaw !== undefined) {
      if (Number.isFinite(size) && size > 0 && size <= 5000 && allowedUnits.has(unit)) {
        portionSize = Math.round(size * 10) / 10
        portionUnit = unit
      } else {
        warnings.push(`「${name}」的份量格式不可用，已留空。`)
      }
    }

    let nutrition: ModelEnergyEstimate | undefined
    const energyRaw = row.energy ?? (row.nutrition && typeof row.nutrition === 'object'
      ? (row.nutrition as Record<string, unknown>).energyKcal ?? (row.nutrition as Record<string, unknown>).energy
      : row.energyKcal)
    if (energyRaw && typeof energyRaw === 'object' && !Array.isArray(energyRaw)) {
      const e = energyRaw as Record<string, unknown>
      const low = Number(e.low)
      const high = Number(e.high)
      if (Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low && high <= 5000) {
        nutrition = {
          low: Math.round(low),
          high: Math.round(high),
          note: typeof e.note === 'string' && e.note.trim() ? e.note.trim().slice(0, 80) : '识别模型粗估，未与成分表核对'
        }
      } else {
        warnings.push(`「${name}」的营养估计不是有效区间，已忽略。`)
      }
    }

    const uncertain = row.uncertain === true || confidence < LOW_CONFIDENCE || category === '其他' || isMixed(name)
    const item: RecognizedFood = { foodName: name, category, confidence, uncertain }
    if (portionSize !== undefined) {
      item.portionSize = portionSize
      item.portionUnit = portionUnit
    }
    if (nutrition) item.nutrition = nutrition

    const key = name.toLowerCase()
    const existing = seen.get(key)
    if (existing) {
      warnings.push(`同名条目「${name}」出现多次，只保留置信度更高的一条。`)
      if (confidence > existing.confidence) seen.set(key, item)
    } else {
      seen.set(key, item)
    }
  }

  const items = [...seen.values()]
  if (!items.length) {
    return { items, warnings, error: '模型返回的条目都缺少必要字段，没有生成记录。' }
  }
  return { items, warnings, error: '' }
}
