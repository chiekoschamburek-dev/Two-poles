<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">MEAL LOG · {{ dateLabel }}</span>
        <h1>今天吃了什么，记个大概就好</h1>
        <p>{{ showEstimate ? '只做结构记录（出现过哪些类别）；热量是按演示参考值算的区间粗估，不评价吃得多不多。' : '只做结构记录（出现过哪些类别），不估算热量，也不评价吃得多不多。' }}</p>
      </div>
      <StatusBadge :variant="summary.recorded === summary.planned ? 'success' : summary.recorded ? 'warning' : 'neutral'">
        {{ summary.recorded }} / {{ summary.planned }} 餐已记录
      </StatusBadge>
    </div>

    <div class="strip animate-slide-in-up" aria-live="polite">
      <div class="strip-item"><span>类别覆盖</span><b>{{ summary.coverage.length }} / 8</b></div>
      <div class="strip-item"><span>完整记录</span><b>{{ summary.completeCount }} 餐</b></div>
      <div class="strip-item"><span>部分记录</span><b>{{ summary.partialCount }} 餐</b></div>
      <div class="strip-item"><span>加餐</span><b>{{ summary.snackCount }} 次</b></div>
      <div class="strip-bar"><i :style="{ width: (summary.coverage.length / 8) * 100 + '%' }"></i></div>
    </div>

    <div class="slots">
      <BaseCard
        v-for="slot in summary.slots"
        :key="slot.id"
        class="slot animate-slide-in-up"
        :class="{ opening: draft?.slot === slot.id }"
      >
        <div class="slot-head">
          <h3>{{ slot.label }}</h3>
          <StatusBadge v-if="draft?.slot === slot.id" variant="info">记录中</StatusBadge>
          <StatusBadge v-else-if="slot.meal" :variant="slot.meal.completeness === 'complete' ? 'success' : 'warning'">
            {{ slot.meal.completeness === 'complete' ? '完整记录' : '部分记录' }}
          </StatusBadge>
          <StatusBadge v-else variant="neutral">未记录</StatusBadge>
        </div>

        <MealForm
          v-if="draft && draft.slot === slot.id"
          :label="slot.label"
          :initial-time="draft.time"
          :initial-items="draft.items"
          :show-estimate="showEstimate"
          @save="onSave"
          @cancel="draft = null"
        />

        <template v-else-if="slot.meal">
          <p class="meal-time">{{ slot.meal.time }} · {{ slot.meal.items.length }} 项</p>
          <ul class="items">
            <li v-for="item in slot.meal.items" :key="item.id">
              <span class="iname">{{ item.foodName }}</span>
              <span v-if="item.source === 'photo'" class="badge-photo">照片 {{ Math.round((item.photoConfidence ?? 0) * 100) }}%</span>
              <span class="icat">{{ item.category }}</span>
              <span class="ipart">{{ item.portionSize ? item.portionSize + (item.portionUnit || '') : '份量未填' }}</span>
            </li>
          </ul>
          <div class="analysis" v-if="slot.meal.analysis">
            <p><strong>本餐出现过的类别</strong><span class="cats">{{ slot.meal.analysis.categoryCoverage.join('、') || '仅"其他/油脂"，未落入 8 类' }}</span></p>
            <p v-if="slot.meal.analysis.unknownItems.length"><strong>类别待确认</strong><span>{{ slot.meal.analysis.unknownItems.join('、') }}</span></p>
            <p v-if="slot.meal.analysis.missingCategories.length"><strong>记完这餐后今天仍缺</strong><span>{{ slot.meal.analysis.missingCategories.join('、') }}</span></p>
            <p v-if="mealEnergy(slot.meal)"><strong>热量粗估</strong><span>{{ mealEnergy(slot.meal) }}</span></p>
            <p v-if="slot.meal.completeness === 'partial'" class="warn">份量没填全，所以这条记为"部分记录"，不会被当成完整一餐。</p>
          </div>
          <div class="slot-actions">
            <BaseButton variant="ghost" size="sm" @click="startEdit(slot.meal)">补记 / 修改</BaseButton>
            <BaseButton variant="secondary" size="sm" :icon="Trash2" @click="remove(slot.meal.id)">删除</BaseButton>
          </div>
        </template>

        <div v-else class="empty">
          <p>{{ slot.label === '晚餐' ? '晚餐还没记。没记只表示"未记录"，不代表没吃。' : `还没记录${slot.label}。` }}</p>
          <BaseButton size="sm" :icon="Plus" @click="startAdd(slot.id)">记录{{ slot.label }}</BaseButton>
        </div>
      </BaseCard>
    </div>

    <BaseCard class="snacks animate-slide-in-up">
      <div class="slot-head">
        <h3>加餐</h3>
        <StatusBadge v-if="draft?.slot === 'snack'" variant="info">记录中</StatusBadge>
        <BaseButton v-else variant="ghost" size="sm" :icon="Plus" @click="startAdd('snack')">添加加餐</BaseButton>
      </div>
      <MealForm
        v-if="draft && draft.slot === 'snack'"
        label="加餐"
        :initial-time="draft.time"
        :initial-items="draft.items"
        :show-estimate="showEstimate"
        @save="onSave"
        @cancel="draft = null"
      />
      <ul v-else-if="snacks.length" class="items">
        <li v-for="meal in snacks" :key="meal.id">
          <span class="iname">{{ meal.time }}</span>
          <span class="icat">{{ meal.items.map(i => i.foodName).join('、') }}</span>
          <button class="mini-del" :aria-label="`删除 ${meal.time} 的加餐`" @click="remove(meal.id)"><Trash2 :size="15" /></button>
        </li>
      </ul>
      <p v-else class="muted">今天没有记录加餐。不记录也是合法状态。</p>
    </BaseCard>

    <BaseCard v-if="store.isAthleteMode" class="timeline animate-slide-in-up">
      <div class="slot-head">
        <div><span class="eyebrow">TRAINING DAY TIMELINE</span><h3>训练日用餐时间线</h3></div>
        <StatusBadge :variant="timeline.length ? 'info' : 'neutral'">{{ timeline.length ? `${timeline.length} 个事件` : '今天没有记录' }}</StatusBadge>
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
      <p class="ver">规则版本 {{ RULE_VERSION }} · 是否含营养估算：{{ hasEstimateToday ? '是（区间粗估，来源见上）' : '否' }} · 数据仅存本机浏览器</p>
    </InsightCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, Trash2, Sparkles } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import InsightCard from '@/components/common/InsightCard.vue'
