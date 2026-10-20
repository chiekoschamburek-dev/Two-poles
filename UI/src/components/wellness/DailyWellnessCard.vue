<template>
  <BaseCard class="wellness" :class="{ open: expanded }" @click="expand">
    <button
      ref="toggleBtn"
      type="button"
      class="w-toggle"
      :aria-expanded="expanded"
      :aria-controls="detailId"
      :aria-label="`${card.title}${store.isAthleteMode ? '（含运动员补充）' : ''}，${expanded ? '收起详解' : '展开详解'}`"
      @click.stop="expanded = !expanded"
    >
      <span class="w-icon" aria-hidden="true">
        <Leaf v-if="card.category === '饮食'" :size="17" />
        <HeartPulse v-else :size="17" />
      </span>
      <span class="w-text">
        <span class="w-eyebrow micro">
          今日养生 · {{ card.category }} / {{ card.topic }}
          <em v-if="store.isAthleteMode" class="w-mode">运动员补充</em>
        </span>
        <span class="w-title">{{ card.title }}</span>
        <span class="w-summary">{{ card.summary }}</span>
      </span>
      <span class="w-cue">
        {{ expanded ? '收起' : '展开详解' }}
        <ChevronDown :size="15" :class="{ flip: expanded }" />
      </span>
    </button>

    <!-- v-show 让 aria-controls 的目标始终存在；隐藏时不进入无障碍树，也不是内部滚动区 -->
    <Transition name="w-expand">
      <div v-show="expanded" :id="detailId" class="w-detail">
        <div class="w-main">
          <div class="w-prose">
            <p v-for="(paragraph, i) in card.detail" :key="`d-${i}`">{{ paragraph }}</p>
          </div>

          <section class="w-points" aria-label="要点">
            <span class="micro">要点</span>
            <ul>
              <li v-for="(point, i) in card.points" :key="`p-${i}`">{{ point }}</li>
            </ul>
          </section>
        </div>

        <aside class="w-side">
          <!-- 仅在运动员模式追加；卡片本身不随模式切换 -->
          <section v-if="store.isAthleteMode" class="w-athlete" aria-label="运动员补充">
            <span class="w-athlete-label">运动员补充 · {{ card.athlete.focus }}</span>
            <p v-for="(paragraph, i) in card.athlete.detail" :key="`ad-${i}`">{{ paragraph }}</p>
            <ul>
              <li v-for="(point, i) in card.athlete.points" :key="`ap-${i}`">{{ point }}</li>
            </ul>
          </section>

          <div class="w-tags">
            <span v-for="tag in card.tags" :key="tag">{{ tag }}</span>
          </div>

          <div class="w-meta">
            <p class="w-source"><b>来源</b> · {{ card.source }}</p>
            <p class="w-disclaimer">{{ WELLNESS_DISCLAIMER }}</p>
          </div>

          <button type="button" class="w-collapse" @click.stop="collapseFromBottom">
            收起
            <ChevronUp :size="14" />
          </button>
        </aside>
      </div>
    </Transition>
  </BaseCard>
</template>

<script setup lang="ts">
/**
 * 首页「今日养生」每日卡片。
 * 展开态只是组件内的临时 UI 状态：不写 localStorage、不走 store.toggleCard，
 * 也不改变当天取到哪一条（内容只由本机日期决定）。
 */
import { computed, nextTick, ref } from 'vue'
import { ChevronDown, ChevronUp, HeartPulse, Leaf } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import { useAppStore } from '@/stores/app'
import { pickDailyWellnessCard, WELLNESS_DISCLAIMER } from '@/services/wellnessCards'

const props = withDefaults(
  defineProps<{
    /** 首页传入统一的 now，避免卡片与页面标题跨到不同日期 */
    date?: Date
  }>(),
  { date: () => new Date() }
)

const store = useAppStore()
const expanded = ref(false)
const toggleBtn = ref<HTMLButtonElement | null>(null)
const card = computed(() => pickDailyWellnessCard(props.date))
const detailId = computed(() => `wellness-detail-${card.value.id}`)

/** 整卡点击只是鼠标/触屏的快捷方式：只在收起时展开，不抢头部按钮的收起职责 */
function expand() {
  if (!expanded.value) expanded.value = true
}

/** 从底部收起时把焦点还给头部按钮，键盘用户不会「掉」到页面开头 */
async function collapseFromBottom() {
  expanded.value = false
  await nextTick()
  toggleBtn.value?.focus()
}
</script>

<style scoped>
.wellness {
  --card-pad: 0;
  margin-top: 14px;
  cursor: pointer;
}
.wellness:hover { border-color: var(--hair-strong); }
.wellness.open,
.wellness.open:hover { border-color: var(--color-accent-line); cursor: default; }

