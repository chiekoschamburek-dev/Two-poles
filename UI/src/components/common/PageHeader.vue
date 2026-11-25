<template>
  <!--
    二级页统一页头：极性身份 + 标题 + 可选主副标 + 右侧操作。
    只负责版式与视觉语义，不读 store/路由；容器宽度由各页的 page-wrap 负责。
    结构是 grid：左上身份、右上操作，其余行（kicker/主副标/说明/附加）横跨整行；
    手机上操作排到说明之后，避免"标题 → 操作 → 说明"的怪顺序。
  -->
  <header class="ph" :class="[`pole-${pole}`, { 'ph-flush': flush }]">
    <div class="ph-id">
      <PoleMark v-if="pole !== 'neutral'" :pole="pole" :size="30" class="ph-mark" />
      <div class="ph-copy">
        <span v-if="labelText" class="ph-label">{{ labelText }}</span>
        <h1 class="ph-title">{{ title }}</h1>
      </div>
    </div>

    <div v-if="$slots.actions" class="ph-actions">
      <slot name="actions" />
    </div>

    <p v-if="kicker" class="ph-kicker">{{ kicker }}</p>
    <p v-if="$slots.lead" class="ph-lead">
      <slot name="lead" />
    </p>
    <p v-if="subtitle" class="ph-sub">{{ subtitle }}</p>
    <div v-if="$slots.below" class="ph-below">
      <slot name="below" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import PoleMark from '@/components/poles/PoleMark.vue'

/**
 * pole="movement" / "nutrition" 时左侧显示两仪标记与「左极 · MOVEMENT」这类身份标签；
 * pole="neutral" 时退成站内原有的小方块 + 英文栏目名（如 SETTINGS），不新造「中性」字样。
 * flush：页面容器自带 gap 时不要再叠页头下边距。
 */
const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  pole?: 'movement' | 'nutrition' | 'neutral'
  /** 覆盖顶部小标签；中性页建议传归属名，如 SETTINGS / PROFILE / REPORT / LIBRARY */
  label?: string
  /** 标题与主副标之间的一行大写小标（如 ANALYSIS · 训练后复盘） */
  kicker?: string
  flush?: boolean
}>(), {
  subtitle: '',
  pole: 'neutral',
  label: '',
  kicker: '',
  flush: false
})

const labelText = computed(() => props.label || (
  props.pole === 'movement'
    ? '左极 · MOVEMENT'
    : props.pole === 'nutrition'
      ? '右极 · NUTRITION'
      : ''
))
</script>

<style scoped>
.ph {
  --ph-accent: var(--color-accent);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 14px;
  padding: 2px 2px 10px;
  margin: 0 0 12px;
}
.ph.ph-flush { margin-bottom: 0; }
.ph.pole-movement { --ph-accent: var(--pole-movement); }
.ph.pole-nutrition { --ph-accent: var(--pole-nutrition); }

.ph-id {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.ph-mark { width: 30px; height: 30px; flex: none; }
.ph-copy { min-width: 0; }

/* 运动/饮食页：极色身份标签；中性页沿用站内「旋转小方块 + 英文栏目名」 */
.ph-label {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-num);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.pole-movement .ph-label { color: var(--pole-movement-strong); }
.pole-nutrition .ph-label { color: var(--pole-nutrition-strong); }
.pole-neutral .ph-label { color: var(--color-accent); letter-spacing: 0.12em; }
.pole-neutral .ph-label::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--color-accent);
  transform: rotate(45deg);
  margin-right: 8px;
  flex: none;
}

.ph-title {
  margin: 2px 0 0;
  font-size: 26px;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--color-ink);
}

.ph-actions {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
  justify-self: end;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.ph-kicker {
  grid-column: 1 / -1;
  margin: 12px 0 0;
  font-family: var(--font-num);
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--color-text-muted);
}
/* 主副标：与标题同号，靠极色与字重分层；尾巴那截小一号、降成说明色 */
.ph-lead {
  grid-column: 1 / -1;
  margin: 5px 0 0;
  font-size: 26px;
  line-height: 1.16;
  letter-spacing: -0.035em;
  font-weight: 600;
  color: var(--color-ink);
}
.ph-lead :deep(em) {
  font-style: normal;
  color: var(--ph-accent);
  letter-spacing: -0.04em;
}
.ph-lead :deep(span) {
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-text-muted);
}
.ph-sub {
  grid-column: 1 / -1;
  margin: 6px 0 0;
  max-width: 820px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
/* 有主副标的页面，说明文字压小一号，避免和主标抢注意力 */
.ph-lead + .ph-sub { font-size: 11px; }
.ph-below {
  grid-column: 1 / -1;
  margin-top: 9px;
}

@media (max-width: 767px) {
  .ph {
    grid-template-columns: minmax(0, 1fr);
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .ph-title { font-size: 22px; }
  /* 手机上让操作排在说明之后，读起来是「这是什么 → 能干什么」 */
  .ph-actions {
    grid-column: 1;
    grid-row: auto;
    order: 9;
    justify-self: start;
    justify-content: flex-start;
    margin-top: 10px;
  }
  .ph-kicker { margin-top: 10px; }
  .ph-lead { font-size: 20px; }
  .ph-lead :deep(span) { font-size: 12px; }
  .ph-sub { font-size: 11.5px; max-width: none; }
  .ph-lead + .ph-sub { font-size: 11px; }
}
</style>