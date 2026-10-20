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
          <p>{{ state.loadingStage === 'questions' ? '模型正在看档案，准备几个问题…' : '正在结合档案与你的回答生成计划…' }}</p>
          <small>通常 10–60 秒；模型慢的时候会更久，关闭窗口会放弃本次结果。</small>
        </div>

        <!-- 失败 -->
        <div v-else-if="state.status === 'error'" class="state err">
          <p>{{ state.error }}</p>
          <ul v-if="state.warnings.length" class="warns">
            <li v-for="w in state.warnings" :key="w">{{ w }}</li>
          </ul>
          <small>可以在设置页检查 base_url / 模型名 / 密钥，或者换成手工计划。</small>
        </div>

        <!-- 先问再生成 -->
        <template v-else-if="state.status === 'questions'">
          <p class="reason">为了让计划更贴合你的实际情况，模型先确认几件事。回答会和档案一起用于生成计划。</p>
          <ul v-if="state.warnings.length" class="warns">
            <li v-for="w in state.warnings" :key="w">{{ w }}</li>
          </ul>
          <div class="questions">
            <section v-for="(q, qi) in state.questions" :key="q.id" class="question">
              <div class="q-head">
                <span class="q-no">{{ qi + 1 }}</span>
                <p>{{ q.question }}</p>
              </div>
              <small v-if="q.why" class="q-why">{{ q.why }}</small>
              <div v-if="q.options.length" class="q-options">
                <button
                  v-for="opt in q.options"
                  :key="opt"
                  type="button"
                  :class="{ on: answers[q.id] === opt }"
                  :aria-pressed="answers[q.id] === opt"
                  @click="answers[q.id] = opt"
                >{{ opt }}</button>
              </div>
              <input
                v-model="answers[q.id]"
                type="text"
                class="q-input"
                :placeholder="q.options.length ? '也可以自己写，例如：每周 5 次' : '输入你的回答'"
                :aria-label="q.question"
              />
            </section>
          </div>
          <p class="fine">回答完所有问题后才能生成计划；也可以跳过，模型会按档案里的默认频次安排（大众模式 4–5 天）。</p>
        </template>

        <!-- 可审核、可修改的草稿 -->
        <template v-else-if="local">
          <div class="draft-bar">
            <span class="micro">DRAFT · {{ local.days.length }} 天 / {{ totalItems }} 项</span>
            <button type="button" class="edit-toggle" :aria-pressed="editing" @click="editing = !editing">
              {{ editing ? '完成修改' : '修改计划' }}
            </button>
          </div>
          <p class="reason">{{ local.reason }}</p>
          <ul v-if="answerSummary.length" class="answers-summary">
            <li v-for="a in answerSummary" :key="a">{{ a }}</li>
          </ul>
          <ul v-if="state.warnings.length" class="warns">
            <li v-for="w in state.warnings" :key="w">{{ w }}</li>
          </ul>

          <div class="days">
            <section v-for="day in local.days" :key="day.date" class="day">
              <div class="day-head">
                <span class="date">{{ day.date }}<i>{{ weekday(day.date) }}</i></span>
                <span class="sum">{{ minutesOf(day) }} 分钟 · {{ day.items.length }} 项</span>
                <button v-if="editing" class="rm" type="button" @click="removeDay(day)">移除这天</button>
              </div>
              <div class="item-head">
                <span>动作</span><span>类型</span><span>时长</span><span>组</span><span>次</span><span></span>
              </div>
              <div v-for="(it, i) in day.items" :key="i" class="item">
                <template v-if="editing">
                  <input
                    v-model="it.exerciseName"
                    list="plan-exercise-names"
                    class="name-input"
                    type="text"
                    placeholder="动作名"
                    aria-label="动作名"
                    @change="onNameChange(it)"
                  />
                  <select v-model="it.type" class="type-input" aria-label="动作类型">
                    <option v-for="t in TRAINING_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                  <input v-model.number="it.plannedDuration" class="n" type="number" min="1" max="180" aria-label="时长（分钟）" />
                  <input v-model.number="it.plannedSets" class="n" type="number" min="1" max="20" aria-label="组数" />
                  <input v-model.number="it.plannedReps" class="n" type="number" min="0" max="200" aria-label="次数" />
                  <button class="rm" type="button" @click="removeItem(day, i)">删</button>
                </template>
                <template v-else>
                  <span class="name">
                    {{ it.exerciseName || '未命名动作' }}
                    <i v-if="it.notInLibrary" class="flag">动作库未收录</i>
                  </span>
                  <span class="type-cell">{{ it.type }}</span>
                  <span class="num-cell">{{ it.plannedDuration }} min</span>
                  <span class="num-cell">{{ it.plannedSets ?? '—' }} 组</span>
                  <span class="num-cell">{{ it.plannedReps ?? '—' }} 次</span>
                  <span></span>
                </template>
              </div>
              <button v-if="editing" class="add-item" type="button" @click="addItem(day)">+ 加一项</button>
              <p v-if="!day.items.length" class="day-empty">这天已清空，确认后不会写入</p>
            </section>
          </div>

          <div v-if="editing && addableDates.length" class="add-day">
            <span class="add-label">补一个训练日</span>
            <select v-model="addDate" aria-label="选择要添加的训练日">
              <option v-for="d in addableDates" :key="d" :value="d">{{ d }} {{ weekday(d) }}</option>
            </select>
            <button type="button" @click="addDay">添加</button>
          </div>

          <p class="fine">
            模型只负责排课，不构成医疗或训练处方；录用前可以「修改计划」改动作、类型、时长、组次，也可以增删训练日。
            录入后旧计划会存进版本历史，不会被覆盖。
          </p>
          <datalist id="plan-exercise-names">
            <option v-for="n in exerciseNames" :key="n" :value="n" />
          </datalist>
        </template>

        <footer class="dlg-foot">
          <template v-if="state.status === 'questions'">
            <button class="btn ghost" type="button" @click="skipQuestions">跳过提问，直接生成</button>
            <span class="spacer"></span>
            <button class="btn ghost" type="button" @click="close">关闭</button>
            <button class="btn primary" type="button" :disabled="!allAnswered" @click="generateFromAnswers">
              根据回答生成计划
            </button>
          </template>
          <template v-else-if="state.status === 'ready'">
            <button class="btn ghost" type="button" @click="regen">重新生成</button>
            <button class="btn ghost" type="button" @click="reask">重新提问</button>
            <span class="spacer"></span>
            <button class="btn ghost" type="button" @click="close">先不录入</button>
            <button class="btn primary" type="button" :disabled="!totalItems" @click="confirm">
              确认并录入计划
            </button>
          </template>
          <template v-else-if="state.status === 'error'">
            <button class="btn ghost" type="button" @click="retry">重试</button>
            <span class="spacer"></span>
            <button class="btn ghost" type="button" @click="close">关闭</button>
          </template>
          <template v-else>
            <span class="spacer"></span>
            <button class="btn ghost" type="button" @click="close">关闭</button>
          </template>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { TRAINING_TYPES, usingDefault } from '@/services/llm'
