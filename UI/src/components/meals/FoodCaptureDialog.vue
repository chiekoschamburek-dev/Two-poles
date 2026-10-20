<template>
  <Teleport to="body">
    <div v-if="open" class="scrim" @click.self="requestClose">
      <div ref="dlgEl" class="dlg" role="dialog" aria-modal="true" aria-labelledby="food-log-title" tabindex="-1">
        <header class="dlg-head">
          <div>
            <span class="micro">{{ eyebrow }}</span>
            <h2 id="food-log-title">{{ heading }}</h2>
          </div>
          <button class="x" type="button" aria-label="关闭" @click="requestClose">✕</button>
        </header>

        <div class="dlg-body">
          <!-- 拍照 / 选图 -->
          <template v-if="view === 'capture'">
            <div class="privacy" :class="{ upload: mode === 'cloud' }">
              <ShieldCheck :size="18" />
              <div>
                <strong>{{ mode === 'cloud' ? '这张照片会发送到模型服务' : '照片只在本机识别' }}</strong>
                <p v-if="mode === 'cloud'">
                  识别服务：{{ cloudModelLabel }}。照片仅用于这一次识别；本应用不保存原图，保存记录时只保留识别结果。
                </p>
                <p v-else>
                  照片只在浏览器里解码，不上传、不保存。本机模型只覆盖 {{ LOCAL_CLASS_COUNT }} 类常见食物，认不出时可手动补录。
                </p>
              </div>
            </div>

            <div v-if="statusLoading" class="state checking">
              <span class="spin" aria-hidden="true"></span>
              <p>正在检查模型配置…</p>
            </div>

            <template v-else>
              <div v-if="cloudAvailable" class="mode-tabs" role="group" aria-label="选择识别方式">
                <button type="button" :class="{ on: mode === 'cloud' }" :aria-pressed="mode === 'cloud'" @click="setMode('cloud')">
                  模型识别
                </button>
                <button type="button" :class="{ on: mode === 'local' }" :aria-pressed="mode === 'local'" @click="setMode('local')">
                  仅本机识别
                </button>
              </div>

              <label v-if="mode === 'cloud'" class="consent">
                <input v-model="consent" type="checkbox" />
                <span>我了解这张照片会发送到上述识别服务，且本应用不会保存原图</span>
              </label>

              <div v-if="cameraActive" class="camera">
                <video ref="videoEl" autoplay playsinline muted aria-label="相机预览"></video>
                <div class="camera-actions">
                  <BaseButton :icon="Camera" @click="captureFrame">拍摄</BaseButton>
                  <BaseButton variant="secondary" @click="stopCamera">关闭相机</BaseButton>
                </div>
              </div>

              <div v-else class="capture-actions">
                <BaseButton size="lg" :icon="Camera" :disabled="blocked" @click="startCamera">拍照</BaseButton>
                <BaseButton variant="secondary" size="lg" :icon="Image" :disabled="blocked" @click="pickFile">选择图片</BaseButton>
              </div>

              <p v-if="mode === 'cloud' && !consent" class="fine center">勾选上面的说明后才能拍照或选图。</p>

              <p v-if="cameraError" class="alert" role="alert">
                {{ cameraError }}
                <span>可以改为「选择图片」或「手动补录」。</span>
              </p>

              <div class="fallback-row">
                <button type="button" class="text-btn" @click="startManual">手动补录</button>
                <span>相机不可用、权限被拒或不想拍照时使用；只需填食物名称。</span>
              </div>
            </template>

            <input ref="fileEl" type="file" accept="image/*" class="file-input" @change="onFile" />
          </template>

          <!-- 处理中 -->
          <div v-else-if="view === 'analyzing'" class="state processing" aria-live="polite">
            <img v-if="prepared" :src="prepared" alt="正在识别的食物照片" class="processing-img" />
            <span class="spin" aria-hidden="true"></span>
            <p>{{ mode === 'cloud' ? '正在请求模型识别食物…' : '正在本机识别食物…' }}</p>
            <small v-if="mode === 'cloud'">照片只用于这一次识别，不保存；通常几秒到半分钟。</small>
            <small v-else>首次需要加载约 6.9 MB 模型；照片不会上传。</small>
          </div>

          <!-- 失败 -->
          <div v-else-if="view === 'error'" class="state err" role="alert">
            <p>{{ analysisError }}</p>
            <ul v-if="warnings.length" class="warns">
              <li v-for="w in warnings" :key="w">{{ w }}</li>
            </ul>
            <div class="err-actions">
              <BaseButton v-if="prepared" size="sm" :icon="RotateCcw" @click="retry">重试识别</BaseButton>
              <BaseButton v-if="mode === 'cloud' && prepared" variant="secondary" size="sm" @click="useLocal">改用本机识别</BaseButton>
              <BaseButton variant="secondary" size="sm" @click="backToCapture">换一张</BaseButton>
              <BaseButton variant="ghost" size="sm" :icon="PenLine" @click="startManual">手动补录</BaseButton>
            </div>
            <small>失败时不会生成记录，也不会用猜测补齐。</small>
            <small v-if="mode === 'cloud'">如果设置页的模型不支持图片输入，请换一个支持图片的模型，或改用本机识别/手动补录。</small>
          </div>

          <!-- 结果 / 手动补录 -->
          <template v-else>
            <div class="result-top">
              <img v-if="!isManual && prepared" :src="prepared" alt="本次识别的照片（不保存）" class="thumb" />
              <div class="result-meta">
                <div class="type-row">
                  <span class="type-badge">{{ MEAL_TYPE_LABELS[mealType] }}</span>
                  <span class="type-note">{{ isManual ? '手动补录' : `按拍摄时间 ${mealTime} 自动判断` }}</span>
                  <button type="button" class="text-btn" @click="typeEditing = !typeEditing">
                    {{ typeEditing ? '收起' : '修改餐次' }}
                  </button>
                </div>
                <div v-if="typeEditing" class="type-pick" role="group" aria-label="修改餐次">
                  <button
                    v-for="opt in MEAL_TYPE_OPTIONS"
                    :key="opt.id"
                    type="button"
                    :class="{ on: mealType === opt.id }"
                    :aria-pressed="mealType === opt.id"
                    @click="mealType = opt.id"
                  >{{ opt.label }}</button>
                </div>
                <p class="fine">
                  {{ isManual
                    ? '只填名称也能保存；份量留空时标为部分记录，系统不会替你觉得克数。'
                    : `识别来源：${recognizedModel}。结果可能认错或漏认，低置信度项已标出；默认保存即可，想改再展开。` }}
                </p>
              </div>
            </div>

            <ul v-if="warnings.length" class="warns">
              <li v-for="w in warnings" :key="w">{{ w }}</li>
            </ul>

            <div class="items-head">
              <span>{{ isManual ? '食物' : '识别结果' }} · {{ filledItems.length }} 项</span>
              <button type="button" class="text-btn" @click="editorOpen = !editorOpen">
                {{ editorOpen ? '收起修改' : '修改' }}
              </button>
            </div>

            <ul v-if="!editorOpen" class="result-items">
              <li v-for="(item, index) in filledItems" :key="index" :class="{ unsure: item.uncertain }">
                <span class="nm">{{ item.foodName }}</span>
                <span class="cat">{{ item.category }}</span>
                <span class="portion">{{ portionText(item) }}</span>
                <span v-if="item.source === 'photo' && item.confidence !== undefined" class="conf" :class="{ low: isLow(item) }">
                  {{ confidencePct(item) }}%
                </span>
                <span v-if="item.uncertain" class="flag">待确认</span>
                <span v-if="showEnergyEstimate && item.nutrition" class="energy">
                  模型粗估 {{ item.nutrition.low }}–{{ item.nutrition.high }} kcal
                </span>
              </li>
            </ul>

            <div v-else class="editor">
              <div v-for="(item, index) in items" :key="index" class="edit-row">
                <input
                  v-model="item.foodName"
                  type="text"
                  class="e-name"
                  :placeholder="index === 0 ? '例如：燕麦粥' : '食物名称'"
                  :aria-label="`第 ${index + 1} 项食物名称`"
                  @input="onName(item)"
                />
                <select v-model="item.category" class="e-cat" :aria-label="`第 ${index + 1} 项类别`" @change="onCategory(item)">
                  <option v-for="c in FOOD_CATEGORIES" :key="c" :value="c">{{ c }}</option>
                </select>
                <input
                  v-model.number="item.portionSize"
                  type="number"
                  min="0"
                  step="any"
                  class="e-size"
                  placeholder="份量"
                  :aria-label="`第 ${index + 1} 项份量`"
                  @input="dropNutrition(item)"
                />
                <select v-model="item.portionUnit" class="e-unit" :aria-label="`第 ${index + 1} 项单位`">
                  <option v-for="u in UNIT_OPTIONS" :key="u" :value="u">{{ u }}</option>
                </select>
                <button
                  type="button"
                  class="e-del"
                  :disabled="items.length === 1"
                  :aria-label="`删除第 ${index + 1} 项`"
                  @click="removeRow(index)"
                ><X :size="15" /></button>
                <span v-if="item.source === 'photo' && item.confidence !== undefined" class="e-meta">
                  模型置信度 {{ confidencePct(item) }}%{{ item.uncertain ? ' · 待确认' : '' }}
                </span>
              </div>
              <button type="button" class="add-row" @click="addRow"><Plus :size="15" /> 再加一项</button>
            </div>

            <div class="summary">
              <p v-if="filledItems.length">
                <strong>本餐类别</strong>
                <span>{{ categoriesText }}</span>
              </p>
              <p v-if="uncertainNames.length">
                <strong>待确认</strong>
                <span>{{ uncertainNames.join('、') }}</span>
              </p>
              <p v-if="noPortionCount">
                <strong>份量</strong>
                <span>{{ noPortionCount }} 项没有估份量，保存后记为「部分记录」</span>
              </p>
              <p v-if="missingToday.length">
                <strong>今天仍缺</strong>
                <span>{{ missingToday.join('、') }}</span>
              </p>
              <p v-if="showEnergyEstimate && modelEnergyTotal">
                <strong>模型粗估</strong>
                <span>{{ modelEnergyTotal }}（未与权威成分表核对，仅作区间参考）</span>
              </p>
              <p v-else-if="!showEnergyEstimate && !isManual && hasAnyNutrition" class="summary-note">
                热量粗估默认关闭；开启后才会显示模型提供的营养区间，统计口径不变。
              </p>
            </div>

            <p v-if="formError" class="error" role="alert">{{ formError }}</p>
            <p class="fine">
              保存后本应用只保留识别结果，不保存原图；记录会出现在今天的列表里，刷新后仍在。
            </p>
          </template>
        </div>

        <footer v-if="view === 'result' || view === 'manual'" class="dlg-foot">
          <BaseButton v-if="!isManual" variant="ghost" @click="backToCapture">重新拍</BaseButton>
          <span class="spacer"></span>
          <BaseButton variant="secondary" @click="requestClose">取消</BaseButton>
          <BaseButton :icon="Check" :disabled="!filledItems.length" @click="save">保存记录</BaseButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Camera, Check, Image, PenLine, Plus, RotateCcw, ShieldCheck, X } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
