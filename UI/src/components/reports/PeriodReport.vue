<template>
  <div class="period-report">
    <header class="period-head">
      <div>
        <span class="micro kick"><i></i>{{ kicker }}</span>
        <h2>{{ heading }}</h2>
        <p>{{ sub }}</p>
      </div>
    </header>

    <StatStrip :items="stats" />

    <p v-if="empty" class="empty-note" role="status">
      这段窗口还没有训练或餐食记录；空白表示“未记录”，不代表没有发生。
    </p>

    <div class="charts">
      <BaseCard variant="flush" class="chart-card">
        <div class="card-head">
          <div>
            <span class="micro">Load by block</span>
            <h3>分块训练负荷</h3>
          </div>
          <div class="legend">
            <span><i class="sw solid"></i>已计算</span>
            <span><i class="sw hatch"></i>缺 RPE</span>
            <span><i class="sw none"></i>未记录</span>
          </div>
        </div>
        <div class="plot" role="img" :aria-label="`${heading}分块训练负荷，${sub}`">
          <div v-for="block in report.blocks" :key="block.start" class="col">
            <span class="v" :class="{ dim: block.load === null }">
              {{ block.load === null ? '—' : block.load }}<i v-if="block.loadCompleteness === 'incomplete'">*</i>
            </span>
            <div class="bar" :class="barClass(block)" :style="{ height: barPx(block) + 'px' }"></div>
          </div>
        </div>
        <div class="block-labels">
          <span v-for="block in report.blocks" :key="block.start">{{ block.label }}</span>
        </div>
        <p class="axis-note">
          * 表示该块有训练但缺 RPE，柱高只累计可计算的日期，不是完整总量。
        </p>
      </BaseCard>

      <BaseCard variant="flush" class="chart-card">
        <div class="card-head">
          <div>
            <span class="micro">Meals</span>
            <h3>餐食结构</h3>
          </div>
          <span class="chip">{{ report.totalMeals ? `${report.mealDays} 天有记录` : '未记录' }}</span>
        </div>
        <div class="matrix" role="img" :aria-label="`${heading}食物类别出现次数`">
          <div v-for="c in categoryRows" :key="c.name" class="mx" :class="{ none: !c.count }">
            <span class="nm">{{ c.name }}</span>
            <span class="cells">
              <i v-for="n in 4" :key="n" :class="{ f: n <= c.level }"></i>
            </span>
            <span class="c">{{ c.count || '—' }}</span>
          </div>
        </div>
        <div v-if="missingCats.length" class="mx-foot">
          <span class="micro">这段窗口没出现过</span>
          <span class="tags"><i v-for="c in missingCats" :key="c">{{ c }}</i></span>
        </div>
        <p class="axis-note">出现次数按记录条目累计，不代表分量或营养摄入量。</p>
      </BaseCard>
    </div>

    <BaseCard variant="flush" class="ledger-card">
      <div class="card-head">
        <div>
          <span class="micro">Blocks</span>
          <h3>分块摘要 <em>{{ report.blocks.length }} 块 · {{ report.totalSessions }} 条训练</em></h3>
        </div>
        <span class="micro">缺 RPE 的块标“不完整”</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>时间块</th><th>有记录</th><th>训练</th><th>时长</th><th>训练负荷</th><th>餐食</th></tr>
          </thead>
          <tbody>
            <tr v-for="block in report.blocks" :key="block.start">
              <td class="d">{{ block.label }}</td>
              <td class="num">{{ block.trainingDays }} 天</td>
              <td class="num">{{ block.sessions }} 次</td>
              <td class="num">{{ block.minutes }} min</td>
              <td class="num">
                {{ block.load === null ? '—' : block.load }}
                <em v-if="block.loadCompleteness === 'incomplete'" class="incomplete">不完整</em>
              </td>
              <td class="num">{{ block.mealDays }} 天</td>
            </tr>
          </tbody>
        </table>
      </div>
    </BaseCard>

    <InsightCard class="quality" :card-id="qualityId" eyebrow="DATA QUALITY" title="这份报告没说的三件事" tone="ink">
      <template #icon><ShieldCheck :size="20" /></template>
      <ul class="lims">
        <li v-for="q in report.dataQuality" :key="q">{{ q }}</li>
      </ul>
      <p class="ver">{{ report.ruleVersion }} · 数据只存本机浏览器</p>
    </InsightCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ShieldCheck } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import StatStrip, { type StatItem } from '@/components/common/StatStrip.vue'