import type { PlanDraft, PlanDraftDay, PlanDraftItem } from '@/services/llm'
import { activeExercises, findExercise } from '@/services/exercises'
import { weekDates, weekStart } from '@/services/weekRules'
import { toISODate } from '@/utils/time'

const store = useAppStore()
const state = computed(() => store.planDraftState)
const open = computed(() => state.value.status !== 'idle')

/** 本地副本：用户改完再确认，取消不污染 store */
const local = ref<PlanDraft | null>(null)
const editing = ref(false)
const answers = ref<Record<string, string>>({})

const exerciseNames = activeExercises().map(e => e.name)
const weekIsoDates = weekDates(weekStart(new Date())).map(toISODate)
const addDate = ref('')
const addableDates = computed(() => weekIsoDates.filter(d => !local.value?.days.some(x => x.date === d)))
watch(addableDates, dates => {
  if (!dates.includes(addDate.value)) addDate.value = dates[0] ?? ''
}, { immediate: true })

watch(
  () => state.value.draft,
  (d) => {
    local.value = d ? JSON.parse(JSON.stringify(d)) : null
    editing.value = false
  },
  { immediate: true }
)

watch(
  [() => state.value.status, () => state.value.questions],
  ([status]) => {
    if (status !== 'questions') return
    const next: Record<string, string> = {}
    for (const q of state.value.questions) next[q.id] = state.value.answers[q.id] ?? ''
    answers.value = next
  },
  { immediate: true }
)

