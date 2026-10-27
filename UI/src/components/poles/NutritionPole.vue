<template>
  <PoleShell
    pole="nutrition"
    title="饮食"
    eyebrow="右极 · NUTRITION"
    :chip="mealChip"
    :chip-tone="mealChipTone"
    :tabs="tabs"
    :model-value="tab"
    tabs-label="饮食视图"
    @update:model-value="setTab"
    @open-bridge="emit('open-bridge')"
  >
    <template #lead>
      <span class="lead-k">{{ kicker }}</span>
      <h3 v-if="dayFacts.recordedSlots">
        已记录 <em>{{ dayFacts.recordedSlots }}</em><span class="unit">/ 3 餐</span>
      </h3>
      <h3 v-else>今天还没有记录</h3>
      <p v-if="dayFacts.recordedSlots">
        覆盖 {{ dayFacts.coverage.length }}/8 类<template v-if="dayFacts.missing.length"> · 还缺 {{ dayFacts.missing.length }} 类</template><template v-else> · 八类都出现过</template>
      </p>
      <p v-else>拍一张或手动补录；只记录结构与类别，不评价吃法。</p>
    </template>

    <template #actions>
      <BaseButton size="sm" :icon="Camera" @click="openCapture('capture')">记录饮食</BaseButton>
      <button type="button" class="text-action" @click="openCapture('manual')">手动补录</button>
      <RouterLink to="/meals" class="text-action">完整记录</RouterLink>
    </template>

    <!-- ——— 今日 ——— -->
    <section
      v-if="tab === 'today'"
      id="nutrition-panel-today"
      class="panel"
      role="tabpanel"
      aria-labelledby="nutrition-tab-today"
    >
      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">今天的三餐</span>
          <span class="head-meta">{{ summary.recorded }}/3 餐 · {{ summary.coverage.length }}/8 类</span>
        </div>

        <div class="slots">
          <div v-for="slot in slotRows" :key="slot.id" class="slot" :class="{ filled: slot.meal }">
            <span class="slot-time">{{ slot.time }}</span>
            <ShapeState :state="slot.state" :label="`${slot.label}：${slot.stateText}`" />
            <div class="slot-main">
              <strong>{{ slot.label }}</strong>
              <small>{{ slot.text }}</small>
            </div>
            <button type="button" class="slot-act" @click="openCapture('capture', slot.id)">
              {{ slot.meal ? '再记' : '记一笔' }}
            </button>
          </div>
        </div>
        <p v-if="dayFacts.snackCount" class="fine-line">另有 {{ dayFacts.snackCount }} 次加餐记录；加餐不计入 3 餐。</p>
      </BaseCard>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">今日类别覆盖</span>
          <span class="head-meta">{{ summary.coverage.length }}/8 类</span>
        </div>
        <ul class="cov-grid">
          <li v-for="row in coverageRows" :key="row.name" :class="{ on: row.present }">
            <i aria-hidden="true"></i>{{ row.name }}<span>{{ row.present ? '已出现' : '未出现' }}</span>
          </li>
        </ul>
        <p class="fine-line">只统计类别是否出现过，不判断分量、烹调方式与油盐糖；未记录不代表没吃。</p>
      </BaseCard>

      <div class="metric-grid">
        <div class="metric">
          <span class="micro">完整记录</span>
          <b>{{ summary.completeCount }}</b><small>条</small>
        </div>
        <div class="metric">
          <span class="micro">部分记录</span>
          <b>{{ summary.partialCount }}</b><small>条</small>
        </div>
        <div class="metric">
          <span class="micro">加餐</span>
          <b>{{ summary.snackCount }}</b><small>次</small>
        </div>
      </div>

      <div v-if="records.length" class="latest">
        <span class="micro">最近一条</span>
        <p>{{ latestText }}</p>
        <button type="button" class="text-action" @click="tab = 'log'">看全部记录 <ArrowRight :size="12" /></button>
      </div>
      <p v-else class="fine-line">今天还没有餐食记录；空着是合法状态，想起来再记一笔也行。</p>
    </section>

    <!-- ——— 本周 ——— -->
    <section
      v-else-if="tab === 'week'"
      id="nutrition-panel-week"
      class="panel"
      role="tabpanel"
      aria-labelledby="nutrition-tab-week"
    >
      <div class="metric-grid">
        <div class="metric">
          <span class="micro">有记录天数</span>
          <b>{{ weekRecordedDays }}<em>/7</em></b><small>天</small>
        </div>
        <div class="metric">
          <span class="micro">餐次</span>
          <b>{{ weekReport.totalMeals }}</b><small>条</small>
        </div>
        <div class="metric">
          <span class="micro">完整记录</span>
          <b>{{ weekReport.completeMeals }}</b><small>条</small>
        </div>
      </div>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">本周记录分布</span>
          <span class="head-meta">{{ weekCoverageCount }}/8 类</span>
        </div>
        <div class="week-rail">
          <div
            v-for="(cell, i) in weekCells"
            :key="cell.iso"
            class="day"
            :class="{ on: cell.isToday, recorded: cell.meals > 0 }"
          >
            <span class="wd">{{ WEEK_LABELS[i] }}</span>
            <b>{{ cell.day }}</b>
            <span class="day-dots" aria-hidden="true">
              <i v-for="n in Math.min(cell.meals, 3)" :key="n"></i>
            </span>
            <small>{{ cell.meals ? `${cell.meals} 条` : '未记' }}</small>
          </div>
        </div>
        <p class="fine-line">圆点数量 = 当天记录条数（最多显示 3 个）；未记录的日子保持空白，不当作 0。</p>
      </BaseCard>

      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">本周类别出现次数</span>
          <RouterLink to="/report" class="head-link">看周报 <ArrowRight :size="12" /></RouterLink>
        </div>
        <ul class="cat-rows">
          <li v-for="row in categoryRows" :key="row.name" :class="{ none: !row.count }">
            <span class="cat-name">{{ row.name }}</span>
            <span class="cat-cells" aria-hidden="true"><i v-for="n in 4" :key="n" :class="{ f: n <= row.level }"></i></span>
            <span class="cat-count">{{ row.count || '—' }}</span>
          </li>
        </ul>
        <p class="fine-line">出现次数按记录条目累计，不代表分量或营养摄入量；出现得少不等于吃得不对。</p>
      </BaseCard>

      <p class="fine-line">饮食记录只存这台设备；没有记录不等于没吃。</p>
    </section>

    <!-- ——— 记录 ——— -->
    <section
      v-else
      id="nutrition-panel-log"
      class="panel"
      role="tabpanel"
      aria-labelledby="nutrition-tab-log"
    >
      <BaseCard variant="flush" class="block">
        <div class="block-head">
          <span class="micro">最近餐食</span>
          <span class="head-meta">{{ store.meals.length }} 条</span>
        </div>

        <ul v-if="recentMeals.length" class="meal-list">
          <li v-for="meal in recentMeals" :key="meal.id">
            <button
              v-if="meal.photoThumb"
              type="button"
              class="meal-thumb"
              :aria-label="`查看${meal.items.map(i => i.foodName).join('、') || '这次记录'}的照片`"
              @click="openPhoto(meal)"
            >
              <img :src="meal.photoThumb" alt="" />
            </button>
            <span v-else class="meal-thumb empty" aria-hidden="true"><Utensils :size="16" /></span>

            <div class="meal-main">
              <div class="meal-line">
                <span class="meal-time">{{ meal.time }}</span>
                <span class="meal-type">{{ mealTypeLabel(meal.mealType) }}</span>
                <span class="meal-date">{{ weekLabel(meal.date) }}</span>
              </div>
              <strong>{{ mealNames(meal) }}</strong>
              <small>
                {{ meal.items.length }} 项 · {{ meal.completeness === 'complete' ? '完整记录' : '部分记录' }}
                <template v-if="meal.items.some(i => i.source === 'photo')"> · 照片识别</template>
              </small>
            </div>
          </li>
        </ul>

        <div v-else class="empty">
          <span class="empty-ic"><Utensils :size="17" /></span>
          <div>
            <strong>还没有餐食记录</strong>
            <p>拍照或手动补录后会出现在这里；没有记录不等于没吃。</p>
          </div>
        </div>
      </BaseCard>

      <div class="inline-actions">
        <BaseButton size="sm" :icon="Camera" @click="openCapture('capture')">记录饮食</BaseButton>
        <button type="button" class="text-action" @click="openCapture('manual')">手动补录</button>
      </div>
      <p class="fine-line">饮食结构只按类别判断；热量粗估默认关闭，可在设置里主动开启。</p>
    </section>

    <template #foot>
      <span class="foot-mark"><PoleMark pole="movement" :size="20" /></span>
      <div class="foot-copy">
        <span class="micro">另一极 · 运动</span>
        <small>{{ movementLine }}</small>
      </div>
      <button type="button" class="foot-btn" @click="emit('focus-other')">
        去看看 <ArrowRight :size="13" />
      </button>
    </template>
  </PoleShell>

  <FoodCaptureDialog
    :open="captureOpen"
    :date="today"
    :initial-view="captureView"
    :initial-meal-type="captureMealType"
    @close="captureOpen = false"
    @saved="onSaved"
  />
  <MealPhotoViewer
    :open="!!photoViewer"
    :photo-id="photoViewer?.photoId"
    :fallback="photoViewer?.fallback"
    :label="photoViewer?.label || ''"
    @close="photoViewer = null"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, Camera, Utensils } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import ShapeState from '@/components/common/ShapeState.vue'