import type { FoodCategory, Meal, MealType, ModelEnergyEstimate } from '@/types/domain'
import {
  FOOD_CATEGORIES,
  MEAL_TYPE_LABELS,
  MEAL_TYPE_OPTIONS,
  inferMealType,
  isMixed,
  suggestCategory
} from '@/services/mealRules'
import { UNIT_GRAMS } from '@/services/foodComposition'
import {
  FoodRecognitionError,
  LOCAL_CLASS_COUNT,
  LOCAL_MODEL_LABEL,
  LOW_CONFIDENCE,
  prepareFoodPhoto,
  recognizeFoodWithModel,
  recognizeLocally
} from '@/services/foodRecognition'
import type { FoodRecognitionResult, RecognizedFood } from '@/services/foodRecognition'
import { canUseLlm, usingDefault } from '@/services/llm'

type View = 'capture' | 'analyzing' | 'result' | 'error' | 'manual'

interface EditableItem {
  foodName: string
  category: FoodCategory
  portionSize: number | ''
  portionUnit: string
  source: 'photo' | 'manual'
  confidence?: number
  uncertain: boolean
  nutrition?: ModelEnergyEstimate
  catAuto: boolean
}

const props = defineProps<{
  open: boolean
  /** 页面当前展示的日期；保存时写进同一天，保证马上出现在今日列表 */
  date: string
  initialView: 'capture' | 'manual'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', meal: Meal): void
}>()

