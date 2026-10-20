<template>
  <div class="page-wrap">
    <header class="lede">
      <div>
        <span class="micro kick"><i></i>Meal log · {{ dateLabel }}</span>
        <h1>记录饮食，拍一张就好</h1>
        <p>{{ headerCopy }}</p>
      </div>
      <div class="lede-r">
        <span class="chip" :class="recordedSlots === 3 ? 'ok' : recordedSlots ? 'part' : ''">
          <i class="dot"></i>{{ recordedSlots }} / 3 餐已记录
        </span>
      </div>
    </header>

    <StatStrip :items="mealStats" />

    <BaseCard class="capture-hero">
      <div class="hero-copy">
        <span class="micro">Photo first</span>
        <h2>拍一张，记一顿</h2>
        <p>不用先选早餐还是晚餐：系统按拍摄时间自动判断餐次，识别后默认直接保存，想改再展开。</p>
        <div class="hero-meta">
          <span class="mode-chip" :class="{ ok: modelAvailable }">
            <i class="dot"></i>{{ recognitionLabel }}
          </span>
          <span>本应用不保存原图 · 发送前会征得同意</span>
        </div>
      </div>
      <div class="hero-act">
        <BaseButton size="lg" :icon="Camera" @click="openCapture">记录饮食</BaseButton>
        <button type="button" class="manual-link" @click="openManual"><PenLine :size="14" /> 手动补录</button>
      </div>
    </BaseCard>

    <div class="day-grid">
      <BaseCard variant="flush" class="today-card">
        <div class="card-head">
          <div>
            <span class="micro">Today · {{ records.length }} 条</span>
            <h2>今日记录 <em v-if="records.length">按时间排列</em></h2>
          </div>
          <div class="slot-chips" aria-label="今日各餐次记录情况">
            <span v-for="slot in slotStatus" :key="slot.id" :class="{ on: slot.count > 0 }">
              {{ slot.label }}<i v-if="slot.count">{{ slot.count }}</i>
            </span>
          </div>
        </div>

        <div v-if="!records.length" class="empty-state">
          <div class="empty-mark" aria-hidden="true"><Camera :size="22" /></div>
          <p>今天还没有饮食记录。</p>
          <small>点上面的「记录饮食」，拍一张就会自动识别食物并判断餐次。</small>
        </div>

        <ol v-else class="log-list">
          <li
            v-for="meal in records"
            :id="`meal-${meal.id}`"
            :key="meal.id"
            class="log"
          >
            <span class="log-dot" aria-hidden="true"></span>
            <div class="log-main">
              <div class="log-head">
                <span class="log-time">{{ meal.time }}</span>
                <span class="type-tag">{{ mealTypeLabel(meal.mealType) }}</span>
                <span class="log-source">{{ mealSource(meal) }}</span>
                <span v-if="attentionCount(meal)" class="low-flag">{{ attentionCount(meal) }} 项待核对</span>
                <span class="head-spacer"></span>
                <div class="log-actions">
                  <button type="button" :aria-expanded="expandedId === meal.id" @click="toggleDetail(meal.id)">
                    {{ expandedId === meal.id ? '收起' : '查看' }}
                  </button>
                  <button type="button" @click="startEdit(meal)">编辑</button>
                  <button type="button" class="danger" @click="remove(meal.id)">删除</button>
                </div>
              </div>

              <div class="log-body">
                <figure v-if="meal.photoThumb" class="meal-photo">
                  <img :src="meal.photoThumb" alt="本次记录的食物照片缩略图" />
                  <figcaption>本机缩略图</figcaption>
                </figure>
                <div class="food-block">
                  <div class="food-block-head">
                    <span class="detail-label">本次食物</span>
                    <span class="food-count">{{ meal.items.length }} 项</span>
                  </div>
                  <ul class="food-rows">
                    <li
                      v-for="(item, index) in meal.items"
                      :key="item.id || index"
                      :class="{ unsure: itemIsUncertain(item) }"
                    >
                      <span class="f-name">{{ item.foodName }}</span>
                      <span class="f-cat">{{ item.category }}</span>
                      <span class="f-portion">{{ portionOf(item) }}</span>
                      <span v-if="confidenceOf(item)" class="f-conf" :class="{ low: isLowPhotoConfidence(item) }">
                        {{ confidenceOf(item) }}
                      </span>
                      <span v-if="itemIsUncertain(item)" class="f-flag">待确认</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div v-if="expandedId === meal.id" class="log-detail">
                <div class="detail-grid">
                  <div>
                    <span class="detail-label">本餐结构</span>
                    <p>{{ structureText(meal) }}</p>
                    <p v-if="meal.analysis?.unknownItems?.length" class="warn">待确认：{{ meal.analysis.unknownItems.join('、') }}</p>
                    <p v-if="meal.analysis?.missingCategories?.length" class="muted">
                      记完这餐后今天仍缺：{{ meal.analysis.missingCategories.join('、') }}
                    </p>
                  </div>
                  <div>
                    <span class="detail-label">份量与营养</span>
                    <p v-if="localEnergyText(meal)" class="energy-line">{{ localEnergyText(meal) }}</p>
                    <p v-if="!localEnergyText(meal) && modelEnergyText(meal)" class="energy-line">{{ modelEnergyText(meal) }}</p>
                    <p v-if="!localEnergyText(meal) && !modelEnergyText(meal)" class="muted">
                      {{ showEstimate ? '没有可估的份量或营养数据。' : '热量粗估默认关闭，可在设置里开启。' }}
                    </p>
                    <p v-if="meal.completeness === 'partial'" class="muted">部分条目没有份量，这条记为「部分记录」。</p>
                  </div>
                  <div>
                    <span class="detail-label">餐次</span>
                    <div class="type-edit">
                      <select :value="meal.mealType" :aria-label="`修改 ${meal.time} 的餐次`" @change="changeType(meal, $event)">
                        <option v-for="opt in MEAL_TYPE_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                      </select>
                      <span>按时间自动判断：{{ inferredLabel(meal) }}</span>
                    </div>
                  </div>
                </div>

                <MealForm
                  v-if="editingId === meal.id"
                  :label="mealTypeLabel(meal.mealType)"
                  :initial-time="meal.time"
                  :initial-items="draftItems(meal)"
                  :show-estimate="showEstimate"
                  editing
                  @save="onEditSave(meal, $event)"
                  @cancel="editingId = null"
                />
              </div>
            </div>
          </li>
        </ol>
      </BaseCard>

      <aside class="side-col">
        <BaseCard class="coverage">
          <div class="side-head">
            <span class="micro">Structure</span>
            <h2>今日类别覆盖</h2>
          </div>
          <div class="cov-big">
            <b>{{ summary.coverage.length }}</b><span>/ 8 类</span>
          </div>
          <ul class="cov-list">
            <li v-for="row in coverageRows" :key="row.name" :class="{ on: row.present }">
              <i aria-hidden="true"></i>{{ row.name }}<span>{{ row.present ? '已出现' : '未出现' }}</span>
            </li>
          </ul>
          <p class="side-note">只统计记录里出现过的类别，不判断分量或营养摄入量。未记录不代表没吃。</p>
          <RouterLink to="/report" class="side-link">看本周餐食结构 <ArrowRight :size="14" /></RouterLink>
        </BaseCard>

        <BaseCard class="howto">
          <span class="micro">How it works</span>
          <h2>一餐只要三步</h2>
          <ol>
            <li><b>拍一张</b><small>或用「选择图片」</small></li>
            <li><b>看识别结果</b><small>低置信度会标出</small></li>
            <li><b>保存记录</b><small>默认不用填表</small></li>
          </ol>
          <p class="side-note">没有模型或识别失败时，可以换一张、改用本机识别，或手动补录。</p>
        </BaseCard>
      </aside>
    </div>

    <BaseCard v-if="store.isAthleteMode" class="timeline">
      <div class="card-head">
        <div>
          <span class="micro">Training day timeline</span>
          <h2>训练日用餐时间线 <em v-if="timeline.length">{{ timeline.length }} 个事件</em></h2>
        </div>
      </div>
      <p class="tl-note">把已记录的餐次与训练按时间排在一起，只作个人复盘；不判断进食时机是否合适，也不给竞技营养结论。</p>
      <ul v-if="timeline.length" class="tl">
        <li v-for="e in timeline" :key="e.key" :class="e.kind">
          <span class="tl-time">{{ e.time }}</span>
          <span class="tl-dot" aria-hidden="true"></span>
          <span class="tl-body">
            <strong>{{ e.title }}</strong>
            <small>{{ e.detail }}</small>
          </span>
        </li>
      </ul>
      <p v-else class="muted">今天还没有训练或餐食记录。空着是合法状态，不代表没吃没练。</p>
    </BaseCard>

    <InsightCard class="rules animate-slide-in-up" card-id="meal-rules" eyebrow="HOW THIS WORKS" title="这些结论是怎么来的">
      <template #icon><Sparkles :size="20" /></template>
      <ul class="lims">
        <li v-for="l in limitations" :key="l">{{ l }}</li>
      </ul>
      <p class="ver">规则版本 {{ RULE_VERSION }} · 是否含营养估算：{{ hasEstimateToday ? '是（区间粗估，来源见上）' : '否' }} · 记录仅存本机浏览器</p>
    </InsightCard>

    <FoodCaptureDialog
      :open="captureOpen"
      :date="date"
      :initial-view="captureInitialView"
      @close="captureOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ArrowRight, Camera, PenLine, Sparkles } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import InsightCard from '@/components/common/InsightCard.vue'
