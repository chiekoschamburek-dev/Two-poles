<template>
  <BaseCard class="insight">
    <div class="insight-row">
      <span class="insight-icon" :class="tone"><slot name="icon" /></span>
      <div class="insight-body">
        <span class="eyebrow">{{ eyebrow }}</span>
        <h3>{{ title }}</h3>
        <div v-if="!collapsed" class="insight-content"><slot /></div>
      </div>
      <button
        type="button"
        class="insight-toggle"
        :aria-expanded="!collapsed"
        @click="store.toggleCard(cardId)"
      >
        <span>{{ collapsed ? '展开' : '收起' }}</span>
        <ChevronDown :size="15" :class="{ flip: collapsed }" />
      </button>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import BaseCard from './BaseCard.vue'
import { useAppStore } from '@/stores/app'

const props = withDefaults(defineProps<{
  cardId: string
  eyebrow: string
  title: string
  tone?: 'accent' | 'ink'
}>(), { tone: 'accent' })

const store = useAppStore()
const collapsed = computed(() => store.isCardCollapsed(props.cardId))
</script>

<style scoped>
.insight-row{display:flex;align-items:flex-start;gap:16px}
.insight-icon{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:13px;color:var(--color-on-accent)}
.insight-icon.accent{background:var(--color-accent);box-shadow:var(--shadow-accent),inset 0 1px 0 rgba(255,255,255,.42)}
.insight-icon.ink{background:var(--color-ink);color:var(--color-bg);box-shadow:0 10px 22px -12px rgba(21,24,27,.6),inset 0 1px 0 rgba(255,255,255,.22)}
.insight-body{flex:1;min-width:0}
.insight-body h3{font-size:17px;margin:6px 0 8px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}
.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.insight-content{margin-top:2px}
.insight-toggle{display:inline-flex;align-items:center;justify-content:center;gap:5px;align-self:center;flex:none;min-height:44px;padding:0 14px;border-radius:11px;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.insight-toggle:hover{color:var(--color-accent);background:var(--color-accent-soft)}
.insight-toggle .flip{transform:rotate(180deg);transition:transform var(--motion-fast)}
</style>
