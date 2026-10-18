<template>
  <form class="mform" @submit.prevent="submit">
    <div class="m-meta">
      <label class="field">
        <span class="field-label">时间</span>
        <input v-model="time" type="time" aria-label="用餐时间" />
      </label>
      <p class="m-note">{{ note }}</p>
    </div>

    <div class="rows">
      <div v-for="(row, i) in items" :key="i" class="row">
        <input
          ref="nameEls"
          v-model="row.foodName"
          type="text"
          class="r-name"
          placeholder="吃了什么，例如：燕麦粥"
          :aria-label="`第 ${i + 1} 项食物名称`"
          @input="onName(row); dropPer(row)"
        />
        <span v-if="row.source === 'photo'" class="badge-photo">照片 {{ Math.round((row.photoConfidence ?? 0) * 100) }}%</span>
        <select
          v-model="row.category"
          class="r-cat"
          :aria-label="`第 ${i + 1} 项类别`"
          @change="row.catAuto = false"
        >
          <option v-for="c in FOOD_CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <span v-if="row.foodName.trim() && catHint(row)" class="r-hint" aria-live="polite">{{ catHint(row) }}</span>
        <input v-model.number="row.portionSize" ref="sizeEls" type="number" min="0" step="any" class="r-size" placeholder="份量" :aria-label="`第 ${i + 1} 项份量`" />
        <select v-model="row.portionUnit" class="r-unit" :aria-label="`第 ${i + 1} 项单位`" @change="dropPer(row)">
          <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
        </select>
        <span v-if="showEstimate && rowEstimate(row)" class="kc">{{ kcLabel(rowEstimate(row)) }}</span>
        <button type="button" class="mini-del" aria-label="删除这一项" :disabled="items.length === 1" @click="removeRow(i)">
          <X :size="15" />
        </button>
        <span v-if="convOf(row).show" class="r-conv">
          <label class="conv-g">1 {{ row.portionUnit }} =
            <input
              class="r-grams"
              type="number"
              min="1"
              max="5000"
              step="1"
              inputmode="numeric"
              :value="convOf(row).per"
              :aria-label="`第 ${i + 1} 项：1 ${row.portionUnit} 等于几克`"
              @change="onPer(row, $event)"
            />
            g
          </label>
          <small>合计 ≈ {{ convOf(row).grams }} g · {{ STATE_LABEL[convOf(row).state] }}</small>
          <button v-if="convOf(row).pending" type="button" class="conv-act" @click="rememberPer(row)">
            记住 1{{ row.portionUnit }}={{ convOf(row).pending }} g
          </button>
          <button v-else-if="convOf(row).state === 'own'" type="button" class="conv-act" @click="forgetPer(row)">撤销本机口径</button>
        </span>
      </div>
      <button type="button" class="add-row" @click="addRow"><Plus :size="15" />再加一项</button>
    </div>

    <div v-if="frequent.length" class="freq">
      <span class="freq-label">常吃<span class="freq-sub">本机历史，点一下填一行</span></span>
      <button v-for="f in frequent" :key="f.name" type="button" class="freq-chip" :aria-label="`把常吃的${f.name}加入这一餐`" @click="addFromFrequent(f)">
        {{ f.name }}<small>×{{ f.count }}{{ f.portionSize ? ` · ${f.portionSize}${f.portionUnit}` : '' }}</small>
      </button>
    </div>

    <div class="m-photo">
      <input ref="fileRef" type="file" accept="image/*" capture="environment" class="file-input" @change="onPick" />
      <button type="button" class="photo-toggle" :aria-expanded="photoOpen" @click="photoOpen = !photoOpen">
        <Camera :size="15" />
        <span>{{ photoOpen ? '收起拍照识别' : '拍照 / 选图识别（可选）' }}</span>
        <ChevronDown :size="14" :class="{ flip: photoOpen }" />
      </button>
      <div v-if="photoOpen" class="photo">
        <div class="photo-bar">
          <BaseButton variant="ghost" size="sm" :icon="Camera" :disabled="photoBusy" @click="fileRef?.click()">{{ photoBusy ? '识别中…' : '选一张照片' }}</BaseButton>
          <span class="photo-state">{{ photoState }}</span>
        </div>
        <div v-if="photoPreview" class="photo-body">
          <img :src="photoPreview" alt="待识别的食物照片" class="photo-img" />
          <ul v-if="photoDetected.length" class="cand">
            <li v-for="c in photoDetected" :key="c.name">
              <span class="cand-t"><b>{{ c.name }}</b><small>{{ c.category }} · {{ Math.round(c.confidence * 100) }}%<template v-if="c.count > 1"> · {{ c.count }} 处</template></small></span>
              <button type="button" class="cand-add" :aria-label="`把${c.name}加入这一餐`" @click="adopt(c)"><Plus :size="15" />加入</button>
            </li>
          </ul>
        </div>
        <p v-if="photoError" class="photo-note">{{ photoError }}</p>
        <p v-else class="photo-note">端侧模型只覆盖 9 类常见食物（苹果、香蕉、橙子、西兰花、胡萝卜、披萨、热狗、甜甜圈、蛋糕），认不出属正常，直接手动填即可。</p>
      </div>
    </div>

    <div class="m-search">
      <button type="button" class="photo-toggle" :aria-expanded="searchOpen" @click="searchOpen = !searchOpen">
        <Search :size="15" />
        <span>{{ searchOpen ? '收起目录搜索' : `在内置目录里搜（${foodTable.length} 条，未与权威成分表核对）` }}</span>
        <ChevronDown :size="14" :class="{ flip: searchOpen }" />
      </button>
      <div v-if="searchOpen" class="search-panel">
        <input
          v-model="query"
          type="search"
          class="search-input"
          placeholder="搜食物名或类别，例如：米饭 / 水果类"
          aria-label="在内置食物目录里搜索"
          @keydown.enter.prevent="results[0] && addFromCatalog(results[0])"
        />
        <ul v-if="results.length" class="cand">
          <li v-for="f in results" :key="f.name">
            <span class="cand-t"><b>{{ f.name }}</b><small>{{ f.category }} · {{ f.energyKcalPer100g }} kcal/100 g · {{ f.note }}</small></span>
            <button type="button" class="cand-add" :aria-label="`把${f.name}加入这一餐`" @click="addFromCatalog(f)"><Plus :size="15" />加入</button>
          </li>
        </ul>
        <p v-else class="photo-note">{{ query.trim() ? '目录里没有这一条。回上面直接填名字也能记，只是这一项不出热量粗估。' : `输入关键字开始筛选，目录共 ${foodTable.length} 条。没收录的食物不必迁就它。` }}</p>
      </div>
    </div>

    <p v-if="showEstimate && formEstimate" class="kc-sum">
      这一餐粗估 <b>{{ formEstimate.low }}–{{ formEstimate.high }} kcal</b>
      <small>（{{ formEstimate.counted }}/{{ formEstimate.named }} 项可估；±{{ bandPct }}% 区间；{{ FOOD_SOURCE_LABEL }}；单位→克：{{ unitBasisNote }}，未计入烹调油；混合菜不参与估算）</small>
    </p>
    <p v-else-if="showEstimate" class="kc-sum off">开了热量粗估，但目前没有可估的条目：需要食物在内置参考表里、份量已填，且不是混合菜。</p>

    <p class="tip">份量可以留空——留空会记为"部分记录"，我们不会替你猜克数。常吃点一下填一行；改"1 碗=几克"只影响这一行，点"记住"才留在本机。按回车直接保存。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="form-actions">
      <BaseButton variant="ghost" @click="emit('cancel')">取消</BaseButton>
      <BaseButton :icon="Check" type="submit">保存{{ label }}</BaseButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, Check, ChevronDown, Plus, Search, X } from 'lucide-vue-next'
