<template>
  <Teleport to="body">
    <Transition name="bridge-pop">
      <div v-if="open" class="overlay" @click.self="close">
        <section
          ref="panel"
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bridge-title"
          tabindex="-1"
        >
          <header class="dlg-head">
            <div class="dlg-title">
              <PoleMark pole="both" :size="26" />
              <div>
                <span class="micro">合 · 协同分析</span>
                <h2 id="bridge-title">两仪 · 同期对照</h2>
              </div>
            </div>
            <button type="button" class="close" aria-label="关闭协同分析" @click="close">
              <X :size="18" />
            </button>
          </header>

          <div class="dlg-body">
            <p class="lead">把同一天的运动与饮食记录并排放在一起。这里只做同期对照：不推断因果，也不给营养处方。</p>

            <div class="summary-grid">
              <div class="sum movement">
                <span class="micro">运动 · 今天</span>
                <b>{{ day.sessionMinutes }}<em>min</em></b>
                <p>{{ day.sessions ? `${day.sessions} 条记录 · 平均 RPE ${day.avgRpe ?? '—'}` : '今天还没记录' }}</p>
              </div>
              <div class="sum nutrition">
                <span class="micro">饮食 · 今天</span>
                <b>{{ day.recordedSlots }}<em>/3 餐</em></b>
                <p>{{ day.recordedSlots ? `覆盖 ${day.coverage.length}/8 类${day.missing.length ? ` · 还缺 ${day.missing.slice(0, 3).join('、')}` : ' · 八类都出现过'}` : '今天还没记录' }}</p>
              </div>
              <div class="sum both">
                <span class="micro">本周 · 两边都有记录</span>
                <b>{{ week.pairedDays }}<em>天</em></b>
                <p>运动 {{ week.sessionDays }} 天 · 饮食 {{ week.mealDays }} 天</p>
              </div>
            </div>

            <section class="cross" aria-labelledby="bridge-cross-title">
              <div class="cross-head">
                <h3 id="bridge-cross-title">训练日 vs 无训练日</h3>
                <span class="micro">只比较有餐食记录的无训练日</span>
              </div>
              <div v-if="week.coverageGap !== null" class="cross-grid">
                <div>
                  <span class="micro">训练日</span>
                  <b>{{ week.avgCoverageTraining }}<em>类 / 天</em></b>
                  <small>{{ week.trainingSampleDays }} 天样本</small>
                </div>
                <div>
                  <span class="micro">无训练日</span>
                  <b>{{ week.avgCoverageRest }}<em>类 / 天</em></b>
                  <small>{{ week.restSampleDays }} 天样本</small>
                </div>
                <div>
                  <span class="micro">差值</span>
                  <b>{{ week.coverageGap > 0 ? '+' : '' }}{{ week.coverageGap }}<em>类</em></b>
                  <small>同期出现，不代表因果</small>
                </div>
              </div>
              <p v-else class="cross-empty">
                样本不足：需要至少 2 个有训练记录的日子和 2 个有餐食记录的无训练日，才给差值。现在分别是
                {{ week.trainingSampleDays }} 天和 {{ week.restSampleDays }} 天；空白日不当作 0 参与平均。
              </p>
            </section>

            <section class="signals" aria-labelledby="bridge-signals-title">
              <div class="cross-head">
                <h3 id="bridge-signals-title">今天与本周能连起来看的地方</h3>
                <span class="micro">{{ signals.length }} 条</span>
              </div>
              <ol class="sig-list">
                <li v-for="signal in signals" :key="signal.id" :class="signal.tone">
                  <span class="sig-tag">{{ toneLabel(signal.tone) }}</span>
                  <div class="sig-copy">
                    <strong>{{ signal.title }}</strong>
                    <p>{{ signal.detail }}</p>
                  </div>
                  <button type="button" class="sig-act" @click="act(signal)">
                    {{ signal.action.label }} <ArrowRight :size="12" />
                  </button>
                </li>
              </ol>
            </section>

            <section class="limits" aria-labelledby="bridge-limits-title">
              <div class="cross-head">
                <h3 id="bridge-limits-title">这份对照没做什么</h3>
              </div>
              <ul>
                <li v-for="limit in BRIDGE_LIMITS" :key="limit">{{ limit }}</li>
              </ul>
              <p class="ver">规则版本 {{ BRIDGE_RULE_VERSION }} · 数据只存本机浏览器</p>
            </section>

          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, X } from 'lucide-vue-next'
import PoleMark from './PoleMark.vue'
import {
  BRIDGE_LIMITS,
  BRIDGE_RULE_VERSION,
  type BridgeSignal,
  type BridgeTarget,
  type DayFacts,
  type WeekFacts
} from '@/services/bridgeRules'

