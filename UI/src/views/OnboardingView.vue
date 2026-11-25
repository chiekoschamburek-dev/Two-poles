<template>
  <div class="page-wrap">
    <PageHeader
      pole="neutral"
      label="PROFILE"
      title="个人档案"
      subtitle="填写真实的个人信息和训练偏好。年龄必填，其他资料可按需填写。"
      class="profile-head"
    />

    <form class="profile-form" novalidate @submit.prevent="saveProfile">
      <BaseCard class="panel">
        <h2 class="q">基本信息</h2>
        <AvatarPicker
          v-model="avatarDataUrl"
          :nickname="nickname"
          @update:loading="avatarLoading = $event"
        />
        <div class="grid2">
          <label class="field">
            <span class="field-label">昵称（可留空）</span>
            <input v-model="nickname" type="text" maxlength="20" placeholder="想怎么称呼你" autocomplete="nickname" />
          </label>
          <label class="field">
            <span class="field-label">年龄（必填）</span>
            <input ref="ageInput" v-model.number="age" type="number" min="12" max="90" placeholder="填写实际年龄" :aria-invalid="!!ageError" required />
            <small v-if="ageError" class="fine err">{{ ageError }}</small>
          </label>
        </div>

        <div class="grid2">
          <label class="field">
            <span class="field-label">身高 cm（可留空）</span>
            <input v-model.number="height" type="number" min="100" max="250" step="any" placeholder="例如 175" />
            <small v-if="bodyError.height" class="fine err">{{ bodyError.height }}</small>
          </label>
          <label class="field">
            <span class="field-label">体重 kg（可留空）</span>
            <input v-model.number="weight" type="number" min="25" max="200" step="any" placeholder="例如 65" />
            <small v-if="bodyError.weight" class="fine err">{{ bodyError.weight }}</small>
          </label>
        </div>
      </BaseCard>

      <BaseCard class="panel">
        <h2 class="q">训练偏好</h2>
        <div class="grid2">
          <div class="field">
            <span class="field-label">主要目标（可留空）</span>
            <SuggestionInput
              v-model="goal"
              label="主要目标（可留空）"
              :suggestions="goals"
              placeholder="例如 保持活力"
              :maxlength="200"
            />
          </div>
          <div class="field">
            <span class="field-label">运动经验（可留空）</span>
            <SuggestionInput
              v-model="experience"
              label="运动经验（可留空）"
              :suggestions="experiences"
              placeholder="例如 每周慢跑两次"
              :maxlength="200"
            />
          </div>
        </div>

        <div class="field">
          <span class="field-label">每次能用的时间（选填，可多选）</span>
          <div class="chips">
            <button v-for="t in timeOptions" :key="t" type="button" class="chip" :class="{ active: availableTimes.includes(t) }" :aria-pressed="availableTimes.includes(t)" @click="toggle(availableTimes, t)">{{ t }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">可用器材（选填，可多选）</span>
          <div class="chips">
            <button v-for="q in equipmentOptions" :key="q" type="button" class="chip" :class="{ active: equipment.includes(q) }" :aria-pressed="equipment.includes(q)" @click="toggle(equipment, q)">{{ q }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">常训练的场地（选填，可多选）</span>
          <div class="chips">
            <button v-for="v in venueOptions" :key="v" type="button" class="chip" :class="{ active: availableVenues.includes(v) }" :aria-pressed="availableVenues.includes(v)" @click="toggle(availableVenues, v)">{{ v }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">需要避开的（选填，可多选）</span>
          <div class="chips">
            <button v-for="r in restrictionOptions" :key="r" type="button" class="chip warn" :class="{ active: restrictions.includes(r) }" :aria-pressed="restrictions.includes(r)" @click="toggle(restrictions, r)">{{ r }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">特殊情况（选填）</span>
          <div class="chips">
            <button v-for="g in gateOptions" :key="g" type="button" class="chip warn" :class="{ active: restrictions.includes(g) }" :aria-pressed="restrictions.includes(g)" @click="toggle(restrictions, g)">{{ g }}</button>
          </div>
          <p v-if="blocked" class="gate" role="status">{{ blocked }}</p>
        </div>
      </BaseCard>

      <BaseCard class="panel">
        <h2 class="q">专项信息</h2>
        <p class="fine section-note">专项、训练目标和成绩记录均可留空。</p>

        <div class="field">
          <span class="field-label">主项（单选，可留空）</span>
          <div class="chips">
            <button
              v-for="e in eventOptions"
              :key="e"
              type="button"
              class="chip"
              :class="{ active: !otherSport && discipline === e }"
              :aria-pressed="!otherSport && discipline === e"
              @click="pickEvent(e)"
            >{{ e }}</button>
            <button type="button" class="chip" :class="{ active: otherSport }" :aria-pressed="otherSport" @click="pickOtherSport">其他</button>
          </div>
          <input
            v-if="otherSport"
            v-model="discipline"
            aria-label="填写主项"
            class="other-input"
            type="text"
            maxlength="24"
            placeholder="填写主项，例如：60m 栏"
          />
        </div>

        <div class="field">
          <span class="field-label">训练目标（二选一；切换不会丢掉另一类已填的内容）</span>
          <div class="seg">
            <button type="button" :class="{ on: goalType === 'competition' }" :aria-pressed="goalType === 'competition'" @click="goalType = 'competition'">比赛目标</button>
            <button type="button" :class="{ on: goalType === 'cycle' }" :aria-pressed="goalType === 'cycle'" @click="goalType = 'cycle'">训练周期目标</button>
          </div>
        </div>

        <div v-if="goalType === 'competition'" class="grid2">
          <label class="field">
            <span class="field-label">赛事名称</span>
            <input v-model="targetEvent" type="text" maxlength="30" placeholder="例如：秋季赛" />
          </label>
          <label class="field">
            <span class="field-label">比赛日期（可留空）</span>
            <input v-model="targetEventDate" type="date" />
          </label>
          <label class="field">
            <span class="field-label">目标成绩（可留空）</span>
            <input v-model="targetResult" type="text" maxlength="16" placeholder="例如：2:05 或 6.85" />
          </label>
          <label class="field">
            <span class="field-label">对应项目</span>
            <input :value="discipline || '未选主项'" type="text" disabled />
          </label>
        </div>

        <div v-else class="grid2">
          <div class="field">
            <span class="field-label">周期阶段</span>
            <div class="chips">
              <button v-for="p in phases" :key="p" type="button" class="chip" :class="{ active: cyclePhase === p }" :aria-pressed="cyclePhase === p" @click="cyclePhase = cyclePhase === p ? '' : p">{{ p }}</button>
            </div>
          </div>
          <label class="field">
            <span class="field-label">阶段重点（可留空）</span>
            <input v-model="cycleFocus" type="text" maxlength="30" placeholder="例如：有氧基础 + 技术" />
          </label>
          <label class="field">
            <span class="field-label">周期开始</span>
            <input v-model="cycleStartDate" type="date" />
          </label>
          <label class="field">
            <span class="field-label">周期结束</span>
            <input v-model="cycleEndDate" type="date" />
          </label>
          <small v-if="cycleError" class="fine err wide">{{ cycleError }}</small>
        </div>

        <details class="sec">
          <summary><span>PB 成绩</span><em>{{ personalBests.length }} 条</em></summary>
          <PbList v-model="personalBests" />
        </details>

        <details class="sec">
          <summary><span>健身房极限数据</span><em>{{ gymRecords.length }} 条</em></summary>
          <GymList v-model="gymRecords" />
        </details>
      </BaseCard>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="nav">
        <BaseButton :icon="Check" type="submit" :disabled="avatarLoading">保存档案</BaseButton>
      </div>
    </form>

    <p class="privacy">档案默认保存在本机。登录并启用同步后，档案会同步至账号。</p>

    <div class="debug-reset">
      <button type="button" @click="resetOnboarding">重置新手引导（调试用）</button>
      <span>只清除完成标记，回到引导第一步；已保存的档案不会被删除。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, toRefs, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Check } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import SuggestionInput from '@/components/common/SuggestionInput.vue'
import AvatarPicker from '@/components/profile/AvatarPicker.vue'
import PbList from '@/components/profile/PbList.vue'
import GymList from '@/components/profile/GymList.vue'
import { useAppStore } from '@/stores/app'
import {
  PROFILE_EQUIPMENT_OPTIONS,
  PROFILE_EVENT_OPTIONS,
  PROFILE_EXPERIENCES,
  PROFILE_GATE_OPTIONS,
  PROFILE_GOALS,
  PROFILE_PHASES,
  PROFILE_RESTRICTION_OPTIONS,
  PROFILE_TIME_OPTIONS,
  PROFILE_VENUE_OPTIONS
} from '@/config/profileOptions'
import { gateReason } from '@/services/exercises'
import { createProfileDraft, toProfilePayload } from '@/services/profileForm'
import { ageError as profileAgeError, bodyErrors, cycleRangeError, isValidAge } from '@/services/profileRules'

const router = useRouter()
const store = useAppStore()

// 选项统一来自 config/profileOptions.ts，档案页与首次使用引导共用
const goals = PROFILE_GOALS
const experiences = PROFILE_EXPERIENCES
const timeOptions = PROFILE_TIME_OPTIONS
const equipmentOptions = PROFILE_EQUIPMENT_OPTIONS
const venueOptions = PROFILE_VENUE_OPTIONS
const restrictionOptions = PROFILE_RESTRICTION_OPTIONS
const gateOptions = PROFILE_GATE_OPTIONS
const phases = PROFILE_PHASES
const eventOptions = PROFILE_EVENT_OPTIONS

const error = ref('')
const ageInput = ref<HTMLInputElement | null>(null)
const triedSave = ref(false)
const avatarLoading = ref(false)

const draft = reactive(createProfileDraft(store.userProfile))
const {
  nickname, avatarDataUrl, age, height, weight, goal, experience, availableTimes, equipment,
  availableVenues, restrictions, discipline, otherPicked, goalType, cyclePhase,
  cycleStartDate, cycleEndDate, cycleFocus, targetEvent, targetEventDate, targetResult,
  personalBests, gymRecords
} = toRefs(draft)

let savedDraft = JSON.stringify(draft)
watch(() => store.userProfile, (profile) => {
  const previous = JSON.parse(savedDraft) as typeof draft
  const next = createProfileDraft(profile)
  // 账号资料稍后同步到本机时，只回填尚未编辑的字段。
  const untouched = (key: keyof typeof draft) => JSON.stringify(draft[key]) === JSON.stringify(previous[key])
  const changes = Object.entries(next).filter(([key]) => untouched(key as keyof typeof draft)
    && (key !== 'otherPicked' || untouched('discipline')))
  Object.assign(draft, Object.fromEntries(changes))
  savedDraft = JSON.stringify(next)
})
const otherSport = computed(() => otherPicked.value || (!!discipline.value && !eventOptions.includes(discipline.value)))

function pickEvent(e: string) {
  otherPicked.value = false
  discipline.value = discipline.value === e ? '' : e
}
function pickOtherSport() {
  otherPicked.value = true
  if (eventOptions.includes(discipline.value)) discipline.value = ''
}

const bodyError = computed(() => bodyErrors(height.value, weight.value))
const ageError = computed(() => triedSave.value ? (profileAgeError(age.value) ?? '') : '')
const cycleError = computed(() => cycleRangeError(cycleStartDate.value, cycleEndDate.value))

function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i === -1) list.push(value)
  else list.splice(i, 1)
}

const blocked = computed(() => gateReason({ restrictions: restrictions.value }))

function saveProfile() {
  if (avatarLoading.value) return
  triedSave.value = true
  error.value = ''
  const savedAge = age.value
  if (!isValidAge(savedAge)) {
    ageInput.value?.focus()
    return
  }
  const wasEditing = store.hasProfile
  const body = bodyError.value
  if (body.height || body.weight) {
    error.value = body.height || body.weight || ''
    return
  }
  const rangeError = cycleRangeError(cycleStartDate.value, cycleEndDate.value)
  if (rangeError) {
    error.value = rangeError
    return
  }
  store.updateProfile(toProfilePayload(draft, savedAge))
  savedDraft = JSON.stringify(draft)
  // 计划生成与重算统一由计划页触发；保存档案只更新档案
  store.showToast({
    type: 'success',
    title: wasEditing ? '档案已更新' : '档案已建好',
    message: '可在计划页查看安排或使用档案生成计划。',
    duration: 3000
  })
  router.push('/')
}

/** 调试入口：清掉完成标记，AppShell 会立即用引导流替换主界面 */
function resetOnboarding() {
  store.resetOnboarding()
  void router.push('/')
}
</script>

<style scoped>
.page-wrap{max-width:var(--page-max-width);margin:auto}
/* 档案表单直接铺满统一容器；宽屏下内部字段自己排两列，不靠外面留白 */
.profile-form{display:grid;gap:16px}
.panel{padding:26px}
.q{font-size:18px;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.field{display:block;margin-bottom:16px}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.chip.warn{background:var(--color-caution-soft);color:var(--color-caution)}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip.active{background:var(--color-accent);color:var(--color-on-accent)}
.chip.warn.active{background:var(--color-caution);color:var(--color-on-caution)}
.note{font-size:12px;color:var(--color-text-muted);line-height:1.7;margin:14px 0 0}
.fine{font-size:11.5px;color:var(--color-text-muted);line-height:1.6;margin:7px 0 0}
.fine.err{color:var(--color-danger)}
.section-note{margin:-7px 0 16px}
/* 主项"其他"的自由输入 */
.other-input{width:100%;margin-top:9px;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
/* 目标类型二选一 */
.seg{display:flex;gap:8px;flex-wrap:wrap}
.seg button{padding:10px 16px;border-radius:11px;font-size:13px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast);min-height:44px}
.seg button.on{background:var(--color-accent);color:var(--color-on-accent)}
/* PB 与极限数据按需展开。 */
.sec{border-top:1px solid var(--color-divider);margin-top:12px}
.sec summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:13px 0;font-size:13.5px;font-weight:600;color:var(--color-ink)}
.sec summary::-webkit-details-marker{display:none}
.sec summary::after{content:'展开';font-size:11px;font-weight:500;color:var(--color-text-muted);margin-left:10px}
.sec[open] summary::after{content:'收起'}
.sec summary em{font-style:normal;font-size:11.5px;font-weight:500;color:var(--color-text-muted);margin-left:auto;margin-right:10px}
.gate{font-size:12.5px;color:var(--color-caution);background:var(--color-caution-soft);border-radius:11px;padding:10px 12px;margin:10px 0 0;line-height:1.65}
.field .chips + .fine,.field .chips + .gate{margin-top:9px}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:11px 14px;margin:0}
.nav{display:flex;justify-content:flex-end}
.nav :deep(button){width:auto;padding:0 22px}
.privacy{font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:16px}
.debug-reset{margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--color-text-muted)}
.debug-reset button{font-family:inherit;font-size:11px;font-weight:600;color:var(--color-text-muted);padding:5px 10px;border-radius:var(--radius-sm);border:1px dashed var(--color-border);transition:color var(--motion-fast),border-color var(--motion-fast)}
.debug-reset button:hover{color:var(--color-caution);border-color:var(--color-caution)}
@media(max-width:640px){.grid2{grid-template-columns:1fr}.panel{padding:18px}.nav :deep(button){width:100%}}
</style>