import BaseButton from '../common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
import { useFoodPhoto } from '@/composables/useFoodPhoto'
import type { DetectedFood } from '@/composables/useFoodPhoto'
import { FOOD_CATEGORIES, frequentFoods, isMixed, suggestCategory } from '@/services/mealRules'
import type { FrequentFood } from '@/services/mealRules'
import {
  ESTIMATE_BAND, estimateEnergy, findFood, foodTable, FOOD_SOURCE_LABEL, resolveUnitGrams, searchFoods, unitKey
} from '@/services/foodComposition'
import type { FoodRef } from '@/services/foodComposition'
import type { FoodCategory, MealDraft } from '@/types/domain'

/** 表单行：catAuto 与 perOverride 只活在界面上，保存前剥掉——它们不是业务字段 */
interface Row extends MealDraft {
  catAuto?: boolean
  /** 本行临时改过的"1 单位=几克"，没点"记住"就不落盘 */
  perOverride?: number
}

const props = defineProps<{
  /** 槽位标签，如"早餐""加餐"；餐次由打开表单的卡片决定，表单内不再选择 */
  label: string
  initialTime: string
  initialItems: MealDraft[]
  showEstimate: boolean
}>()
const emit = defineEmits<{
  (e: 'save', value: { time: string; items: MealDraft[] }): void
  (e: 'cancel'): void
}>()

