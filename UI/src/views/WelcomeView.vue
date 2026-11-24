<template>
  <div class="welcome">
    <header class="w-top">
      <div class="w-brand">
        <PoleMark :size="30" />
        <div class="w-brand-copy">
          <b>TWOPOLES</b>
          <span>运动与饮食协同</span>
        </div>
      </div>
      <span class="w-badge">首次设置 · 约 2 分钟</span>
    </header>

    <main class="w-main">
      <section class="w-intro">
        <span class="eyebrow"><i></i>GET STARTED</span>
        <h1>先花两分钟，<br />让计划贴合你。</h1>
        <p>不用填长表。只问生成训练安排真正会用到的信息，其他可以之后在档案页慢慢补。</p>
        <div class="w-privacy">
          <ShieldCheck :size="16" aria-hidden="true" />
          资料默认只保存在本机；登录并启用同步后才上云。
        </div>
      </section>

      <section class="w-flow">
        <div class="stepper-wrap">
          <ol class="stepper" aria-label="首次设置步骤">
            <li
              v-for="(s, i) in STEPS"
              :key="s.key"
              :class="{ current: step === i, done: step > i }"
              :aria-current="step === i ? 'step' : undefined"
            >
              <span class="dot"><Check v-if="step > i" :size="12" /><template v-else>{{ i + 1 }}</template></span>
              <span class="label">{{ s.label }}</span>
            </li>
          </ol>
          <div class="w-progress" aria-hidden="true"><i :style="{ width: progressWidth }"></i></div>
        </div>

        <BaseCard class="panel">
          <div class="step-head">
            <span class="micro">STEP {{ step + 1 }} / {{ STEPS.length }}</span>
            <h2 ref="heading" class="step-title" tabindex="-1">{{ current.title }}</h2>
            <p>{{ current.copy }}</p>
          </div>

          <!-- 1. 基础身体数据 -->
          <div v-if="step === 0" class="step-body">
            <AvatarPicker
              v-model="draft.avatarDataUrl"
              :nickname="draft.nickname"
              hint="支持 JPG、PNG、WebP。完成引导后生效。"
              @update:loading="avatarLoading = $event"
            />
            <div class="grid2">
              <label class="field">
                <span class="field-label">昵称（可留空）</span>
                <input v-model="draft.nickname" type="text" maxlength="20" placeholder="想怎么称呼你" autocomplete="nickname" />
              </label>
              <div class="field">
                <span class="field-label">年龄（必填）</span>
                <div class="age-control">
                  <button type="button" class="age-step" aria-label="年龄减一" @click="bumpAge(-1)">−</button>
                  <input
                    v-model.number="draft.age"
                    type="number"
                    inputmode="numeric"
                    :min="AGE_RANGE.min"
                    :max="AGE_RANGE.max"
                    placeholder="—"
                    aria-label="年龄（必填）"
                    :aria-invalid="!!ageMessage"
                    @blur="ageTouched = true"
                  />
                  <button type="button" class="age-step" aria-label="年龄加一" @click="bumpAge(1)">＋</button>
                </div>
                <small class="field-hint">{{ AGE_RANGE.min }}–{{ AGE_RANGE.max }} 岁；用于训练强度与动作筛选</small>
                <small v-if="ageMessage" class="field-error" role="alert">{{ ageMessage }}</small>
              </div>
            </div>
            <div class="grid2">
              <label class="field">
                <span class="field-label">身高 cm（可留空）</span>
                <input v-model.number="draft.height" type="number" min="100" max="250" step="any" placeholder="例如 175" />
                <small v-if="body.height" class="field-error">{{ body.height }}</small>
              </label>
              <label class="field">
                <span class="field-label">体重 kg（可留空）</span>
                <input v-model.number="draft.weight" type="number" min="25" max="200" step="any" placeholder="例如 65" />
                <small v-if="body.weight" class="field-error">{{ body.weight }}</small>
              </label>
            </div>
          </div>

          <!-- 2. 运动目标 -->
          <div v-else-if="step === 1" class="step-body">
            <div class="field-block">
              <div class="block-head"><span class="field-label">主要目标</span><small>单选，可留空</small></div>
              <div class="choice-grid">
                <button
                  v-for="g in PROFILE_GOALS"
                  :key="g"
                  type="button"
                  class="choice-card"
                  :class="{ on: draft.goal === g }"
                  :aria-pressed="draft.goal === g"
                  @click="draft.goal = draft.goal === g ? '' : g"
                >
                  <span class="choice-check"><Check v-if="draft.goal === g" :size="12" /></span>
                  <b>{{ g }}</b>
                </button>
              </div>
              <input v-model="draft.goal" class="text-input" type="text" maxlength="200" placeholder="也可以写自己的目标（可留空）" aria-label="自定义主要目标" />
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">专项</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="e in PROFILE_DISCIPLINE_OPTIONS"
                  :key="e"
                  type="button"
                  class="chip"
                  :class="{ on: draft.disciplines.includes(e) }"
                  :aria-pressed="draft.disciplines.includes(e)"
                  @click="toggle(draft.disciplines, e)"
                >{{ e }}</button>
              </div>
              <div v-if="customDisciplines.length" class="chips picked">
                <button
                  v-for="d in customDisciplines"
                  :key="d"
                  type="button"
                  class="chip on"
                  :aria-label="`移除自定义专项 ${d}`"
                  @click="toggle(draft.disciplines, d)"
                >{{ d }} ×</button>
              </div>
              <div class="custom-add">
                <input
                  v-model="draft.customDiscipline"
                  class="text-input"
                  type="text"
                  maxlength="24"
                  placeholder="没有你练的项目？自己填一个"
                  aria-label="添加自定义专项"
                  @keydown.enter.prevent="addDiscipline"
                />
                <button type="button" class="add-btn" @click="addDiscipline">加上</button>
              </div>
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">训练目标</span><small>二选一；切换不会丢掉另一类已填内容</small></div>
              <div class="seg">
                <button type="button" :class="{ on: draft.goalType === 'competition' }" :aria-pressed="draft.goalType === 'competition'" @click="draft.goalType = 'competition'">比赛目标</button>
                <button type="button" :class="{ on: draft.goalType === 'cycle' }" :aria-pressed="draft.goalType === 'cycle'" @click="draft.goalType = 'cycle'">训练周期目标</button>
              </div>

              <div v-if="draft.goalType === 'competition'" class="grid2">
                <label class="field">
                  <span class="field-label">赛事名称</span>
                  <input v-model="draft.targetEvent" type="text" maxlength="30" placeholder="例如：秋季赛" />
                </label>
                <label class="field">
                  <span class="field-label">比赛日期（可留空）</span>
                  <input v-model="draft.targetEventDate" type="date" />
                </label>
                <label class="field">
                  <span class="field-label">目标成绩（可留空）</span>
                  <input v-model="draft.targetResult" type="text" maxlength="16" placeholder="例如：2:05 或 6.85" />
                </label>
                <div class="field">
                  <span class="field-label">对应项目</span>
                  <input :value="draft.disciplines.length ? draft.disciplines.join('、') : '未选专项'" type="text" disabled />
                </div>
              </div>

              <div v-else class="grid2">
                <div class="field">
                  <span class="field-label">周期阶段</span>
                  <div class="chips">
                    <button
                      v-for="p in PROFILE_PHASES"
                      :key="p"
                      type="button"
                      class="chip"
                      :class="{ on: draft.cyclePhase === p }"
                      :aria-pressed="draft.cyclePhase === p"
                      @click="draft.cyclePhase = draft.cyclePhase === p ? '' : p"
                    >{{ p }}</button>
                  </div>
                </div>
                <label class="field">
                  <span class="field-label">阶段重点（可留空）</span>
                  <input v-model="draft.cycleFocus" type="text" maxlength="30" placeholder="例如：有氧基础 + 技术" />
                </label>
                <label class="field">
                  <span class="field-label">周期开始</span>
                  <input v-model="draft.cycleStartDate" type="date" />
                </label>
                <label class="field">
                  <span class="field-label">周期结束</span>
                  <input v-model="draft.cycleEndDate" type="date" />
                </label>
                <small v-if="cycleMessage" class="field-error wide">{{ cycleMessage }}</small>
              </div>
            </div>
          </div>

          <!-- 3. 运动习惯与条件 -->
          <div v-else-if="step === 2" class="step-body">
            <div class="field-block">
              <div class="block-head"><span class="field-label">运动经验</span><small>单选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="e in PROFILE_EXPERIENCES"
                  :key="e"
                  type="button"
                  class="chip"
                  :class="{ on: draft.experience === e }"
                  :aria-pressed="draft.experience === e"
                  @click="draft.experience = draft.experience === e ? '' : e"
                >{{ e }}</button>
              </div>
              <input v-model="draft.experience" class="text-input" type="text" maxlength="200" placeholder="或者写一句你的运动习惯" aria-label="运动经验" />
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">每次能用的时间</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="t in PROFILE_TIME_OPTIONS"
                  :key="t"
                  type="button"
                  class="chip"
                  :class="{ on: draft.availableTimes.includes(t) }"
                  :aria-pressed="draft.availableTimes.includes(t)"
                  @click="toggle(draft.availableTimes, t)"
                >{{ t }}</button>
              </div>
              <div v-if="customTimes.length" class="chips picked">
                <button
                  v-for="t in customTimes"
                  :key="t"
                  type="button"
                  class="chip on"
                  :aria-label="`移除自定义时长 ${t}`"
                  @click="toggle(draft.availableTimes, t)"
                >{{ t }} ×</button>
              </div>
              <div class="custom-add">
                <input
                  v-model.number="customMinutes"
                  class="text-input"
                  type="number"
                  :min="TIME_RANGE.min"
                  :max="TIME_RANGE.max"
                  placeholder="档位都不合适？填分钟数"
                  aria-label="自定义可用时长（分钟）"
                  @keydown.enter.prevent="addCustomTime"
                  @blur="timeTouched = true"
                />
                <button type="button" class="add-btn" @click="addCustomTime">加上</button>
              </div>
              <small v-if="timeError" class="field-error">{{ timeError }}</small>
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">可用器材</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="q in PROFILE_EQUIPMENT_OPTIONS"
                  :key="q"
                  type="button"
                  class="chip"
                  :class="{ on: draft.equipment.includes(q) }"
                  :aria-pressed="draft.equipment.includes(q)"
                  @click="toggle(draft.equipment, q)"
                >{{ q }}</button>
              </div>
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">常训练的场地</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="v in PROFILE_VENUE_OPTIONS"
                  :key="v"
                  type="button"
                  class="chip"
                  :class="{ on: draft.availableVenues.includes(v) }"
                  :aria-pressed="draft.availableVenues.includes(v)"
                  @click="toggle(draft.availableVenues, v)"
                >{{ v }}</button>
              </div>
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">需要避开的</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="r in PROFILE_RESTRICTION_OPTIONS"
                  :key="r"
                  type="button"
                  class="chip warn"
                  :class="{ on: draft.restrictions.includes(r) }"
                  :aria-pressed="draft.restrictions.includes(r)"
                  @click="toggle(draft.restrictions, r)"
                >{{ r }}</button>
              </div>
            </div>

            <div class="field-block">
              <div class="block-head"><span class="field-label">特殊情况</span><small>多选，可留空</small></div>
              <div class="chips">
                <button
                  v-for="g in PROFILE_GATE_OPTIONS"
                  :key="g"
                  type="button"
                  class="chip warn"
                  :class="{ on: draft.restrictions.includes(g) }"
                  :aria-pressed="draft.restrictions.includes(g)"
                  @click="toggle(draft.restrictions, g)"
                >{{ g }}</button>
              </div>
              <p v-if="blocked" class="gate-note" role="status">{{ blocked }}</p>
            </div>
          </div>

          <!-- 4. 确认与补充 -->
          <div v-else class="step-body">
            <div class="summary-card">
              <div class="summary-head">
                <div>
                  <span class="micro">Summary</span>
                  <h3>{{ draft.nickname.trim() || '你的档案' }}</h3>
                </div>
                <div class="summary-actions">
                  <button type="button" @click="goToStep(0)">修改基础</button>
                  <button type="button" @click="goToStep(1)">修改目标</button>
                  <button type="button" @click="goToStep(2)">修改习惯</button>
                </div>
              </div>
              <dl class="summary-grid">
                <div><dt>年龄</dt><dd>{{ draft.age === '' ? '未填' : `${draft.age} 岁` }}</dd></div>
                <div><dt>身体数据</dt><dd>{{ bodyLine }}</dd></div>
                <div><dt>主要目标</dt><dd>{{ draft.goal.trim() || '未填' }}</dd></div>
                <div><dt>运动经验</dt><dd>{{ draft.experience.trim() || '未填' }}</dd></div>
                <div><dt>专项</dt><dd>{{ draft.disciplines.length ? draft.disciplines.join('、') : '未填' }}</dd></div>
                <div><dt>训练目标</dt><dd>{{ trainingGoalLine }}</dd></div>
                <div><dt>可用时间</dt><dd>{{ listText(draft.availableTimes) }}</dd></div>
                <div><dt>器材 / 场地</dt><dd>{{ equipmentLine }}</dd></div>
                <div><dt>需要避开</dt><dd>{{ avoidLine }}</dd></div>
                <div><dt>特殊情况</dt><dd>{{ specialLine }}</dd></div>
              </dl>
            </div>

            <details class="extra">
              <summary><span>PB 成绩</span><em>{{ draft.personalBests.length }} 条</em></summary>
              <PbList v-model="draft.personalBests" />
            </details>
            <details class="extra">
              <summary><span>健身房极限数据</span><em>{{ draft.gymRecords.length }} 条</em></summary>
              <GymList v-model="draft.gymRecords" />
            </details>

            <p class="confirm-note">点击「开启运动计划」后，档案会立即保存并生成本周计划；之后可在档案页修改，也可在这里先补充 PB 或极限数据。</p>
          </div>

          <p v-if="error || stepError" class="step-error" role="alert">{{ error || stepError }}</p>

          <footer class="w-actions">
            <button v-if="step > 0" type="button" class="back" @click="goToStep(step - 1)">
              <ChevronLeft :size="15" /> 上一步
            </button>
            <span class="spacer"></span>
            <span v-if="step === 0 && !canAdvance" class="foot-hint">填写 {{ AGE_RANGE.min }}–{{ AGE_RANGE.max }} 岁年龄后可继续</span>
            <button v-if="step > 0 && step < 3" type="button" class="skip" @click="skipStep">跳过这一步</button>
            <BaseButton v-if="step < 3" :icon="ChevronRight" :disabled="!canAdvance" @click="advance">下一步</BaseButton>
            <BaseButton v-else :disabled="saving || avatarLoading" @click="finish">{{ saving ? '正在保存…' : avatarLoading ? '正在处理头像…' : '开启运动计划' }}</BaseButton>
          </footer>
        </BaseCard>

        <p class="w-foot">资料只用于生成安排与提醒，不做医疗诊断。随时可以在「档案」里修改。</p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Check, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-vue-next'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import AvatarPicker from '@/components/profile/AvatarPicker.vue'
