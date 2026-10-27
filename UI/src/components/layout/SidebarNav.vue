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
      <!-- 首页是"两仪"本身；只有精确停在 / 时才高亮，避免进计划/跟练后首页也亮着 -->
      <RouterLink
        to="/"
        class="nav-item"
        title="今日两仪 · 运动与饮食"
        active-class="nav-parent"
        exact-active-class="router-link-active"
        @click="emit('close')"
      >
        <CircleDot :size="19" />
        <span class="short">两仪</span>
        <span class="full">今日两仪 · 运动与饮食</span>
      </RouterLink>

      <span class="nav-sep" aria-hidden="true"></span>

      <div class="nav-group movement" role="group" aria-labelledby="nav-group-movement">
        <span id="nav-group-movement" class="group-head" :class="{ on: movementActive }">
          <i aria-hidden="true"></i><span>运动</span>
        </span>
        <RouterLink
          v-for="item in movementItems"
          :key="item.to"
          :to="item.to"
          class="nav-item movement"
          :title="item.full"
          @click="emit('close')"
        >
          <component :is="item.icon" :size="19" />
          <span class="short">{{ item.label }}</span>
          <span class="full">{{ item.full }}</span>
        </RouterLink>
      </div>

      <div class="nav-group nutrition" role="group" aria-labelledby="nav-group-nutrition">
        <span id="nav-group-nutrition" class="group-head" :class="{ on: nutritionActive }">
          <i aria-hidden="true"></i><span>饮食</span>
        </span>
        <RouterLink
          v-for="item in nutritionItems"
          :key="item.to"
          :to="item.to"
          class="nav-item nutrition"
          :title="item.full"
          @click="emit('close')"
        >
          <component :is="item.icon" :size="19" />
          <span class="short">{{ item.label }}</span>
          <span class="full">{{ item.full }}</span>
        </RouterLink>
      </div>

      <span class="nav-sep" aria-hidden="true"></span>

      <RouterLink
        to="/report"
        class="nav-item"
        title="我的周报"
        @click="emit('close')"
      >
        <ClipboardList :size="19" />
        <span class="short">周报</span>
        <span class="full">我的周报</span>
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
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { CalendarDays, Dumbbell, Utensils, CircleDot, ClipboardList, Settings, UserRound } from 'lucide-vue-next'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const route = useRoute()
const movementActive = computed(() => route.path.startsWith('/plan') || route.path.startsWith('/execution'))
const nutritionActive = computed(() => route.path.startsWith('/meals'))

/** 脊上放短标签（86px 装不下全称），title 与移动端抽屉里给全称 */
const movementItems = [
  { to: '/plan', label: '计划', full: '训练计划', icon: CalendarDays },
  { to: '/execution', label: '跟练', full: '摄像头跟练', icon: Dumbbell }
]
const nutritionItems = [
  // 分组标题已经叫"饮食"，条目用"记录"避免"饮食 / 饮食"重复
  { to: '/meals', label: '记录', full: '饮食记录', icon: Utensils }
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
  overflow-y: auto;
  scrollbar-width: none;
}
.rail::-webkit-scrollbar { display: none; }

.brand { width: 44px; height: 44px; display: grid; place-items: center; margin-bottom: 14px; border-radius: var(--radius-md); flex: none; }
.brand svg { width: 30px; height: 30px; }
.brand:hover { background: var(--color-neutral-soft); }

nav { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 100%; }

.nav-item {
  width: 64px;
  padding: 8px 0 6px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
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

/* 激活态：白底 + 左侧 2px 竖条。运动/饮食各自用自己的极色，其余用全站强调色 */
.nav-item.router-link-active {
  color: var(--color-ink);
  background: var(--color-card);
  border-color: var(--color-border);
  box-shadow: inset 2px 0 0 var(--color-accent), var(--shadow-card);
  font-weight: 600;
}
.nav-item.movement.router-link-active { box-shadow: inset 2px 0 0 var(--pole-movement), var(--shadow-card); }
.nav-item.nutrition.router-link-active { box-shadow: inset 2px 0 0 var(--pole-nutrition), var(--shadow-card); }

.nav-item .full { display: none; }

/* 分组：一级是「运动 / 饮食」，组内才是计划、跟练、记录 */
.nav-group {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-top: 5px;
}
.nav-group.movement { --pole-color: var(--pole-movement); }
.nav-group.nutrition { --pole-color: var(--pole-nutrition); }

.group-head {
  width: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 2px 0 3px;
  font-family: var(--font-num);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--color-text-muted);
  transition: color var(--motion-fast);
}
.group-head i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--pole-color);
  opacity: 0.5;
  flex: none;
}
.group-head.on { color: var(--pole-color); }
.group-head.on i { opacity: 1; }

.nav-sep {
  width: 32px;
  height: 1px;
  margin: 7px 0 3px;
  background: var(--color-divider);
  flex: none;
}

.rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 10px; }
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
  .brand { align-self: flex-start; margin: 0 0 12px 2px; }
  nav, .rail-foot { align-items: stretch; gap: 2px; }
  .nav-item {
    width: 100%;
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    padding: 10px 12px;
    font-size: 14px;
    letter-spacing: 0;
  }
  .nav-item.router-link-active { box-shadow: inset 2px 0 0 var(--color-accent); }
  .nav-item.movement.router-link-active { box-shadow: inset 2px 0 0 var(--pole-movement); }
  .nav-item.nutrition.router-link-active { box-shadow: inset 2px 0 0 var(--pole-nutrition); }
  .nav-item .short { display: none; }
  .nav-item .full { display: inline; }

  .nav-group { align-items: stretch; margin-top: 7px; }
  .group-head {
    width: 100%;
    justify-content: flex-start;
    padding: 4px 12px 3px;
    font-size: 10.5px;
    letter-spacing: 0.14em;
  }
  .group-head i { width: 6px; height: 6px; }
  .nav-sep { width: calc(100% - 24px); margin: 9px 12px 5px; }

  .rail-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--color-divider); }
  .rail-foot .nav-item { font-size: 13.5px; }
}

@media (prefers-reduced-transparency: reduce) {
  .rail { background: var(--color-card); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
</style>