import StatStrip, { type StatItem } from '@/components/common/StatStrip.vue'
import MealForm from '@/components/meals/MealForm.vue'
import FoodCaptureDialog from '@/components/meals/FoodCaptureDialog.vue'
import { useAppStore } from '@/stores/app'
import type { Meal, MealDraft, MealItem, MealType, ModelEnergyEstimate } from '@/types/domain'
import {
  FOOD_CATEGORIES,
  MEAL_TYPE_OPTIONS,
  RULE_VERSION,
  buildLimitations,
  inferMealType,
  isMixed,
  mealTypeLabel,
  summarizeDay
} from '@/services/mealRules'
import { LOW_CONFIDENCE } from '@/services/foodRecognition'
import { canUseLlm, isLlmReady, usingDefault } from '@/services/llm'
import { shortDate, toISODate } from '@/utils/time'

const store = useAppStore()

const now = new Date()
const date = toISODate(now)
const dateLabel = shortDate(now)
const summary = computed(() => summarizeDay(store.meals, date))
const showEstimate = computed(() => store.privacy.showEnergyEstimate)

const records = computed(() => store.meals
  .filter(m => m.date === date)
  .slice()
  .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt)))

const recordedSlots = computed(() => new Set(
  records.value.filter(m => m.mealType !== 'snack').map(m => m.mealType)
).size)