const UNITS = ['碗', '盘', '份', '个', '杯', '片', '克', '把']
const store = useAppStore()
const bandPct = Math.round(ESTIMATE_BAND * 100)
const time = ref(props.initialTime)
/** 编辑已有餐次时，用户当时选的类别就是事实，不再自动改写 */
const items = ref<Row[]>(props.initialItems.map(i => ({ ...i, catAuto: false })))
const error = ref('')
const photoOpen = ref(false)
const searchOpen = ref(false)
const query = ref('')
const fileRef = ref<HTMLInputElement | null>(null)
const nameEls = ref<HTMLInputElement[]>([])
const sizeEls = ref<HTMLInputElement[]>([])

const note = computed(() => (props.label === '晚餐' ? '晚餐还没记。没记只表示"未记录"，不代表没吃。' : `还没记录${props.label}。`))

const {
  status: photoStatus,
  busy: photoBusy,
  errorMessage: photoError,
  previewUrl: photoPreview,
  detected: photoDetected,
  analyze: analyzePhoto,
  reset: resetPhoto
} = useFoodPhoto()

const photoState = computed(() => {
  if (photoStatus.value === 'loading') return '端侧识别中…（首次需加载 6.9 MB 模型）'
  if (photoDetected.value.length) return `识别到 ${photoDetected.value.length} 类，勾选后加入`
  if (photoStatus.value === 'done') return '没认出可对照的食物'
  return '照片只在本机推理，不上传、不保存'
})

onMounted(async () => {
  await nextTick()
  nameEls.value[0]?.focus()
})
onBeforeUnmount(resetPhoto)

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await analyzePhoto(file)
  input.value = ''
}

function blankRow(): Row {
  // 类别先落"其他"（即待确认），由名称推断改写——固定默认谷薯类会让"苹果"记成谷薯类
  return { foodName: '', category: '其他', portionSize: '', portionUnit: '碗', catAuto: true }
}

function rowOf(c: DetectedFood): Row {
  return {
    foodName: c.name,
    category: suggestCategory(c.name) ?? c.category,
    portionSize: '',
    portionUnit: '份',
    source: 'photo',
    photoConfidence: c.confidence,
    catAuto: true
  }
}

/** 名称变化时推断类别；用户手动改过类别（catAuto=false）就不再改写 */
function onName(row: Row) {
  if (!row.catAuto) return
  const inferred = suggestCategory(row.foodName)
  row.category = inferred ?? '其他'
}

function catHint(row: Row) {
  const name = row.foodName.trim()
  if (!name) return ''
  if (isMixed(name)) return '混合菜：类别与热量待确认，可拆成原料'
  if (row.category === '其他') return '未命中参考表，类别请人工确认'
  return row.catAuto ? `类别按参考表推断为${row.category}，可改` : ''
}

function adopt(c: DetectedFood) {
  const existing = items.value.find(i => i.foodName === c.name)
  if (existing) {
    existing.source = 'photo'
    existing.photoConfidence = Math.max(existing.photoConfidence ?? 0, c.confidence)
    return
  }
  const first = items.value[0]
  if (!first.foodName) items.value[0] = rowOf(c)
  else items.value.push(rowOf(c))
}

function addRow() {
  items.value.push(blankRow())
  nextTick(() => nameEls.value[items.value.length - 1]?.focus())
}

function removeRow(index: number) {
  if (items.value.length > 1) items.value.splice(index, 1)
}

/** 命中目录且不是混合菜时返回规范条目，用于换算与"常吃"归并 */
function catalogFood(row: Row): FoodRef | null {
  const n = row.foodName.trim()
  if (!n || isMixed(n)) return null
  return findFood(n) ?? null
}

