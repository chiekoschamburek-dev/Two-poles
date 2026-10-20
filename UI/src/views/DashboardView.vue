<template>
  <div class="page">
    <!-- 建档提示：只在没档案时出现，不占首屏主位 -->
    <RouterLink v-if="!store.hasProfile" to="/onboarding" class="setup animate-fade-in">
      <span class="setup-ic"><Sparkles :size="16" /></span>
      <span class="setup-tx">
        <strong>还没完成建档</strong>
        <small>花一分钟填几项，这里的称呼与"为什么适合你"才会按你的情况来。</small>
      </span>
      <em>去建档 <ArrowRight :size="13" /></em>
    </RouterLink>

    <!-- 标题区：先说"今天做什么" -->
    <header class="lede">
      <div class="lead-l">
        <span class="micro kick"><i></i>{{ kicker }}</span>
        <h1 v-if="mainItem">
          {{ mainItem.exerciseName }}
          <em>{{ mainItem.plannedDuration ?? '—' }}</em><span class="unit">分钟</span>
        </h1>
        <h1 v-else>今日休息</h1>
        <p v-if="mainItem" class="meta">
          <span>合计 <b>{{ totalMinutes }}</b> 分钟</span>
          <i class="sep"></i>
          <span>{{ venueLabel }}</span>
          <i class="sep"></i>
          <span>{{ equipLabel }}</span>
          <template v-if="restrictLabel">
            <i class="sep"></i>
            <span>避开{{ restrictLabel }}</span>
          </template>
          <template v-if="notice.stale">
            <i class="sep"></i>
            <span class="warn">计划由旧规则生成，可在计划页重生成</span>
          </template>
        </p>
        <p v-else class="meta">
          <span>这一天不安排训练，也不影响后续计划。想动一动就随手记一笔。</span>
        </p>
      </div>
      <div class="lead-r">
        <button class="btn ghost" @click="router.push('/plan')">换一项</button>
        <button class="btn primary" :disabled="!mainItem" @click="start">
          <Play :size="14" fill="currentColor" />开始跟练
        </button>
      </div>
    </header>

    <!-- 主集群：时间轴 + 双极仪表 -->
    <div class="cluster">
      <BaseCard v-if="!isAthlete && timeline.length" variant="flush" class="timeline">
        <div class="panel-head">
          <span class="micro">今天的 {{ timeline.length }} 段 · 合计 {{ totalMinutes }} 分钟</span>
          <span class="chip"><i class="dot"></i>计划 {{ totalMinutes }} min</span>
        </div>

        <div v-for="(row, i) in timeline" :key="row.id" class="tl-row" :class="{ last: i === timeline.length - 1, done: row.completed }">
          <span class="tl-time">{{ pad(row.start) }} — {{ pad(row.end) }}</span>
          <span class="tl-axis"></span>
          <div class="tl-main">
            <strong>{{ row.exerciseName }}</strong>
            <small>{{ row.detail }}</small>
          </div>
          <span class="tl-dur">{{ row.plannedDuration ?? 0 }}<i>min</i></span>
        </div>

        <div class="tl-note">
          <span class="micro">备注</span>
          <p v-if="notice.gateNote">{{ notice.gateNote }}</p>
          <p v-else>今天没练也照常记录：记「没做成」比不记更有用。</p>
          <span class="lock">
            <Lock :size="10" />
            {{ lockedCount ? `${lockedCount} 项周期锁定` : '未锁定' }}
          </span>
        </div>

        <div class="tl-foot">
          <div>
            <div class="k">上次同类</div>
            <div class="v"><template v-if="lastSame"><b>{{ lastSame.date.slice(5) }}</b> · RPE <b>{{ lastSame.rpe ?? '—' }}</b></template><template v-else>还没有记录</template></div>
          </div>
          <div>
            <div class="k">近 4 周平均</div>
            <div class="v"><b>{{ recentAvg }}</b> 次 / 周</div>
          </div>
          <div>
            <div class="k">本周目标</div>
            <div class="v"><b>{{ week.plannedSessions }}</b> 场 · 已完成 <b>{{ week.completedSessions }}</b></div>
          </div>
        </div>
      </BaseCard>

      <!-- 休息日 / 条件不足：如实说明，不硬编一套训练 -->
      <BaseCard v-else-if="!isAthlete" variant="flush" class="timeline rest">
        <div class="panel-head">
          <span class="micro">今天不安排训练</span>
          <span class="chip"><i class="dot"></i>休息日</span>
        </div>
        <div class="rest-body">
          <div class="rest-mark">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r="22" fill="none" stroke="var(--color-border)" stroke-width="3" />
              <path d="M20 32h24" stroke="var(--color-accent)" stroke-width="3" stroke-linecap="round" />
            </svg>
          </div>
          <div>
            <strong>{{ notice.gateNote ? '这次没有自动推荐' : '这一天没有安排训练' }}</strong>
            <p>{{ notice.gateNote || '它表示"未安排"，不代表没有活动。你仍然可以记录今天实际做了什么。' }}</p>
            <ul v-if="notice.conflicts.length" class="conflicts">
              <li v-for="c in notice.conflicts" :key="c">{{ c }}</li>
            </ul>
          </div>
        </div>
        <div v-if="upcoming.length" class="upcoming">
          <span class="micro">接下来</span>
          <div v-for="u in upcoming" :key="u.date" class="up-row">
            <span class="d">{{ u.label }}</span>
            <span class="n">{{ u.items }}</span>
          </div>
        </div>
        <div class="tl-foot">
          <div>
            <div class="k">本周安排</div>
            <div class="v"><b>{{ week.plannedSessions }}</b> 场</div>
          </div>
          <div>
            <div class="k">已记录</div>
            <div class="v"><b>{{ week.completedSessions }}</b> 场</div>
          </div>
          <div>
            <div class="k">可以做的</div>
            <div class="v"><RouterLink to="/plan">去计划页手工加一项</RouterLink></div>
          </div>
        </div>
      </BaseCard>

      <!-- 运动员模式：主图换成负荷曲线。大众模式看"今天做什么"，运动员先看"这周负荷安不安全" -->
      <BaseCard v-if="isAthlete" variant="flush" class="load-panel">
        <div class="panel-head">
          <span class="micro">近 28 天 · 每日负荷</span>
          <span class="chip" :class="zoneClass">
            <i class="dot"></i>{{ acwrChip }}
          </span>
        </div>
        <div class="load-body">
          <LoadChart
            :points="loadSeries.points"
            :ctl="loadSeries.ctl"
            :atl="loadSeries.atl"
            :acwr="loadSeries.acwr"
            :zone="zone"
            :days-needed="loadSeries.daysNeeded"
            :covered-days="loadSeries.coveredDays"
            :missing-days="loadSeries.missingDays"
          />
        </div>
      </BaseCard>

      <!-- 双极仪表：同一个母题，首页/周报/跟练共用 -->
      <BaseCard variant="ink" class="gauge">
        <div class="g-head">
          <div>
            <span class="micro">Week {{ weekNo }} · {{ isAthlete ? 'Load' : 'Load' }}</span>
            <div class="g-title">{{ isAthlete ? '本周强度分布' : '本周两仪' }}</div>
          </div>
          <span class="live"><i></i>{{ isAthlete ? 'W2' : 'LIVE' }}</span>
        </div>

        <div class="g-body">
          <TwoPoleDial
            :training="isAthlete ? lowPct : trainingPct"
            :meal="isAthlete ? highPct : mealPct"
            :size="228"
            tone="ink"
            :aria-label="isAthlete
              ? `近 28 天强度分布：低强度 ${pctLabel(lowPct)}，高强度 ${pctLabel(highPct)}`
              : `本周训练完成 ${pctLabel(trainingPct)}，饮食记录 ${pctLabel(mealPct)}`"
          >
            <div class="num-big">{{ loadLabel }}<sup v-if="week.totalLoad !== null">AU</sup></div>
            <div class="num-cap">本周负荷</div>
            <div class="num-note">{{ isAthlete ? splitNote : loadNote }}</div>
          </TwoPoleDial>

          <div class="g-side">
            <div class="legend">
              <template v-if="isAthlete">
                <span><i style="background: var(--brand-pole-a-dark)"></i>低强度 <b>{{ pctLabel(lowPct) }}</b></span>
                <span><i style="background: var(--brand-pole-b-dark)"></i>高强度 <b>{{ pctLabel(highPct) }}</b></span>
              </template>
              <template v-else>
                <span><i style="background: var(--brand-pole-a-dark)"></i>训练 <b>{{ pctLabel(trainingPct) }}</b></span>
                <span><i style="background: var(--brand-pole-b-dark)"></i>饮食 <b>{{ pctLabel(mealPct) }}</b></span>
              </template>
            </div>

            <div class="g-foot">
              <div><b>{{ week.completedSessions }}<em>/{{ week.plannedSessions }}</em></b><span>场次</span></div>
              <div><b>{{ week.totalDuration }}<em>min</em></b><span>时长</span></div>
              <div v-if="isAthlete"><b>{{ avgRpe ?? '—' }}<em>RPE</em></b><span>均主观强度</span></div>
              <div v-else><b>{{ mealSummary.recorded }}<em>/{{ mealSummary.planned }}</em></b><span>餐次</span></div>
            </div>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- 底部账本：一条横排，替掉四张等宽卡 -->
    <div class="ledger">
      <BaseCard variant="flush" class="ledger-pane">
        <div class="panel-head tight">
          <span class="micro">{{ isAthlete ? '接下来 3 个训练日' : '本周负荷 · 逐日' }}</span>
          <span class="micro" :style="{ color: peak ? 'var(--color-text-muted)' : 'transparent' }">
            {{ isAthlete ? (loadSeries.ctl === null ? '还没有均线' : `CTL ${loadSeries.ctl}`) : `峰值 ${peak ? `${peak.label} ${peak.value}` : '—'}` }}
          </span>
        </div>
        <!-- 运动员：负荷曲线已经画了"过去"，这里放"接下来"，避免两块说的是同一段时间 -->
        <div v-if="isAthlete" class="next-list">
          <div v-if="!upcoming.length" class="bars-empty">接下来 7 天都没有安排训练，可在计划页手工加一项。</div>
          <div v-for="u in upcoming" v-else :key="u.date" class="next-row">
            <span class="d">{{ u.label }}</span>
            <span class="n">{{ u.items }}</span>
          </div>
        </div>
        <div v-else-if="hasAnyLoad" class="bars">
          <div v-for="b in bars" :key="b.label" class="col" :class="{ zero: b.value === null, today: b.today }">
            <span class="v" :class="{ dim: b.value === null }">{{ b.value === null ? '—' : b.value }}</span>
            <div class="bar" :style="{ height: b.px + 'px' }"></div>
            <span class="d">{{ b.label }}</span>
          </div>
        </div>
        <div v-else class="bars-empty">
          本周还没有训练记录。负荷图显示为空，而不是 0。
        </div>
      </BaseCard>

      <BaseCard variant="flush" class="ledger-pane">
        <div class="panel-head tight">
          <span class="micro">今天的三餐</span>
          <span class="chip" :class="mealChipClass"><i class="dot"></i>{{ mealSummary.recorded }} / {{ mealSummary.planned }}</span>
        </div>
        <div class="meals">
          <div v-for="slot in mealRows" :key="slot.id" class="mrow">
            <span class="t">{{ slot.time }}</span>
            <ShapeState :state="slot.state" :label="`${slot.label}：${slot.stateText}`" />
            <span class="n" :class="{ dim: !slot.meal }">{{ slot.label }}<small>{{ slot.text }}</small></span>
            <RouterLink to="/meals" class="act" :class="{ dim: slot.meal }">{{ slot.meal ? '改' : '＋ 记' }}</RouterLink>
          </div>
        </div>
      </BaseCard>

      <BaseCard class="why">
        <div class="q">
          <Sparkles :size="13" />
          {{ mainItem ? '为什么是这 ' + totalMinutes + ' 分钟？' : '为什么今天没有安排？' }}
        </div>
        <p>{{ whyText }}</p>
        <div class="tags">
          <span v-for="t in tags" :key="t">{{ t }}</span>
        </div>
      </BaseCard>
    </div>

    <!-- 收尾内容：每天一条饮食/健身知识，收起时只占一行摘要 -->
    <DailyWellnessCard :date="now" />

    <footer class="footnote">
      <span>无账号 · 记录只存本机 · 照片经同意才用于识别</span>
      <span class="micro">v3 · plan-rules-v3</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { Play, Sparkles, ArrowRight, Lock } from 'lucide-vue-next'