import InsightCard from '@/components/common/InsightCard.vue'
import { FOOD_CATEGORIES } from '@/services/mealRules'
import type { PeriodReport, ReportBlock } from '@/services/reportRules'

const props = defineProps<{
  report: PeriodReport
  kicker: string
  heading: string
  sub: string
  qualityId: string
}>()

const stats = computed<StatItem[]>(() => {
  const r = props.report
  return [
    {
      label: '计划天数',
      value: r.plannedDays,
      unit: r.plannedDays ? '天' : '',
      hint: r.plannedDays ? '按你档案过滤后的安排' : '这段窗口没有安排，不计算完成率'
    },
    {
      label: '有记录天数',
      value: r.trainingDays,
      unit: '天',
      hint: r.completionRate === null ? '未记录不等于没练' : `完成率 ${Math.round(r.completionRate * 100)}% · 未记录不计入分母`,
      tone: r.trainingDays ? 'accent' : 'default'
    },
    {
      label: '总时长',
      value: r.totalMinutes,
      unit: 'min',
      hint: '来自实际记录，不含估算'
    },
    {
      label: '训练负荷',
      value: r.totalLoad === null ? '—' : r.totalLoad,
      unit: r.totalLoad === null ? '' : 'AU',
      hint: r.totalLoad === null
        ? '这段窗口没有一条带 RPE 的记录'
        : `RPE × 时长 · 覆盖 ${r.loadDays} 天${r.unloadedDays > 0 ? `，${r.unloadedDays} 天缺 RPE 未计入` : ''}`
    }
  ]
})

const empty = computed(() => props.report.totalSessions === 0 && props.report.totalMeals === 0)

const maxLoad = computed(() => Math.max(120, ...props.report.blocks.map(b => b.load ?? 0)))
const PLOT_H = 132
function barPx(block: ReportBlock): number {
  if (block.load === null) return 6
  return Math.max(8, Math.round((block.load / maxLoad.value) * PLOT_H))
}
function barClass(block: ReportBlock) {
  return {
    zero: block.loadCompleteness === 'none',
    hatch: block.loadCompleteness === 'incomplete'
  }
}

const categoryRows = computed(() => FOOD_CATEGORIES.slice(0, 8).map(name => {
  const count = props.report.categoryCoverage[name] ?? 0
  const max = Math.max(1, ...FOOD_CATEGORIES.slice(0, 8).map(c => props.report.categoryCoverage[c] ?? 0))
  return { name, count, level: count ? Math.max(1, Math.round((count / max) * 4)) : 0 }
}))
const missingCats = computed(() => FOOD_CATEGORIES.slice(0, 8)
  .filter(c => (props.report.categoryCoverage[c] ?? 0) === 0))
</script>

<style scoped>
.period-report { display: grid; gap: 0; }
.period-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding: 18px 0 14px; }
.kick { display: inline-flex; align-items: center; gap: 8px; }
.kick i { width: 14px; height: 1px; background: var(--color-accent); display: block; }
.period-head h2 { margin: 8px 0 0; font-size: 32px; letter-spacing: -0.03em; }
.period-head p { margin: 7px 0 0; font-size: 12.5px; color: var(--color-text-muted); line-height: 1.6; }
.empty-note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
  background: var(--color-neutral-soft);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.charts { display: grid; grid-template-columns: 1.22fr 1fr; gap: 14px; margin-top: 14px; }
