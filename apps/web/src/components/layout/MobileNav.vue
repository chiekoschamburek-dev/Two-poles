<template>
  <nav
    class="mobile-nav"
    :class="[context === 'movement' ? 'ctx-movement' : context === 'nutrition' ? 'ctx-nutrition' : '', { five: items.length > 4 }]"
    aria-label="底部导航"
  >
    <RouterLink
      v-for="item in items"
      :key="`${item.to}-${item.label}`"
      :to="item.to"
      class="nav-item"
      :class="[item.tone, { on: item.active }]"
      :aria-current="item.active ? 'page' : undefined"
    >
      <PoleMark v-if="item.pole" :pole="item.pole" :size="19" />
      <component v-else-if="item.icon" :is="item.icon" :size="19" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect, type Component } from 'vue'
import { useRoute } from 'vue-router'
import { CalendarDays, Dumbbell, Pill, UserRound, Utensils, Video } from 'lucide-vue-next'
import PoleMark from '@/components/poles/PoleMark.vue'

type Pole = 'movement' | 'nutrition'
type Tone = 'move' | 'nut' | 'mine' | ''
interface NavItem {
  to: string
  label: string
  tone: Tone
  active: boolean
  pole?: Pole
  icon?: Component
}

const route = useRoute()
const path = computed(() => route.path)
// 手机底栏是上下文导航：档案/报告等全局页沿用最后一次进入的极
const lastPole = ref<Pole>('movement')

const isMovementPath = (p: string) =>
  p === '/movement' || p.startsWith('/plan') || p.startsWith('/execution') || p.startsWith('/analysis')
const isNutritionPath = (p: string) => p === '/nutrition' || p.startsWith('/meals') || p.startsWith('/supplements')

const context = computed<'home' | Pole>(() => {
  if (path.value === '/') return 'home'
  if (isMovementPath(path.value)) return 'movement'
  if (isNutritionPath(path.value)) return 'nutrition'
  return lastPole.value
})

watchEffect(() => {
  if (isMovementPath(path.value)) lastPole.value = 'movement'
  else if (isNutritionPath(path.value)) lastPole.value = 'nutrition'
})

const mine = computed(() => ({
  to: '/onboarding',
  label: '我的',
  icon: UserRound,
  tone: 'mine' as Tone,
  active: path.value.startsWith('/onboarding')
}))

const items = computed<NavItem[]>(() => {
  if (context.value === 'home') {
    return [
      { to: '/movement', label: '运动', pole: 'movement', tone: 'move', active: false },
      { to: '/nutrition', label: '饮食', pole: 'nutrition', tone: 'nut', active: false },
      mine.value
    ]
  }

  if (context.value === 'movement') {
    return [
      { to: '/movement', label: '运动', pole: 'movement', tone: 'move', active: path.value === '/movement' },
      { to: '/execution', label: '跟练', icon: Dumbbell, tone: 'move', active: path.value.startsWith('/execution') },
      { to: '/plan', label: '训练计划', icon: CalendarDays, tone: 'move', active: path.value.startsWith('/plan') },
      { to: '/analysis', label: '分析', icon: Video, tone: 'move', active: path.value.startsWith('/analysis') },
      mine.value
    ]
  }

  return [
    { to: '/nutrition', label: '饮食', pole: 'nutrition', tone: 'nut', active: path.value === '/nutrition' },
    { to: '/meals', label: '记录', icon: Utensils, tone: 'nut', active: path.value.startsWith('/meals') },
    { to: '/supplements', label: '补剂', icon: Pill, tone: 'nut', active: path.value.startsWith('/supplements') },
    mine.value
  ]
})
</script>

<style scoped>
.mobile-nav { display: none; }

@media (max-width: 767px) {
  .mobile-nav {
    display: flex;
    position: fixed;
    left: 10px;
    right: 10px;
    /* PWA 独立模式下 iOS Home 指示条悬在底部，胶囊整体上移让位 */
    bottom: calc(10px + var(--safe-bottom));
    height: var(--mobile-nav-height);
    z-index: var(--z-sticky);
    align-items: center;
    padding: 0 4px;
    background: var(--surface-glass-strong);
    backdrop-filter: blur(16px) saturate(1.3);
    -webkit-backdrop-filter: blur(16px) saturate(1.3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    box-shadow: 0 12px 30px -20px rgba(17, 22, 26, .5), var(--inner-light);
  }

  /* 极上下文：首项上方一小段极色，底栏本身仍保持单一纸面 */
  .mobile-nav::before {
    content: "";
    display: none;
    position: absolute;
    top: -1px;
    width: 28px;
    height: 2.5px;
    border-radius: 0 0 3px 3px;
    background: var(--pole-movement);
  }
  .mobile-nav.ctx-movement::before { display: block; left: 27px; }
  .mobile-nav.ctx-nutrition::before {
    display: block;
    /* 饮食上下文现在是 4 格：饮食 / 记录 / 补剂 / 我的 */
    left: 35px;
    background: var(--pole-nutrition);
  }

  .nav-item {
    flex: 1;
    min-width: 0;
    min-height: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 5px 2px;
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: .01em;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--motion-fast), background var(--motion-fast), box-shadow var(--motion-fast);
  }
  .nav-item :deep(svg) {
    width: 19px;
    height: 19px;
    flex: none;
  }
  .mobile-nav.five .nav-item { font-size: 9px; }
  .mobile-nav.five .nav-item :deep(svg) { width: 18px; height: 18px; }

  /* 极图标本身保留自己的颜色；文字只在激活时染色 */
  .nav-item.move { color: var(--color-text-muted); }
  .nav-item.nut { color: var(--color-text-muted); }

  .nav-item.on.move {
    color: var(--pole-movement-strong);
    background: var(--pole-movement-soft);
    box-shadow: inset 0 0 0 1px var(--pole-movement-line);
    font-weight: 700;
  }
  .nav-item.on.nut {
    color: var(--pole-nutrition-strong);
    background: var(--pole-nutrition-soft);
    box-shadow: inset 0 0 0 1px var(--pole-nutrition-line);
    font-weight: 700;
  }
  .nav-item.on.mine {
    color: var(--color-ink);
    background: var(--color-neutral-soft);
    box-shadow: inset 0 0 0 1px var(--color-border);
    font-weight: 700;
  }
}
</style>
