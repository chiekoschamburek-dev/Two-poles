<template>
  <section class="strip" :style="{ '--cols': items.length }">
    <div v-for="it in items" :key="it.label" class="cell" :class="it.tone || 'default'">
      <span class="micro lab">{{ it.label }}</span>
      <div class="val">
        <b>{{ it.value }}</b><em v-if="it.unit">{{ it.unit }}</em>
      </div>
      <p v-if="it.hint" class="hint">{{ it.hint }}</p>
    </div>
  </section>
</template>

<script lang="ts">
/** 指标条的一格。类型放在普通 script 块里，调用方才能 import 到。 */
export interface StatItem {
  label: string
  value: string | number
  unit?: string
  hint?: string
  tone?: 'default' | 'accent' | 'caution'
}
</script>

<script setup lang="ts">
/**
 * 指标条：一条强横线打头、发丝线收尾，中间只有竖线分隔。
 * 替掉"四张等宽卡"——卡会把注意力平分，条只负责把量摆出来。
 * 数字用等宽字（Bahnschrift），竖着比也不跳。
 */
withDefaults(defineProps<{ items: StatItem[] }>(), {})
</script>

<style scoped>
.strip {
  display: grid;
  grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
  border-top: 1px solid var(--color-ink);
  border-bottom: 1px solid var(--color-border);
}

.cell {
  padding: 13px 20px 15px;
  min-width: 0;
}
.cell + .cell {
  border-left: 1px solid var(--color-border);
}

.lab {
  display: block;
  color: var(--color-text-muted);
}

.val {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 9px;
  min-width: 0;
}
.val b {
  font-family: var(--font-num);
  font-size: 44px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink);
}
.val em {
  font-style: normal;
  font-family: var(--font-num);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-text-muted);
}

.hint {
  margin: 8px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.accent .val b { color: var(--color-accent); }
.caution .val b { color: var(--color-caution); }

@media (max-width: 1099px) {
  .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* 2×2 时给第三格补一条上边线，否则中间那道横线会断 */
  .cell:nth-child(3) { border-top: 1px solid var(--color-border); }
  .cell:nth-child(4) { border-top: 1px solid var(--color-border); }
  .cell:nth-child(3) { border-left: none; }
  .val b { font-size: 34px; }
  .cell { padding: 12px 14px 14px; }
}
</style>