import { eyebrowDate, toISODate } from '@/utils/time'
import { summarizeDay, MEAL_SLOTS } from '@/services/mealRules'
import { buildWeeklyReport, weekStart, WEEK_LABELS } from '@/services/weekRules'
import { buildDayPlan } from '@/services/planRules'
import BaseCard from '@/components/common/BaseCard.vue'
import TwoPoleDial from '@/components/common/TwoPoleDial.vue'
import ShapeState from '@/components/common/ShapeState.vue'
import LoadChart from '@/components/common/LoadChart.vue'
import { buildLoadSeries, intensitySplit, loadZone } from '@/services/loadRules'
import DailyWellnessCard from '@/components/wellness/DailyWellnessCard.vue'
import type { PlanItem } from '@/types/domain'

const router = useRouter()
const store = useAppStore()
const now = new Date()
const today = toISODate(now)
const eyebrow = eyebrowDate(now)

// ——— 今日计划（已存的优先，其次按档案现算） ———
const notice = computed(() => store.dayPlanNotice(now))
const items = computed<PlanItem[]>(() => notice.value.items)

/** 主项 = 时长最长的那一段；标题就写它，而不是写一句情绪文案 */
const mainItem = computed(() => {
  const list = items.value
  if (!list.length) return null
  return [...list].sort((a, b) => (b.plannedDuration ?? 0) - (a.plannedDuration ?? 0))[0]
})
const totalMinutes = computed(() => items.value.reduce((s, i) => s + (i.plannedDuration ?? 0), 0))
const lockedCount = computed(() => items.value.filter(i => i.locked).length)

