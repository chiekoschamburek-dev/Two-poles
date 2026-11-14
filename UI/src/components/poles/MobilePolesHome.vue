<template>
  <div class="m-home" role="region" aria-label="今日两仪">
    <header class="mh-head">
      <div class="mh-head-copy">
        <span class="mh-eyebrow">{{ eyebrowDate(now) }}</span>
        <h1>今日两仪</h1>
        <p>点底栏的「运动」或「饮食」进入对应的一极，底栏会随极切换。</p>
      </div>
      <RouterLink to="/report" class="mh-report">
        记录报告 <ArrowRight :size="12" />
      </RouterLink>
    </header>

    <article class="mh-card movement">
      <div class="mh-card-head">
        <PoleMark pole="movement" :size="30" class="mh-mark" />
        <div class="mh-id">
          <span class="mh-micro move">左极 · MOVEMENT</span>
          <h2>运动</h2>
        </div>
        <span class="mh-chip" :class="movementChipTone"><i></i>{{ movementChip }}</span>
      </div>
      <div class="mh-lead">
        <h3 v-if="mainItem">{{ mainItem.exerciseName }} <em>{{ totalMinutes }}</em><span>分钟</span></h3>
        <h3 v-else>今天休息</h3>
        <p>{{ movementMeta }}</p>
      </div>
      <div class="mh-actions">
        <button type="button" class="mh-btn dark" @click="router.push('/movement')">
          进入运动 <ArrowRight :size="13" />
        </button>
        <button type="button" class="mh-btn ghost" @click="router.push('/plan')">完整计划</button>
      </div>
      <div class="mh-stats">
        <div><b>{{ week.completedSessions }}/{{ week.plannedSessions }}</b><span>本周完成 · 场</span></div>
        <div><b>{{ week.totalDuration }}</b><span>本周时长 · min</span></div>
        <div><b>{{ week.totalLoad ?? '—' }}</b><span>本周负荷 · AU</span></div>
      </div>
    </article>

    <article class="mh-card nutrition">
      <div class="mh-card-head">
        <PoleMark pole="nutrition" :size="30" class="mh-mark" />
        <div class="mh-id">
          <span class="mh-micro nut">右极 · NUTRITION</span>
          <h2>饮食</h2>
        </div>
        <span class="mh-chip" :class="nutritionChipTone"><i></i>{{ dayFacts.recordedSlots }} / 3 餐</span>
      </div>
      <div class="mh-lead">
        <h3>已记录 <em class="nut-num">{{ dayFacts.recordedSlots }}</em><span>/ 3 餐</span></h3>
        <p>{{ nutritionMeta }}</p>
      </div>
      <div class="mh-actions">
        <button type="button" class="mh-btn dark" @click="router.push('/nutrition')">
          进入饮食 <ArrowRight :size="13" />
        </button>
        <button type="button" class="mh-btn ghost" @click="router.push('/meals')">完整记录</button>
      </div>
      <div class="mh-meals">
        <div v-for="slot in mealStrip" :key="slot.id" class="mh-meal" :class="{ done: slot.done }" :title="slot.text">
          <span><i></i>{{ slot.label }}</span>
          <b>{{ slot.done ? '已记录' : '未记录' }}</b>
        </div>
      </div>
    </article>

    <button type="button" class="mh-bridge" aria-label="展开今日运动与饮食的同期对照" @click="emit('open-bridge')">
      <span class="mh-micro light">TODAY · 同期对照</span>
      <span class="mh-dots" aria-hidden="true"><i></i><i></i></span>
      <span class="mh-bridge-copy">{{ bridgeSummary }}</span>
      <span class="mh-link">展开协同 <ArrowRight :size="11" /></span>
    </button>

    <button v-if="wellnessReady" id="home-tips-trigger" type="button" class="mh-tips" @click="toggleWellnessCard">
      <span class="mh-tips-ic">
        <Leaf v-if="wellnessCard.category === '饮食'" :size="15" />
        <HeartPulse v-else :size="15" />
      </span>
      <span class="mh-tips-copy">
        <b>今日 Tips · {{ wellnessCard.category }}</b>
        <small>{{ wellnessCard.title }}</small>
      </span>
      <ChevronRight :size="14" class="mh-chev" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, ChevronRight, HeartPulse, Leaf } from 'lucide-vue-next'
import PoleMark from './PoleMark.vue'
import { useAppStore } from '@/stores/app'
import { useWellnessDock } from '@/composables/useWellnessDock'
import { MAIN_MEAL_SLOTS, buildWeekFacts, readDayFacts } from '@/services/bridgeRules'
import { MEAL_SLOTS, summarizeDay } from '@/services/mealRules'
import { buildWeeklyReport } from '@/services/weekRules'
import { eyebrowDate, toISODate } from '@/utils/time'

const emit = defineEmits<{ (e: 'open-bridge'): void }>()

const store = useAppStore()
const router = useRouter()
const now = new Date()
const today = toISODate(now)