const store = useAppStore()
const UNIT_OPTIONS = Object.keys(UNIT_GRAMS)

const view = ref<View>('capture')
const statusLoading = ref(false)
const mode = ref<'cloud' | 'local'>('local')
const consent = ref(false)
const cameraActive = ref(false)
const cameraError = ref('')
const analysisError = ref('')
const warnings = ref<string[]>([])
const prepared = ref('')
const items = ref<EditableItem[]>([])
const mealType = ref<MealType>('snack')
const mealTime = ref('')
const typeEditing = ref(false)
const editorOpen = ref(false)
const formError = ref('')
const recognized = ref<FoodRecognitionResult | null>(null)
const isManual = computed(() => view.value === 'manual')

const videoEl = ref<HTMLVideoElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const dlgEl = ref<HTMLElement | null>(null)
let stream: MediaStream | null = null
let runId = 0
let previousOverflow = ''

const cloudAvailable = computed(() => canUseLlm(store.llmConfig, store.llmDefault))
const cloudModelLabel = computed(() => {
  if (usingDefault(store.llmConfig)) {
    return store.llmDefault.model ? `${store.llmDefault.model}（服务端默认）` : '服务端默认模型'
  }
  const name = store.llmConfig.model || '设置页模型'
  let host = ''
  try { host = new URL(store.llmConfig.baseUrl).host } catch { /* 没填完整时只显示模型名 */ }
  return host ? `${name}（${host}）` : name
})
const blocked = computed(() => mode.value === 'cloud' && !consent.value)
const showEnergyEstimate = computed(() => store.privacy.showEnergyEstimate)
const recognizedModel = computed(() => {
  if (!recognized.value) return ''
  return recognized.value.provider === 'cloud'
    ? `模型识别 · ${recognized.value.model}`
    : LOCAL_MODEL_LABEL
})