import PbList from '@/components/profile/PbList.vue'
import GymList from '@/components/profile/GymList.vue'
import PoleMark from '@/components/poles/PoleMark.vue'
import {
  PROFILE_DISCIPLINE_OPTIONS,
  PROFILE_EQUIPMENT_OPTIONS,
  PROFILE_EXPERIENCES,
  PROFILE_GATE_OPTIONS,
  PROFILE_GOALS,
  PROFILE_PHASES,
  PROFILE_RESTRICTION_OPTIONS,
  PROFILE_TIME_OPTIONS,
  PROFILE_VENUE_OPTIONS
} from '@/config/profileOptions'
import { useAppStore } from '@/stores/app'
import { createProfileDraft, toProfilePayload } from '@/services/profileForm'
import {
  AGE_RANGE,
  TIME_RANGE,
  ageError as profileAgeError,
  bodyErrors,
  customTimeError,
  cycleRangeError,
  goalSummary,
  isValidAge,
  sortTimeLabels,
  timeLabel
} from '@/services/profileRules'
import { gateReason } from '@/services/exercises'

const STEPS = [
  {
    key: 'basics',
    label: '身体数据',
    title: '先认识一下你',
    copy: '年龄用于控制训练强度与动作筛选；身高和体重可以留空，之后随时补。'
  },
  {
    key: 'goal',
    label: '运动目标',
    title: '你想练成什么样',
    copy: '主要目标决定计划侧重；专项、比赛或周期目标都是选填。'
  },
  {
    key: 'habits',
    label: '习惯条件',
    title: '你能用哪些条件',
    copy: '时间、器材、场地和避开项会直接参与动作过滤，填得越准，推荐越稳。'
  },
  {
    key: 'confirm',
    label: '确认开始',
    title: '确认一下，就可以开始',
    copy: '这些资料只用来生成计划与提醒；进入主界面后仍可在档案页修改。'
  }
] as const