.chart-card { display: flex; flex-direction: column; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 13px 20px 0; }
.card-head h3 { margin: 5px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
.card-head h3 em { font-style: normal; font-size: 11.5px; font-weight: 400; color: var(--color-text-muted); margin-left: 6px; }
.chip {
  display: inline-flex; align-items: center; height: 24px; padding: 0 9px;
  border-radius: var(--radius-sm); border: 1px solid var(--color-border);
  background: var(--color-card);
  font-family: var(--font-num); font-size: 11px; font-weight: 600;
  color: var(--color-text-secondary); font-variant-numeric: tabular-nums;
}
.plot { display: flex; align-items: flex-end; gap: 12px; height: 158px; padding: 14px 20px 0; border-bottom: 1px solid var(--hair-strong); margin: 0 20px; }
.plot .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.plot .bar { width: 100%; max-width: 52px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #12857c, #0c655e); }
.plot .bar.zero { background: transparent; box-shadow: inset 0 0 0 1px var(--hair-strong); }
.plot .bar.hatch { background: repeating-linear-gradient(45deg, var(--color-neutral) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--hair-strong); }
.plot .v { font-family: var(--font-num); font-size: 11.5px; font-weight: 600; color: var(--color-ink); font-variant-numeric: tabular-nums; }
.plot .v.dim { color: var(--color-text-muted); font-weight: 500; }
.plot .v i { font-style: normal; color: var(--color-caution); margin-left: 2px; }
.block-labels { display: flex; padding: 7px 20px 0; margin: 0; }
.block-labels span { flex: 1; text-align: center; font-family: var(--font-num); font-size: 10.5px; color: var(--color-text-muted); white-space: nowrap; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 3px; }
.legend span { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--color-text-muted); }
.sw { width: 11px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.solid { background: var(--color-accent); }
.sw.hatch { background: repeating-linear-gradient(45deg, var(--color-neutral) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--hair-strong); }
.sw.none { box-shadow: inset 0 0 0 1px var(--hair); }
.axis-note { margin: auto 0 0; padding: 10px 20px 13px; font-size: 10.5px; line-height: 1.6; color: var(--color-text-muted); }
.matrix { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 20px; padding: 14px 20px 0; }
.mx { display: grid; grid-template-columns: 46px 1fr auto; align-items: center; gap: 8px; }
.mx .nm { font-size: 12px; color: var(--color-text-secondary); }
.mx .cells { display: flex; gap: 3px; }
.mx .cells i { width: 10px; height: 10px; border-radius: 2px; box-shadow: inset 0 0 0 1.2px var(--hair-strong); }
.mx .cells i.f { background: var(--color-accent); box-shadow: none; }
.mx .c { font-family: var(--font-num); font-size: 10.5px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.mx.none .nm { color: var(--color-text-muted); }
.mx-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 20px 0; margin: auto 0 0; border-top: 1px solid var(--hair-soft); }
.mx-foot .tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mx-foot .tags i { font-style: normal; font-size: 10.5px; color: var(--color-text-muted); padding: 3px 7px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
.ledger-card { margin-top: 14px; }
.table-wrap { overflow-x: auto; padding: 10px 20px 4px; }
table { width: 100%; border-collapse: collapse; min-width: 660px; }
th { text-align: left; padding: 0 10px 8px 0; font-family: var(--font-num); font-size: 9.5px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-text-muted); border-bottom: 1px solid var(--color-ink); white-space: nowrap; }
td { padding: 9px 10px 9px 0; font-size: 12.5px; color: var(--color-text-secondary); border-bottom: 1px solid var(--hair-soft); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
td.num { font-family: var(--font-num); font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
td.d { font-family: var(--font-num); font-variant-numeric: tabular-nums; color: var(--color-text-muted); font-size: 11.5px; white-space: nowrap; }
.incomplete { font-style: normal; font-size: 10px; color: var(--color-caution); margin-left: 4px; }
.quality { margin-top: 14px; }
.lims { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.lims li { position: relative; padding-left: 15px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.7; }
.lims li::before { content: '·'; position: absolute; left: 2px; top: -1px; color: var(--color-accent); font-weight: 700; font-size: 16px; }
.ver { font-size: 10.5px; color: var(--color-text-muted); margin: 10px 0 0; }
@media (max-width: 1099px) { .charts { grid-template-columns: 1fr; } }
@media (max-width: 767px) {
  .period-head { padding: 14px 0 12px; }
  .period-head h2 { font-size: 28px; }
  .plot { padding: 12px 14px 0; margin: 0 14px; gap: 8px; height: 138px; }
  .block-labels { padding: 6px 14px 0; }
  .card-head { padding: 12px 14px 0; }
  .axis-note { padding: 9px 14px 12px; }
  .matrix { padding: 12px 14px 0; gap: 6px 12px; }
  .table-wrap { padding: 8px 14px 2px; }
}
</style>