const pad = (n: number) => String(n).padStart(2, '0')

/** 时间轴：按分钟累加出 00—05 / 05—25 这样的区间，直接对上"今天怎么打发这 30 分钟" */
const timeline = computed(() => {
  let acc = 0
  return items.value.map(i => {
    const start = acc
    const dur = i.plannedDuration ?? 0
    acc += dur
    const bits: string[] = []
    if (i.plannedSets && i.plannedReps) bits.push(`${i.plannedSets} 组 × ${i.plannedReps} 次`)
    if (i.note) bits.push(i.note)
    return {
      id: i.id,
      exerciseName: i.exerciseName,
      plannedDuration: i.plannedDuration,
      completed: i.completed,
      start,
      end: acc,
      detail: bits.join(' · ') || `${dur} 分钟`
    }
  })
})

// ——— 周报聚合 ———
const week = computed(() => buildWeeklyReport(store.sessions, store.meals, now, { profile: store.userProfile, mode: store.currentMode }))
const weekDays = computed(() => {
  const start = weekStart(now)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return toISODate(d)
  })
})
const weekNo = computed(() => {
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
})

// ——— 标签行 ———
const kicker = computed(() => {
  const p = store.userProfile
  const nth = week.value.completedSessions + 1
  if (!p) return `${eyebrow} · 还没建档`
  const phase = store.isAthleteMode ? (p.cyclePhase || '周期训练') : (p.goal || '基础体能')
  return `${eyebrow} · 本周第 ${nth} 次 · ${phase}`
})
const venueLabel = computed(() => {
  const v = store.userProfile?.availableVenues
  return v?.length ? v.join(' / ') : '任意场地'
})
const equipLabel = computed(() => {
  const e = store.userProfile?.equipment
  return e?.length ? e.join(' / ') : '无器材'
})
const restrictLabel = computed(() => store.userProfile?.restrictions?.join('、') ?? '')

