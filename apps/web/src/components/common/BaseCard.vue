<template>
  <article class="card" :class="[variant, { interactive, glass }]"><slot /></article>
</template>

<script setup lang="ts">
/**
 * 全站只有两种表面：
 *   default / flush —— 纸面：白底 + 1px 发丝线 + 顶亮内描边，不再靠投影"浮"起来
 *   ink             —— 仪表面：深墨 + 细网格，只给承载数据仪表的那一块
 * flush 用于自带表头/行分隔的面板（首页时间轴、周报账本），避免两层 padding 打架。
 */
withDefaults(
  defineProps<{
    interactive?: boolean
    /** 旧参数：玻璃面。保留是为了不打断现有调用，视觉上已退成半透明纸面 */
    glass?: boolean
    variant?: 'default' | 'flush' | 'ink'
  }>(),
  { interactive: false, glass: false, variant: 'default' }
)
</script>

<style scoped>
.card {
  position: relative;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  /* 内距走变量，调用方要改直接给 --card-pad，不必和组件抢选择器优先级 */
  padding: var(--card-pad, var(--space-6));
  box-shadow: var(--inner-light);
  transition: border-color var(--motion-base) var(--easing-ease-out), background var(--motion-base);
}

/* 悬停只交换边框颜色，不做位移——"浮起来"是 2.x 的手感，别带回来 */
.card.interactive:hover {
  border-color: var(--hair-strong);
}

.card.flush {
  --card-pad: 0;
  overflow: hidden;
}

.card.ink {
  overflow: hidden;
  color: var(--ink-panel-on);
  border-color: #26313a;
  background: linear-gradient(180deg, var(--ink-panel-top) 0%, var(--ink-panel) 58%, #0d1114 100%);
  box-shadow: none;
}

/* 极细网格：只用来交代"这是仪器面"，不做装饰性花纹 */
.card.ink::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.045) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(120% 100% at 70% 0%, #000 25%, transparent 78%);
  -webkit-mask-image: radial-gradient(120% 100% at 70% 0%, #000 25%, transparent 78%);
}

.card.glass {
  background: var(--surface-glass);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
}

@media (prefers-reduced-transparency: reduce) {
  .card.glass {
    background: var(--color-card);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
