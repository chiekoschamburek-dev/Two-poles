<template><div class="metric-card" :class="tone"><div class="metric-top"><span>{{label}}</span><div class="metric-icon"><component :is="icon" :size="18"/></div></div><strong>{{value}}</strong><small v-if="hint">{{hint}}</small></div></template>
<script setup lang="ts">import type { Component } from 'vue'; withDefaults(defineProps<{label:string;value:string|number;hint?:string;icon?:Component;tone?:'default'|'success'|'caution'}>(),{tone:'default'})
</script>
<style scoped>/* 白卡 + 1px 描边 + 单层浅影；颜色只出现在数字上，且只表达状态 */
.metric-card{padding:18px;border-radius:16px;background:var(--color-card);border:1px solid var(--color-border);box-shadow:var(--shadow-xs);transition:box-shadow var(--motion-base) var(--easing-ease-out),border-color var(--motion-base)}
.metric-card:hover{box-shadow:var(--shadow-sm);border-color:var(--color-accent-line)}
.metric-top{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--color-text-muted)}
.metric-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:var(--color-text-muted);background:var(--color-neutral-soft);transition:color var(--motion-base)}
.metric-card:hover .metric-icon{color:var(--color-accent)}
.metric-card strong{display:block;font-family:var(--font-display);font-size:30px;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin-top:12px;color:var(--color-ink)}
.metric-card small{display:block;font-size:12px;color:var(--color-text-muted);margin-top:5px}
.success strong{color:var(--color-success)}
.caution strong{color:var(--color-caution)}</style>
