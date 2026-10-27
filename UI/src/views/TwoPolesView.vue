<template>
  <div class="poles">
    <header class="poles-head">
      <div class="poles-title">
        <PoleMark pole="both" :size="30" />
        <div>
          <span class="micro">TwoPoles · 双极工作台</span>
          <h1>今日两仪</h1>
        </div>
      </div>
      <p class="poles-note">左侧运动、右侧饮食；底部是两边的同期对照。</p>
      <div class="poles-meta">
        <span class="wk">第 {{ weekNo }} 周 · {{ dateLabel }}</span>
        <RouterLink to="/report" class="report-link">本周周报 <ArrowRight :size="13" /></RouterLink>
      </div>
    </header>

    <div class="deck" :class="{ 'deck-mobile': isDeck }">
      <section
        ref="movementSheet"
        class="sheet sheet-movement"
        :class="{ front: active === 'movement', back: active !== 'movement', linked: linked === 'movement' }"
        :inert="isDeck && active !== 'movement'"
        :aria-hidden="isDeck && active !== 'movement' ? 'true' : undefined"
        aria-label="运动"
        tabindex="-1"
      >
        <MovementPole
          :nutrition="todayFacts"
          @focus-other="focusPole('nutrition')"
          @open-bridge="bridgeOpen = true"
        />
      </section>

      <section
        ref="nutritionSheet"
        class="sheet sheet-nutrition"
        :class="{ front: active === 'nutrition', back: active !== 'nutrition', linked: linked === 'nutrition' }"
        :inert="isDeck && active !== 'nutrition'"
        :aria-hidden="isDeck && active !== 'nutrition' ? 'true' : undefined"
        aria-label="饮食"
        tabindex="-1"
      >
        <NutritionPole
          :movement="todayFacts"
          :movement-week-days="weekFacts.sessionDays"
          @focus-other="focusPole('movement')"
          @open-bridge="bridgeOpen = true"
        />
      </section>

      <button
        v-if="isDeck"
        type="button"
        class="peek"
        :aria-label="`切换到${otherTitle}：${peekLine}。${peekNote}`"
        @click="toggle"
      >
        <Transition name="peek-fade" mode="out-in">
          <span :key="otherPole" class="peek-inner">
            <PoleMark :pole="otherPole" :size="26" />
            <span class="peek-copy">
              <span class="micro">另一极 · {{ otherTitle }}</span>
              <strong>{{ peekLine }}</strong>
              <small>{{ peekNote }}</small>
            </span>
            <span class="peek-swap">
              <ChevronsUpDown :size="15" aria-hidden="true" />
              <span>切换</span>
            </span>
          </span>
        </Transition>
      </button>
    </div>

    <BridgeBand
      v-if="!isDeck"
      :day="todayFacts"
      :week="weekFacts"
      :signals="signals"
      @open="bridgeOpen = true"
      @action="onSignal"
    />

    <BridgeDialog
      :open="bridgeOpen"
      :day="todayFacts"
      :week="weekFacts"
      :signals="signals"
      @close="bridgeOpen = false"
      @action="onSignal"
    />

    <p class="visually-hidden" aria-live="polite">{{ liveMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, ChevronsUpDown } from 'lucide-vue-next'
import MovementPole from '@/components/poles/MovementPole.vue'
import NutritionPole from '@/components/poles/NutritionPole.vue'
import BridgeBand from '@/components/poles/BridgeBand.vue'
import BridgeDialog from '@/components/poles/BridgeDialog.vue'
import PoleMark from '@/components/poles/PoleMark.vue'
import { useAppStore } from '@/stores/app'
import {
  buildBridgeSignals,
  buildWeekFacts,
  peekLine as formatPeekLine,
  readDayFacts,
  type BridgeTarget
} from '@/services/bridgeRules'
import { shortDate, toISODate } from '@/utils/time'

type Pole = 'movement' | 'nutrition'

const store = useAppStore()
const router = useRouter()
const now = new Date()
const today = toISODate(now)
const dateLabel = shortDate(now)

const todayFacts = computed(() => readDayFacts(store.sessions, store.meals, today))
const weekFacts = computed(() => buildWeekFacts(store.sessions, store.meals, now))
const signals = computed(() => buildBridgeSignals(todayFacts.value, weekFacts.value))

const active = ref<Pole>('movement')
const linked = ref<Pole | null>(null)
const bridgeOpen = ref(false)

const isDeck = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
const movementSheet = ref<HTMLElement | null>(null)
const nutritionSheet = ref<HTMLElement | null>(null)
let mediaQuery: MediaQueryList | null = null
let linkTimer: number | undefined

const otherPole = computed<Pole>(() => (active.value === 'movement' ? 'nutrition' : 'movement'))
const otherTitle = computed(() => (otherPole.value === 'movement' ? '运动' : '饮食'))
const activeTitle = computed(() => (active.value === 'movement' ? '运动' : '饮食'))
const liveMessage = computed(() => `${activeTitle.value}界面在前。`)

const peekLine = computed(() => formatPeekLine(otherPole.value, todayFacts.value))
const peekNote = computed(() => {
  if (otherPole.value === 'movement') {
    return `本周 ${weekFacts.value.sessionDays} 天有训练记录`
  }
  const missing = todayFacts.value.missing
  if (!todayFacts.value.recordedSlots) {
    return `本周 ${weekFacts.value.mealDays} 天有餐食记录`
  }
  return missing.length
    ? `覆盖 ${todayFacts.value.coverage.length}/8 类 · 还缺 ${missing.slice(0, 2).join('、')}`
    : `覆盖 ${todayFacts.value.coverage.length}/8 类 · 八类齐`
})

const weekNo = computed(() => {
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
})

function flash(pole: Pole) {
  linked.value = pole
  if (linkTimer) window.clearTimeout(linkTimer)
  linkTimer = window.setTimeout(() => {
    linked.value = null
  }, 1400)
}

/** 两栏之间的"联动"：桌面只高亮另一栏；手机端交换前后两张卡片 */
function focusPole(pole: Pole) {
  if (isDeck.value) {
    active.value = pole
    nextTick(() => {
      const sheet = pole === 'movement' ? movementSheet.value : nutritionSheet.value
      sheet?.focus({ preventScroll: true })
      sheet?.querySelector<HTMLElement>('.pole-body')?.scrollTo({ top: 0 })
    })
  }
  flash(pole)
}

function toggle() {
  focusPole(otherPole.value)
}

function onSignal(target: BridgeTarget) {
  bridgeOpen.value = false
  if (target === 'movement' || target === 'nutrition') {
    focusPole(target)
    return
  }
  const path = target === 'plan'
    ? '/plan'
    : target === 'meals'
      ? '/meals'
      : target === 'execution'
        ? '/execution'
        : '/report'
  router.push(path)
}

function syncDeck() {
  isDeck.value = mediaQuery?.matches ?? false
}

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 1023px)')
  syncDeck()
  mediaQuery.addEventListener('change', syncDeck)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncDeck)
  if (linkTimer) window.clearTimeout(linkTimer)
})
</script>