const store = useAppStore()
const router = useRouter()
const draft = reactive(createProfileDraft(store.userProfile))

const step = ref(0)
const ageTouched = ref(false)
const avatarLoading = ref(false)
const saving = ref(false)
const error = ref('')
const stepError = ref('')
const heading = ref<HTMLElement | null>(null)
/** 自定义时长与专项的输入缓冲：点「加上」才并入多选，不直接落库 */
const customMinutes = ref<number | ''>('')
const timeTouched = ref(false)

const current = computed(() => STEPS[step.value])
const progressWidth = computed(() => `${((step.value + 1) / STEPS.length) * 100}%`)
const body = computed(() => bodyErrors(draft.height, draft.weight))
const ageMessage = computed(() => (ageTouched.value ? (profileAgeError(draft.age) ?? '') : ''))
const cycleMessage = computed(() => cycleRangeError(draft.cycleStartDate, draft.cycleEndDate) ?? '')
const customTimes = computed(() => draft.availableTimes.filter(t => !PROFILE_TIME_OPTIONS.includes(t)))
const customDisciplines = computed(() => draft.disciplines.filter(d => !PROFILE_DISCIPLINE_OPTIONS.includes(d)))
const timeError = computed(() => (timeTouched.value ? customTimeError(customMinutes.value) : null))
const blocked = computed(() => gateReason({ restrictions: draft.restrictions }))