const heading = computed(() => {
  if (view.value === 'capture') return '记录饮食'
  if (view.value === 'analyzing') return '正在识别'
  if (view.value === 'error') return '这次没有识别成功'
  if (view.value === 'manual') return '手动补录'
  return '确认这一餐'
})
const eyebrow = computed(() => {
  if (view.value === 'manual') return 'MANUAL LOG'
  if (view.value === 'error') return 'RECOGNITION FAILED'
  return 'PHOTO LOG'
})

const filledItems = computed(() => items.value.filter(i => i.foodName.trim()))
const categories = computed(() => {
  const present = new Set(filledItems.value.map(i => i.category))
  return FOOD_CATEGORIES.filter(c => present.has(c))
})
const categoriesText = computed(() => categories.value.join('、') || '未识别')
const uncertainNames = computed(() => filledItems.value
  .filter(i => i.uncertain || i.category === '其他' || isMixed(i.foodName))
  .map(i => i.foodName.trim()))
const noPortionCount = computed(() => filledItems.value.filter(i => i.portionSize === '').length)
const hasAnyNutrition = computed(() => filledItems.value.some(i => !!i.nutrition))
const modelEnergyTotal = computed(() => {
  const list = filledItems.value.map(i => i.nutrition).filter((n): n is ModelEnergyEstimate => !!n)
  if (!list.length) return ''
  const low = list.reduce((s, n) => s + n.low, 0)
  const high = list.reduce((s, n) => s + n.high, 0)
  return `${low}–${high} kcal`
})
const missingToday = computed(() => {
  if (!filledItems.value.length) return []
  const dayCategories = new Set(
    store.meals
      .filter(m => m.date === props.date)
      .flatMap(m => m.items.map(i => i.category))
  )
  for (const c of categories.value) dayCategories.add(c)
  return FOOD_CATEGORIES.slice(0, 8).filter(c => !dayCategories.has(c))
})

watch(() => props.open, (open) => {
  if (open) {
    reset()
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
  } else {
    cleanup()
  }
})

onBeforeUnmount(cleanup)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') requestClose()
}

function cleanup() {
  runId++
  stopCamera()
  // 关闭即释放这次识别的照片与结果，不在内存里继续留着
  prepared.value = ''
  items.value = []
  recognized.value = null
  warnings.value = []
  window.removeEventListener('keydown', onKeydown)
  if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow
}

