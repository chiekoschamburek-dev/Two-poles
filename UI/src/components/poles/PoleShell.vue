<template>
  <article
    class="pole"
    :class="`pole-${pole}`"
    :aria-labelledby="`${pole}-title`"
  >
    <header class="pole-head">
      <div class="identity">
        <PoleMark :pole="pole" :size="30" class="mark" />
        <div class="names">
          <span class="micro">{{ eyebrow }}</span>
          <h2 :id="`${pole}-title`">{{ title }}</h2>
        </div>
        <span v-if="chip" class="chip" :class="chipTone">
          <i class="dot"></i>{{ chip }}
        </span>
        <button class="bridge-btn" type="button" title="打开运动 × 饮食的同期对照" @click="emit('open-bridge')">
          <Link2 :size="13" aria-hidden="true" />
          <span>协同</span>
        </button>
      </div>

      <div class="lead">
        <div class="lead-copy"><slot name="lead" /></div>
        <div class="lead-actions"><slot name="actions" /></div>
      </div>
    </header>

    <PoleTabs
      :tabs="tabs"
      :model-value="modelValue"
      :label="tabsLabel"
      :base="pole"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <div class="pole-body">
      <slot />
    </div>

    <footer class="pole-foot">
      <slot name="foot" />
    </footer>
  </article>
</template>

<script setup lang="ts">
import { Link2 } from 'lucide-vue-next'
import PoleMark from './PoleMark.vue'
import PoleTabs, { type PoleTab } from './PoleTabs.vue'

withDefaults(
  defineProps<{
    pole: 'movement' | 'nutrition'
    title: string
    eyebrow: string
    chip?: string
    chipTone?: '' | 'ok' | 'part'
    tabs: PoleTab[]
    modelValue: string
    tabsLabel: string
  }>(),
  { chip: '', chipTone: '' }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'open-bridge'): void
}>()
</script>

<style scoped>
/* 一根栏：身份条 + 标题区 + 视图切换 + 可独立滚动的身体 + 固定联动脚注。
   桌面两栏并排时它们各自滚动，手机端由 TwoPolesView 叠成可切换的卡片。 */
.pole {
  --pole-color: var(--pole-movement);
  --pole-soft: var(--pole-movement-soft);
  --pole-line: var(--pole-movement-line);
  --pole-strong: var(--pole-movement-strong);
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--inner-light);
}
.pole-nutrition {
  --pole-color: var(--pole-nutrition);
  --pole-soft: var(--pole-nutrition-soft);
  --pole-line: var(--pole-nutrition-line);
  --pole-strong: var(--pole-nutrition-strong);
}

/* 栏顶 3px 身份线：不靠满屏着色区分两极 */
.pole::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, var(--pole-color), color-mix(in srgb, var(--pole-color) 18%, transparent));
  z-index: 1;
}

.pole-head {
  flex: none;
  padding: 17px 18px 12px;
  border-bottom: 1px solid var(--color-divider);
  background: linear-gradient(180deg, color-mix(in srgb, var(--pole-color) 5%, var(--color-card)), var(--color-card) 150px);
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.mark {
  margin-top: 1px;
}
.names {
  min-width: 0;
}
.names h2 {
  margin: 2px 0 0;
  font-size: 19px;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.names .micro {
  color: var(--pole-color);
  white-space: nowrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  margin-left: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  font-family: var(--font-num);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.chip .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.chip.ok {
  color: var(--pole-color);
  border-color: var(--pole-line);
  background: var(--pole-soft);
}
.chip.ok .dot { background: var(--pole-color); }
.chip.part {
  color: var(--color-caution);
  border-color: rgba(138, 90, 0, 0.26);
  background: var(--color-caution-soft);
}
.chip.part .dot { background: var(--color-caution); }

.bridge-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  transition: color var(--motion-fast), background var(--motion-fast), border-color var(--motion-fast);
}
.bridge-btn:hover {
  color: var(--pole-strong);
  background: var(--pole-soft);
  border-color: var(--pole-line);
}

.lead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
}
.lead-copy {
  flex: 1;
  min-width: 0;
}
.lead-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* 标题区内容由各极提供，这里只统一排版 */
.lead-copy :deep(h3) {
  margin: 5px 0 0;
  font-size: 25px;
  line-height: 1.16;
  letter-spacing: -0.025em;
  color: var(--color-ink);
}
.lead-copy :deep(h3 em) {
  font-style: normal;
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--pole-color);
  letter-spacing: -0.035em;
}
.lead-copy :deep(h3 .unit) {
  margin-left: 5px;
  font-family: var(--font-family);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-text-muted);
}
.lead-copy :deep(.lead-k) {
  display: inline-block;
  font-family: var(--font-num);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: var(--tracking-micro);
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.lead-copy :deep(p) {
  margin: 7px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-width: 46ch;
}

.pole-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 14px 16px;
  scrollbar-gutter: stable;
}

.pole-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 9px 16px;
  border-top: 1px solid var(--color-divider);
  background: var(--color-card);
}

@media (max-width: 1279px) {
  .pole-head { padding: 15px 15px 11px; }
  .pole-body { padding: 10px 12px 14px; }
  .lead-copy :deep(h3) { font-size: 22px; }
}
@media (max-width: 767px) {
  .pole-head { padding: 14px 14px 10px; }
  .names h2 { font-size: 18px; }
  .lead {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-top: 12px;
  }
  .lead-actions {
    justify-content: flex-start;
  }
  .lead-copy :deep(h3) { font-size: 24px; }
  .pole-body { padding: 10px 10px 14px; }
  .pole-foot { padding: 8px 14px; }
}
</style>