const modelLabel = computed(() => {
  if (usingDefault(store.llmConfig)) {
    return store.llmDefault.model ? `${store.llmDefault.model}（服务端默认）` : '未配置模型'
  }
  return store.llmConfig.model || '未配置模型'
})

const title = computed(() => {
  if (state.value.status === 'loading') {
    return state.value.loadingStage === 'questions' ? '正在准备问题…' : '正在生成计划…'
  }
  if (state.value.status === 'error') return '这次没生成成功'
  if (state.value.status === 'questions') return '先确认几件事'
  return '这份计划要录入吗？'
})

const totalItems = computed(() => local.value?.days.reduce((n, d) => n
  + d.items.filter(i => i.exerciseName.trim() && Number(i.plannedDuration) > 0).length, 0) ?? 0)
const allAnswered = computed(() => state.value.questions.length > 0
  && state.value.questions.every(q => (answers.value[q.id] ?? '').trim().length > 0))
const answerSummary = computed(() => state.value.questions
  .map(q => ({ q: q.question, a: state.value.answers[q.id]?.trim() ?? '' }))
  .filter(x => x.a)
  .map(x => `${x.q}：${x.a}`))

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `周${WEEKDAY[new Date(y, (m ?? 1) - 1, d ?? 1).getDay()] ?? '?'}`
}
function minutesOf(day: PlanDraftDay): number {
  return day.items.reduce((n, i) => n + (Number(i.plannedDuration) || 0), 0)
}

function blankItem(): PlanDraftItem {
  return {
    exerciseName: '',
    type: '其他',
    plannedDuration: 20,
    plannedSets: 1,
    plannedReps: 10,
    notInLibrary: true
  }
}

function onNameChange(item: PlanDraftItem) {
  const hit = findExercise(item.exerciseName.trim())
  item.notInLibrary = !hit
  if (hit) item.type = hit.type
}

function addItem(day: PlanDraftDay) {
  day.items.push(blankItem())
  editing.value = true
}

function addDay() {
  if (!local.value || !addDate.value) return
  if (local.value.days.some(d => d.date === addDate.value)) return
  local.value.days.push({ date: addDate.value, items: [blankItem()] })
  local.value.days.sort((a, b) => a.date.localeCompare(b.date))
  editing.value = true
}

function removeItem(day: PlanDraftDay, index: number) {
  day.items.splice(index, 1)
}

function removeDay(day: PlanDraftDay) {
  if (!local.value) return
  local.value.days = local.value.days.filter(d => d !== day)
}

function generateFromAnswers() {
  if (!allAnswered.value) return
  void store.generatePlanDraft(new Date(), { ...answers.value })
}

function skipQuestions() {
  void store.generatePlanDraft(new Date(), {})
}

function reask() {
  void store.generatePlanQuestions()
}

function regen() {
  void store.generatePlanDraft()
}

function retry() {
  if (state.value.loadingStage === 'questions') void store.generatePlanQuestions()
  else void store.generatePlanDraft()
}

function close() {
  store.resetPlanDraft()
}

function cleanItem(item: PlanDraftItem): PlanDraftItem | null {
  const exerciseName = item.exerciseName.trim()
  const duration = Number(item.plannedDuration)
  if (!exerciseName || !Number.isFinite(duration) || duration <= 0) return null
  const sets = item.plannedSets === undefined ? undefined : Number(item.plannedSets)
  const reps = item.plannedReps === undefined ? undefined : Number(item.plannedReps)
  return {
    ...item,
    exerciseName,
    plannedDuration: Math.min(180, Math.max(1, Math.round(duration))),
    plannedSets: sets !== undefined && Number.isFinite(sets) ? Math.min(20, Math.max(1, Math.round(sets))) : undefined,
    plannedReps: reps !== undefined && Number.isFinite(reps) ? Math.min(200, Math.max(0, Math.round(reps))) : undefined
  }
}

