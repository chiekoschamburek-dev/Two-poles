<template>
  <Teleport to="body">
    <div v-if="open" class="scrim" @click.self="close">
      <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="draft-title">
        <header class="dlg-head">
          <div>
            <span class="micro">AI PLAN · {{ modelLabel }}</span>
            <h2 id="draft-title">{{ title }}</h2>
          </div>
          <button class="x" type="button" aria-label="关闭" @click="close">✕</button>
        </header>

        <!-- 生成中 -->
        <div v-if="state.status === 'loading'" class="state">
          <span class="spin" aria-hidden="true"></span>
          <p>正在把档案交给模型生成计划…</p>
          <small>通常 5–30 秒；模型慢的时候会更久。关掉这个窗口不会取消本次请求。</small>
        </div>

        <!-- 失败 -->
        <div v-else-if="state.status === 'error'" class="state err">
          <p>{{ state.error }}</p>
          <ul v-if="state.warnings.length" class="warns">
            <li v-for="w in state.warnings" :key="w">{{ w }}</li>
          </ul>
          <small>可以在设置页检查 base_url / 模型名 / 密钥，或者换成手工计划。</small>
        </div>

        <!-- 可审核的草稿 -->
        <template v-else-if="local">
          <p class="reason">{{ local.reason }}</p>
          <ul v-if="state.warnings.length" class="warns">
            <li v-for="w in state.warnings" :key="w">{{ w }}</li>
          </ul>

          <div class="days">
            <section v-for="day in local.days" :key="day.date" class="day">
              <div class="day-head">
                <span class="date">{{ day.date }}<i>{{ weekday(day.date) }}</i></span>
                <span class="sum">{{ minutesOf(day) }} 分钟 · {{ day.items.length }} 项</span>
                <button class="rm" type="button" @click="removeDay(day)">移除这天</button>
              </div>
              <div class="item-head">
                <span>动作</span><span>时长</span><span>组</span><span>次</span><span></span>
              </div>
              <div v-for="(it, i) in day.items" :key="i" class="item">
                <span class="name">
                  {{ it.exerciseName }}
                  <i v-if="it.notInLibrary" class="flag">动作库未收录</i>
                </span>
                <input v-model.number="it.plannedDuration" class="n" type="number" min="1" max="180" aria-label="时长（分钟）" />
                <input v-model.number="it.plannedSets" class="n" type="number" min="1" max="20" aria-label="组数" />
                <input v-model.number="it.plannedReps" class="n" type="number" min="0" max="200" aria-label="次数" />
                <button class="rm" type="button" @click="removeItem(day, i)">删</button>
              </div>
              <p v-if="!day.items.length" class="day-empty">这天已清空，确认后不会写入</p>
            </section>
          </div>

          <p class="fine">
            模型只负责排课，不构成医疗或训练处方；确认前可以改任意一项。录入后旧计划会存进版本历史，不会被覆盖。
          </p>
        </template>

        <footer class="dlg-foot">
          <button v-if="state.status !== 'loading'" class="btn ghost" type="button" @click="regen">重新生成</button>
          <span class="spacer"></span>
          <button class="btn ghost" type="button" @click="close">{{ state.status === 'ready' ? '先不录入' : '关闭' }}</button>
          <button v-if="state.status === 'ready'" class="btn primary" type="button" :disabled="!totalItems" @click="confirm">
            确认并录入计划
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import type { PlanDraft, PlanDraftDay } from '@/services/llm'

const store = useAppStore()
const state = computed(() => store.planDraftState)
const open = computed(() => state.value.status !== 'idle')

/** 本地副本：用户改完再确认，取消不污染 store */
const local = ref<PlanDraft | null>(null)

// 每次进入 ready 都重新克隆一份，避免上一轮编辑残留
watch(
  () => state.value.draft,
  (d) => {
    local.value = d ? JSON.parse(JSON.stringify(d)) : null
  },
  { immediate: true }
)

/** 实际生效的模型：自己的优先，否则是服务端默认 */
const modelLabel = computed(() => {
  if (store.llmConfig.model) return store.llmConfig.model
  if (store.llmDefault.model) return `${store.llmDefault.model}（服务端默认）`
  return '未配置模型'
})

const title = computed(() => {
  if (state.value.status === 'loading') return '正在生成计划…'
  if (state.value.status === 'error') return '这次没生成成功'
  return '这份计划要录入吗？'
})

const totalItems = computed(() => local.value?.days.reduce((n, d) => n + d.items.length, 0) ?? 0)

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `周${WEEKDAY[new Date(y, (m ?? 1) - 1, d ?? 1).getDay()] ?? '?'}`
}
function minutesOf(day: PlanDraftDay): number {
  return day.items.reduce((n, i) => n + (Number(i.plannedDuration) || 0), 0)
}