function reset() {
  cleanup()
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  view.value = props.initialView === 'manual' ? 'manual' : 'capture'
  statusLoading.value = false
  mode.value = 'local'
  consent.value = false
  cameraError.value = ''
  analysisError.value = ''
  warnings.value = []
  prepared.value = ''
  items.value = []
  typeEditing.value = false
  editorOpen.value = false
  formError.value = ''
  recognized.value = null
  const at = new Date()
  mealTime.value = clockTime(at)
  mealType.value = inferMealType(at)
  if (props.initialView === 'manual') {
    editorOpen.value = true
    items.value = [blankItem()]
  } else {
    void loadStatus()
  }
  nextTick(() => dlgEl.value?.focus())
}

async function loadStatus() {
  statusLoading.value = true
  if (usingDefault(store.llmConfig) && !store.llmDefault.available) {
    await store.refreshLlmStatus()
  }
  if (!props.open) return
  mode.value = canUseLlm(store.llmConfig, store.llmDefault) ? 'cloud' : 'local'
  statusLoading.value = false
}

function setMode(next: 'cloud' | 'local') {
  if (next === 'cloud' && !cloudAvailable.value) return
  stopCamera()
  cameraError.value = ''
  mode.value = next
}

function startManual() {
  stopCamera()
  view.value = 'manual'
  editorOpen.value = true
  typeEditing.value = false
  warnings.value = []
  analysisError.value = ''
  formError.value = ''
  prepared.value = ''
  recognized.value = null
  const at = new Date()
  mealTime.value = clockTime(at)
  mealType.value = inferMealType(at)
  if (!items.value.length) items.value = [blankItem()]
}

function blankItem(): EditableItem {
  return {
    foodName: '',
    category: '其他',
    portionSize: '',
    portionUnit: '份',
    source: 'manual',
    uncertain: false,
    catAuto: true
  }
}

function onName(item: EditableItem) {
  // 用户改了名称，模型给的营养与置信度就不再对应当前这一项
  if (item.source === 'photo') {
    item.nutrition = undefined
    item.confidence = undefined
    item.uncertain = false
  }
  if (!item.catAuto) return
  item.category = suggestCategory(item.foodName) ?? '其他'
}

function onCategory(item: EditableItem) {
  item.catAuto = false
  if (item.category !== '其他') item.uncertain = false
}

function dropNutrition(item: EditableItem) {
  item.nutrition = undefined
}

function addRow() {
  items.value.push(blankItem())
}

function removeRow(index: number) {
  if (items.value.length > 1) items.value.splice(index, 1)
}

function itemFromRecognized(food: RecognizedFood): EditableItem {
  return {
    foodName: food.foodName,
    category: food.category,
    portionSize: food.portionSize ?? '',
    portionUnit: food.portionUnit ?? '份',
    source: 'photo',
    confidence: food.confidence,
    uncertain: food.uncertain,
    nutrition: food.nutrition,
    catAuto: false
  }
}

function isLow(item: EditableItem): boolean {
  return (item.confidence ?? 1) < LOW_CONFIDENCE
}

function confidencePct(item: EditableItem): number {
  return Math.round((item.confidence ?? 0) * 100)
}

function portionText(item: EditableItem): string {
  return item.portionSize === '' ? '份量未估' : `${item.portionSize}${item.portionUnit}`
}

function clockTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function pickFile() {
  if (blocked.value) return
  fileEl.value?.click()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const session = runId
  try {
    const dataUrl = await prepareFoodPhoto(file)
    if (!props.open || session !== runId) return
    await analyze(dataUrl)
  } catch (err) {
    if (!props.open || session !== runId) return
    fail(err)
  }
}

async function startCamera() {
  if (blocked.value) return
  cameraError.value = ''
  analysisError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = '这个浏览器或页面环境不支持直接调用相机（需要 HTTPS 或 localhost）。'
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false
    })
    if (!props.open) {
      stopCamera()
      return
    }
    cameraActive.value = true
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
    }
  } catch (err) {
    stopCamera()
    const name = (err as DOMException)?.name || ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      cameraError.value = '相机权限被拒绝，无法拍照。'
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      cameraError.value = '没有找到可用的相机。'
    } else if (name === 'NotReadableError') {
      cameraError.value = '相机被其他应用占用，暂时打不开。'
    } else {
      cameraError.value = `无法打开相机${name ? `（${name}）` : ''}。`
    }
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  cameraActive.value = false
  if (videoEl.value) videoEl.value.srcObject = null
}

