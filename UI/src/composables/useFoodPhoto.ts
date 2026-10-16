// 端侧照片识别食物。只使用 COCO 里确实存在的 9 个可食物类，识别不到就不猜。
// 图片只在本机解码推理，不上传、不落盘。
import { ref } from 'vue'
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import type { Category } from '@mediapipe/tasks-vision'
import type { FoodCategory } from '@/types/domain'
import { findFood } from '@/services/foodComposition'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/efficientdet_lite0.tflite'

interface FoodClass {
  zh: string
  category: FoodCategory
}

/** EfficientDet-Lite0 / COCO 中真实存在的可食类，其他一律忽略 */
const COCO_FOOD: Record<string, FoodClass> = {
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

export interface DetectedFood {
  name: string
  category: FoodCategory
  count: number
  confidence: number
}

export type FoodScanStatus = 'idle' | 'loading' | 'done' | 'failed'

let detectorPromise: Promise<ObjectDetector> | null = null

async function ensureDetector(): Promise<ObjectDetector> {
  if (!detectorPromise) {
    detectorPromise = FilesetResolver.forVisionTasks(WASM_PATH).then(vision =>
      ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        scoreThreshold: 0.35,
        maxResults: 16
      })
    )
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

function toCategories(detection: { categories: Category[] }): { name: string; score: number } | null {
  const best = [...detection.categories].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const label = (best?.categoryName ?? '').toLowerCase().trim()
  const food = COCO_FOOD[label]
  return food ? { name: food.zh, score: best?.score ?? 0 } : null
}

export function useFoodPhoto() {
  const status = ref<FoodScanStatus>('idle')
  const errorMessage = ref('')
  const previewUrl = ref('')
  const detected = ref<DetectedFood[]>([])
  const busy = ref(false)

  function reset() {
    detected.value = []
    errorMessage.value = ''
    status.value = 'idle'
    busy.value = false
    if (previewUrl.value) {
      URL.revokeObjectURL(previewUrl.value)
      previewUrl.value = ''
    }
  }

  async function analyze(file: File) {
    reset()
    if (!file.type.startsWith('image/')) {
      status.value = 'failed'
      errorMessage.value = '请选择图片文件。'
      return
    }
    busy.value = true
    status.value = 'loading'
    previewUrl.value = URL.createObjectURL(file)
    try {
      const detector = await ensureDetector()
      const img = new Image()
      img.src = previewUrl.value
      await img.decode()
      const result = detector.detect(img)
      const merged = new Map<string, DetectedFood>()
      for (const detection of result.detections) {
        const hit = toCategories(detection)
        if (!hit) continue
        const existing = merged.get(hit.name)
        const food = findFood(hit.name)
        if (existing) {
          existing.count++
          existing.confidence = Math.max(existing.confidence, hit.score)
        } else {
          merged.set(hit.name, {
            name: hit.name,
            category: food?.category ?? '其他',
            count: 1,
            confidence: hit.score
          })
        }
      }
      detected.value = [...merged.values()].sort((a, b) => b.confidence - a.confidence)
      status.value = 'done'
      if (!detected.value.length) {
        errorMessage.value = '这张照片里没有认出可对照的食物（端侧模型只覆盖 9 类）。请手动填写，或换一张更接近单品照的图。'
      }
    } catch (err) {
      status.value = 'failed'
      errorMessage.value = `识别失败：${(err as Error)?.message || '模型加载未完成'}。可直接手动填写。`
    } finally {
      busy.value = false
    }
  }

  return { status, busy, errorMessage, previewUrl, detected, analyze, reset }
}
