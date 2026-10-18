<template>
  <div class="metric" :class="tone">
    <div class="top">
      <span class="lab">{{ label }}</span>
      <component :is="icon" v-if="icon" :size="15" class="ic" />
    </div>
    <strong>{{ value }}</strong>
    <small v-if="hint">{{ hint }}</small>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

/**
 * @deprecated 3.0 起不再使用：指标一律走 StatStrip（发丝线分隔的指标条）。
 * 四张等宽卡会把注意力平分，换成条之后数字才能竖着比。
 * 此文件暂留作 2.x 参考，当前无任何调用；下次能改文件权限时直接删掉。
 */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    icon?: Component
    tone?: 'default' | 'success' | 'caution'
    accent?: string
  }>(),
  { tone: 'default' }
)
</script>

<style scoped>
.metric {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 15px 16px 16px;
  border-radius: var(--radius-md);
  background: var(--color-card);
  border: 1px solid var(--color-border);
  box-shadow: var(--inner-light);
  transition: border-color var(--motion-base) var(--easing-ease-out);
}
.metric:hover { border-color: var(--hair-strong); }

.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lab { font-size: 12px; color: var(--color-text-muted); }
.ic { color: var(--color-text-muted); flex: none; }

.metric strong {
  display: block;
  margin-top: 11px;
  font-family: var(--font-num);
  font-size: 30px;
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink);
}
.metric small {
  display: block;
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.success strong { color: var(--color-success); }
.caution strong { color: var(--color-caution); }
</style>