const slotStatus = computed(() => {
  const types: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
  return types.map(type => ({
    id: type,
    label: mealTypeLabel(type),
    count: records.value.filter(m => m.mealType === type).length
  }))
})

const coverageRows = computed(() => FOOD_CATEGORIES.slice(0, 8).map(name => ({
  name,
  present: summary.value.coverage.includes(name)
})))

const modelAvailable = computed(() => canUseLlm(store.llmConfig, store.llmDefault))
onMounted(() => {
  if (!isLlmReady(store.llmConfig) && !store.llmDefault.available) void store.refreshLlmStatus()
})
const recognitionLabel = computed(() => {
  if (!modelAvailable.value) return '本机识别 · 9 类（未配置模型）'
  const model = usingDefault(store.llmConfig) ? store.llmDefault.model : store.llmConfig.model
  return `模型识别 · ${model || '已配置'}`
})

const headerCopy = computed(() => showEstimate.value
  ? '拍照或选图后自动识别食物，餐次按拍摄时间判断；热量只作区间粗估，不评价吃得多不多。'
  : '拍照或选图后自动识别食物，餐次按拍摄时间判断；只记录结构，不估算热量，也不评价吃得多不多。')

const mealStats = computed<StatItem[]>(() => {
  const s = summary.value
  return [
    {
      label: '类别覆盖',
      value: `${s.coverage.length} / 8`,
      hint: s.recorded ? (s.missing.length ? `还缺 ${s.missing.slice(0, 3).join('、')}${s.missing.length > 3 ? ' 等' : ''}` : '八类都出现过') : '今天还没有记录',
      tone: s.coverage.length >= 5 ? 'accent' : 'default'
    },
    { label: '完整记录', value: s.completeCount, unit: '条', hint: '每项都填了份量' },
    { label: '部分记录', value: s.partialCount, unit: '条', hint: '有食物，但份量没估全' },
    { label: '加餐', value: s.snackCount, unit: '次', hint: '不记录也是合法状态' }
  ]
})