function captureFrame() {
  const video = videoEl.value
  if (!video || !video.videoWidth || !video.videoHeight) {
    cameraError.value = '相机画面还没准备好，请稍等一秒再拍。'
    return
  }
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    cameraError.value = '浏览器无法生成这张照片，请改用「选择图片」。'
    return
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  stopCamera()
  void analyze(dataUrl)
}

async function analyze(dataUrl: string) {
  prepared.value = dataUrl
  analysisError.value = ''
  warnings.value = []
  formError.value = ''
  recognized.value = null
  const at = new Date()
  mealTime.value = clockTime(at)
  mealType.value = inferMealType(at)
  typeEditing.value = false
  editorOpen.value = false
  view.value = 'analyzing'
  const id = ++runId
  try {
    const result = mode.value === 'cloud'
      ? await recognizeFoodWithModel(dataUrl, store.llmConfig)
      : await recognizeLocally(dataUrl)
    if (id !== runId) return
    recognized.value = result
    items.value = result.items.map(itemFromRecognized)
    warnings.value = result.warnings
    view.value = 'result'
  } catch (err) {
    if (id !== runId) return
    fail(err)
  }
}

function fail(err: unknown) {
  if (err instanceof FoodRecognitionError) {
    analysisError.value = err.message
    warnings.value = err.warnings
  } else {
    analysisError.value = `识别失败：${(err as Error)?.message || '未知错误'}`
    warnings.value = []
  }
  view.value = 'error'
}

function retry() {
  if (!prepared.value) return
  void analyze(prepared.value)
}

function useLocal() {
  mode.value = 'local'
  if (!prepared.value) {
    backToCapture()
    return
  }
  void analyze(prepared.value)
}

function backToCapture() {
  stopCamera()
  runId++
  view.value = 'capture'
  cameraError.value = ''
  analysisError.value = ''
  warnings.value = []
  prepared.value = ''
  recognized.value = null
  items.value = []
  formError.value = ''
  typeEditing.value = false
  editorOpen.value = false
  if (!cloudAvailable.value) mode.value = 'local'
}

function requestClose() {
  stopCamera()
  runId++
  emit('close')
}

function save() {
  formError.value = ''
  const list = filledItems.value
  if (!list.length) {
    formError.value = '至少保留一项食物名称，才能保存记录。'
    return
  }
  const normalized = list.map(i => {
    const size = i.portionSize === '' ? undefined : Number(i.portionSize)
    const validSize = size !== undefined && Number.isFinite(size) && size > 0 ? size : undefined
    return {
      foodName: i.foodName.trim(),
      category: i.category,
      portionSize: validSize,
      portionUnit: validSize !== undefined ? i.portionUnit : undefined,
      source: i.source,
      photoConfidence: i.confidence,
      uncertain: i.uncertain,
      modelEnergy: i.nutrition
    }
  })
  const meal = store.addMeal({
    date: props.date,
    mealType: mealType.value,
    time: mealTime.value,
    items: normalized
  })
  emit('saved', meal)
  emit('close')
}
</script>

