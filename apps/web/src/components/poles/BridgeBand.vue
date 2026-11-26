<template>
  <section class="bridge" aria-label="运动与饮食的同期对照">
    <div class="b-dial">
      <TwoPoleDial
        :training="week.movementRate"
        :meal="week.nutritionRate"
        :size="76"
        tone="paper"
        :show-ticks="false"
        :show-inner-ring="false"
        :aria-label="dialLabel"
      >
        <span class="dial-big">{{ week.pairedDays }}</span>
        <span class="dial-cap">天同记</span>
      </TwoPoleDial>
    </div>

    <div class="b-copy">
      <span class="micro">合 · 今日同期对照</span>
      <p class="b-line">
        今天已记录运动 <b>{{ day.sessionMinutes }}</b> 分钟、饮食 <b>{{ day.recordedSlots }}/3</b> 餐；本周运动 <b>{{ week.sessionDays }}</b> 天、饮食 <b>{{ week.mealDays }}</b> 天。
      </p>
      <small>只做同期对照，不推断因果；未记录不等于没发生。</small>
    </div>

    <div class="b-signals">
      <button
        v-for="signal in topSignals"
        :key="signal.id"
        type="button"
        class="signal"
        :class="signal.tone"
        @click="emit('action', signal.action.target)"
      >
        <span class="sig-dot" aria-hidden="true"></span>
        <span class="sig-text">{{ signal.title }}</span>
        <ArrowRight :size="12" aria-hidden="true" />
      </button>
    </div>

    <BaseButton variant="secondary" size="sm" @click="emit('open')">展开协同</BaseButton>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import TwoPoleDial from '@/components/common/TwoPoleDial.vue'
import type { BridgeSignal, BridgeTarget, DayFacts, WeekFacts } from '@/services/bridgeRules'

const props = defineProps<{
  day: DayFacts
  week: WeekFacts
  signals: BridgeSignal[]
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'action', target: BridgeTarget): void
}>()

const topSignals = computed(() => props.signals.slice(0, 2))
const dialLabel = computed(() =>
  `本周运动 ${props.week.sessionDays} 天、饮食 ${props.week.mealDays} 天；两边都有记录 ${props.week.pairedDays} 天`
)
</script>

<style scoped>
.bridge {
  flex: none;
  display: grid;
  grid-template-columns: auto minmax(0, 1.15fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 11px 16px;
  border: 1px solid var(--color-border);
  border-top-color: var(--hair-strong);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(120% 180% at 0% 0%, color-mix(in srgb, var(--pole-movement) 6%, transparent), transparent 52%),
    radial-gradient(120% 180% at 100% 0%, color-mix(in srgb, var(--pole-nutrition) 7%, transparent), transparent 52%),
    var(--color-card);
  box-shadow: var(--inner-light);
}

.b-dial {
  flex: none;
}
.dial-big {
  display: block;
  font-family: var(--font-num);
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
.dial-cap {
  display: block;
  margin-top: 2px;
  font-size: 8.5px;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
}

.b-copy {
  min-width: 0;
}
.b-copy .micro {
  color: var(--color-text-muted);
}
.b-line {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.b-line b {
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}
.b-copy small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.b-signals {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.signal {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  text-align: left;
  color: var(--color-text-secondary);
  transition: background var(--motion-fast), border-color var(--motion-fast);
}
.signal:hover {
  background: var(--color-neutral-soft);
  border-color: var(--color-border);
}
.sig-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.signal.movement .sig-dot { background: var(--pole-movement); }
.signal.nutrition .sig-dot { background: var(--pole-nutrition); }
.signal.caution .sig-dot { background: var(--color-caution); }
.sig-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.signal :deep(svg) {
  flex: none;
  color: var(--color-text-muted);
}

@media (max-width: 1279px) {
  .bridge { gap: 12px; padding: 10px 13px; }
  .b-line { font-size: 12px; }
  .signal { padding-left: 4px; padding-right: 4px; }
}
</style>