interface Conv {
  show: boolean
  /** 这一项折算出来的总克数（只展示，不直接编辑） */
  grams: number
  /** 当前生效的"1 单位 = 几克" */
  per: number
  /** 口径来自哪里：已记住的本机口径 / 本行临时改的 / 演示假设 */
  state: 'own' | 'pending' | 'demo'
  /** 本行改过、但还没点"记住"的口径 */
  pending: number | null
  food: string
  unit: string
}

/** 单位↔克数换算的单一出口；单位本身就是克、没填份量或目录没收录时不显示 */
function convOf(row: Row): Conv {
  const off: Conv = { show: false, grams: 0, per: 0, state: 'demo', pending: null, food: '', unit: row.portionUnit }
  const food = catalogFood(row)
  const size = Number(row.portionSize)
  if (!food || row.portionUnit === '克' || !(size > 0)) return off
  const info = resolveUnitGrams(food.name, row.portionUnit, store.unitGrams)
  if (!info) return off
  const per = row.perOverride ?? info.grams
  const changed = row.perOverride != null && row.perOverride !== info.grams
  return {
    show: true,
    grams: Math.round(size * per),
    per,
    state: changed ? 'pending' : info.own ? 'own' : 'demo',
    pending: changed ? row.perOverride! : null,
    food: food.name,
    unit: row.portionUnit
  }
}

const STATE_LABEL = { own: '本机口径', pending: '本行临时改的，还没记住', demo: '演示假设' } as const

/** 改的是"1 单位=几克"：先只影响这一行，点"记住"才落本机 */
function onPer(row: Row, event: Event) {
  const v = Number((event.target as HTMLInputElement).value)
  row.perOverride = v > 0 && v <= 5000 ? Math.round(v) : undefined
}

/** 换了食物或单位，上一行的临时口径就不再适用 */
function dropPer(row: Row) {
  row.perOverride = undefined
}

function rememberPer(row: Row) {
  const c = convOf(row)
  if (!c.pending || !store.rememberUnitGrams(c.food, c.unit, c.pending)) return
  row.perOverride = undefined
  store.showToast({
    type: 'success',
    title: `已记住：1${c.unit} = ${c.pending} g`,
    message: `只有 ${c.food} 的这一个单位变了，其它条目不受影响`,
    duration: 3000
  })
}

function forgetPer(row: Row) {
  const c = convOf(row)
  if (!store.forgetUnitGrams(c.food, c.unit)) return
  row.perOverride = undefined
  store.showToast({ type: 'info', title: `已撤销 ${c.food} 的本机口径`, message: `1${c.unit} 退回演示假设`, duration: 2500 })
}

/** 常吃与目录搜索都放在服务层的纯函数里，自检可以直接断言 */
const frequent = computed(() => frequentFoods(store.meals))
const results = computed(() => searchFoods(query.value))

/** 三个入口共用：同名条目不重复加，优先占用空行 */
function putRow(patch: Row): Row {
  const hit = items.value.find(i => i.foodName.trim() === patch.foodName)
  if (hit) return hit
  const blank = items.value.find(i => !i.foodName.trim())
  if (blank) Object.assign(blank, patch)
  else items.value.push(patch)
  return blank ?? patch
}

function rowFrom(name: string, category: FoodCategory, size: number | '', unit: string): Row {
  return { foodName: name, category, portionSize: size, portionUnit: unit, source: 'manual', catAuto: false }
}

/** 从常吃或目录加进来时，缺份量就把光标停在份量上 */
function focusSize(row: Row) {
  if (row.portionSize !== '') return
  const index = items.value.indexOf(row)
  nextTick(() => sizeEls.value[index]?.focus())
}

function addFromFrequent(f: FrequentFood) {
  focusSize(putRow(rowFrom(f.name, f.category, f.portionSize ?? '', f.portionUnit)))
}

function addFromCatalog(f: FoodRef) {
  const known = frequent.value.find(x => x.name === f.name)
  focusSize(putRow(rowFrom(f.name, f.category, known?.portionSize ?? '', known?.portionUnit ?? '份')))
}

function rowEstimate(row: Row) {
  const food = catalogFood(row)
  /** 本行还没落盘的临时口径也要参与实时估算，否则改了"1 碗=几克"数字不动 */
  const unitGrams = food && row.perOverride != null
    ? { ...store.unitGrams, [unitKey(food.name, row.portionUnit)]: row.perOverride }
    : store.unitGrams
  return estimateEnergy({
    foodName: row.foodName,
    portionSize: row.portionSize === '' ? undefined : Number(row.portionSize),
    portionUnit: row.portionUnit,
    unitGrams
  })
}

