<template><div class="metric-card" :class="accent"><div class="metric-top"><span>{{label}}</span><div class="metric-icon"><component :is="icon" :size="18"/></div></div><strong>{{value}}</strong><small v-if="hint">{{hint}}</small></div></template>
<script setup lang="ts">import type { Component } from 'vue'; withDefaults(defineProps<{label:string;value:string|number;hint?:string;icon?:Component;accent?:'teal'|'blue'|'purple'|'orange'}>(),{accent:'teal'})
</script>
<style scoped>.metric-card{position:relative;isolation:isolate;overflow:hidden;padding:20px;border-radius:20px;color:white;min-height:132px;box-shadow:var(--shadow-card),var(--inner-light);transition:transform var(--motion-base) var(--easing-ease-out),box-shadow var(--motion-base)}
.metric-top{display:flex;align-items:center;justify-content:space-between;opacity:.9;font-size:13px;position:relative;z-index:2}
.metric-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#ffffff2e;box-shadow:inset 0 1px 0 #ffffff40;transition:transform var(--motion-base) var(--easing-spring)}
.metric-card strong{display:block;font-family:var(--font-display);font-size:30px;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin-top:12px;position:relative;z-index:2;text-shadow:0 2px 10px rgba(9,42,58,.22)}
.metric-card small{display:block;font-size:12px;opacity:.8;margin-top:5px;position:relative;z-index:2}
/* 光斑：右上高光 + 顶部薄薄一层亮面，替代整块平涂渐变 */
.metric-card::before{content:'';position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(130px 100px at 86% 6%,rgba(255,255,255,.3),transparent 72%),linear-gradient(178deg,rgba(255,255,255,.2),transparent 42%)}
/* 斜向掠过的高光带：hover 时从左侧扫到右侧 */
.metric-card::after{content:'';position:absolute;top:-60%;left:0;width:42%;height:220%;z-index:1;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);transform:translateX(-180%) rotate(10deg);transition:transform var(--motion-slower) var(--easing-ease-out)}
.metric-card:hover{transform:translateY(-4px) scale(1.01);box-shadow:var(--shadow-card-lg),var(--accent-glow)}
.metric-card:hover::after{transform:translateX(320%) rotate(10deg)}
.metric-card:hover .metric-icon{transform:scale(1.16) rotate(-8deg)}
.teal{--accent-glow:0 14px 34px -14px rgba(8,126,128,.6);background:var(--gradient-teal)}
.blue{--accent-glow:0 14px 34px -14px rgba(36,104,160,.6);background:var(--gradient-blue)}
.purple{--accent-glow:0 14px 34px -14px rgba(96,84,190,.55);background:linear-gradient(135deg,#5569c9,#8a62cf)}
.orange{--accent-glow:0 14px 34px -14px rgba(200,130,50,.55);background:linear-gradient(135deg,#d48842,#e5b565)}</style>