import FoodCaptureDialog from '@/components/meals/FoodCaptureDialog.vue'
import MealPhotoViewer from '@/components/meals/MealPhotoViewer.vue'
import PoleMark from './PoleMark.vue'
import PoleShell from './PoleShell.vue'
import { useAppStore } from '@/stores/app'
import type { DayFacts } from '@/services/bridgeRules'
import {
  FOOD_CATEGORIES,
  MEAL_SLOTS,
  mealTypeLabel,
  summarizeDay
} from '@/services/mealRules'
import { buildWeeklyReport, WEEK_LABELS, weekDates, weekStart } from '@/services/weekRules'
import { eyebrowDate, shortDate, toISODate } from '@/utils/time'
import type { Meal, MealType } from '@/types/domain'

type View = 'today' | 'week' | 'log'

const props = defineProps<{
  /** 另一极今天的实际记录，用来写脚注里的"另一极"摘要 */
  movement: DayFacts
  /** 本周有运动记录的天数 */
  movementWeekDays: number
}>()

const emit = defineEmits<{
  (e: 'focus-other'): void
  (e: 'open-bridge'): void
}>()

const store = useAppStore()
const now = new Date()
const today = toISODate(now)
const tab = ref<View>('today')

const tabs = [
  { id: 'today', label: '今日' },
  { id: 'week', label: '本周' },
  { id: 'log', label: '记录' }
]