const notice = computed(() => store.dayPlanNotice(now))
const items = computed(() => notice.value.items)
const mainItem = computed(() => {
  const list = items.value
  if (!list.length) return null
  return [...list].sort((a, b) => (b.plannedDuration ?? 0) - (a.plannedDuration ?? 0))[0]
})
const totalMinutes = computed(() => items.value.reduce((sum, item) => sum + (item.plannedDuration ?? 0), 0))

const week = computed(() => buildWeeklyReport(store.sessions, store.meals, now, {
  profile: store.userProfile
}))
const dayFacts = computed(() => readDayFacts(store.sessions, store.meals, today))
const weekFacts = computed(() => buildWeekFacts(store.sessions, store.meals, now))
const nutritionDay = computed(() => summarizeDay(store.meals, today))

const movementChip = computed(() => week.value.plannedSessions
  ? `${week.value.completedSessions}/${week.value.plannedSessions} 场`
  : '本周无安排')
const movementChipTone = computed<'' | 'ok' | 'part'>(() => {
  if (!week.value.plannedSessions) return ''
  if (week.value.completedSessions >= week.value.plannedSessions) return 'ok'
  return week.value.completedSessions > 0 ? 'part' : ''
})
const nutritionChipTone = computed<'' | 'nut-ok' | 'part'>(() => {
  if (dayFacts.value.recordedSlots >= MAIN_MEAL_SLOTS) return 'nut-ok'
  return dayFacts.value.recordedSlots > 0 ? 'part' : ''
})

const movementMeta = computed(() => {
  if (!mainItem.value) {
    return notice.value.gateNote || '今天没有安排训练，休息日不影响后续计划。'
  }
  const venue = store.userProfile?.availableVenues?.length
    ? store.userProfile.availableVenues.join(' / ')
    : '任意场地'
  const equip = store.userProfile?.equipment?.length
    ? store.userProfile.equipment.join(' / ')
    : '无器材'
  const restrict = store.userProfile?.restrictions?.length
    ? ` · 避开${store.userProfile.restrictions.join('、')}`
    : ''
  return `${items.value.length} 段 · ${venue} · ${equip}${restrict}`
})

const nutritionMeta = computed(() => {
  const facts = dayFacts.value
  if (!facts.recordedSlots) return '今天还没记录 · 点进去记一笔'
  const tail = facts.missing.length
    ? `还缺 ${facts.missing.slice(0, 2).join('、')}${facts.missing.length > 2 ? ' 等' : ''}`
    : '八类都出现过'
  return `覆盖 ${facts.coverage.length}/8 类 · ${tail}`
})

const mealStrip = computed(() => nutritionDay.value.slots.map(slot => {
  const meta = MEAL_SLOTS.find(m => m.id === slot.id)
  const names = slot.meal?.items.map(item => item.foodName).slice(0, 2).join(' · ') ?? ''
  return {
    id: slot.id,
    label: slot.label,
    done: !!slot.meal,
    text: slot.meal ? (names || '已记录') : (meta?.defaultTime ?? '未记录')
  }
}))

const bridgeSummary = computed(() => {
  const d = dayFacts.value
  const w = weekFacts.value
  const both = d.sessions > 0 && d.recordedSlots > 0
  const tail = both ? '，两边都在记录。' : '。'
  return `运动 ${d.sessionMinutes} 分钟 · 饮食 ${d.recordedSlots}/3 餐；本周运动 ${w.sessionDays} 天、饮食 ${w.mealDays} 天${tail}`
})

const {
  ready: wellnessReady,
  card: wellnessCard,
  toggleCard: toggleWellnessCard
} = useWellnessDock()
</script>

<style scoped>
.m-home {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px 6px 18px;
  scrollbar-width: none;
}
.m-home::-webkit-scrollbar { display: none; }

.mh-head { display: flex; align-items: flex-start; gap: 10px; padding: 0 2px 13px; }
.mh-head-copy { flex: 1; min-width: 0; }
.mh-eyebrow {
  display: block;
  font-family: var(--font-num);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .16em;
  color: var(--color-text-muted);
  text-transform: uppercase;
}
.mh-head h1 { margin: 5px 0 0; font-size: 27px; line-height: 1.15; letter-spacing: -.03em; }
.mh-head p { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--color-text-muted); }
.mh-report {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 27px;
  margin-top: 1px;
  padding: 0 8px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 9.5px;
  font-weight: 600;
  white-space: nowrap;
  text-decoration: none;
}
.mh-report:hover { color: var(--color-ink); border-color: var(--color-ink); }

