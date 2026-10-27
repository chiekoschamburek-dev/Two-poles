<template>
  <aside class="rail" :class="{ open }" aria-label="主导航">
    <RouterLink to="/" class="brand" aria-label="两仪·TwoPoles · 今日两仪" @click="emit('close')">
      <svg viewBox="0 0 64 64" role="img" aria-label="两仪·TwoPoles">
        <g fill="none" stroke-width="5.4">
          <circle cx="32" cy="32" r="21.5" stroke="var(--brand-pole-ring)" />
          <g stroke-linecap="round">
            <path d="M16.3 16.3A22.2 22.2 0 0 1 47.7 16.3" stroke="var(--brand-pole-a)" />
            <path d="M47.7 47.7A22.2 22.2 0 0 1 16.3 47.7" stroke="var(--brand-pole-b)" />
          </g>
        </g>
        <circle cx="10.5" cy="32" r="3.1" fill="var(--brand-pole-a)" />
        <circle cx="53.5" cy="32" r="3.1" fill="var(--brand-pole-b)" />
      </svg>
    </RouterLink>

    <nav>
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :title="item.full"
        @click="emit('close')"
      >
        <component :is="item.icon" :size="19" />
        <span class="short">{{ item.label }}</span>
        <span class="full">{{ item.full }}</span>
      </RouterLink>
    </nav>

    <div class="rail-foot">
      <RouterLink to="/onboarding" class="nav-item" title="个人档案" @click="emit('close')">
        <UserRound :size="18" />
        <span class="short">档案</span>
        <span class="full">个人档案</span>
      </RouterLink>
      <RouterLink to="/settings" class="nav-item" title="个人设置" @click="emit('close')">
        <Settings :size="18" />
        <span class="short">设置</span>
        <span class="full">个人设置</span>
      </RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { CalendarDays, Dumbbell, Utensils, CircleDot, ClipboardList, Settings, UserRound } from 'lucide-vue-next'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 脊上放短标签（86px 装不下全称），title 与移动端抽屉里给全称 */
const items = [
  { to: '/', label: '两仪', full: '今日两仪 · 运动与饮食', icon: CircleDot },
  { to: '/plan', label: '计划', full: '训练计划', icon: CalendarDays },
  { to: '/execution', label: '跟练', full: '摄像头跟练', icon: Dumbbell },
  { to: '/meals', label: '饮食', full: '饮食记录', icon: Utensils },
  { to: '/report', label: '周报', full: '我的周报', icon: ClipboardList }
]
</script>

<style scoped>
/* 图标脊：把 230px 的文字列表压成 86px。省下的宽度全给内容，左侧也多了一条明确的边界 */
.rail {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--sidebar-width);
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 15px 0 14px;
  background: var(--surface-glass);
  backdrop-filter: blur(14px) saturate(1.25);
  -webkit-backdrop-filter: blur(14px) saturate(1.25);
  border-right: 1px solid var(--color-border);
}

.brand { width: 44px; height: 44px; display: grid; place-items: center; margin-bottom: 16px; border-radius: var(--radius-md); }
.brand svg { width: 30px; height: 30px; }
.brand:hover { background: var(--color-neutral-soft); }

nav { display: flex; flex-direction: column; align-items: center; gap: 3px; }

.nav-item {
  width: 64px;
  padding: 9px 0 7px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-decoration: none;
  transition: color var(--motion-fast) var(--easing-ease-out), background var(--motion-fast), border-color var(--motion-fast);
}
.nav-item :deep(svg) { stroke-width: 1.6; }
.nav-item:hover { color: var(--color-text-secondary); background: var(--color-neutral-soft); }

/* 激活态：白底 + 左侧 2px 强调条。不靠颜色面积，一眼能认出"我在哪" */
.nav-item.router-link-active {
  color: var(--color-ink);
  background: var(--color-card);
  border-color: var(--color-border);
  box-shadow: inset 2px 0 0 var(--color-accent), var(--shadow-card);
  font-weight: 600;
}

.nav-item .full { display: none; }

.rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.rail-foot .nav-item { font-size: 9.5px; padding: 7px 0 6px; }

@media (max-width: 1099px) {
  .rail {
    width: 244px;
    align-items: stretch;
    gap: 4px;
    padding: 16px 12px;
    transform: translateX(-100%);
    transition: transform var(--motion-base) var(--easing-ease-out);
    background: var(--surface-glass-strong);
    box-shadow: var(--shadow-lg);
    z-index: calc(var(--z-sticky) + 3);
  }
  .rail.open { transform: translateX(0); }
  .brand { align-self: flex-start; margin: 0 0 14px 2px; }
  nav, .rail-foot { align-items: stretch; gap: 2px; }
  .nav-item {
    width: 100%;
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    padding: 11px 12px;
    font-size: 14px;
    letter-spacing: 0;
  }
  .nav-item.router-link-active { box-shadow: inset 2px 0 0 var(--color-accent); }
  .nav-item .short { display: none; }
  .nav-item .full { display: inline; }
  .rail-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--color-divider); }
  .rail-foot .nav-item { font-size: 13.5px; }
}

@media (prefers-reduced-transparency: reduce) {
  .rail { background: var(--color-card); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
</style>