function kcLabel(e: ReturnType<typeof rowEstimate>) {
  return e ? `≈${e.low}–${e.high} kcal` : ''
}

const formEstimate = computed(() => {
  const rows = items.value.map(r => ({ r, e: rowEstimate(r) })).filter(x => x.e !== null)
  const named = items.value.filter(i => i.foodName.trim()).length
  if (!rows.length) return null
  return {
    low: rows.reduce((s, x) => s + x.e!.low, 0),
    high: rows.reduce((s, x) => s + x.e!.high, 0),
    counted: rows.length,
    named,
    own: rows.filter(x => x.e!.unitOwn && x.r.perOverride == null).length,
    pending: rows.filter(x => x.r.perOverride != null).length,
    demo: rows.filter(x => x.r.perOverride == null && !x.e!.unitOwn && x.e!.unit !== '克').length,
    asGrams: rows.filter(x => x.e!.unit === '克').length
  }
})

/** 汇总里的口径说明：三种来源分开写，避免"没记住"也被说成"本机口径" */
const unitBasisNote = computed(() => {
  const f = formEstimate.value
  if (!f) return ''
  const parts: string[] = []
  if (f.own) parts.push(`${f.own} 项按本机口径`)
  if (f.pending) parts.push(`${f.pending} 项本行临时改过（未记住）`)
  if (f.demo) parts.push(`${f.demo} 项按演示假设`)
  if (f.asGrams) parts.push(`${f.asGrams} 项直接记的克数`)
  return parts.join('、')
})

function submit() {
  const list: MealDraft[] = items.value
    .map(({ catAuto: _catAuto, perOverride: _perOverride, ...i }) => ({ ...i, foodName: i.foodName.trim() }))
    .filter(i => i.foodName)
  if (!list.length) {
    error.value = '至少填一项食物名称，不然结构规则没有输入可判断。'
    return
  }
  if (!/^\d{2}:\d{2}$/.test(time.value)) {
    error.value = '时间格式应为 HH:MM。'
    return
  }
  /** 落库的估算只认已记住的口径；有行还挂着临时口径就保存，界面显示的数与存下的数会分叉 */
  if (items.value.some(i => convOf(i).pending !== null)) {
    error.value = '有条目的"1 单位=几克"改过但还没点"记住"。先记住这个换算，或点"撤销本机口径"退回演示假设，再保存。'
    return
  }
  error.value = ''
  emit('save', { time: time.value, items: list })
}
</script>