const canAdvance = computed(() => {
  if (step.value === 0) return isValidAge(draft.age) && !body.value.height && !body.value.weight
  if (step.value === 1) return !cycleMessage.value
  return true
})

const listText = (list: string[], empty = '未填') => (list.length ? list.join(' · ') : empty)
const bodyLine = computed(() => {
  const parts: string[] = []
  if (draft.height !== '') parts.push(`身高 ${draft.height} cm`)
  if (draft.weight !== '') parts.push(`体重 ${draft.weight} kg`)
  return parts.length ? parts.join(' · ') : '未填'
})
const equipmentLine = computed(() => {
  const parts = [listText(draft.equipment), listText(draft.availableVenues)]
  if (parts.every(part => part === '未填')) return '未填'
  return `${parts[0]} · ${parts[1]}`
})
const avoidLine = computed(() => {
  const picked = draft.restrictions.filter(item => PROFILE_RESTRICTION_OPTIONS.includes(item))
  return picked.length ? picked.join(' · ') : '无'
})
const specialLine = computed(() => {
  const picked = draft.restrictions.filter(item => PROFILE_GATE_OPTIONS.includes(item))
  return picked.length ? picked.join(' · ') : '无'
})
const trainingGoalLine = computed(() => {
  if (!draft.disciplines.length && !draft.targetEvent && !draft.cyclePhase && !draft.cycleFocus) return '未填'
  return goalSummary({
    goalType: draft.goalType,
    targetEvent: draft.targetEvent,
    targetEventDate: draft.targetEventDate,
    disciplines: draft.disciplines,
    cyclePhase: draft.cyclePhase
  })
})