const tags = computed(() => {
  const p = store.userProfile
  const out: string[] = []
  if (p?.equipment?.length) out.push(...p.equipment)
  else out.push('无器材')
  if (p?.availableVenues?.length) out.push(...p.availableVenues)
  if (p?.restrictions?.length) out.push(...p.restrictions)
  if (p?.experience) out.push(p.experience)
  return out.slice(0, 5)
})

const whyText = computed(() => {
  const p = store.userProfile
  if (!p) return '还没有建档，所以这是一份不过滤的基础模板。填上可用时间、器材与"需要避开的"，推荐才会按你的情况收窄。'
  if (!items.value.length) {
    return notice.value.gateNote
      || '按你的档案，今天不在训练日里。休息日不安排训练，也不影响后续计划；有活动就如实记一笔。'
  }
  const times = p.availableTimes?.length ? p.availableTimes.join(' + ') : '未填可用时间（按 20 分钟处理）'
  const modeNote = store.isAthleteMode
    ? `当前是${p.discipline || '专项'}训练的${p.cyclePhase || '周期'}，主项优先保证有氧，其余留给热身与整理。`
    : '当前是大众模式，主项优先力量类，热身与整理各占一段。'
  return `你的档案里可用时间是「${times}」，场地${venueLabel.value}、器材${equipLabel.value}${restrictLabel.value ? `、需要避开${restrictLabel.value}` : ''}。${modeNote}`
})

// ——— 仪表：几何在 TwoPoleDial 里，这里只负责取数 ———
const trainingPct = computed(() => week.value.completionRate ?? 0)
const mealSummary = computed(() => summarizeDay(store.meals, today))
const mealPct = computed(() => (mealSummary.value.planned ? mealSummary.value.recorded / mealSummary.value.planned : 0))

const loadLabel = computed(() => (week.value.totalLoad === null ? '—' : String(week.value.totalLoad)))
const loadNote = computed(() => {
  if (week.value.totalLoad === null) return week.value.completedSessions ? 'RPE 未记全，暂不合计' : '本周还没有记录'
  return `覆盖 ${week.value.loadDays} 天 · 不含缺 RPE 的天`
})
const pctLabel = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—')

// ——— 运动员模式：负荷序列与强度分布（口径都在 services/loadRules.ts 里） ———
const isAthlete = computed(() => store.isAthleteMode)
const loadSeries = computed(() => buildLoadSeries(store.sessions, now))
const zone = computed(() => loadZone(loadSeries.value.acwr))
const acwrChip = computed(() => {
  if (loadSeries.value.acwr === null) return `还需 ${loadSeries.value.daysNeeded} 天样本`
  return loadSeries.value.atl !== null && loadSeries.value.ctl !== null && loadSeries.value.atl >= loadSeries.value.ctl
    ? 'ATL 在 CTL 上方'
    : 'ATL 在 CTL 下方'
})
const zoneClass = computed(() => ({
  ok: zone.value === 'optimal',
  part: zone.value === 'low' || zone.value === 'high',
  bad: zone.value === 'veryHigh'
}))
/** 强度分布看近 28 天，和负荷图同一个窗口，避免两块数据说的不是一段时间 */
const split = computed(() => intensitySplit(store.sessions, { since: loadSeries.value.points[0]?.date }))
const lowPct = computed(() => split.value.lowShare ?? 0)
const highPct = computed(() => split.value.highShare ?? 0)
const splitNote = computed(() => {
  if (split.value.lowShare === null) return '还没有可归类的训练时长'
  return `低 ${Math.round(split.value.lowMinutes)} min · 高 ${Math.round(split.value.highMinutes)} min`
})
/** 本周平均 RPE：只统计记了 RPE 的场次 */
const avgRpe = computed(() => {
  const w = week.value
  const rows = store.sessions.filter(
    s => s.date >= w.weekStartDate && s.date <= w.weekEndDate && s.rpe !== null
  )
  if (!rows.length) return null
  return Math.round((rows.reduce((a, s) => a + (s.rpe ?? 0), 0) / rows.length) * 10) / 10
})