<style scoped>
.mform{display:grid;gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid var(--color-divider)}
.m-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.field{display:block}
.field-label{display:block;font-size:11px;color:var(--color-text-muted);margin-bottom:5px}
.field input,.row input,.row select{padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.m-note{flex:1;min-width:160px;font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.6}
.rows{display:grid;gap:8px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.r-name{flex:1;min-width:150px}
.r-cat{width:104px;flex:none}
.r-size{width:72px;flex:none}
.r-unit{width:74px;flex:none}
.r-hint{flex-basis:100%;order:9;font-size:11px;color:var(--color-text-muted);line-height:1.5;margin:-2px 0 0 2px}
.r-conv{flex-basis:100%;order:10;display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:11px;color:var(--color-text-muted);margin:-2px 0 0 2px}
.r-conv small{font-size:11px}
.conv-g{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--color-text-secondary)}
.r-grams{width:62px;padding:5px 7px;border:1px solid var(--color-border);border-radius:8px;font-size:12px;font-family:inherit;color:var(--color-ink);background:var(--surface-field);font-variant-numeric:tabular-nums}
.conv-act{padding:4px 9px;border-radius:8px;font-size:11px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);transition:all var(--motion-fast)}
.conv-act:hover{background:var(--color-accent);color:var(--color-on-accent)}
.freq{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.freq-label{font-size:11px;font-weight:700;color:var(--color-text-secondary);display:inline-flex;align-items:baseline;gap:6px}
.freq-sub{font-weight:400;color:var(--color-text-muted)}
.freq-chip{display:inline-flex;align-items:baseline;gap:5px;padding:6px 11px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);border:1px solid var(--color-accent-line);transition:all var(--motion-fast)}
.freq-chip small{font-size:11px;font-weight:500;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.freq-chip:hover{background:var(--color-accent-line)}
.m-search{display:grid;gap:10px}
.search-panel{border:1px dashed var(--color-accent-line);border-radius:15px;padding:14px;background:var(--color-neutral-soft)}
.search-input{width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.search-panel .cand{margin-top:10px}
.add-row{display:inline-flex;align-items:center;gap:5px;justify-self:start;padding:7px 12px;border-radius:10px;font-size:12px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);transition:all var(--motion-fast)}
.add-row:hover{background:var(--color-accent-line)}
.mini-del{color:var(--color-text-muted);display:grid;place-items:center;padding:4px;border-radius:8px;transition:all var(--motion-fast);flex:none}
.mini-del:hover:not(:disabled){background:var(--color-danger-soft);color:var(--color-danger)}
.mini-del:disabled{opacity:.4;cursor:not-allowed}
.m-photo{display:grid;gap:10px}
.file-input{display:none}
.photo-toggle{display:inline-flex;align-items:center;gap:7px;justify-self:start;padding:8px 13px;border-radius:11px;font-size:12px;color:var(--color-text-secondary);background:transparent;box-shadow:inset 0 0 0 1px var(--color-border);transition:all var(--motion-fast)}
.photo-toggle:hover{color:var(--color-accent);box-shadow:inset 0 0 0 1px rgba(15,118,110,.4)}
.photo-toggle .flip{transform:rotate(180deg);transition:transform var(--motion-fast)}
.photo{border:1px dashed var(--color-accent-line);border-radius:15px;padding:14px;background:linear-gradient(160deg,var(--color-accent-soft),var(--color-neutral-soft));box-shadow:inset 0 1px 0 #fff}
.photo-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.photo-bar :deep(button){width:auto;padding:0 16px;margin:0}
.photo-state{font-size:12px;color:var(--color-text-muted);margin:0}
.photo-body{display:flex;gap:12px;margin-top:12px;align-items:flex-start;flex-wrap:wrap}
.photo-img{width:120px;height:120px;object-fit:cover;border-radius:12px;background:var(--color-divider);box-shadow:0 0 0 1px rgba(21,24,27,.08),0 8px 20px -10px rgba(21,24,27,.35)}
.cand{list-style:none;padding:0;margin:0;display:grid;gap:6px;flex:1;min-width:190px}
.cand li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:11px;background:var(--color-card);border:1px solid rgba(220,229,237,.85);box-shadow:var(--inner-light);transition:transform var(--motion-fast) var(--easing-ease-out),box-shadow var(--motion-fast)}
.cand li:hover{transform:translateX(2px);box-shadow:var(--inner-light),var(--ring-accent)}
.cand-t b{font-size:13px;color:var(--color-ink);margin-right:6px}
.cand-t small{font-size:11px;color:var(--color-text-muted)}
.cand-add{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:600;color:var(--color-accent);padding:6px 10px;border-radius:9px;background:var(--color-accent-soft);transition:all var(--motion-fast)}
.cand-add:hover{background:var(--color-accent);color:var(--color-on-accent)}
.photo-note{font-size:11px;color:var(--color-text-muted);line-height:1.7;margin:10px 0 0}
.badge-photo{font-size:11px;color:var(--color-accent);background:var(--color-accent-soft);padding:4px 9px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(15,118,110,.16);font-variant-numeric:tabular-nums}
.kc{font-size:11px;color:var(--color-caution);background:var(--color-caution-soft);padding:4px 9px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(215,165,75,.28);font-variant-numeric:tabular-nums}
.kc-sum{font-size:13px;color:var(--color-ink);background:var(--color-neutral-soft);border-radius:12px;padding:11px 13px;margin:0;box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgba(21,24,27,.05)}
.kc-sum small{display:block;font-size:11px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.kc-sum.off{font-size:12px;color:var(--color-text-secondary)}
.tip{font-size:12px;color:var(--color-text-muted);margin:0;line-height:1.6}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:10px 13px;margin:0}
.form-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.form-actions :deep(button){width:auto;padding:0 20px}
@media(max-width:520px){.form-actions{flex-direction:column}.form-actions :deep(button){width:100%}}
</style>