<style scoped>
.scrim{position:fixed;inset:0;z-index:var(--z-modal-backdrop);background:rgba(17,22,26,.46);backdrop-filter:blur(3px);display:grid;place-items:center;padding:24px}
.dlg{width:min(740px,100%);max-height:min(88vh,940px);display:flex;flex-direction:column;background:var(--color-card);border-radius:var(--radius-xl);border:1px solid var(--color-border);box-shadow:0 30px 80px -40px rgba(11,16,20,.65);overflow:hidden;outline:none}
.dlg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 14px;border-bottom:1px solid var(--color-divider)}
.dlg-head h2{font-size:19px;margin:6px 0 0;letter-spacing:-.01em}
.x{width:32px;height:32px;border-radius:9px;color:var(--color-text-muted);font-size:14px;flex:none}
.x:hover{background:var(--color-neutral-soft);color:var(--color-ink)}
.dlg-body{overflow-y:auto;padding:18px 22px;flex:1;min-height:0;display:grid;gap:14px;align-content:start}
.privacy{display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border-radius:var(--radius-md);background:var(--color-accent-soft);color:var(--color-ink);box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.privacy.upload{background:var(--color-caution-soft);box-shadow:inset 0 0 0 1px rgba(138,90,0,.25);color:var(--color-ink)}
.privacy>svg{flex:none;margin-top:2px;color:var(--color-accent)}
.privacy.upload>svg{color:var(--color-caution)}
.privacy strong{display:block;font-size:13px}
.privacy p{margin:4px 0 0;font-size:11.5px;line-height:1.7;color:var(--color-text-secondary)}
.mode-tabs{display:inline-flex;align-self:start;padding:3px;border-radius:10px;background:var(--color-neutral-soft);box-shadow:inset 0 0 0 1px var(--color-border)}
.mode-tabs button{padding:7px 13px;border-radius:8px;font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.mode-tabs button.on{background:var(--color-card);color:var(--color-ink);box-shadow:0 1px 4px rgba(21,24,27,.12),inset 0 0 0 1px var(--color-border)}
.consent{display:flex;align-items:flex-start;gap:9px;font-size:12px;line-height:1.6;color:var(--color-text-secondary);padding:10px 12px;border-radius:var(--radius-sm);background:var(--color-neutral-soft)}
.consent input{margin-top:2px;width:15px;height:15px;accent-color:var(--color-accent);flex:none}
.capture-actions{display:flex;gap:10px;flex-wrap:wrap}
.capture-actions :deep(button){flex:1;min-width:160px}
.camera{display:grid;gap:10px}
.camera video{width:100%;max-height:46vh;border-radius:14px;background:#0d1114;object-fit:cover}
.camera-actions{display:flex;gap:10px;flex-wrap:wrap}
.camera-actions :deep(button){flex:1}
.state{display:grid;gap:8px;justify-items:center;text-align:center;padding:30px 16px}
.state p{margin:0;font-size:14px;color:var(--color-ink)}
.state small{font-size:11.5px;line-height:1.7;color:var(--color-text-muted);display:block;max-width:440px}
.state.checking{padding:18px}
.processing-img{width:132px;height:132px;object-fit:cover;border-radius:14px;margin-bottom:4px;box-shadow:0 8px 24px -14px rgba(21,24,27,.5)}
.spin{display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid var(--color-accent-soft);border-top-color:var(--color-accent);animation:spin 900ms linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.alert{margin:0;padding:10px 12px;border-radius:var(--radius-sm);background:var(--color-caution-soft);color:var(--color-caution);font-size:12px;line-height:1.7}
.alert span{display:block;color:var(--color-text-secondary);margin-top:2px}
.fallback-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:2px}
.fallback-row span{font-size:11.5px;color:var(--color-text-muted);line-height:1.6}
.text-btn{font-family:inherit;font-size:12px;font-weight:600;color:var(--color-accent);padding:3px 2px;border-radius:5px;white-space:nowrap}
.text-btn:hover{text-decoration:underline}
.fine{font-size:11.5px;color:var(--color-text-muted);line-height:1.7;margin:0}
.fine.center{text-align:center}
.file-input{display:none}
.err{color:var(--color-danger)}
.err p{color:var(--color-danger);font-weight:600}
.warns{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.warns li{font-size:11.5px;line-height:1.65;color:var(--color-caution);padding-left:14px;position:relative}
.warns li::before{content:'·';position:absolute;left:2px;top:-1px;font-weight:700}
.err-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.err-actions :deep(button){width:auto}
.result-top{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.thumb{width:116px;height:116px;object-fit:cover;border-radius:13px;flex:none;background:var(--color-divider);box-shadow:inset 0 0 0 1px rgba(21,24,27,.06)}
.result-meta{flex:1;min-width:210px;display:grid;gap:8px}
.type-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.type-badge{display:inline-flex;align-items:center;height:28px;padding:0 11px;border-radius:999px;background:var(--color-accent-soft);color:var(--color-accent);font-size:12.5px;font-weight:700;box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.type-note{font-size:11.5px;color:var(--color-text-muted)}
.type-pick{display:flex;gap:6px;flex-wrap:wrap}
.type-pick button{padding:6px 11px;border-radius:999px;font-size:11.5px;font-weight:600;color:var(--color-text-secondary);background:var(--color-card);box-shadow:inset 0 0 0 1px var(--color-border)}
.type-pick button.on{color:var(--color-accent);background:var(--color-accent-soft);box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.items-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:7px;border-bottom:1px solid var(--color-border)}
.items-head span{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted)}
.result-items{list-style:none;margin:0;padding:0;display:grid}
.result-items li{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:10px 0;border-bottom:1px dashed var(--color-divider);font-size:13px}
.result-items li:last-child{border-bottom:0}
.result-items li.unsure{background:linear-gradient(90deg,var(--color-caution-soft),transparent 72%);margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:7px}
.nm{font-weight:600;color:var(--color-ink);overflow-wrap:anywhere}
.cat{font-size:11px;color:var(--color-text-muted);white-space:nowrap}
.portion{font-family:var(--font-num);font-size:11.5px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.conf{font-family:var(--font-num);font-size:10.5px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);padding:2px 7px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap}
.conf.low{color:var(--color-caution);background:var(--color-caution-soft);box-shadow:inset 0 0 0 1px rgba(138,90,0,.18)}
.flag{font-size:10.5px;font-weight:600;color:var(--color-caution);border:1px solid rgba(138,90,0,.28);padding:2px 6px;border-radius:5px;white-space:nowrap}
.energy{font-family:var(--font-num);font-size:10.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.editor{display:grid;gap:8px;padding:12px;border:1px dashed var(--color-accent-line);border-radius:13px;background:var(--color-neutral-soft)}
.edit-row{display:grid;grid-template-columns:minmax(0,1fr) 96px 70px 64px 30px;gap:6px;align-items:center}
.edit-row input,.edit-row select{padding:9px 10px;border:1px solid var(--color-border);border-radius:9px;font-size:12.5px;font-family:inherit;color:var(--color-ink);background:var(--surface-field);min-width:0}
.e-meta{grid-column:1/-1;font-size:10.5px;color:var(--color-text-muted);margin:-1px 0 2px 2px}
.e-del{width:30px;height:30px;display:grid;place-items:center;border-radius:7px;color:var(--color-text-muted)}
.e-del:hover:not(:disabled){background:var(--color-danger-soft);color:var(--color-danger)}
.e-del:disabled{opacity:.35;cursor:not-allowed}
.add-row{display:inline-flex;align-items:center;gap:5px;justify-self:start;padding:6px 10px;border-radius:8px;font-size:11.5px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft)}
.summary{display:grid;gap:6px;padding:12px 13px;border-radius:var(--radius-md);background:var(--color-neutral-soft);box-shadow:inset 0 0 0 1px var(--color-border)}
.summary p{margin:0;display:flex;gap:8px;flex-wrap:wrap;font-size:12px;line-height:1.65;color:var(--color-text-secondary)}
.summary strong{flex:none;color:var(--color-ink)}
.summary-note{color:var(--color-text-muted)!important;font-size:11px!important}
.error{margin:0;padding:10px 12px;border-radius:var(--radius-sm);background:var(--color-danger-soft);color:var(--color-danger);font-size:12.5px;line-height:1.6}
.dlg-foot{display:flex;align-items:center;gap:10px;padding:14px 22px;border-top:1px solid var(--color-divider);background:var(--color-neutral-soft);flex-wrap:wrap}
.spacer{flex:1}
.dlg-foot :deep(button){width:auto}
@media(max-width:640px){
  .scrim{padding:0}
  .dlg{width:100%;max-height:94vh;border-radius:18px 18px 0 0;align-self:end}
  .dlg-head{padding:16px 16px 12px}
  .dlg-body{padding:14px 16px}
  .dlg-foot{padding:12px 16px;justify-content:stretch;flex-wrap:nowrap;gap:8px}
  .dlg-foot .spacer{display:none}
  .dlg-foot :deep(button){flex:1 1 0;min-width:0;padding:0 8px;font-size:13px}
  .capture-actions{flex-direction:column}
  .capture-actions :deep(button){width:100%;min-width:0}
  .thumb{width:88px;height:88px}
  .result-meta{min-width:0}
  .edit-row{grid-template-columns:minmax(0,1fr) 84px 30px;grid-template-areas:"name name del" "cat size unit"}
  .e-name{grid-area:name}
  .e-cat{grid-area:cat}
  .e-size{grid-area:size}
  .e-unit{grid-area:unit}
  .e-del{grid-area:del;justify-self:end}
  .e-meta{grid-column:1/-1}
}
</style>