function toggle(list: string[], value: string) {
  const index = list.indexOf(value)
  if (index === -1) list.push(value)
  else list.splice(index, 1)
}

/** 自定义专项：与预设项并列存在一个数组里，删掉就是取消选中 */
function addDiscipline() {
  const value = draft.customDiscipline.trim()
  if (!value) return
  if (!draft.disciplines.includes(value)) draft.disciplines.push(value)
  draft.customDiscipline = ''
}

/** 自定义时长：校验后按分钟数并入，重复值不会再加一条 */
function addCustomTime() {
  timeTouched.value = true
  if (customMinutes.value === '' || customTimeError(customMinutes.value)) return
  draft.availableTimes = sortTimeLabels([...draft.availableTimes, timeLabel(Number(customMinutes.value))])
  customMinutes.value = ''
}

function bumpAge(delta: number) {
  ageTouched.value = true
  if (typeof draft.age !== 'number') {
    draft.age = 18
    return
  }
  draft.age = Math.min(AGE_RANGE.max, Math.max(AGE_RANGE.min, draft.age + delta))
}

async function goToStep(index: number) {
  step.value = index
  error.value = ''
  stepError.value = ''
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function advance() {
  if (!canAdvance.value) {
    ageTouched.value = true
    stepError.value = step.value === 0
      ? `请先填写 ${AGE_RANGE.min}–${AGE_RANGE.max} 岁之间的年龄。`
      : (cycleMessage.value || '请先修正这一步的填写。')
    return
  }
  void goToStep(step.value + 1)
}

function skipStep() {
  if (step.value < 1 || step.value >= 3) return
  if (!canAdvance.value) {
    stepError.value = cycleMessage.value || '请先修正这一步的填写。'
    return
  }
  void goToStep(step.value + 1)
}

async function finish() {
  if (saving.value || avatarLoading.value) return
  error.value = ''
  stepError.value = ''
  const validAge = draft.age
  if (!isValidAge(validAge)) {
    step.value = 0
    ageTouched.value = true
    error.value = `请先填写 ${AGE_RANGE.min}–${AGE_RANGE.max} 岁之间的年龄。`
    return
  }
  if (body.value.height || body.value.weight) {
    step.value = 0
    error.value = body.value.height || body.value.weight || ''
    return
  }
  if (cycleMessage.value) {
    step.value = 1
    error.value = cycleMessage.value
    return
  }
  saving.value = true
  try {
    store.updateProfile(toProfilePayload(draft, validAge))
    store.ensureWeekPlan(new Date())
    if (!store.completeOnboarding()) {
      error.value = '档案保存失败，请重试。'
      return
    }
    store.showToast({
      type: 'success',
      title: '档案已建好，开始训练吧',
      message: '档案已保存；本周计划已就绪，之后可在档案页随时修改。',
      duration: 3500
    })
    await router.push('/')
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '保存失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* ——— 全屏引导 ——— */
.welcome{min-height:100vh;min-height:100dvh;padding:22px var(--gutter) 48px;background:radial-gradient(80% 50% at 18% 0%,var(--color-accent-soft),transparent 62%)}
.w-top{max-width:1160px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--color-divider)}
.w-brand{display:flex;align-items:center;gap:10px;min-width:0}
.w-brand-copy{display:grid;gap:1px;min-width:0}
.w-brand-copy b{font-family:var(--font-num);font-size:12px;letter-spacing:.14em;color:var(--color-ink);line-height:1.2}
.w-brand-copy span{font-size:10.5px;color:var(--color-text-muted);white-space:nowrap}
.w-badge{flex:none;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-card);font-family:var(--font-num);font-size:10.5px;font-weight:600;color:var(--color-text-secondary);white-space:nowrap}
.w-main{max-width:1160px;margin:0 auto;display:grid;grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:46px;padding-top:34px;align-items:start}
.w-intro{position:sticky;top:24px;min-width:0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}
.eyebrow i{width:14px;height:1px;background:var(--color-accent)}
.w-intro h1{font-size:40px;line-height:1.12;letter-spacing:-.04em;margin:12px 0 14px;color:var(--color-ink)}
.w-intro p{font-size:13px;line-height:1.8;color:var(--color-text-secondary);margin:0;max-width:360px}
.w-privacy{display:inline-flex;align-items:flex-start;gap:7px;margin-top:18px;padding:9px 11px;border-radius:10px;background:var(--color-neutral-soft);font-size:11px;line-height:1.6;color:var(--color-text-muted);max-width:360px}
.w-privacy :deep(svg){flex:none;margin-top:1px;color:var(--color-accent)}
.w-flow{min-width:0}
.w-foot{font-size:11px;line-height:1.7;color:var(--color-text-muted);text-align:center;margin:12px 0 0}

/* ——— 步骤条 ——— */
.stepper-wrap{margin-bottom:12px}
.stepper{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.stepper li{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;color:var(--color-text-muted)}
.stepper .dot{width:23px;height:23px;flex:none;display:grid;place-items:center;border-radius:50%;border:1px solid var(--color-border);font-family:var(--font-num);font-size:10px;font-weight:700;background:var(--color-card);color:var(--color-text-muted)}
.stepper .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stepper li.current{color:var(--color-ink)}
.stepper li.current .dot{background:var(--color-accent);border-color:var(--color-accent);color:var(--color-on-accent)}
.stepper li.done{color:var(--color-text-secondary)}
.stepper li.done .dot{background:var(--color-accent-soft);border-color:var(--color-accent-line);color:var(--color-accent)}
.w-progress{height:3px;margin-top:9px;border-radius:2px;background:var(--color-divider);overflow:hidden}
.w-progress i{display:block;height:100%;background:var(--color-accent);transition:width var(--motion-base) var(--easing-ease-out)}

/* ——— 面板 ——— */
.panel{--card-pad:26px}
.step-head h2{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:7px 0 8px;color:var(--color-ink);outline:none}
.step-head p{font-size:12.5px;line-height:1.7;color:var(--color-text-muted);margin:0;max-width:560px}
.step-body{display:grid;gap:20px;margin-top:22px}
.field-block{display:grid;gap:9px;min-width:0}
.block-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.block-head .field-label{margin:0;font-size:12.5px;font-weight:600;color:var(--color-ink)}
.block-head small{font-size:10.5px;color:var(--color-text-muted)}
.field{display:grid;gap:7px;min-width:0}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input,.text-input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.field input:focus,.text-input:focus{outline:none;border-color:var(--color-accent);box-shadow:0 0 0 3px var(--color-accent-soft)}
.field input:disabled{opacity:.6}
.text-input{display:block}
.field-hint{font-size:10.5px;line-height:1.5;color:var(--color-text-muted)}
.field-error{font-size:11px;line-height:1.5;color:var(--color-danger)}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.wide{grid-column:1/-1}

/* 年龄步进器 */
.age-control{display:flex;align-items:stretch;gap:7px}
.age-step{width:44px;flex:none;border-radius:11px;border:1px solid var(--color-border);background:var(--color-neutral-soft);color:var(--color-ink);font-size:20px;line-height:1;font-weight:600;transition:background var(--motion-fast),border-color var(--motion-fast)}
.age-step:hover{border-color:var(--color-accent-line);background:var(--color-accent-soft);color:var(--color-accent)}
.age-control input{flex:1;min-width:0;padding:8px 10px;text-align:center;font-family:var(--font-num);font-size:24px;font-weight:600;letter-spacing:-.02em;appearance:textfield;-moz-appearance:textfield}
.age-control input::-webkit-outer-spin-button,.age-control input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

/* 目标卡片 */
.choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.choice-card{position:relative;display:flex;align-items:center;gap:8px;min-height:58px;padding:12px 13px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-card);text-align:left;transition:border-color var(--motion-fast),background var(--motion-fast)}
.choice-card b{font-size:13px;font-weight:600;color:var(--color-text-secondary);line-height:1.35}
.choice-card .choice-check{width:17px;height:17px;flex:none;border-radius:50%;border:1px solid var(--hair-strong);display:grid;place-items:center;color:var(--color-on-accent)}
.choice-card:hover{border-color:var(--color-accent-line)}
.choice-card.on{background:var(--color-accent-soft);border-color:var(--color-accent-line)}
.choice-card.on b{color:var(--color-accent)}
.choice-card.on .choice-check{background:var(--color-accent);border-color:var(--color-accent)}

/* 选项 chips */
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{font-family:inherit;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);border:1px solid transparent;transition:all var(--motion-fast)}
.chip:hover{border-color:var(--color-accent-line)}
.chip.on{background:var(--color-accent-soft);color:var(--color-accent);border-color:var(--color-accent-line)}
.chip.warn{background:var(--color-caution-soft);color:var(--color-caution)}
.chip.warn.on{background:var(--color-caution);color:var(--color-on-caution);border-color:var(--color-caution)}
/* 专项与时长的自定义补充：输入框 + 「加上」，与预设 chip 视觉上分开 */
.custom-add{display:flex;gap:8px;margin-top:2px}
.custom-add .text-input{flex:1;min-width:0}
.add-btn{flex:none;font-family:inherit;padding:0 16px;min-height:40px;border-radius:11px;font-size:12.5px;font-weight:600;color:var(--color-accent);background:var(--color-accent-soft);border:1px solid var(--color-accent-line);transition:all var(--motion-fast)}
.add-btn:hover{background:var(--color-accent-line)}
.picked{margin-top:2px}
.field-block .field-error{margin:0}
.seg{display:flex;gap:8px;flex-wrap:wrap}
.seg button{font-family:inherit;padding:9px 14px;border-radius:11px;font-size:12.5px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);border:1px solid transparent;transition:all var(--motion-fast)}
.seg button.on{background:var(--color-accent);color:var(--color-on-accent)}
.gate-note{font-size:11.5px;color:var(--color-caution);background:var(--color-caution-soft);border-radius:10px;padding:9px 11px;margin:0;line-height:1.65}

