<template>
  <header class="topbar">
    <button class="menu-btn" :aria-label="menuOpen ? '关闭菜单' : '打开菜单'" :aria-expanded="menuOpen" @click="$emit('toggle-menu')">
      <Menu :size="20" />
    </button>

    <RouterLink to="/" class="lockup" aria-label="返回今日两仪">
      <svg class="mark" viewBox="0 0 64 64" role="img" aria-label="两仪·TwoPoles">
        <g fill="none" stroke-width="5.6">
          <circle cx="32" cy="32" r="21.5" stroke="var(--brand-pole-ring)" />
          <g stroke-linecap="round">
            <path d="M16.3 16.3A22.2 22.2 0 0 1 47.7 16.3" stroke="var(--brand-pole-a)" />
            <path d="M47.7 47.7A22.2 22.2 0 0 1 16.3 47.7" stroke="var(--brand-pole-b)" />
          </g>
        </g>
        <circle cx="10.5" cy="32" r="3.1" fill="var(--brand-pole-a)" />
        <circle cx="53.5" cy="32" r="3.1" fill="var(--brand-pole-b)" />
      </svg>
      <span class="brand-short" aria-hidden="true">TWOPOLES</span>
      <span class="micro">TwoPoles · 运动与饮食协同</span>
    </RouterLink>

    <div class="right">
      <!-- 填了周期开始日期才显示"周期第几周"，没填不占位 -->
      <span v-if="cycleWeek" class="cycle-chip" :aria-label="`周期第 ${cycleWeek} 周`">
        <i class="dot"></i>
        <b>W{{ cycleWeek }}</b>
      </span>

      <span class="date">{{ dateLabel }}</span>
      <button class="avatar" aria-label="个人设置" @click="router.push('/settings')">
        <img v-if="store.userProfile?.avatarDataUrl" :src="store.userProfile.avatarDataUrl" alt="" />
        <template v-else>{{ initial }}</template>
      </button>
      <button
        class="gear-btn"
        :class="{ on: route.path === '/settings' }"
        aria-label="个人设置"
        :aria-current="route.path === '/settings' ? 'page' : undefined"
        @click="router.push('/settings')"
      >
        <Settings :size="16" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Menu, Settings } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { shortDate } from '@/utils/time'

withDefaults(defineProps<{ menuOpen?: boolean }>(), { menuOpen: false })
defineEmits<{ (e: 'toggle-menu'): void }>()

const route = useRoute()
const router = useRouter()
const store = useAppStore()
const dateLabel = shortDate(new Date())
const initial = computed(() => store.userProfile?.nickname?.trim()?.charAt(0) || '我')

/** 档案填了周期开始日期时，把"周期第几周"标出来 */
const cycleWeek = computed(() => {
  const start = store.userProfile?.cycleStartDate
  if (!start) return null
  const t = new Date(`${start}T00:00:00`).getTime()
  if (Number.isNaN(t)) return null
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days < 0) return null
  return Math.floor(days / 7) + 1
})
</script>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  height: var(--topbar-height);
  margin-left: var(--sidebar-width);
  padding: 0 var(--gutter) 0 var(--space-7);
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(180deg, var(--color-bg) 62%, color-mix(in srgb, var(--color-bg) 72%, transparent));
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  border-bottom: 1px solid var(--color-divider);
}

.lockup { display: flex; align-items: center; gap: 9px; color: inherit; text-decoration: none; }
/* 导航脊上已经有标志了，桌面端页头不再重复一次；窄屏脊收进抽屉，这里才把标志露出来 */
.mark { display: none; width: 20px; height: 20px; flex: none; }
.lockup .micro { color: var(--color-text-muted); }
.lockup:hover .micro { color: var(--color-text-secondary); }
.brand-short {
  display: none;
  font-family: var(--font-num);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: .18em;
  color: var(--color-text-muted);
  line-height: 1;
}

.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }

.date {
  font-family: var(--font-num);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 周期徽章：白底细边，强调色只出现在那个点与数字上 */
.cycle-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
}
.cycle-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); flex: none; }
.cycle-chip b { font-family: var(--font-num); font-size: 10.5px; font-weight: 600; color: var(--color-accent); letter-spacing: 0.04em; }

.avatar {
  width: 30px;
  height: 30px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--color-ink);
  color: var(--color-card);
  font-family: var(--font-num);
  font-weight: 600;
  font-size: 12.5px;
  display: grid;
  place-items: center;
  transition: transform var(--motion-fast) var(--easing-spring);
  flex: none;
}
.avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
.avatar:hover { transform: scale(1.06); }

.menu-btn { display: none; color: var(--color-ink); }

.gear-btn {
  display: none;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-text-secondary);
  flex: none;
  transition: color var(--motion-fast), border-color var(--motion-fast), background var(--motion-fast);
}
.gear-btn:hover { color: var(--color-ink); border-color: var(--color-ink); }
.gear-btn.on {
  color: var(--color-accent-strong);
  background: var(--color-accent-soft);
  border-color: var(--color-accent-line);
}

@media (max-width: 1099px) {
  .topbar { margin-left: 0; padding: 0 var(--space-6); }
  /* 抽屉在 1099px 就出现了，汉堡按钮必须同一档出现，否则 768–1099 之间没有任何导航入口 */
  .menu-btn { display: grid; place-items: center; width: 32px; height: 32px; margin-left: -8px; }
  .mark { display: block; }
}
@media (max-width: 767px) {
  .topbar { padding: 0 var(--space-4); gap: 10px; }
  /* 手机只剩合并底栏，不再有抽屉入口 */
  .menu-btn { display: none; }
  .mark { width: 18px; height: 18px; }
  .lockup .micro { display: none; }
  .brand-short { display: inline; }
  .date { display: none; }
  .avatar { display: none; }
  .gear-btn { display: grid; }
}
</style>