const hasLocalEstimateToday = computed(() => showEstimate.value && store.meals.some(m =>
  m.date === date && (m.analysis?.estimateRefs?.length ?? 0) > 0
))
const hasModelEstimateToday = computed(() => showEstimate.value && store.meals.some(m =>
  m.date === date && m.items.some(i => !!i.modelEnergy)
))
const hasEstimateToday = computed(() => hasLocalEstimateToday.value || hasModelEstimateToday.value)
const limitations = computed(() => {
  const base = buildLimitations(hasLocalEstimateToday.value)
  // 只有模型热量时，不能同时留一句"没有热量估算"
  const cleaned = hasModelEstimateToday.value && !hasLocalEstimateToday.value
    ? base.filter(l => !l.includes('hasNutritionEstimate = false'))
    : base
  return [
    ...cleaned,
    ...(hasModelEstimateToday.value
      ? ['部分照片识别结果带有模型提供的热量区间：它只是模型粗估，未与成分表核对，也不构成营养建议。']
      : []),
    '照片识别会给出名称、类别与置信度；低置信度项在列表里标注，默认不强迫逐项确认。',
    '识别失败不会生成记录；原图不保存。若使用模型识别，拍照前会单独说明并征得同意。'
  ]
})

const timeline = computed(() => {
  const completenessText = (c: Meal['completeness']) => (c === 'complete' ? '完整记录' : c === 'partial' ? '部分记录' : '未记完整')
  const rows = [
    ...records.value.map(m => ({
      key: `meal-${m.id}`,
      kind: 'meal' as const,
      time: m.time,
      title: mealTypeLabel(m.mealType),
      detail: `${m.items.map(i => i.foodName).join('、') || '没有条目'} · ${completenessText(m.completeness)}`
    })),
    ...store.sessions.filter(s => s.date === date).map(s => ({
      key: `train-${s.id}`,
      kind: 'train' as const,
      time: s.createdAt.slice(11, 16),
      title: `${s.exerciseName}（训练记录）`,
      detail: [
        `${s.actualDuration ?? '—'} min`,
        s.actualDistance ? `${(s.actualDistance / 1000).toFixed(1)} km` : '',
        s.rpe === null ? 'RPE 未记录' : `RPE ${s.rpe}`,
        s.cameraUsed ? '摄像头计数' : '手工记录'
      ].filter(Boolean).join(' · ')
    }))
  ]
  return rows.sort((a, b) => a.time.localeCompare(b.time))
})

// ——— 拍照入口 ———
const captureOpen = ref(false)
const captureInitialView = ref<'capture' | 'manual'>('capture')

function openCapture() {
  captureInitialView.value = 'capture'
  captureOpen.value = true
}

function openManual() {
  captureInitialView.value = 'manual'
  captureOpen.value = true
}