// ——— 逐日负荷 ———
const loadMax = computed(() => Math.max(1, ...week.value.loadByDay.map(v => v ?? 0)))
const hasAnyLoad = computed(() => week.value.loadByDay.some(v => v !== null))
const bars = computed(() => week.value.loadByDay.map((v, i) => ({
  label: WEEK_LABELS[i],
  value: v,
  today: weekDays.value[i] === today,
  px: v === null ? 6 : Math.max(8, Math.round((v / loadMax.value) * 96))
})))

/** 休息日不硬凑训练，但「下一次是什么」得能看见 */
const upcoming = computed(() => {
  const out: { date: string; label: string; items: string }[] = []
  for (let i = 1; i <= 7 && out.length < 3; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const dayItems = buildDayPlan(d, store.userProfile, store.currentMode).items
    if (!dayItems.length) continue
    out.push({
      date: toISODate(d),
      label: `周${WEEK_LABELS[(d.getDay() + 6) % 7]} ${d.getMonth() + 1}/${d.getDate()}`,
      items: dayItems.map(x => x.exerciseName).join(' · ')
    })
  }
  return out
})
const peak = computed(() => {
  let best: { label: string; value: number } | null = null
  week.value.loadByDay.forEach((v, i) => {
    if (v !== null && (!best || v > best.value)) best = { label: WEEK_LABELS[i], value: v }
  })
  return best as { label: string; value: number } | null
})

// ——— 三餐 ———
const mealRows = computed(() => mealSummary.value.slots.map(s => {
  const meta = MEAL_SLOTS.find(m => m.id === s.id)
  const items = s.meal?.items ?? []
  const complete = s.meal?.completeness === 'complete'
  return {
    id: s.id,
    label: s.label,
    meal: s.meal,
    time: s.meal?.time || meta?.defaultTime || '—',
    state: (!s.meal ? 'none' : complete ? 'complete' : 'partial') as 'complete' | 'partial' | 'none',
    stateText: !s.meal ? '未记录' : complete ? '记录完整' : '部分记录',
    text: items.length
      ? items.map(i => i.foodName).join(' · ')
      : (s.meal ? '已记录，条目待补' : '未记录')
  }
}))
const mealChipClass = computed(() => {
  const r = mealSummary.value.recorded
  return r === 0 ? '' : r < mealSummary.value.planned ? 'part' : 'ok'
})

// ——— 上一条同类训练 ———
const lastSame = computed(() => {
  const name = mainItem.value?.exerciseName
  if (!name) return null
  const same = store.sessions.filter(s => s.exerciseName === name).sort((a, b) => b.date.localeCompare(a.date))
  return same[0] ?? null
})
const recentAvg = computed(() => {
  const since = new Date(now)
  since.setDate(since.getDate() - 28)
  const iso = toISODate(since)
  const n = store.sessions.filter(s => s.date >= iso).length
  return (n / 4).toFixed(1)
})

function start() {
  if (!mainItem.value) return
  router.push({ path: '/execution', query: { exercise: mainItem.value.exerciseName } })
}
</script>

<style scoped>
.page { max-width: var(--content-max-width); margin: 0 auto; }

/* ——— 建档提示 ——— */
.setup {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border: 1px solid var(--color-accent-line);
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-ink);
  text-decoration: none;
  transition: border-color var(--motion-fast);
}
.setup:hover { border-color: var(--color-accent); }
.setup-ic { width: 30px; height: 30px; border-radius: var(--radius-sm); display: grid; place-items: center; color: var(--color-on-accent); background: var(--color-accent); flex: none; }
.setup-tx { flex: 1; min-width: 0; }
.setup-tx strong { display: block; font-size: 13px; font-weight: 600; }
.setup-tx small { display: block; font-size: 11.5px; color: var(--color-text-secondary); margin-top: 2px; line-height: 1.5; }
.setup em { font-style: normal; font-size: 12px; font-weight: 700; color: var(--color-accent); display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }

/* ——— 标题区 ——— */
.lede { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 18px 0 18px; }
.kick { display: inline-flex; align-items: center; gap: 8px; }
.kick i { width: 14px; height: 1px; background: var(--color-accent); display: block; }
.lede h1 { font-size: 40px; letter-spacing: -0.03em; margin: 9px 0 0; color: var(--color-ink); line-height: 1.12; font-weight: 600; }
.lede h1 em { font-style: normal; font-family: var(--font-num); font-weight: 600; color: var(--color-accent); letter-spacing: -0.035em; }
.lede h1 .unit { font-size: 18px; font-weight: 500; color: var(--color-text-muted); margin-left: 6px; letter-spacing: 0; }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 11px; font-size: 12.5px; color: var(--color-text-secondary); }
.meta b { font-family: var(--font-num); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-ink); }
.meta .sep { width: 1px; height: 10px; background: var(--hair-strong); display: block; }
.meta .warn { color: var(--color-caution); }
.lead-r { display: flex; gap: 8px; padding-bottom: 3px; flex: none; }

/* ——— 按钮：主操作用深墨，强调色只留给"记录/进度" ——— */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 42px; padding: 0 18px; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; border: 1px solid transparent; white-space: nowrap; transition: background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.primary { background: var(--color-ink); color: var(--color-card); }
.btn.primary:hover:not(:disabled) { background: #000; }
.btn.ghost { background: transparent; border-color: var(--hair-strong); color: var(--color-ink); }
.btn.ghost:hover:not(:disabled) { border-color: var(--color-ink); }

/* ——— 主集群 ——— */
.cluster { display: grid; grid-template-columns: minmax(0, 1fr) 356px; gap: 14px; align-items: start; }

/* 面板内距统一走 BaseCard 的 --card-pad，避免父组件和组件抢 padding */
.timeline { display: flex; flex-direction: column; overflow: hidden; }
/* 运动员模式的负荷面板：和 timeline 同一列、同一套表头，只是主体换成图表 */
.load-panel { display: flex; flex-direction: column; overflow: hidden; }
.load-body { padding: 2px 20px 14px; }
/* 运动员账本：接下来几个训练日 */
.next-list { display: flex; flex-direction: column; }
.next-row { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 8px 20px; }
.next-row + .next-row { border-top: 1px solid var(--hair-soft); }
.next-row .d { font-family: var(--font-num); font-size: 11px; letter-spacing: .04em; color: var(--color-text-muted); }
.next-row .n { font-size: 13px; color: var(--color-text-secondary); }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 20px 11px; }
.panel-head.tight { padding-bottom: 8px; border-bottom: 1px solid var(--hair-soft); }

.chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-card); font-family: var(--font-num); font-size: 11px; font-weight: 600; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.chip .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--color-text-muted); }
.chip.ok { color: var(--color-accent); border-color: var(--color-accent-line); background: var(--color-accent-soft); }
.chip.ok .dot { background: var(--color-accent); }
.chip.part { color: var(--color-caution); border-color: rgba(138, 90, 0, 0.26); background: var(--color-caution-soft); }
.chip.part .dot { background: var(--color-caution); }

.tl-row { position: relative; display: grid; grid-template-columns: 56px 20px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 13px 20px; }
.tl-row + .tl-row { border-top: 1px solid var(--hair-soft); }
.tl-row::after { content: ''; position: absolute; left: 97px; top: calc(50% + 6px); bottom: -7px; width: 1px; background: var(--color-border); }
.tl-row.last::after { display: none; }
.tl-time { font-family: var(--font-num); font-size: 11px; color: var(--color-text-muted); letter-spacing: 0.04em; text-align: right; font-variant-numeric: tabular-nums; }
.tl-axis { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--hair-strong); background: var(--color-card); justify-self: center; position: relative; z-index: 1; }
.tl-row.done .tl-axis { background: var(--color-accent); border-color: var(--color-accent); }
.tl-main strong { display: block; font-size: 14.5px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-ink); }
.tl-main small { display: block; font-size: 12px; color: var(--color-text-muted); line-height: 1.5; margin-top: 1px; }
.tl-dur { font-family: var(--font-num); font-size: 12.5px; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.tl-dur i { font-style: normal; font-size: 10.5px; color: var(--color-text-muted); margin-left: 2px; }

.tl-note { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 11px 20px; border-top: 1px dashed var(--color-border); }
.tl-note p { margin: 0; font-size: 12px; color: var(--color-text-secondary); }
.tl-note .lock { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--color-text-muted); white-space: nowrap; }