.mh-card {
  position: relative;
  margin-top: 13px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9);
}
.mh-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--pole-movement), rgba(163, 77, 40, .16));
}
.mh-card.nutrition::before {
  background: linear-gradient(90deg, var(--pole-nutrition), rgba(15, 118, 110, .14));
}
.mh-card-head { display: flex; align-items: center; gap: 9px; padding: 13px 14px 6px; }
.mh-mark { flex: none; overflow: visible; }
.mh-id { flex: 1; min-width: 0; }
.mh-micro {
  display: block;
  font-family: var(--font-num);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: .14em;
  white-space: nowrap;
}
.mh-micro.move { color: var(--pole-movement-strong); }
.mh-micro.nut { color: var(--pole-nutrition-strong); }
.mh-id h2 { margin: 2px 0 0; font-size: 18px; line-height: 1.1; letter-spacing: -.01em; }
.mh-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  flex: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-card);
  font-family: var(--font-num);
  font-size: 9.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.mh-chip i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
.mh-chip.ok { background: var(--pole-movement-soft); border-color: var(--pole-movement-line); color: var(--pole-movement-strong); }
.mh-chip.part { background: var(--color-caution-soft); border-color: rgba(138, 90, 0, .26); color: var(--color-caution); }
.mh-chip.nut-ok { background: var(--pole-nutrition-soft); border-color: var(--pole-nutrition-line); color: var(--pole-nutrition-strong); }

.mh-lead { padding: 2px 14px 0; }
.mh-lead h3 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -.03em; font-weight: 600; }
.mh-lead h3 em {
  font-style: normal;
  font-family: var(--font-num);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -.04em;
  color: var(--pole-movement);
}
.mh-lead h3 em.nut-num { color: var(--pole-nutrition); }
.mh-lead h3 span {
  margin-left: 4px;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-text-muted);
}
.mh-lead p { margin: 5px 0 0; font-size: 10.5px; line-height: 1.6; color: var(--color-text-secondary); }
.mh-actions { display: flex; align-items: center; gap: 8px; padding: 11px 14px 12px; }
.mh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 33px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-base);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.mh-btn.dark { background: var(--color-ink); color: var(--color-on-accent); }
.mh-btn.ghost { background: var(--color-card); border-color: var(--hair-strong); color: var(--color-text-secondary); }
.mh-btn.ghost:hover { color: var(--color-ink); border-color: var(--color-ink); }

.mh-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--hair-soft);
  background: var(--surface-field);
}
.mh-stats > div { padding: 8px 12px 9px; border-left: 1px solid var(--hair-soft); }
.mh-stats > div:first-child { border-left: 0; }
.mh-stats b {
  display: block;
  font-family: var(--font-num);
  font-size: 16.5px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -.01em;
}
.mh-stats span { display: block; margin-top: 2px; font-size: 8.5px; line-height: 1.3; color: var(--color-text-muted); white-space: nowrap; }

.mh-meals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 14px 12px; }
.mh-meal { background: var(--surface-field); border: 1px solid var(--hair-soft); border-radius: var(--radius-base); padding: 7px 8px; }
.mh-meal span { display: flex; align-items: center; gap: 4px; font-size: 8.5px; color: var(--color-text-muted); }
.mh-meal span i { width: 5px; height: 5px; border-radius: 50%; border: 1px solid var(--hair-strong); }
.mh-meal.done span i { background: var(--pole-nutrition); border-color: var(--pole-nutrition); }
.mh-meal b { display: block; margin-top: 3px; font-size: 10px; font-weight: 600; color: var(--color-text-muted); }
.mh-meal.done b { color: var(--pole-nutrition-strong); }

.mh-bridge {
  position: relative;
  display: block;
  width: 100%;
  margin-top: 13px;
  padding: 12px 14px 13px;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-lg);
  background: linear-gradient(160deg, #1a2229 0%, #11161a 62%, #0d1114 100%);
  color: var(--color-text-inverse);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06);
}
.mh-micro.light { color: rgba(255, 255, 255, .45); }
.mh-dots { position: absolute; right: 14px; top: 12px; display: flex; gap: 5px; }
.mh-dots i { width: 5px; height: 5px; border-radius: 50%; }
.mh-dots i:first-child { background: var(--pole-movement); }
.mh-dots i:last-child { background: var(--brand-pole-b-dark); }
.mh-bridge-copy {
  display: block;
  margin-top: 7px;
  max-width: 292px;
  font-size: 11px;
  line-height: 1.65;
  color: rgba(238, 242, 244, .78);
}
.mh-link {
  position: absolute;
  right: 13px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  color: rgba(255, 255, 255, .62);
}

.mh-tips {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-accent-line);
  border-radius: var(--radius-lg);
  background: var(--color-accent-soft);
  text-align: left;
}
.mh-tips-ic {
  width: 28px;
  height: 28px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: var(--radius-base);
  background: var(--color-card);
  color: var(--color-accent-strong);
}
.mh-tips-copy { flex: 1; min-width: 0; }
.mh-tips-copy b { display: block; font-size: 9px; font-weight: 700; letter-spacing: .02em; color: var(--color-accent-strong); }
.mh-tips-copy small {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--color-text-secondary);
}
.mh-chev { flex: none; color: var(--color-accent-strong); }
</style>