const summary = computed(() => summarizeDay(store.meals, today))
const dayFacts = computed(() => ({
  recordedSlots: new Set(
    store.meals
      .filter(m => m.date === today && m.mealType !== 'snack')
      .map(m => m.mealType)
  ).size,
  coverage: summary.value.coverage,
  missing: summary.value.missing,
  snackCount: summary.value.snackCount
}))
const records = computed(() => store.meals
  .filter(m => m.date === today)
  .slice()
  .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt)))

const kicker = computed(() => `${eyebrowDate(now)} · ${store.isAthleteMode ? '周期营养' : '饮食结构'}`)

const mealChip = computed(() => `${dayFacts.value.recordedSlots} / 3 餐`)
const mealChipTone = computed<'' | 'ok' | 'part'>(() => {
  if (dayFacts.value.recordedSlots >= 3) return 'ok'
  return dayFacts.value.recordedSlots > 0 ? 'part' : ''
})

const slotRows = computed(() => summary.value.slots.map(slot => {
  const meta = MEAL_SLOTS.find(m => m.id === slot.id)
  const items = slot.meal?.items ?? []
  const complete = slot.meal?.completeness === 'complete'
  return {
    id: slot.id,
    label: slot.label,
    meal: slot.meal,
    time: slot.meal?.time || meta?.defaultTime || '—',
    state: (!slot.meal ? 'none' : complete ? 'complete' : 'partial') as 'complete' | 'partial' | 'none',
    stateText: !slot.meal ? '未记录' : complete ? '记录完整' : '部分记录',
    text: items.length
      ? items.map(item => item.foodName).join(' · ')
      : (slot.meal ? '已记录，条目待补' : '未记录')
  }
}))
const coverageRows = computed(() => FOOD_CATEGORIES.slice(0, 8).map(name => ({
  name,
  present: summary.value.coverage.includes(name)
})))

