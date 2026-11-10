<template>
  <div class="page-wrap">
    <div class="page-head">
      <div>
        <span class="eyebrow">PROFILE</span>
        <h1>个人档案</h1>
        <p>填写真实的个人信息和训练偏好。年龄必填，其他资料可按需填写。</p>
      </div>
    </div>

    <form class="profile-form" novalidate @submit.prevent="saveProfile">
      <BaseCard class="panel">
        <h2 class="q">基本信息</h2>
        <div class="avatar-field">
          <div class="avatar-preview">
            <img v-if="avatarDataUrl" :src="avatarDataUrl" alt="头像预览" />
            <span v-else aria-hidden="true">{{ nickname.trim().charAt(0) || '我' }}</span>
          </div>
          <div class="avatar-controls">
            <span class="field-label">头像（可留空）</span>
            <input ref="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="chooseAvatar" />
            <div class="avatar-actions">
              <BaseButton type="button" variant="secondary" size="sm" @click="avatarInput?.click()">{{ avatarDataUrl ? '更换头像' : '选择头像' }}</BaseButton>
              <BaseButton v-if="avatarDataUrl" type="button" variant="ghost" size="sm" @click="removeAvatar">移除头像</BaseButton>
            </div>
            <p v-if="avatarLoading" class="fine" role="status">正在处理头像…</p>
            <p v-else-if="avatarError" class="fine err" role="alert">{{ avatarError }}</p>
            <p v-else class="fine">支持 JPG、PNG、WebP。点击「保存档案」后生效。</p>
          </div>
        </div>
        <div class="grid2">
          <label class="field">
            <span class="field-label">昵称（可留空）</span>
            <input v-model="nickname" type="text" maxlength="20" placeholder="想怎么称呼你" autocomplete="nickname" />
          </label>
          <label class="field">
            <span class="field-label">年龄（必填）</span>
            <input ref="ageInput" v-model.number="age" type="number" min="12" max="90" placeholder="填写实际年龄" :aria-invalid="!!ageError" required />
            <small v-if="ageError" class="fine err">{{ ageError }}</small>
            <small v-else-if="age !== '' && age < AUTO_RECOMMEND_MIN_AGE" class="fine">12–17 岁可建档并记录，自动训练推荐面向 18 岁及以上。</small>
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
          <label class="field">
            <span class="field-label">主要目标（可留空）</span>
            <input v-model="goal" type="text" list="profile-goals" maxlength="200" placeholder="例如 保持活力" />
          </label>
          <label class="field">
            <span class="field-label">运动经验（可留空）</span>
            <input v-model="experience" type="text" list="profile-experience" maxlength="200" placeholder="例如 每周慢跑两次" />
          </label>
        </div>
        <datalist id="profile-goals"><option v-for="g in goals" :key="g" :value="g" /></datalist>
        <datalist id="profile-experience"><option v-for="e in experiences" :key="e" :value="e" /></datalist>

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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, toRefs, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Check } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import PbList from '@/components/profile/PbList.vue'
import GymList from '@/components/profile/GymList.vue'
import { useAppStore } from '@/stores/app'
import type { GoalType, UserProfile } from '@/types/domain'
import { AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'
import { gateReason } from '@/services/exercises'
import { FIELD_EVENTS, TRACK_EVENTS, bodyErrors, cycleRangeError } from '@/services/profileRules'
import { prepareModelImage } from '@/utils/modelImage'

const router = useRouter()
const store = useAppStore()

const goals = ['保持活力', '减脂', '增肌', '改善体态', '专项提升', '康复维持']
const experiences = ['几乎不运动', '偶尔运动', '有一定基础', '长期规律训练']
const timeOptions = ['10 分钟', '20 分钟', '30 分钟', '45 分钟', '60 分钟']
const equipmentOptions = ['无器材', '椅子', '弹力带', '哑铃', '单杠', '跑步机']
const venueOptions = ['宿舍或家', '健身房', '户外']
const restrictionOptions = ['无跳跃', '膝部负担小', '腰部负担小', '低强度起步']
/** 这几项不是动作过滤器，而是"是否进入自动推荐"的适用范围门槛 */
const gateOptions = ['孕期或产后', '伤病或遵医嘱限制']
const phases = ['基础准备', '强度建立', '量化提升', '减量与测试']

const eventOptions = [...TRACK_EVENTS, ...FIELD_EVENTS]
const error = ref('')
const ageInput = ref<HTMLInputElement | null>(null)
const triedSave = ref(false)
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarLoading = ref(false)
const avatarError = ref('')
let avatarRequest = 0

function profileDraft(profile: UserProfile | null) {
  const goalType: GoalType = profile?.goalType ?? (profile?.targetEvent ? 'competition' : 'cycle')
  return {
    nickname: profile?.nickname ?? '',
    avatarDataUrl: profile?.avatarDataUrl ?? '',
    age: profile?.age ?? ('' as const),
    height: profile?.height ?? ('' as const),
    weight: profile?.weight ?? ('' as const),
    goal: profile?.goal ?? '',
    experience: profile?.experience ?? '',
    availableTimes: [...(profile?.availableTimes ?? [])],
    equipment: [...(profile?.equipment ?? [])],
    availableVenues: [...(profile?.availableVenues ?? [])],
    restrictions: [...(profile?.restrictions ?? [])],
    discipline: profile?.discipline ?? '',
    otherPicked: !!profile?.discipline && !eventOptions.includes(profile.discipline),
    goalType,
    cyclePhase: profile?.cyclePhase ?? '',
    cycleStartDate: profile?.cycleStartDate ?? '',
    cycleEndDate: profile?.cycleEndDate ?? '',
    cycleFocus: profile?.cycleFocus ?? '',
    targetEvent: profile?.targetEvent ?? '',
    targetEventDate: profile?.targetEventDate ?? '',
    targetResult: profile?.targetResult ?? '',
    personalBests: (profile?.personalBests ?? []).map(record => ({ ...record })),
    gymRecords: (profile?.gymRecords ?? []).map(record => ({ ...record }))
  }
}

const draft = reactive(profileDraft(store.userProfile))
const {
  nickname, avatarDataUrl, age, height, weight, goal, experience, availableTimes, equipment,
  availableVenues, restrictions, discipline, otherPicked, goalType, cyclePhase,
  cycleStartDate, cycleEndDate, cycleFocus, targetEvent, targetEventDate, targetResult,
  personalBests, gymRecords
} = toRefs(draft)

let savedDraft = JSON.stringify(draft)
watch(() => store.userProfile, (profile) => {
  const previous = JSON.parse(savedDraft) as typeof draft
  const next = profileDraft(profile)
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
const ageError = computed(() => triedSave.value && (age.value === '' || !Number.isInteger(age.value) || age.value < 12 || age.value > 90)
  ? '请填写 12–90 岁之间的实际年龄。' : '')
const cycleError = computed(() => cycleRangeError(cycleStartDate.value, cycleEndDate.value))

function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i === -1) list.push(value)
  else list.splice(i, 1)
}

const blocked = computed(() => gateReason({ restrictions: restrictions.value }))

async function chooseAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const request = ++avatarRequest
  avatarLoading.value = true
  avatarError.value = ''
  try {
    const preview = await prepareModelImage(file, 256)
    if (request !== avatarRequest) return
    if (preview.length > 180_000) throw new Error('头像压缩后仍太大，请换一张图片。')
    avatarDataUrl.value = preview
  } catch (failure) {
    if (request === avatarRequest) avatarError.value = failure instanceof Error ? failure.message : '无法读取头像。'
  } finally {
    if (request === avatarRequest) avatarLoading.value = false
  }
}

