<template><nav class="mobile-nav" aria-label="移动端导航"><RouterLink v-for="item in items" :key="item.to" :to="item.to" :class="{ on: isOn(item) }" :aria-current="isOn(item) ? 'page' : undefined"><component :is="item.icon" :size="19"/><span>{{item.label}}</span></RouterLink></nav></template>
<script setup lang="ts">import { computed } from 'vue'; import { useRoute } from 'vue-router'; import { CircleDot, Utensils, BarChart3, UserRound } from 'lucide-vue-next'
// 计划与跟练是运动一侧的下钻页，归在"两仪"名下；底栏只留四个一级入口
const items=[{to:'/',label:'两仪',icon:CircleDot,owns:['/plan','/execution']},{to:'/meals',label:'记录',icon:Utensils},{to:'/report',label:'图表',icon:BarChart3},{to:'/settings',label:'我的',icon:UserRound,owns:['/onboarding']}]
const route=useRoute()
const path=computed(() => route.path)
const isOn=(item:{to:string;owns?:string[]}) => path.value === item.to || (item.owns || []).some(p => path.value.startsWith(p))
</script>
<style scoped>/* 浮起来的胶囊底栏：一条边 + 一层浅影，比"贴边的半透明长条"更像一块可以点的地方 */
.mobile-nav{display:none}@media(max-width:767px){.mobile-nav{display:flex;position:fixed;left:10px;right:10px;bottom:10px;height:var(--mobile-nav-height);z-index:var(--z-sticky);background:var(--surface-glass-strong);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);border:1px solid var(--color-border);border-radius:var(--radius-xl);box-shadow:0 12px 30px -20px rgba(17,22,26,.5),var(--inner-light);justify-content:space-around;align-items:center;padding:0 4px}.mobile-nav a{position:relative;color:var(--color-text-muted);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:60px;min-height:46px;font-size:10.5px;letter-spacing:.02em;padding:5px 10px;border-radius:var(--radius-md);transition:color var(--motion-fast),background var(--motion-fast)}.mobile-nav a.on{color:var(--color-accent);font-weight:700;background:var(--color-accent-soft)}}</style>