const weekReport = computed(() => buildWeeklyReport(store.sessions, store.meals, now, {
  profile: store.userProfile,
  mode: store.currentMode
}))
const weekCells = computed(() => weekDates(weekStart(now)).map(d => {
  const iso = toISODate(d)
  const dayMeals = store.meals.filter(m => m.date === iso)
  return {
    iso,
    day: d.getDate(),
    isToday: iso === today,
    meals: dayMeals.length
  }
}))
const weekRecordedDays = computed(() => weekCells.value.filter(cell => cell.meals > 0).length)
const weekCoverageCount = computed(() =>
  FOOD_CATEGORIES.slice(0, 8).filter(category => (weekReport.value.categoryCoverage[category] ?? 0) > 0).length
)
const categoryRows = computed(() => {
  const coverage = weekReport.value.categoryCoverage
  const max = Math.max(1, ...FOOD_CATEGORIES.slice(0, 8).map(c => coverage[c] ?? 0))
  return FOOD_CATEGORIES.slice(0, 8).map(name => {
    const count = coverage[name] ?? 0
    return { name, count, level: count ? Math.max(1, Math.round((count / max) * 4)) : 0 }
  })
})

const latest = computed(() => records.value[records.value.length - 1] ?? null)
const latestText = computed(() => {
  const meal = latest.value
  if (!meal) return ''
  return `${meal.time} · ${mealTypeLabel(meal.mealType)} · ${meal.items.map(i => i.foodName).join('、') || '条目待补'}`
})

const recentMeals = computed(() => [...store.meals]
  .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
  .slice(0, 8))

const movementLine = computed(() => {
  const m = props.movement
  const todayText = m.sessions > 0
    ? `今天 ${m.sessionMinutes} 分钟`
    : '今天还没记录'
  return `${todayText} · 本周 ${props.movementWeekDays} 天有训练记录`
})

// ——— 记录 / 照片 ———
const captureOpen = ref(false)
const captureView = ref<'capture' | 'manual'>('capture')
const captureMealType = ref<MealType | null>(null)
const photoViewer = ref<{ photoId?: string; fallback?: string; label: string } | null>(null)

function setTab(value: string) {
  if (value === 'today' || value === 'week' || value === 'log') tab.value = value
}

function openCapture(view: 'capture' | 'manual', mealType: MealType | null = null) {
  captureView.value = view
  captureMealType.value = mealType
  captureOpen.value = true
}

function onSaved(_meal: Meal) {
  captureOpen.value = false
  captureMealType.value = null
  tab.value = 'today'
}

function openPhoto(meal: Meal) {
  photoViewer.value = {
    photoId: meal.photoId,
    fallback: meal.photoThumb,
    label: meal.items.map(i => i.foodName).join('、') || '这次记录'
  }
}

function mealNames(meal: Meal) {
  return meal.items.map(item => item.foodName).join('、') || '条目待补'
}

function weekLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return `${shortDate(d)}`
}
</script>

<style scoped>
.panel {
  display: grid;
  gap: 10px;
}
.block {
  min-width: 0;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 14px 9px;
  border-bottom: 1px solid var(--hair-soft);
}
.head-meta {
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.head-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--pole-color);
  white-space: nowrap;
}

