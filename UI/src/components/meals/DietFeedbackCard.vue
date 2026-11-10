<template>
  <BaseCard v-if="visible" class="diet-feedback">
    <div class="df-head">
      <div>
        <span class="eyebrow">Diet feedback · 今日</span>
        <h3>今日饮食反馈</h3>
      </div>
      <div class="df-controls">
        <button
          type="button"
          class="df-dismiss"
          @click="onDismiss"
        >今日不再提醒</button>
        <button
          type="button"
          class="df-toggle"
          :aria-expanded="!collapsed"
          aria-label="收起或展开今日饮食反馈"
          @click="store.toggleCard(CARD_ID)"
        >
          <span>{{ collapsed ? '展开' : '收起' }}</span>
          <ChevronDown :size="15" :class="{ flip: collapsed }" />
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="df-body">
      <p v-if="!items.length" class="df-all-good">
        目前已记的结构没触发任何提示，继续保持。
      </p>
      <ul v-else class="df-list">
        <li v-for="item in items" :key="item.id" class="df-item">
          <span class="df-icon"><component :is="ruleIcon(item.id)" :size="17" /></span>
          <div class="df-item-body">
            <div class="df-item-head">
              <strong>{{ item.title }}</strong>
              <span class="df-engine" :class="item.engine">{{ item.engine === 'llm' ? 'AI 建议' : '规则建议' }}</span>
            </div>
            <p class="df-advice">{{ item.advice }}</p>
            <span class="df-basis">{{ item.basis }}</span>
          </div>
        </li>
      </ul>
      <p class="df-fine">
        只按当天已记条目的类别结构提示，不判断份量与营养素，也不作营养建议；当天正餐记不满
        {{ summaryMinMeals }} 餐不给全天结论。规则版本 {{ DIET_RULE_VERSION }}。
      </p>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
/**
 * 今日饮食反馈卡：同一数据源（useDietFeedback）在 /meals 顶部与首页饮食栏各渲染一份。
 * 收起状态走全局 collapsedCards（跨页面记住）；「今日不再提醒」只关今天的 Toast，卡片照常更新。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { Apple, ChevronDown, Cookie, Egg, Salad, Wheat } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import { useAppStore } from '@/stores/app'
import { useDietFeedback } from '@/composables/useDietFeedback'
import { DIET_RULE_VERSION, DIET_THRESHOLDS, type DietRuleId } from '@/services/dietFeedbackRules'
import { meetsImmediateGate } from '@/services/dietFeedbackRules'

const CARD_ID = 'diet-feedback'

const store = useAppStore()
const { items, facts, settings, dismissToday } = useDietFeedback()

const summaryMinMeals = DIET_THRESHOLDS.summaryMinMeals

const collapsed = computed(() => store.isCardCollapsed(CARD_ID))
/** 功能关掉或还没记到门槛就不渲染：不占位，也不给「一片空白」的疑惑 */
const visible = computed(() =>
  settings.value.enabled && !!facts.value && meetsImmediateGate(facts.value)
)

const RULE_ICONS: Record<DietRuleId, Component> = {
  'protein-missing': Egg,
  'staple-heavy': Wheat,
  'veg-missing': Salad,
  'fruit-missing': Apple,
  'snack-heavy': Cookie
}

function ruleIcon(id: DietRuleId): Component {
  return RULE_ICONS[id]
}

function onDismiss() {
  const persisted = dismissToday()
  store.showToast({
    type: persisted ? 'info' : 'warning',
    title: persisted ? '今天不再弹饮食提醒' : '本次已关闭，但没能记住',
    message: persisted
      ? '这张卡片仍然可以随时查看'
      : '浏览器存储不可用，刷新后还会提醒；卡片仍可随时查看',
    duration: 4000
  })
}
</script>

<style scoped>
.diet-feedback{border-color:var(--pole-nutrition-line)}
.df-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.df-head h3{font-size:17px;margin:6px 0 0;letter-spacing:-.01em}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--pole-nutrition-strong);font-weight:700}
.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--pole-nutrition-strong);transform:rotate(45deg);margin-right:8px}
.df-controls{display:flex;align-items:center;gap:6px;flex:none}
.df-dismiss{min-height:32px;padding:0 10px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-card);font-size:11.5px;font-weight:600;color:var(--color-text-secondary);white-space:nowrap;transition:border-color var(--motion-fast), color var(--motion-fast)}
.df-dismiss:hover{border-color:var(--color-caution);color:var(--color-caution)}
.df-toggle{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:32px;padding:0 12px;border-radius:var(--radius-sm);font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.df-toggle:hover{color:var(--color-ink)}
.df-toggle .flip{transform:rotate(180deg);transition:transform var(--motion-fast)}
.df-body{margin-top:12px}
.df-all-good{font-size:13px;color:var(--color-text-secondary);margin:0}
.df-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.df-item{display:flex;gap:12px;align-items:flex-start}
.df-icon{width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:11px;background:var(--pole-nutrition-soft);color:var(--color-teal-strong, var(--color-ink))}
.df-item-body{flex:1;min-width:0}
.df-item-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.df-item-head strong{font-size:13.5px}
.df-engine{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;border:1px solid var(--color-border);color:var(--color-text-muted)}
.df-engine.llm{border-color:var(--color-accent-line);color:var(--color-accent)}
.df-advice{font-size:13px;color:var(--color-text);margin:4px 0 2px}
.df-basis{font-size:11.5px;color:var(--color-text-muted)}
.df-fine{font-size:11px;color:var(--color-text-muted);margin:14px 0 0;padding-top:10px;border-top:1px solid var(--color-divider)}
</style>