/* ——— 确认摘要 ——— */
.summary-card{padding:16px;border-radius:12px;background:var(--color-neutral-soft);border:1px solid var(--color-divider)}
.summary-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.summary-head h3{font-size:18px;margin:5px 0 0;color:var(--color-ink)}
.summary-actions{display:flex;gap:4px;flex-wrap:wrap}
.summary-actions button{font-family:inherit;font-size:11px;font-weight:600;color:var(--color-accent);padding:5px 8px;border-radius:7px;transition:background var(--motion-fast)}
.summary-actions button:hover{background:var(--color-accent-soft)}
.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px;margin:14px 0 0}
.summary-grid>div{padding:9px 0;border-top:1px dashed var(--color-divider);min-width:0}
.summary-grid dt{font-family:var(--font-num);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:4px}
.summary-grid dd{font-size:12.5px;line-height:1.55;color:var(--color-text-secondary);margin:0;overflow-wrap:anywhere}
.extra{border-top:1px solid var(--color-divider)}
.extra summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:13px;font-weight:600;color:var(--color-text-secondary)}
.extra summary::-webkit-details-marker{display:none}
.extra summary::after{content:'展开';font-size:10.5px;font-weight:500;color:var(--color-text-muted);margin-left:10px}
.extra[open] summary::after{content:'收起'}
.extra summary em{font-style:normal;font-size:11px;font-weight:500;color:var(--color-text-muted);margin-left:auto;margin-right:10px}
.confirm-note{font-size:11.5px;line-height:1.7;color:var(--color-text-muted);margin:0}