function confirm() {
  if (!local.value || !totalItems.value) return
  const cleaned: PlanDraft = {
    ...local.value,
    days: local.value.days
      .map(d => ({
        ...d,
        items: d.items.map(cleanItem).filter((i): i is PlanDraftItem => i !== null)
      }))
      .filter(d => d.items.length)
  }
  store.acceptPlanDraft(cleaned)
}
</script>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: var(--z-modal-backdrop); background: rgba(17, 22, 26, 0.46);
  backdrop-filter: blur(3px); display: grid; place-items: center; padding: 24px;
}
.dlg {
  width: min(840px, 100%); max-height: min(90vh, 950px); display: flex; flex-direction: column;
  background: var(--color-card); border-radius: var(--radius-xl); border: 1px solid var(--color-border);
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, 0.65); overflow: hidden;
}
.dlg-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 14px; border-bottom: 1px solid var(--color-divider); }
.dlg-head h2 { font-size: 19px; margin: 6px 0 0; letter-spacing: -0.01em; }
.x { width: 32px; height: 32px; border-radius: 9px; color: var(--color-text-muted); font-size: 14px; flex: none; }
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
.answers-summary { list-style: none; margin: 10px 22px 0; padding: 0; display: grid; gap: 5px; }
.answers-summary li { font-size: 11.5px; line-height: 1.6; color: var(--color-text-secondary); padding: 6px 9px; border-radius: 7px; background: var(--color-neutral-soft); }
.draft-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 22px 0; }
.edit-toggle { padding: 6px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; color: var(--color-accent); background: var(--color-accent-soft); box-shadow: inset 0 0 0 1px var(--color-accent-line); }
.edit-toggle:hover { background: var(--color-accent-line); }

.questions { overflow-y: auto; flex: 1; min-height: 0; padding: 8px 22px 4px; display: grid; gap: 12px; }
.question { padding: 12px; border-radius: var(--radius-md); background: var(--color-neutral-soft); box-shadow: inset 0 0 0 1px var(--color-border); }
.q-head { display: flex; align-items: baseline; gap: 8px; }
.q-no { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; flex: none; font-family: var(--font-num); font-size: 10px; font-weight: 700; color: var(--color-accent); background: var(--color-accent-soft); }
.q-head p { margin: 0; font-size: 13px; font-weight: 600; color: var(--color-ink); line-height: 1.6; }
.q-why { display: block; margin: 4px 0 0 28px; font-size: 11px; color: var(--color-text-muted); line-height: 1.6; }
.q-options { display: flex; flex-wrap: wrap; gap: 6px; margin: 9px 0 0 28px; }
.q-options button { padding: 6px 10px; border-radius: 8px; font-size: 11.5px; color: var(--color-text-secondary); background: var(--color-card); box-shadow: inset 0 0 0 1px var(--color-border); }
.q-options button.on { color: var(--color-accent); background: var(--color-accent-soft); box-shadow: inset 0 0 0 1px var(--color-accent-line); font-weight: 600; }
.q-input { width: calc(100% - 28px); margin: 8px 0 0 28px; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 8px; font-size: 12.5px; font-family: inherit; color: var(--color-ink); background: var(--surface-field); }