import MealForm from '@/components/meals/MealForm.vue'
import { useAppStore } from '@/stores/app'
import type { Meal, MealDraft } from '@/types/domain'
import { buildLimitations, MEAL_SLOTS, RULE_VERSION, summarizeDay } from '@/services/mealRules'
import { shortDate, toISODate } from '@/utils/time'

const store = useAppStore()

const now = new Date()
const date = toISODate(now)
const dateLabel = shortDate(now)
const summary = computed(() => summarizeDay(store.meals, date))
const snacks = computed(() => store.meals.filter(m => m.date === date && m.mealType === 'snack'))
const showEstimate = computed(() => store.privacy.showEnergyEstimate)
/** 免责清单要跟今天实际出的数一致，不能无论有没有估算都写"没有热量估算" */
const hasEstimateToday = computed(() => store.meals.some(m => m.date === date && (m.analysis?.estimateRefs?.length ?? 0) > 0))
const limitations = computed(() => buildLimitations(hasEstimateToday.value))

/** 训练日时间线：把已记录的餐次与训练按时间排在一起（距离按文档口径存米、显示可转换） */
const timeline = computed(() => {
  const slotLabel = (t: Meal['mealType']) => MEAL_SLOTS.find(s => s.id === t)?.label ?? '加餐'
  const completenessText = (c: Meal['completeness']) => (c === 'complete' ? '完整记录' : c === 'partial' ? '部分记录' : '未记完整')
  const rows = [
    ...store.meals.filter(m => m.date === date).map(m => ({
      key: `meal-${m.id}`,
      kind: 'meal' as const,
      time: m.time,
      title: slotLabel(m.mealType),
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

/** 表单就地展开在 draft.slot 那张卡里；同一时刻最多一个 */
const draft = ref<{ slot: Meal['mealType']; time: string; items: MealDraft[]; replacesId: string | null } | null>(null)

function blankRow(): MealDraft {
  return { foodName: '', category: '其他', portionSize: '', portionUnit: '碗' }
}

function defaultTime(type: Meal['mealType']) {
  const slot = MEAL_SLOTS.find(s => s.id === type)
  if (slot) return slot.defaultTime
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function startAdd(type: Meal['mealType']) {
  draft.value = { slot: type, time: defaultTime(type), items: [blankRow()], replacesId: null }
}

function startEdit(meal: Meal) {
  draft.value = {
    slot: meal.mealType,
    time: meal.time,
    items: meal.items.map(i => ({
      foodName: i.foodName,
      category: i.category,
      portionSize: i.portionSize ?? '',
      portionUnit: i.portionUnit ?? '碗',
      source: i.source,
      photoConfidence: i.photoConfidence
    })),
    replacesId: meal.id
  }
}

function onSave(value: { time: string; items: MealDraft[] }) {
  if (!draft.value) return
  const { slot, replacesId } = draft.value
  if (replacesId) store.meals = store.meals.filter(m => m.id !== replacesId)
  store.addMeal({
    date,
    mealType: slot,
    time: value.time,
    items: value.items.map(i => ({
      foodName: i.foodName,
      category: i.category,
      portionSize: i.portionSize === '' ? undefined : Number(i.portionSize),
      portionUnit: i.portionUnit || undefined,
      source: i.source ?? 'manual',
      photoConfidence: i.photoConfidence
    }))
  })
  draft.value = null
}

function remove(mealId: string) {
  if (draft.value?.replacesId === mealId) draft.value = null
  store.removeMeal(mealId)
}

function mealEnergy(meal: Meal) {
  const refs = meal.analysis?.estimateRefs ?? []
  if (!refs.length) return ''
  const low = refs.reduce((s, r) => s + r.low, 0)
  const high = refs.reduce((s, r) => s + r.high, 0)
  const rest = meal.items.length - refs.length
  return `${low}–${high} kcal（${refs.length}/${meal.items.length} 项可估${rest > 0 ? '，其余是混合菜或缺份量' : ''}）· 依据 ${refs[0].basis} · ${refs[0].source}`
}
</script>

<style scoped>
.page-wrap{max-width:var(--content-max-width);margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:28px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0;max-width:620px;line-height:1.7}
.strip{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:16px 20px;margin-bottom:20px;border-radius:18px;background:linear-gradient(135deg,var(--color-accent-soft),var(--color-neutral-soft));border:1px solid var(--color-accent-line);position:relative;overflow:hidden}
.strip-item{display:flex;flex-direction:column;gap:3px}
.strip-item span{font-size:11px;color:var(--color-text-muted)}
.strip-item b{font-size:18px;color:var(--color-ink)}
.strip-bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--color-divider)}
.strip-bar i{display:block;height:100%;background:var(--color-accent);transition:width var(--motion-slower) var(--easing-ease-out)}
.slots{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
.timeline{margin-bottom:20px;padding:20px}
.tl{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:2px}
.tl li{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px dashed var(--color-divider)}
.tl li:last-child{border-bottom:0}
.tl-time{font-size:12px;color:var(--color-text-muted);font-variant-numeric:tabular-nums;min-width:46px}
.tl-dot{width:9px;height:9px;border-radius:50%;margin-top:5px;flex:none}
.tl li.meal .tl-dot{background:var(--color-accent)}
.tl li.train .tl-dot{background:transparent;box-shadow:inset 0 0 0 2px var(--color-accent-strong)}
.tl-body{flex:1}
.tl-body strong,.tl-body small{display:block}
.tl-body strong{font-size:13.5px;color:var(--color-ink)}
.tl-body small{font-size:11.5px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.tl-note{font-size:12px;color:var(--color-text-muted);margin:6px 0 0;line-height:1.65}
.slot{padding:20px;display:flex;flex-direction:column}
/* 展开的那张卡占满整行：手指点在哪表单就在哪，同时给一行四列控件留出宽度 */
.slot.opening{grid-column:1/-1}
.slot-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.slot-head h3{font-size:17px}
.meal-time{font-size:12px;color:var(--color-text-muted);margin:0 0 10px}
.items{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:8px}
.items li{display:flex;align-items:center;gap:8px;font-size:13px;padding:8px 10px;border-radius:10px;background:var(--color-neutral-soft)}
.iname{flex:1;color:var(--color-ink);font-weight:600;min-width:0;overflow-wrap:anywhere}
.icat{font-size:11px;color:var(--color-accent);background:var(--color-accent-soft);padding:3px 8px;border-radius:999px;white-space:nowrap}
.ipart{font-size:11px;color:var(--color-text-muted);white-space:nowrap}
.analysis{border-top:1px solid var(--color-divider);padding-top:10px;margin-bottom:12px;display:grid;gap:6px}
.analysis p{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--color-text-secondary);margin:0}
.analysis strong{color:var(--color-ink);flex:none}
.analysis .warn{color:var(--color-caution)}
.slot-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}
.slot-actions :deep(button){width:auto;flex:1;padding:0 12px;font-size:13px}
.empty{margin-top:auto}
.empty p{font-size:13px;color:var(--color-text-secondary);line-height:1.7;margin:6px 0 12px}
.snacks{margin-top:16px;padding:20px}
.muted{font-size:13px;color:var(--color-text-muted)}
.mini-del{color:var(--color-text-muted);display:grid;place-items:center;padding:4px;border-radius:8px;transition:all var(--motion-fast);flex:none}
.mini-del:hover:not(:disabled){background:var(--color-danger-soft);color:var(--color-danger)}
.badge-photo{font-size:11px;color:var(--color-accent);background:var(--color-accent-soft);padding:4px 9px;border-radius:999px;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(15,118,110,.16);font-variant-numeric:tabular-nums}
.rules{margin-top:16px}
.lims{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.lims li{position:relative;padding-left:16px;font-size:12px;color:var(--color-text-secondary);line-height:1.7}
.lims li::before{content:'·';position:absolute;left:2px;top:-1px;color:var(--color-accent);font-weight:700;font-size:16px}
.ver{font-size:11px;color:var(--color-text-muted);margin:10px 0 0}
@media(max-width:1024px){.slots{grid-template-columns:1fr 1fr}}
@media(max-width:767px){.slots{grid-template-columns:1fr}.page-head{align-items:flex-start}.slot-actions{flex-direction:column}.slot-actions :deep(button){width:100%}}
</style>