/* ——— 底部操作 ——— */
.step-error{font-size:12px;line-height:1.6;color:var(--color-danger);background:var(--color-danger-soft);border-radius:10px;padding:10px 12px;margin:18px 0 0}
.w-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:22px;padding-top:18px;border-top:1px solid var(--color-divider)}
.w-actions .spacer{flex:1;min-width:8px}
.w-actions .back,.w-actions .skip{font-family:inherit;font-size:12px;font-weight:600;color:var(--color-text-secondary);padding:8px 10px;border-radius:9px;transition:background var(--motion-fast),color var(--motion-fast)}
.w-actions .back{display:inline-flex;align-items:center;gap:3px}
.w-actions .back:hover,.w-actions .skip:hover{background:var(--color-neutral-soft);color:var(--color-ink)}
.w-actions .skip{color:var(--color-text-muted)}
.foot-hint{font-size:11px;color:var(--color-text-muted)}

@media(max-width:980px){
  .w-main{grid-template-columns:1fr;gap:24px;padding-top:24px}
  .w-intro{position:static}
  .w-intro h1{font-size:34px;margin-top:10px}
  .w-intro p{max-width:620px}
  .w-privacy{max-width:620px}
}
@media(max-width:640px){
  .welcome{padding:16px var(--space-4) 40px}
  .w-badge{font-size:9.5px;padding:0 8px}
  .w-intro h1{font-size:29px}
  .w-intro p{font-size:12.5px}
  .panel{--card-pad:18px}
  .step-head h2{font-size:22px}
  .grid2{grid-template-columns:1fr}
  .choice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .summary-grid{grid-template-columns:1fr}
  .stepper li{font-size:10px;gap:4px}
  .stepper .dot{width:20px;height:20px;font-size:9px}
  .stepper .label{font-size:10px}
  .w-actions{gap:7px}
  .w-actions .spacer{flex-basis:100%;height:0}
  .w-actions :deep(.base-button){margin-left:auto}
}
@media(max-width:360px){
  .stepper .label{display:none}
  .choice-grid{grid-template-columns:1fr}
  .age-control input{font-size:21px}
}
</style>