function removeAvatar() {
  avatarRequest++
  avatarLoading.value = false
  avatarError.value = ''
  avatarDataUrl.value = ''
}

function saveProfile() {
  if (avatarLoading.value) return
  triedSave.value = true
  error.value = ''
  const savedAge = age.value
  if (savedAge === '' || ageError.value) {
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
  store.updateProfile({
    nickname: nickname.value.trim() || undefined,
    avatarDataUrl: avatarDataUrl.value || undefined,
    age: savedAge,
    goal: goal.value.trim(),
    experience: experience.value.trim(),
    availableTimes: [...availableTimes.value],
    equipment: [...equipment.value],
    availableVenues: [...availableVenues.value],
    restrictions: [...restrictions.value],
    // 身体数据：留空时存 undefined，不覆盖成 0
    height: height.value === '' ? undefined : Number(height.value),
    weight: weight.value === '' ? undefined : Number(weight.value),
    // 专项字段：保存时原样带回，不丢
    discipline: discipline.value.trim() || undefined,
    cyclePhase: cyclePhase.value || undefined,
    cycleStartDate: cycleStartDate.value || undefined,
    cycleEndDate: cycleEndDate.value || undefined,
    cycleFocus: cycleFocus.value.trim() || undefined,
    goalType: goalType.value,
    targetEvent: targetEvent.value.trim() || undefined,
    targetEventDate: targetEventDate.value || undefined,
    targetResult: targetResult.value.trim() || undefined,
    personalBests: [...personalBests.value],
    gymRecords: [...gymRecords.value]
  })
  savedDraft = JSON.stringify(draft)
  // 档案条件变了：先让模型问清关键信息，再明确重算本周计划
  if (store.planLlmReady) void store.generatePlanQuestions()
  if (wasEditing) store.regenerateWeekPlan(new Date())
  store.showToast({
    type: 'success',
    title: wasEditing ? '档案已更新' : '档案已建好',
    message: '可在计划页查看安排或使用档案生成计划。',
    duration: 3000
  })
  router.push('/')
}
</script>

<style scoped>
.page-wrap{max-width:760px;margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:28px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0}
.profile-form{display:grid;gap:16px}
.panel{padding:26px}
.q{font-size:18px;margin-bottom:16px}
.avatar-field{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.avatar-preview{width:68px;height:68px;display:grid;place-items:center;flex:none;overflow:hidden;border-radius:50%;background:var(--color-accent-soft);color:var(--color-accent);font-size:22px;font-weight:700}
.avatar-preview img{display:block;width:100%;height:100%;object-fit:cover}
.avatar-controls{min-width:0}
.avatar-actions{display:flex;gap:8px;flex-wrap:wrap}
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
@media(max-width:640px){.grid2{grid-template-columns:1fr}.panel{padding:18px}.nav :deep(button){width:100%}}
</style>