.w-toggle {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  width: 100%;
  padding: 16px 20px;
  text-align: left;
  color: inherit;
  border-radius: var(--radius-lg);
}
.w-toggle:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -3px; }

.w-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: grid;
  place-items: center;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  flex: none;
}
.w-text { min-width: 0; }
.w-eyebrow { display: block; color: var(--color-accent); }
.w-mode {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid var(--color-accent-line);
  border-radius: 3px;
  font-family: var(--font-family);
  font-style: normal;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-accent-strong);
  vertical-align: 1px;
}
.w-title {
  display: block;
  margin-top: 5px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
  color: var(--color-ink);
}
.w-summary {
  display: block;
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
.w-cue {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-muted);
  white-space: nowrap;
  transition: color var(--motion-fast) var(--easing-ease-out);
}
.wellness:hover .w-cue { color: var(--color-accent); }
.w-cue svg { transition: transform var(--motion-fast) var(--easing-ease-out); }
.w-cue svg.flip { transform: rotate(180deg); }

/* 展开区：正常文档流，不设固定高度、不做内部滚动 */
.w-detail {
  border-top: 1px solid var(--hair-soft);
  padding: 16px 20px 18px;
}
.w-prose p {
  margin: 0;
  max-width: 56em;
  font-size: 13px;
  line-height: 1.8;
  color: var(--color-text-secondary);
}
.w-prose p + p { margin-top: 9px; }

.w-points { margin-top: 16px; }
.w-points > .micro { display: block; margin-bottom: 7px; }
.w-points ul { display: grid; gap: 6px; }
.w-points li {
  position: relative;
  padding-left: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}
.w-points li::before {
  content: '';
  position: absolute;
  left: 1px;
  top: 0.62em;
  width: 5px;
  height: 5px;
  border-radius: 1px;
  background: var(--color-accent);
  transform: rotate(45deg);
}

.w-athlete {
  margin-top: 16px;
  padding: 12px 14px 13px;
  border: 1px solid var(--color-accent-line);
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
}
.w-athlete-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-accent-strong);
}
.w-athlete p {
  margin: 6px 0 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--color-text-secondary);
}
.w-athlete ul { display: grid; gap: 4px; margin-top: 7px; }
.w-athlete li {
  position: relative;
  padding-left: 12px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
.w-athlete li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.65em;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-accent);
}

.w-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 16px; }
.w-tags span {
  font-size: 10.5px;
  padding: 3px 7px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: var(--color-card);
}

.w-meta {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border);
}
.w-source {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.w-source b { font-weight: 600; color: var(--color-text-secondary); }
.w-disclaimer {
  margin: 5px 0 0;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

.w-collapse {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  margin-top: 10px;
  padding: 0 14px;
  border: 1px solid var(--hair-strong);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: var(--color-card);
  transition: color var(--motion-fast), border-color var(--motion-fast);
}
.w-collapse:hover { color: var(--color-accent); border-color: var(--color-accent-line); }
.w-collapse:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

/* 只做轻微的透明度与位移；不裁切长内容 */
.w-expand-enter-active {
  transition: opacity var(--motion-base) var(--easing-ease-out), transform var(--motion-base) var(--easing-ease-out);
}
.w-expand-leave-active {
  transition: opacity var(--motion-fast) var(--easing-ease-out), transform var(--motion-fast) var(--easing-ease-out);
}
.w-expand-enter-from,
.w-expand-leave-to { opacity: 0; transform: translateY(-4px); }

/* 宽屏：正文单独成阅读列，专业补充与来源退到右侧，避免一行排到 100 多字 */
@media (min-width: 1100px) {
  .w-detail {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 30px;
  }
  .w-main,
  .w-side { min-width: 0; }
  .w-side {
    display: flex;
    flex-direction: column;
    padding-left: 26px;
    border-left: 1px solid var(--hair-soft);
  }
  .w-athlete { margin-top: 0; }
  .w-side > .w-tags:first-child { margin-top: 0; }
  .w-athlete + .w-tags { margin-top: 14px; }
  .w-meta { margin-top: 14px; }
  /* 右侧一栏被拉到与正文同高，收起按钮落在末尾而不是悬在半空 */
  .w-collapse { align-self: flex-start; margin-top: auto; }
}

@media (max-width: 767px) {
  .w-toggle {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 10px;
    padding: 14px 14px 13px;
  }
  .w-icon { width: 30px; height: 30px; border-radius: var(--radius-sm); }
  .w-title { font-size: 15.5px; }
  .w-summary { font-size: 12px; }
  .w-cue { grid-column: 2; margin-top: 7px; }
  .w-detail { padding: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .w-expand-enter-active,
  .w-expand-leave-active,
  .w-cue svg { transition: none; }
}
</style>