<style scoped>
.poles {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.poles-head {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 0 2px;
}
.poles-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.poles-title h1 {
  margin: 2px 0 0;
  font-size: 26px;
  line-height: 1.1;
  letter-spacing: -0.03em;
}
.poles-note {
  flex: 1;
  min-width: 0;
  margin: 0 0 3px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}
.poles-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  margin-bottom: 2px;
}
.wk {
  font-family: var(--font-num);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.report-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  color: var(--color-text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.report-link:hover {
  border-color: var(--color-ink);
  color: var(--color-ink);
}

.deck {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  --peek: 88px;
  --overlap: 18px;
}

.sheet {
  min-height: 0;
  height: 100%;
  border-radius: var(--radius-xl);
  outline: none;
  transition: box-shadow var(--motion-base) var(--easing-ease-out);
}
.sheet-movement {
  --pole-color: var(--pole-movement);
}
.sheet-nutrition {
  --pole-color: var(--pole-nutrition);
}
.sheet.linked {
  box-shadow: 0 0 0 2px var(--pole-color), var(--shadow-lg);
}
/* 用内描边而不是外描边：手机端前后卡片贴在一起，外描边会被裁切 */
.sheet:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--pole-color);
}

.peek {
  display: none;
}

/* 手机 / 平板：两张卡片上下叠放，下面那张只露出身份与摘要；点它换位 */
@media (max-width: 1023px) {
  .poles {
    gap: 0;
  }
  .poles-head {
    display: none;
  }
  .deck {
    display: block;
    overflow: hidden;
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: calc(100% - var(--peek) - 6px);
    overflow: hidden;
    transition: transform var(--motion-slow) var(--easing-ease-out), box-shadow var(--motion-base);
    will-change: transform;
  }
  .sheet.front {
    z-index: 2;
    transform: translateY(0);
  }
  .sheet.back {
    z-index: 1;
    transform: translateY(calc(100% - var(--overlap)));
  }
  /* 手机端"另一极"的摘要由下方 peek 卡片承担，卡片里不再重复一条脚注 */
  .sheet :deep(.pole-foot) {
    display: none;
  }
  .peek {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    display: flex;
    height: var(--peek);
    align-items: center;
    padding: 0 12px;
    text-align: left;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: 0 -14px 30px -28px rgba(17, 22, 26, 0.55), var(--inner-light);
    overflow: hidden;
  }
  .peek-inner {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }
  .peek-copy {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .peek-copy .micro {
    color: var(--color-text-muted);
  }
  .peek-copy strong {
    font-size: 14px;
    line-height: 1.25;
    color: var(--color-ink);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peek-copy small {
    font-size: 10.5px;
    line-height: 1.35;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .peek-swap {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hair-strong);
    color: var(--color-text-secondary);
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
  }
}

@media (max-width: 767px) {
  .peek {
    border-radius: var(--radius-lg);
  }
}

.peek-fade-enter-active,
.peek-fade-leave-active {
  transition: opacity var(--motion-fast) var(--easing-ease-out), transform var(--motion-fast) var(--easing-ease-out);
}
.peek-fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}
.peek-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .sheet {
    transition: none;
  }
}
</style>