/* ——— 餐次 ——— */
.slots {
  padding: 2px 14px 4px;
}
.slot {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--color-divider);
}
.slot:last-child {
  border-bottom: 0;
}
.slot-time {
  flex: none;
  width: 34px;
  font-family: var(--font-num);
  font-size: 10.5px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.slot-main {
  flex: 1;
  min-width: 0;
}
.slot-main strong {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--color-ink);
}
.slot-main small {
  display: block;
  margin-top: 1px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-act {
  flex: none;
  min-height: 30px;
  padding: 0 9px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.slot-act:hover {
  border-color: var(--pole-color);
  color: var(--pole-color);
}
.slot.filled .slot-act {
  border-color: var(--pole-line);
  color: var(--pole-strong);
  background: var(--pole-soft);
}

.cov-grid {
  list-style: none;
  margin: 0;
  padding: 9px 14px 4px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}
.cov-grid li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
}
.cov-grid li i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--hair-strong);
  flex: none;
}
.cov-grid li.on {
  color: var(--color-text-secondary);
}
.cov-grid li.on i {
  background: var(--pole-color);
  box-shadow: none;
}
.cov-grid li span {
  margin-left: auto;
  font-size: 9.5px;
  color: var(--color-text-muted);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  overflow: hidden;
}
.metric {
  padding: 10px 12px 11px;
  min-width: 0;
}
.metric + .metric {
  border-left: 1px solid var(--hair-soft);
}
.metric b {
  display: block;
  margin-top: 5px;
  font-family: var(--font-num);
  font-size: 25px;
  line-height: 1;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.metric b em {
  font-style: normal;
  font-size: 13px;
  color: var(--color-text-muted);
}
.metric small {
  display: block;
  margin-top: 3px;
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
}

.latest {
  display: grid;
  gap: 4px;
  padding: 10px 14px;
  border: 1px dashed var(--pole-line);
  border-radius: var(--radius-lg);
  background: var(--pole-soft);
}
.latest p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.latest .text-action {
  justify-self: start;
  min-height: 28px;
  padding: 0;
}

/* ——— 本周 ——— */
.week-rail {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
  padding: 9px 12px 6px;
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 2px 5px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--color-text-secondary);
}
.day.on {
  background: var(--pole-soft);
  border-color: var(--pole-line);
}
.day.on b {
  color: var(--pole-color);
}
.day b {
  font-family: var(--font-num);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.wd,
.day small {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
}
.day-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 5px;
}
.day-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--pole-line);
}
.day.recorded .day-dots i {
  background: var(--pole-color);
}

.cat-rows {
  list-style: none;
  margin: 0;
  padding: 9px 14px 4px;
  display: grid;
  gap: 6px;
}
.cat-rows li {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}
.cat-name {
  font-size: 11.5px;
  color: var(--color-text-secondary);
}
.cat-cells {
  display: flex;
  gap: 3px;
}
.cat-cells i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px var(--hair-strong);
}
.cat-cells i.f {
  background: var(--pole-color);
  box-shadow: none;
}
.cat-count {
  font-family: var(--font-num);
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.cat-rows li.none .cat-name {
  color: var(--color-text-muted);
}

/* ——— 记录 ——— */
.meal-list {
  list-style: none;
  margin: 0;
  padding: 0 14px;
}
.meal-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--color-divider);
}
.meal-list li:last-child {
  border-bottom: 0;
}
.meal-thumb {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-neutral-soft);
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
}
.meal-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.meal-thumb.empty {
  box-shadow: inset 0 0 0 1px var(--hair-soft);
}
.meal-main {
  flex: 1;
  min-width: 0;
}
.meal-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.meal-time {
  font-family: var(--font-num);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}
.meal-type {
  font-size: 10px;
  font-weight: 600;
  color: var(--pole-strong);
  background: var(--pole-soft);
  border-radius: 4px;
  padding: 1px 5px;
}
.meal-date {
  font-family: var(--font-num);
  font-size: 9.5px;
  color: var(--color-text-muted);
}
.meal-main strong {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meal-main small {
  display: block;
  margin-top: 1px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.empty {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
}
.empty-ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--radius-sm);
  background: var(--pole-soft);
  color: var(--pole-color);
}
.empty strong {
  display: block;
  font-size: 13px;
  color: var(--color-ink);
}
.empty p {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 2px 2px 0;
}
.fine-line {
  margin: 0;
  padding: 2px 2px 0;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 32px;
  padding: 0 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--pole-color);
  white-space: nowrap;
}
.text-action:hover {
  text-decoration: underline;
}

/* ——— 脚注 ——— */
.foot-mark {
  flex: none;
  display: grid;
  place-items: center;
}
.foot-copy {
  flex: 1;
  min-width: 0;
}
.foot-copy .micro {
  display: block;
  color: var(--color-text-muted);
}
.foot-copy small {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 30px;
  padding: 0 9px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.foot-btn:hover {
  border-color: var(--pole-color);
  color: var(--pole-color);
}

@media (max-width: 767px) {
  .metric b { font-size: 22px; }
  .week-rail { padding: 8px 6px 4px; }
  .day b { font-size: 12px; }
  .block-head { padding-left: 11px; padding-right: 11px; }
  .slots, .cov-grid, .cat-rows, .meal-list { padding-left: 11px; padding-right: 11px; }
  .cov-grid { gap: 5px 8px; }
}
</style>