function onSaved(meal: Meal) {
  expandedId.value = meal.id
  editingId.value = null
  nextTick(() => {
    window.setTimeout(() => {
      document.getElementById(`meal-${meal.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  })
}

// ——— 今日记录 ———
const expandedId = ref<string | null>(null)
const editingId = ref<string | null>(null)

function toggleDetail(mealId: string) {
  if (expandedId.value === mealId) {
    expandedId.value = null
    if (editingId.value === mealId) editingId.value = null
  } else {
    expandedId.value = mealId
  }
}

function startEdit(meal: Meal) {
  expandedId.value = meal.id
  editingId.value = meal.id
  nextTick(() => {
    document.getElementById(`meal-${meal.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function remove(mealId: string) {
  if (editingId.value === mealId) editingId.value = null
  if (expandedId.value === mealId) expandedId.value = null
  store.removeMeal(mealId)
}

function mealSource(meal: Meal): string {
  return meal.items.some(i => i.source === 'photo') ? '照片识别' : '手动记录'
}

function itemIsUncertain(item: MealItem): boolean {
  return item.uncertain === true
    || item.category === '其他'
    || isMixed(item.foodName)
    || (item.source === 'photo' && (item.photoConfidence ?? 1) < LOW_CONFIDENCE)
}

function attentionCount(meal: Meal): number {
  return meal.items.filter(itemIsUncertain).length
}

function confidenceOf(item: MealItem): string {
  return item.source === 'photo' && item.photoConfidence !== undefined
    ? `${Math.round(item.photoConfidence * 100)}%`
    : ''
}

function isLowPhotoConfidence(item: MealItem): boolean {
  return item.source === 'photo' && (item.photoConfidence ?? 1) < LOW_CONFIDENCE
}

function portionOf(item: MealItem): string {
  return item.portionSize ? `${item.portionSize}${item.portionUnit || ''}` : '份量未估'
}

function structureText(meal: Meal): string {
  const fromAnalysis = meal.analysis?.categoryCoverage ?? []
  const present = fromAnalysis.length
    ? fromAnalysis
    : FOOD_CATEGORIES.filter(c => meal.items.some(i => i.category === c))
  return present.length ? present.join('、') : '仅"其他/油脂"，未落入 8 类'
}

function localEnergyText(meal: Meal): string {
  if (!showEstimate.value) return ''
  const refs = meal.analysis?.estimateRefs ?? []
  if (!refs.length) return ''
  const low = refs.reduce((s, r) => s + r.low, 0)
  const high = refs.reduce((s, r) => s + r.high, 0)
  const rest = meal.items.length - refs.length
  return `${low}–${high} kcal（${refs.length}/${meal.items.length} 项可估${rest > 0 ? '，其余是混合菜或缺份量' : ''}）· 依据 ${refs[0].basis} · ${refs[0].source}`
}

function modelEnergyText(meal: Meal): string {
  if (!showEstimate.value) return ''
  const list = meal.items.map(i => i.modelEnergy).filter((e): e is ModelEnergyEstimate => !!e)
  if (!list.length) return ''
  const low = list.reduce((s, e) => s + e.low, 0)
  const high = list.reduce((s, e) => s + e.high, 0)
  return `${low}–${high} kcal · 识别模型粗估（${list.length}/${meal.items.length} 项，未与成分表核对）`
}

function inferredLabel(meal: Meal): string {
  return mealTypeLabel(inferMealType(meal.time))
}

function changeType(meal: Meal, event: Event) {
  const next = (event.target as HTMLSelectElement).value as MealType
  if (!MEAL_TYPE_OPTIONS.some(o => o.id === next)) return
  if (store.updateMealType(meal.id, next)) {
    store.showToast({
      type: 'info',
      title: `已改为${mealTypeLabel(next)}`,
      message: '只改餐次标签，条目与类别结构没有变化',
      duration: 2200
    })
  }
}

function draftItems(meal: Meal): MealDraft[] {
  return meal.items.map(i => ({
    foodName: i.foodName,
    category: i.category,
    portionSize: i.portionSize ?? '',
    portionUnit: i.portionUnit ?? '碗',
    source: i.source,
    photoConfidence: i.photoConfidence,
    uncertain: i.uncertain,
    modelEnergy: i.modelEnergy
  }))
}

function onEditSave(meal: Meal, value: { time: string; items: MealDraft[] }) {
  store.meals = store.meals.filter(m => m.id !== meal.id)
  const saved = store.addMeal({
    date: meal.date,
    mealType: meal.mealType,
    time: value.time,
    items: value.items.map(i => ({
      foodName: i.foodName,
      category: i.category,
      portionSize: i.portionSize === '' ? undefined : Number(i.portionSize),
      portionUnit: i.portionUnit || undefined,
      source: i.source ?? 'manual',
      photoConfidence: i.photoConfidence,
      uncertain: i.uncertain,
      modelEnergy: i.modelEnergy
    })),
    photoThumb: meal.photoThumb
  })
  editingId.value = null
  expandedId.value = saved.id
}
</script>

<style scoped>
.page-wrap{max-width:var(--content-max-width);margin:auto}
/* ——— 抬头 ——— */
.lede{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:18px 0 16px}
.kick{display:inline-flex;align-items:center;gap:8px}.kick i{width:14px;height:1px;background:var(--color-accent);display:block}
.lede h1{margin:9px 0 0;font-size:36px;letter-spacing:-.03em;color:var(--color-ink)}
.lede p{margin:8px 0 0;max-width:660px;font-size:12.5px;color:var(--color-text-muted);line-height:1.7}
.lede-r{flex:none;padding-bottom:3px}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-card);font-family:var(--font-num);font-size:11.5px;font-weight:600;color:var(--color-text-secondary);font-variant-numeric:tabular-nums}
.chip .dot{width:5px;height:5px;border-radius:50%;background:var(--color-text-muted)}
.chip.ok{color:var(--color-accent);border-color:var(--color-accent-line);background:var(--color-accent-soft)}.chip.ok .dot{background:var(--color-accent)}
.chip.part{color:var(--color-caution);border-color:rgba(138,90,0,.26);background:var(--color-caution-soft)}.chip.part .dot{background:var(--color-caution)}

/* ——— 拍照主入口 ——— */
.capture-hero{margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:24px;border-color:var(--color-accent-line);background:linear-gradient(120deg,var(--color-accent-soft),var(--color-card) 62%)}
.hero-copy{min-width:0}
.hero-copy h2{font-size:24px;margin:6px 0 0;letter-spacing:-.02em}
.hero-copy p{margin:7px 0 0;max-width:580px;font-size:12.5px;line-height:1.7;color:var(--color-text-secondary)}
.hero-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:var(--color-text-muted)}
.mode-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-card);font-family:var(--font-num);font-variant-numeric:tabular-nums}
.mode-chip .dot{width:5px;height:5px;border-radius:50%;background:var(--color-text-muted)}
.mode-chip.ok{color:var(--color-accent);border-color:var(--color-accent-line);background:var(--color-card)}
.mode-chip.ok .dot{background:var(--color-accent)}
.hero-act{display:grid;gap:8px;flex:none;min-width:210px}
.hero-act :deep(button){width:100%}
.manual-link{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;border-radius:9px;font-size:12px;font-weight:600;color:var(--color-text-secondary);transition:color var(--motion-fast),background var(--motion-fast)}
.manual-link:hover{color:var(--color-accent);background:var(--color-accent-soft)}

/* ——— 今日记录 + 结构 ——— */
.day-grid{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(250px,.8fr);gap:14px;margin-top:14px;align-items:start}
.today-card{min-width:0}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px 0}
.card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.015em;margin:5px 0 0}
.card-head h2 em{font-style:normal;font-size:11.5px;font-weight:400;color:var(--color-text-muted);margin-left:6px}
.slot-chips{display:flex;gap:5px;flex-wrap:wrap;padding-top:2px}
.slot-chips span{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:6px;border:1px solid var(--color-border);font-size:10.5px;color:var(--color-text-muted);background:var(--color-card)}
.slot-chips span.on{color:var(--color-accent);border-color:var(--color-accent-line);background:var(--color-accent-soft)}
.slot-chips i{font-style:normal;font-family:var(--font-num);font-size:10px;font-weight:700}
.empty-state{padding:32px 20px 28px;text-align:center}
.empty-mark{width:46px;height:46px;margin:0 auto 12px;border-radius:14px;display:grid;place-items:center;background:var(--color-accent-soft);color:var(--color-accent);box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.empty-state p{font-size:13.5px;color:var(--color-ink);margin:0 0 5px;font-weight:600}
.empty-state small{font-size:12px;color:var(--color-text-muted);line-height:1.7}
.log-list{list-style:none;margin:0;padding:8px 18px 14px;display:grid}
.log{display:flex;gap:10px;border-top:1px dashed var(--color-divider);min-width:0}
.log:first-child{border-top:0}
.log-dot{width:7px;height:7px;border-radius:50%;background:var(--color-accent);flex:none;margin-top:21px}
.log-main{flex:1;min-width:0;padding:13px 0}
.log-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.log-time{font-family:var(--font-num);font-size:12.5px;font-weight:600;color:var(--color-ink);font-variant-numeric:tabular-nums}
.type-tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:var(--color-accent-soft);color:var(--color-accent);font-size:11px;font-weight:700;box-shadow:inset 0 0 0 1px var(--color-accent-line)}
.log-source{font-size:10.5px;color:var(--color-text-muted)}
.low-flag{font-size:10px;font-weight:600;color:var(--color-caution);background:var(--color-caution-soft);padding:2px 7px;border-radius:5px;white-space:nowrap}
.head-spacer{flex:1;min-width:8px}
.log-actions{display:flex;gap:2px;flex-wrap:wrap}
.log-actions button{font-family:inherit;font-size:11.5px;color:var(--color-text-secondary);padding:4px 7px;border-radius:6px;transition:color var(--motion-fast),background var(--motion-fast)}
.log-actions button:hover{background:var(--color-neutral-soft);color:var(--color-ink)}
.log-actions button.danger:hover{background:var(--color-danger-soft);color:var(--color-danger)}
.log-body{display:flex;gap:11px;align-items:flex-start;margin-top:9px;min-width:0}
.meal-photo{flex:none;width:88px;margin:0;display:grid;gap:3px}
.meal-photo img{width:88px;height:88px;object-fit:cover;border-radius:10px;background:var(--color-divider);box-shadow:inset 0 0 0 1px rgba(21,24,27,.06)}
.meal-photo figcaption{font-size:9px;line-height:1.4;color:var(--color-text-muted);text-align:center}
.food-block{flex:1;min-width:0;margin-top:0}
.food-block-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:3px}
.food-block-head .detail-label{margin-bottom:0}
.food-count{font-family:var(--font-num);font-size:10.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.food-rows{list-style:none;margin:0;padding:0;display:grid}
.food-rows li{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:8px 0;border-top:1px dashed var(--color-divider);font-size:12.5px;line-height:1.5}
.food-rows li:first-child{border-top:0}
.f-name{font-weight:600;color:var(--color-ink);overflow-wrap:anywhere;min-width:0}
.f-cat{font-size:10.5px;color:var(--color-text-muted);white-space:nowrap}
.f-portion{font-family:var(--font-num);font-size:11px;color:var(--color-text-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.f-conf{font-family:var(--font-num);font-size:10px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);padding:2px 6px;border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums}
.f-conf.low{color:var(--color-caution);background:var(--color-caution-soft);box-shadow:inset 0 0 0 1px rgba(138,90,0,.18)}
.f-flag{font-size:10px;font-weight:600;color:var(--color-caution);border:1px solid rgba(138,90,0,.28);padding:1px 6px;border-radius:4px;white-space:nowrap}
.food-rows li.unsure{background:linear-gradient(90deg,var(--color-caution-soft),transparent 72%);margin:0 -6px;padding-left:6px;padding-right:6px;border-radius:6px}
.log-detail{margin-top:12px;padding-top:12px;border-top:1px solid var(--color-divider);display:grid;gap:12px}
.detail-grid{display:grid;grid-template-columns:1.2fr 1.1fr .8fr;gap:16px}
.detail-label{display:block;font-family:var(--font-num);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:5px}
.detail-grid p{font-size:12px;line-height:1.65;color:var(--color-text-secondary);margin:0 0 5px}
.detail-grid p:last-child{margin-bottom:0}
.detail-grid .warn{color:var(--color-caution)}
.detail-grid .muted,.muted{color:var(--color-text-muted);font-size:12px;line-height:1.7}
.energy-line{font-variant-numeric:tabular-nums}
.type-edit{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.type-edit select{padding:8px 10px;border:1px solid var(--color-border);border-radius:9px;font-size:12.5px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.type-edit span{font-size:10.5px;color:var(--color-text-muted)}
.side-col{display:grid;gap:14px;align-content:start;min-width:0}
.side-head h2{font-size:16px;margin:5px 0 0}
.cov-big{display:flex;align-items:baseline;gap:5px;margin-top:12px}
.cov-big b{font-family:var(--font-num);font-size:40px;line-height:1;letter-spacing:-.045em;color:var(--color-ink)}
.cov-big span{font-size:12px;color:var(--color-text-muted)}
.cov-list{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}
.cov-list li{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--color-text-muted)}
.cov-list li i{width:7px;height:7px;border-radius:2px;box-shadow:inset 0 0 0 1px var(--hair-strong);flex:none}
.cov-list li.on{color:var(--color-text-secondary)}
.cov-list li.on i{background:var(--color-accent);box-shadow:none}
.cov-list li span{margin-left:auto;font-size:10px;color:var(--color-text-muted)}
.side-note{font-size:11px;line-height:1.7;color:var(--color-text-muted);margin:13px 0 0}
.side-link{display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:11.5px;font-weight:600;color:var(--color-accent)}
.side-link:hover{text-decoration:underline}
.howto h2{font-size:16px;margin:5px 0 0}
.howto ol{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:9px;counter-reset:step}
.howto li{display:flex;align-items:baseline;gap:8px;counter-increment:step;font-size:12px;color:var(--color-text-secondary)}
.howto li::before{content:counter(step);font-family:var(--font-num);font-size:10px;font-weight:700;color:var(--color-accent);width:17px;height:17px;border-radius:50%;display:grid;place-items:center;background:var(--color-accent-soft);flex:none;align-self:center}
.howto small{font-size:10.5px;color:var(--color-text-muted);margin-left:auto}

/* ——— 时间线与说明 ——— */
.timeline{margin-top:14px}
.tl{list-style:none;margin:12px 0 0;padding:0 18px 16px;display:grid;gap:2px}
.tl li{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px dashed var(--color-divider)}
.tl li:last-child{border-bottom:0}
.tl-time{font-family:var(--font-num);font-size:11.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums;min-width:44px}
.tl-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex:none}
.tl li.meal .tl-dot{background:var(--color-accent)}
.tl li.train .tl-dot{background:transparent;box-shadow:inset 0 0 0 2px var(--color-accent-strong)}
.tl-body{flex:1}
.tl-body strong,.tl-body small{display:block}
.tl-body strong{font-size:13.5px;color:var(--color-ink)}
.tl-body small{font-size:11.5px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.tl-note{font-size:12px;color:var(--color-text-muted);margin:6px 18px 0;line-height:1.65}
.rules{margin-top:14px}
.lims{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.lims li{position:relative;padding-left:16px;font-size:12px;color:var(--color-text-secondary);line-height:1.7}
.lims li::before{content:'·';position:absolute;left:2px;top:-1px;color:var(--color-accent);font-weight:700;font-size:16px}
.ver{font-size:11px;color:var(--color-text-muted);margin:10px 0 0}

@media(max-width:1099px){
  .day-grid{grid-template-columns:1fr}
  .side-col{grid-template-columns:1fr 1fr}
  .detail-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:767px){
  .lede{flex-direction:column;align-items:stretch;gap:12px;padding:14px 0 12px}
  .lede h1{font-size:28px}
  .lede-r{padding-bottom:0}
  .capture-hero{flex-direction:column;align-items:stretch;gap:16px;padding:18px}
  .hero-act{min-width:0}
  .card-head{padding:14px 14px 0;flex-direction:column;align-items:stretch;gap:8px}
  .log-list{padding:6px 14px 12px}
  .log{gap:8px}
  .head-spacer{display:none}
  .log-actions{width:100%;margin-left:0;justify-content:flex-start;border-top:1px dashed var(--color-divider);padding-top:4px;margin-top:2px}
  .meal-photo{width:72px}
  .meal-photo img{width:72px;height:72px}
  .detail-grid{grid-template-columns:1fr;gap:12px}
  .side-col{grid-template-columns:1fr}
  .tl{padding:10px 14px 14px}
  .tl-note{margin:6px 14px 0}
  .cov-list{grid-template-columns:1fr 1fr}
}
</style>