.tl-foot { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--hair-soft); padding: 10px 20px 12px; }
.tl-foot > div + div { border-left: 1px solid var(--hair-soft); padding-left: 16px; }
.tl-foot .k { font-family: var(--font-num); font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-text-muted); }
.tl-foot .v { font-size: 12.5px; margin-top: 4px; color: var(--color-text-secondary); }
.tl-foot .v b { font-family: var(--font-num); font-weight: 600; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.tl-foot a { color: var(--color-accent); font-weight: 600; }

/* 休息日 */
.rest-body { display: flex; flex: 1; gap: 16px; align-items: center; padding: 10px 20px 20px; }
.rest-mark svg { width: 54px; height: 54px; }
.rest-body strong { font-size: 15px; font-weight: 600; color: var(--color-ink); }
.rest-body p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.65; color: var(--color-text-secondary); }
.conflicts { margin: 8px 0 0; padding-left: 16px; list-style: disc; font-size: 11.5px; color: var(--color-caution); line-height: 1.6; }
.upcoming { display: grid; gap: 2px; padding: 10px 20px 12px; border-top: 1px dashed var(--color-border); }
.upcoming > .micro { margin-bottom: 4px; }
.up-row { display: flex; align-items: baseline; gap: 12px; padding: 4px 0; }
.up-row .d { font-family: var(--font-num); font-size: 11.5px; color: var(--color-text-muted); width: 74px; flex: none; font-variant-numeric: tabular-nums; }
.up-row .n { font-size: 12.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ——— 仪表 ——— */
/* 深色表面由 BaseCard variant="ink" 提供，这里只管这块面板自己的内距与排版 */
.gauge { --card-pad: 15px 18px 16px; display: flex; flex-direction: column; }
.g-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
/* display:contents 让手机/平板之外保持"环在上、图例与数字在下"的原样结构 */
.g-body { display: contents; }
.g-head .micro { color: var(--ink-panel-muted); }
.g-title { font-size: 12.5px; color: rgba(255, 255, 255, 0.88); margin-top: 3px; font-weight: 500; }
.live { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-num); font-size: 10px; letter-spacing: 0.14em; color: rgba(255, 255, 255, 0.55); }
.live i { width: 5px; height: 5px; border-radius: 50%; background: var(--brand-pole-a-dark); }
/* 环本身的尺寸/几何在 TwoPoleDial 里；这里只放它在版面里的位置与环内的字 */
.dial { align-self: center; margin-top: 2px; }
.num-big { font-family: var(--font-num); font-size: 62px; font-weight: 600; line-height: 0.92; letter-spacing: -0.045em; color: #fff; font-variant-numeric: tabular-nums; }
.num-big sup { font-size: 14px; letter-spacing: 0; vertical-align: super; color: rgba(255, 255, 255, 0.5); margin-left: 3px; }
.num-cap { font-size: 11.5px; color: rgba(255, 255, 255, 0.62); margin-top: 7px; }
.num-note { margin-top: 3px; font-family: var(--font-num); font-size: 10px; color: rgba(255, 255, 255, 0.42); letter-spacing: 0.04em; }
.legend { display: flex; gap: 16px; justify-content: center; margin-top: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255, 255, 255, 0.66); }
.legend i { width: 14px; height: 3px; border-radius: 2px; display: block; }
.legend b { font-family: var(--font-num); font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }
.g-foot { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 14px; border-top: 1px solid var(--ink-panel-line); }
.g-foot > div { padding: 11px 4px 0; text-align: center; }
.g-foot > div + div { border-left: 1px solid var(--ink-panel-line); }
.g-foot b { display: block; font-family: var(--font-num); font-size: 19px; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.g-foot em { font-style: normal; font-size: 12px; color: rgba(255, 255, 255, 0.45); }
.g-foot span { font-size: 10.5px; color: rgba(255, 255, 255, 0.5); }

/* ——— 账本 ——— */
.ledger { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 14px; margin-top: 14px; }
.ledger-pane { display: flex; flex-direction: column; min-width: 0; }

.bars { display: flex; align-items: flex-end; gap: 10px; min-height: 128px; padding: 6px 20px 10px; border-bottom: 1px solid var(--hair-strong); margin: 0 20px 10px; }
.bars .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; }
.bars .bar { width: 100%; max-width: 34px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #12857c, #0c655e); }
.bars .col.zero .bar { background: repeating-linear-gradient(45deg, var(--hair-strong) 0 3px, transparent 3px 6px); }
/* 今天但还没有数据：只描边。今天有数据：照常填色，靠加粗日期区分 */
.bars .col.today.zero .bar { background: transparent; box-shadow: inset 0 0 0 1.4px var(--color-accent); }
.bars .v { font-family: var(--font-num); font-size: 10.5px; font-weight: 600; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.bars .v.dim { color: var(--color-text-muted); font-weight: 500; }
.bars .d { font-family: var(--font-num); font-size: 10px; letter-spacing: 0.1em; color: var(--color-text-muted); }
.bars .col.today .d { color: var(--color-accent); font-weight: 700; }
.bars-empty { padding: 4px 20px 18px; font-size: 12px; line-height: 1.6; color: var(--color-text-muted); }

.meals { display: flex; flex-direction: column; }
.mrow { display: flex; align-items: center; gap: 10px; padding: 9px 20px; }
.mrow + .mrow { border-top: 1px solid var(--hair-soft); }
.mrow .t { font-family: var(--font-num); font-size: 10.5px; color: var(--color-text-muted); width: 34px; flex: none; font-variant-numeric: tabular-nums; }
.mrow .n { flex: 1; min-width: 0; font-size: 12.5px; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mrow .n small { color: var(--color-text-muted); font-size: 11px; margin-left: 6px; }
.mrow .n.dim { color: var(--color-text-muted); }
.mrow .act { font-size: 11.5px; font-weight: 700; color: var(--color-accent); white-space: nowrap; }
.mrow .act.dim { color: var(--color-text-muted); font-weight: 500; }

/* 形状即状态已抽到 ShapeState 组件：实心=完整，半填=部分，空心=未记录 */

.why { --card-pad: 13px 18px 14px; display: flex; flex-direction: column; gap: 9px; }
.why .q { display: flex; align-items: flex-start; gap: 7px; font-size: 13px; font-weight: 600; color: var(--color-ink); }
.why .q :deep(svg) { color: var(--color-accent); flex: none; margin-top: 2px; }
.why p { margin: 0; font-size: 11.8px; line-height: 1.7; color: var(--color-text-muted); }
.why .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; padding-top: 4px; }
.why .tags span { font-size: 10.5px; padding: 3px 7px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text-muted); background: var(--color-card); }

.footnote { display: flex; justify-content: space-between; align-items: center; padding: 10px 2px 4px; }
.footnote span { font-size: 10.5px; color: var(--color-text-muted); }

/* ——— 自适应 ——— */
@media (max-width: 1279px) {
  .ledger { grid-template-columns: 1fr 1fr; }
  .why { grid-column: 1 / -1; }
}
@media (max-width: 1099px) {
  .cluster { grid-template-columns: 1fr; }
  /* 窄下来之后仪表改成横向：左边环、右边三格数字，避免变成一块空荡荡的长条 */
  .g-body { display: grid; grid-template-columns: 236px minmax(0, 420px); justify-content: center; align-items: center; gap: 4px 26px; }
  .dial { justify-self: center; margin-top: 6px; }
  .g-side { display: flex; flex-direction: column; gap: 10px; }
  .legend { justify-content: flex-start; margin-top: 0; }
  .g-foot { margin-top: 0; border-top: none; grid-template-columns: 1fr; }
  .g-foot > div { display: flex; align-items: baseline; justify-content: space-between; padding: 0; text-align: left; }
  .g-foot > div + div { border-left: none; border-top: 1px solid var(--ink-panel-line); padding-top: 6px; margin-top: 6px; }
  .g-foot span { order: -1; font-size: 11px; }
  .g-foot b { font-size: 17px; }
}
@media (max-width: 767px) {
  .lede { flex-direction: column; align-items: stretch; gap: 14px; padding: 14px 0 14px; }
  .lede h1 { font-size: 30px; }
  .lede h1 .unit { font-size: 15px; }
  .lead-r { padding-bottom: 0; }
  .lead-r .btn { flex: 1; height: 46px; }
  .meta { font-size: 12px; gap: 8px; }
  .cluster { gap: 12px; }
  .tl-row { grid-template-columns: 44px 16px minmax(0, 1fr) auto; gap: 9px; padding: 12px 14px; }
  .tl-row::after { left: 14px; display: none; }
  .tl-time { font-size: 10px; }
  .panel-head { padding: 12px 14px 10px; }
  .tl-note { grid-template-columns: 44px 1fr; padding: 10px 14px; }
  .tl-note .lock { display: none; }
  .tl-foot { grid-template-columns: repeat(3, 1fr); padding: 10px 14px 12px; }
  .tl-foot > div + div { padding-left: 10px; }
  .tl-foot .k { font-size: 8.5px; letter-spacing: 0.1em; }
  .tl-foot .v { font-size: 11.5px; }
  .ledger { grid-template-columns: 1fr; }
  .why { grid-column: auto; }
  .bars { padding-left: 14px; padding-right: 14px; margin-left: 14px; margin-right: 14px; }
  .mrow { padding: 9px 14px; }
  .gauge { --card-pad: 14px 14px 15px; }
  .g-body { grid-template-columns: 132px minmax(0, 1fr); justify-content: stretch; gap: 2px 14px; }
  /* 环的直径由组件读取 --dial-size，窄屏只改这个变量，不动组件的 svg */
  .dial { --dial-size: 132px; }
  .num-big { font-size: 34px; }
  .num-big sup { font-size: 10px; margin-left: 1px; }
  .num-cap { font-size: 9.5px; margin-top: 3px; }
  .num-note { display: none; }
  .legend { gap: 12px; }
  .legend span { font-size: 10.5px; }
  .g-foot span { font-size: 10px; }
  .g-foot b { font-size: 15px; }
}
</style>