.days { overflow-y: auto; padding: 8px 22px 4px; flex: 1; min-height: 0; }
.day { padding: 12px 0; border-top: 1px solid var(--color-divider); }
.day:first-child { border-top: 0; }
.day-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.date { font-family: var(--font-num); font-size: 13px; font-weight: 600; color: var(--color-ink); letter-spacing: 0.01em; }
.date i { font-style: normal; font-size: 11px; color: var(--color-text-muted); margin-left: 6px; }
.sum { font-size: 11.5px; color: var(--color-text-muted); margin-left: auto; }
.item, .item-head {
  display: grid; grid-template-columns: minmax(0, 1.5fr) 92px 66px 52px 52px 32px; gap: 8px;
  align-items: center; justify-content: start; padding: 5px 0;
}
.item-head { padding-bottom: 2px; }
.item-head span { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-text-muted); }
.item-head span:not(:first-child) { text-align: center; }
.name { font-size: 13px; color: var(--color-ink); display: flex; align-items: center; gap: 7px; min-width: 0; overflow-wrap: anywhere; }
.name .flag { font-style: normal; font-size: 10px; color: var(--color-caution); background: var(--color-caution-soft); padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
.type-cell { font-size: 11.5px; color: var(--color-text-secondary); white-space: nowrap; }
.num-cell { font-family: var(--font-num); font-size: 11.5px; color: var(--color-text-secondary); white-space: nowrap; text-align: center; font-variant-numeric: tabular-nums; }
.n {
  width: 100%; padding: 6px 4px; border: 1px solid var(--color-border); border-radius: 8px; text-align: center;
  font-size: 12.5px; font-family: var(--font-num); color: var(--color-ink); background: var(--surface-field);
}
.name-input, .type-input {
  width: 100%; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 8px;
  font-size: 12.5px; font-family: inherit; color: var(--color-ink); background: var(--surface-field); min-width: 0;
}
.rm { font-size: 11px; color: var(--color-text-muted); padding: 4px 6px; border-radius: 6px; white-space: nowrap; }
.rm:hover { color: var(--color-danger); background: var(--color-danger-soft); }
.add-item { margin-top: 5px; padding: 5px 9px; border-radius: 7px; font-size: 11px; font-weight: 600; color: var(--color-accent); background: var(--color-accent-soft); }
.add-day { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 22px 0; padding: 9px 11px; border-radius: 9px; background: var(--color-neutral-soft); }
.add-label { font-size: 11.5px; color: var(--color-text-secondary); }
.add-day select { padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 7px; font-size: 12px; font-family: inherit; color: var(--color-ink); background: var(--surface-field); }
.add-day button { padding: 6px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; color: var(--color-accent); background: var(--color-accent-soft); }
.day-empty { font-size: 12px; color: var(--color-text-muted); margin: 2px 0 6px; }
.fine { font-size: 11.5px; color: var(--color-text-muted); line-height: 1.7; margin: 10px 22px 14px; }

.dlg-foot { display: flex; align-items: center; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--color-divider); background: var(--color-neutral-soft); flex-wrap: wrap; }
.spacer { flex: 1; }
.btn { min-height: 42px; padding: 0 18px; border-radius: 11px; font-size: 13.5px; font-weight: 600; }
.btn.ghost { color: var(--color-ink); border: 1px solid var(--color-border); background: var(--color-card); }
.btn.primary { background: var(--color-ink); color: var(--color-card); }
.btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 720px) {
  .scrim { padding: 0; }
  .dlg { width: 100%; max-height: 94vh; border-radius: 16px 16px 0 0; align-self: end; }
  .dlg-head { padding: 16px 16px 12px; }
  .reason { margin: 12px 16px 0; }
  .warns { margin: 8px 16px 0; }
  .answers-summary { margin: 8px 16px 0; }
  .draft-bar { padding: 12px 16px 0; }
  .questions { padding: 8px 16px 4px; }
  .q-input { width: calc(100% - 28px); }
  .days { padding: 6px 16px 4px; }
  .item-head { display: none; }
  .item { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0; }
  .name-input, .name { flex: 1 1 100%; }
  .type-input, .type-cell { flex: 1 1 110px; }
  .n { width: 64px; flex: none; }
  .rm { margin-left: auto; }
  .add-day { margin: 4px 16px 0; }
  .fine { margin: 10px 16px 12px; }
  .dlg-foot { padding: 12px 16px; }
  .dlg-foot .btn { flex: 1 1 auto; padding: 0 12px; }
}
</style>