function removeItem(day: PlanDraftDay, index: number) {
  day.items.splice(index, 1)
}
function removeDay(day: PlanDraftDay) {
  if (!local.value) return
  local.value.days = local.value.days.filter(d => d !== day)
}
function regen() {
  void store.generatePlanDraft()
}
function close() {
  store.resetPlanDraft()
}
function confirm() {
  if (!local.value || !totalItems.value) return
  // 清掉空日与空项，避免把 0 项的一天写进计划
  const cleaned: PlanDraft = {
    ...local.value,
    days: local.value.days
      .map(d => ({ ...d, items: d.items.filter(i => i.exerciseName && (i.plannedDuration ?? 0) > 0) }))
      .filter(d => d.items.length)
  }
  store.acceptPlanDraft(cleaned)
}
</script>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 60; background: rgba(17, 22, 26, 0.42);
  backdrop-filter: blur(3px); display: grid; place-items: center; padding: 24px;
}
.dlg {
  width: min(760px, 100%); max-height: min(86vh, 900px); display: flex; flex-direction: column;
  background: var(--color-card); border-radius: var(--radius-xl); border: 1px solid var(--hair, var(--color-border));
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, 0.65); overflow: hidden;
}
.dlg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 14px; border-bottom: 1px solid var(--color-divider); }
.dlg-head h2 { font-size: 19px; margin: 6px 0 0; letter-spacing: -0.01em; }
.x { width: 32px; height: 32px; border-radius: 9px; color: var(--color-text-muted); font-size: 14px; }
.x:hover { background: var(--color-neutral-soft); color: var(--color-ink); }

.state { padding: 34px 22px; text-align: center; }
.state p { font-size: 14px; color: var(--color-ink); margin: 0 0 8px; }
.state small { font-size: 12px; color: var(--color-text-muted); line-height: 1.7; display: block; }
.state.err p { color: var(--color-danger); }
.spin {
  display: inline-block; width: 22px; height: 22px; margin-bottom: 14px; border-radius: 50%;
  border: 2px solid var(--color-accent-soft); border-top-color: var(--color-accent);
  animation: spin 900ms linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.reason { font-size: 13.5px; line-height: 1.7; color: var(--color-text-secondary); margin: 14px 22px 0; }
.warns { margin: 10px 22px 0; padding-left: 18px; font-size: 12px; color: var(--color-caution); line-height: 1.7; }

.days { overflow-y: auto; padding: 8px 22px 4px; flex: 1; min-height: 0; }
.day { padding: 12px 0; border-top: 1px solid var(--color-divider); }
.day:first-child { border-top: 0; }
.day-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.date { font-family: var(--font-num); font-size: 13px; font-weight: 600; color: var(--color-ink); letter-spacing: 0.01em; }
.date i { font-style: normal; font-size: 11px; color: var(--color-text-muted); margin-left: 6px; }
.sum { font-size: 11.5px; color: var(--color-text-muted); margin-left: auto; }
.item, .item-head {
  /* 名称列给定上限，数字列紧跟在后面，避免被 1fr 拉到最右边 */
  display: grid; grid-template-columns: minmax(0, 320px) 66px 52px 52px 34px; gap: 10px;
  align-items: center; justify-content: start; padding: 5px 0;
}
.item-head { padding-bottom: 2px; }
.item-head span { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-muted); }
.item-head span:not(:first-child) { text-align: center; }
.name { font-size: 13px; color: var(--color-ink); display: flex; align-items: center; gap: 7px; min-width: 0; }
.name .flag { font-style: normal; font-size: 10px; color: var(--color-caution); background: var(--color-caution-soft); padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
.n {
  width: 100%; padding: 6px 4px; border: 1px solid var(--color-border); border-radius: 8px; text-align: center;
  font-size: 12.5px; font-family: var(--font-num); color: var(--color-ink); background: var(--surface-field);
}
.rm { font-size: 11px; color: var(--color-text-muted); padding: 4px 6px; border-radius: 6px; white-space: nowrap; }
.rm:hover { color: var(--color-danger); background: var(--color-danger-soft); }
.day-empty { font-size: 12px; color: var(--color-text-muted); margin: 2px 0 6px; }
.fine { font-size: 11.5px; color: var(--color-text-muted); line-height: 1.7; margin: 10px 22px 14px; }

.dlg-foot { display: flex; align-items: center; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--color-divider); background: var(--color-neutral-soft); }
.spacer { flex: 1; }
.btn { min-height: 42px; padding: 0 18px; border-radius: 11px; font-size: 13.5px; font-weight: 600; }
.btn.ghost { color: var(--color-ink); border: 1px solid var(--color-border); background: var(--color-card); }
.btn.primary { background: var(--color-ink); color: #fff; }
.btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 560px) {
  .scrim { padding: 0; }
  .dlg { width: 100%; max-height: 92vh; border-radius: 16px 16px 0 0; align-self: end; }
  .item, .item-head { grid-template-columns: minmax(0, 1fr) 56px 44px 44px; }
  .item-head span:nth-child(4) { display: none; }
  .item .n:nth-of-type(3) { display: none; }
}
</style>