const props = defineProps<{
  open: boolean
  day: DayFacts
  week: WeekFacts
  signals: BridgeSignal[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', target: BridgeTarget): void
}>()

const panel = ref<HTMLElement | null>(null)
let previousOverflow = ''
let previousActive: HTMLElement | null = null

const TONE: Record<BridgeSignal['tone'], string> = {
  movement: '运动',
  nutrition: '饮食',
  caution: '注意',
  neutral: '同期'
}
const toneLabel = (tone: BridgeSignal['tone']) => TONE[tone]

function close() {
  emit('close')
}

function act(signal: BridgeSignal) {
  emit('action', signal.action.target)
  close()
}

/** Esc 关闭 + Tab 在弹层内循环；打开时把焦点放进弹层，关闭后还给触发它的按钮 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab' || !panel.value) return
  const nodes = panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (!nodes.length) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    panel.value?.focus()
  } else {
    document.body.style.overflow = previousOverflow
    window.removeEventListener('keydown', onKeydown)
    previousActive?.focus?.()
  }
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-backdrop);
  background: var(--overlay);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 22px;
}
.dialog {
  width: min(880px, 100%);
  max-height: min(88vh, 940px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, 0.65);
  overflow: hidden;
  outline: none;
}
.dlg-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-card);
}
.dlg-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dlg-title h2 {
  margin: 2px 0 0;
  font-size: 18px;
  letter-spacing: -0.015em;
}
.close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  background: var(--color-card);
  transition: border-color var(--motion-fast), color var(--motion-fast);
}
.close:hover {
  border-color: var(--color-ink);
  color: var(--color-ink);
}
.dlg-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 20px;
  display: grid;
  gap: 14px;
}
.lead {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.sum {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
}
.sum.movement { border-top: 3px solid var(--pole-movement); }
.sum.nutrition { border-top: 3px solid var(--pole-nutrition); }
.sum.both { border-top: 3px solid var(--color-ink); }
.sum b {
  display: block;
  margin-top: 6px;
  font-family: var(--font-num);
  font-size: 30px;
  line-height: 1;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}
.sum b em {
  margin-left: 3px;
  font-style: normal;
  font-size: 12px;
  color: var(--color-text-muted);
  letter-spacing: 0;
}
.sum p {
  margin: 5px 0 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.cross,
.signals,
.limits {
  padding: 13px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
}
.cross-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 9px;
}
.cross-head h3 {
  margin: 0;
  font-size: 13.5px;
  letter-spacing: -0.01em;
}
.cross-head .micro {
  text-align: right;
  white-space: nowrap;
}
.cross-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.cross-grid > div {
  padding: 9px 10px;
  border-left: 1px solid var(--hair-soft);
}
.cross-grid > div:first-child {
  border-left: 0;
  padding-left: 0;
}
.cross-grid b {
  display: block;
  margin-top: 4px;
  font-family: var(--font-num);
  font-size: 19px;
  font-weight: 600;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.cross-grid b em {
  margin-left: 2px;
  font-style: normal;
  font-size: 10.5px;
  color: var(--color-text-muted);
  letter-spacing: 0;
}
.cross-grid small {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
}
.cross-empty {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--color-text-muted);
}

.sig-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.sig-list li {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-base);
  background: var(--color-neutral-soft);
}
.sig-tag {
  display: inline-grid;
  place-items: center;
  min-height: 22px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  background: var(--color-card);
  border: 1px solid var(--color-border);
}
.sig-list li.movement .sig-tag { color: var(--pole-movement); border-color: var(--pole-movement-line); }
.sig-list li.nutrition .sig-tag { color: var(--pole-nutrition); border-color: var(--pole-nutrition-line); }
.sig-list li.caution .sig-tag { color: var(--color-caution); border-color: rgba(138, 90, 0, 0.26); }
.sig-copy strong {
  display: block;
  font-size: 12.5px;
  color: var(--color-ink);
  font-weight: 600;
}
.sig-copy p {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.sig-act {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--hair-strong);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.sig-act:hover {
  border-color: var(--color-ink);
  color: var(--color-ink);
}

.limits ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 5px;
}
.limits li {
  position: relative;
  padding-left: 14px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}
.limits li::before {
  content: '·';
  position: absolute;
  left: 2px;
  top: -1px;
  color: var(--color-accent);
  font-weight: 700;
  font-size: 16px;
}
.limits .ver {
  margin: 8px 0 0;
  font-family: var(--font-num);
  font-size: 10px;
  color: var(--color-text-muted);
}

.bridge-pop-enter-active,
.bridge-pop-leave-active {
  transition: opacity var(--motion-base) var(--easing-ease-out);
}
.bridge-pop-enter-active .dialog,
.bridge-pop-leave-active .dialog {
  transition: transform var(--motion-base) var(--easing-ease-out), opacity var(--motion-base);
}
.bridge-pop-enter-from,
.bridge-pop-leave-to {
  opacity: 0;
}
.bridge-pop-enter-from .dialog,
.bridge-pop-leave-to .dialog {
  transform: translateY(14px) scale(0.99);
  opacity: 0;
}

@media (max-width: 767px) {
  .overlay { padding: 0; place-items: stretch; }
  .dialog {
    width: 100%;
    max-height: 100dvh;
    height: 100dvh;
    border-radius: 0;
    border: 0;
  }
  .dlg-head { padding: 12px 14px; }
  .dlg-body { padding: 12px 12px 18px; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
  .sum.both { grid-column: 1 / -1; }
  .cross-grid { grid-template-columns: 1fr 1fr; }
  .cross-grid > div:nth-child(3) { grid-column: 1 / -1; border-left: 0; padding-left: 0; border-top: 1px solid var(--hair-soft); padding-top: 8px; }
  .sig-list li { grid-template-columns: 40px minmax(0, 1fr); }
  .sig-act { grid-column: 2; justify-self: start; }
}
</style>
