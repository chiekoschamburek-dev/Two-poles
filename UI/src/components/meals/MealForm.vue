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
        />
        <span v-if="row.source === 'photo'" class="badge-photo">照片 {{ Math.round((row.photoConfidence ?? 0) * 100) }}%</span>
        <select v-model="row.category" class="r-cat" :aria-label="`第 ${i + 1} 项类别`">
          <option v-for="c in FOOD_CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <input v-model.number="row.portionSize" type="number" min="0" step="1" class="r-size" placeholder="份量" :aria-label="`第 ${i + 1} 项份量`" />
        <select v-model="row.portionUnit" class="r-unit" :aria-label="`第 ${i + 1} 项单位`">
          <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
        </select>
        <span v-if="showEstimate && rowEstimate(row)" class="kc">{{ kcLabel(rowEstimate(row)) }}</span>
        <button type="button" class="mini-del" aria-label="删除这一项" :disabled="items.length === 1" @click="removeRow(i)">
          <X :size="15" />
        </button>
      </div>
      <button type="button" class="add-row" @click="addRow"><Plus :size="15" />再加一项</button>
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

    <p v-if="showEstimate && formEstimate" class="kc-sum">
      这一餐粗估 <b>{{ formEstimate.low }}–{{ formEstimate.high }} kcal</b>
      <small>（{{ formEstimate.counted }}/{{ formEstimate.named }} 项可估；±25% 区间；{{ FOOD_SOURCE_LABEL }}；单位→克数为演示假设，未计入烹调油）</small>
    </p>
    <p v-else-if="showEstimate" class="kc-sum off">开了热量粗估，但目前没有可估的条目：需要食物在内置参考表里，且份量已填。</p>

    <p class="tip">份量可以留空——留空会记为"部分记录"，我们不会替你猜克数。按回车直接保存。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="form-actions">
      <BaseButton variant="ghost" @click="emit('cancel')">取消</BaseButton>
      <BaseButton :icon="Check" type="submit">保存{{ label }}</BaseButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Camera, Check, ChevronDown, Plus, X } from 'lucide-vue-next'
import BaseButton from '../common/BaseButton.vue'
import { useFoodPhoto } from '@/composables/useFoodPhoto'
import type { DetectedFood } from '@/composables/useFoodPhoto'
import { FOOD_CATEGORIES } from '@/services/mealRules'
import { estimateEnergy, FOOD_SOURCE_LABEL } from '@/services/foodComposition'
import type { MealDraft } from '@/types/domain'

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
const time = ref(props.initialTime)
const items = ref<MealDraft[]>(props.initialItems.map(i => ({ ...i })))
const error = ref('')
const photoOpen = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)
const nameEls = ref<HTMLInputElement[]>([])

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

function blankRow(): MealDraft {
  return { foodName: '', category: '谷薯类', portionSize: '', portionUnit: '碗' }
}

function rowOf(c: DetectedFood): MealDraft {
  return { foodName: c.name, category: c.category, portionSize: '', portionUnit: '份', source: 'photo', photoConfidence: c.confidence }
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

function rowEstimate(row: MealDraft) {
  return estimateEnergy({
    foodName: row.foodName,
    portionSize: row.portionSize === '' ? undefined : Number(row.portionSize),
    portionUnit: row.portionUnit
  })
}

function kcLabel(e: ReturnType<typeof rowEstimate>) {
  return e ? `≈${e.low}–${e.high} kcal` : ''
}

const formEstimate = computed(() => {
  const list = items.value.map(rowEstimate).filter((e): e is NonNullable<typeof e> => e !== null)
  const named = items.value.filter(i => i.foodName.trim()).length
  if (!list.length) return null
  return { low: list.reduce((s, e) => s + e.low, 0), high: list.reduce((s, e) => s + e.high, 0), counted: list.length, named }
})

function submit() {
  const list = items.value
    .map(i => ({ ...i, foodName: i.foodName.trim() }))
    .filter(i => i.foodName)
  if (!list.length) {
    error.value = '至少填一项食物名称，不然结构规则没有输入可判断。'
    return
  }
  if (!/^\d{2}:\d{2}$/.test(time.value)) {
    error.value = '时间格式应为 HH:MM。'
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
.field input,.row input,.row select{padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-ink);background:#fff}
.m-note{flex:1;min-width:160px;font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.6}
.rows{display:grid;gap:8px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.r-name{flex:1;min-width:150px}
.r-cat{width:104px;flex:none}
.r-size{width:72px;flex:none}
.r-unit{width:74px;flex:none}
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
.cand li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:11px;background:rgba(255,255,255,.9);border:1px solid rgba(220,229,237,.85);box-shadow:var(--inner-light);transition:transform var(--motion-fast) var(--easing-ease-out),box-shadow var(--motion-fast)}
.cand li:hover{transform:translateX(2px);box-shadow:var(--inner-light),var(--ring-accent)}
.cand-t b{font-size:13px;color:var(--color-ink);margin-right:6px}
.cand-t small{font-size:11px;color:var(--color-text-muted)}
.cand-add{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:600;color:var(--color-accent);padding:6px 10px;border-radius:9px;background:var(--color-accent-soft);transition:all var(--motion-fast)}
.cand-add:hover{background:var(--color-accent);color:#fff}
.photo-note{font-size:11px;color:var(--color-text-muted);line-height:1.7;margin:10px 0 0}
.badge-photo{font-size:11px;color:var(--color-accent);background:var(--color-accent-soft);padding:4px 9px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(15,118,110,.16);font-variant-numeric:tabular-nums}
.kc{font-size:11px;color:var(--color-caution);background:var(--color-caution-soft);padding:4px 9px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(215,165,75,.28);font-variant-numeric:tabular-nums}
.kc-sum{font-size:13px;color:var(--color-ink);background:var(--color-neutral-soft);border-radius:12px;padding:11px 13px;margin:0;box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgba(21,24,27,.05)}
.kc-sum small{display:block;font-size:11px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.kc-sum.off{font-size:12px;color:var(--color-text-secondary)}
.tip{font-size:12px;color:var(--color-text-muted);margin:0;line-height:1.6}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:10px 13px;margin:0}
.form-actions{display:flex;gap:10px;justify-content:flex-end}
.form-actions :deep(button){width:auto;padding:0 20px}
@media(max-width:520px){.form-actions{flex-direction:column}.form-actions :deep(button){width:100%}}
</style>
