<template>
  <div class="page-wrap">
    <div class="page-head">
      <div>
        <span class="eyebrow">PROFILE · 第 {{ step }} / {{ total }} 步</span>
        <h1>{{ editing ? '更新你的档案' : '先花一分钟，认识一下你' }}</h1>
        <p>{{ stepTitles[step - 1] }}</p>
      </div>
      <div class="dots"><i v-for="i in total" :key="i" :class="{ on: i <= step }"></i></div>
    </div>

    <BaseCard class="panel animate-slide-in-up">
      <template v-if="step === 1">
        <h2 class="q">你想怎么用这个助手？</h2>
        <div class="choices">
          <button
            v-for="m in modeChoices"
            :key="m.id"
            class="choice"
            :class="{ active: mode === m.id }"
            :aria-pressed="mode === m.id"
            @click="mode = m.id"
          >
            <strong>{{ m.label }}</strong>
            <small>{{ m.desc }}</small>
            <em>{{ m.meta }}</em>
          </button>
        </div>
        <p class="note">之后可以在侧边栏随时切换：切换前会先列出差异与未完成的计划，确认后才生效，已记录的训练不会被删除。</p>
      </template>

      <template v-else-if="step === 2">
        <h2 class="q">基本情况</h2>
        <div class="grid2">
          <label class="field">
            <span class="field-label">昵称（可留空）</span>
            <input v-model="nickname" type="text" maxlength="20" placeholder="想怎么称呼你" />
          </label>
          <label class="field">
            <span class="field-label">年龄</span>
            <input v-model.number="age" type="number" min="12" max="90" placeholder="25" />
            <small v-if="age && age < 18" class="fine">12–17 岁可建档并记录，但自动训练推荐面向 18 岁及以上。</small>
          </label>
        </div>

        <div class="field">
          <span class="field-label">主要目标</span>
          <div class="chips">
            <button v-for="g in goals" :key="g" class="chip" :class="{ active: goal === g }" :aria-pressed="goal === g" @click="goal = g">{{ g }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">运动经验</span>
          <div class="chips">
            <button v-for="e in experiences" :key="e" class="chip" :class="{ active: experience === e }" :aria-pressed="experience === e" @click="experience = e">{{ e }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">每次能用的时间（可多选）</span>
          <div class="chips">
            <button v-for="t in timeOptions" :key="t" class="chip" :class="{ active: availableTimes.includes(t) }" :aria-pressed="availableTimes.includes(t)" @click="toggle(availableTimes, t)">{{ t }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">可用器材（可多选）</span>
          <div class="chips">
            <button v-for="q in equipmentOptions" :key="q" class="chip" :class="{ active: equipment.includes(q) }" :aria-pressed="equipment.includes(q)" @click="toggle(equipment, q)">{{ q }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">常训练的场地（可多选）</span>
          <div class="chips">
            <button v-for="v in venueOptions" :key="v" class="chip" :class="{ active: availableVenues.includes(v) }" :aria-pressed="availableVenues.includes(v)" @click="toggle(availableVenues, v)">{{ v }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">需要避开的（可多选）</span>
          <div class="chips">
            <button v-for="r in restrictionOptions" :key="r" class="chip warn" :class="{ active: restrictions.includes(r) }" :aria-pressed="restrictions.includes(r)" @click="toggle(restrictions, r)">{{ r }}</button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">特殊情况（只决定要不要自动推荐）</span>
          <div class="chips">
            <button v-for="g in gateOptions" :key="g" class="chip warn" :class="{ active: restrictions.includes(g) }" :aria-pressed="restrictions.includes(g)" @click="toggle(restrictions, g)">{{ g }}</button>
          </div>
          <p v-if="blocked" class="gate" role="status">{{ blocked }}</p>
          <p v-else class="fine">勾选后仍然可以记录训练与三餐，只是不再自动生成安排；系统不据此判断动作是否安全。</p>
        </div>
      </template>

      <template v-else-if="mode === 'athlete'">
        <h2 class="q">专项信息</h2>
        <div class="grid2">
          <label class="field">
            <span class="field-label">项目</span>
            <input v-model="discipline" type="text" placeholder="例如：长跑" />
          </label>
          <label class="field">
            <span class="field-label">周期阶段</span>
            <div class="chips">
              <button v-for="p in phases" :key="p" class="chip" :class="{ active: cyclePhase === p }" :aria-pressed="cyclePhase === p" @click="cyclePhase = p">{{ p }}</button>
            </div>
          </label>
        </div>
        <div class="grid2">
          <label class="field">
            <span class="field-label">周期开始</span>
            <input v-model="cycleStartDate" type="date" />
          </label>
          <label class="field">
            <span class="field-label">周期结束</span>
            <input v-model="cycleEndDate" type="date" />
          </label>
        </div>
        <div class="grid2">
          <label class="field">
            <span class="field-label">目标赛事（可留空）</span>
            <input v-model="targetEvent" type="text" placeholder="例如：秋季半马" />
          </label>
          <label class="field">
            <span class="field-label">体重 kg（可留空）</span>
            <input v-model.number="weight" type="number" min="25" max="200" step="0.5" placeholder="60" />
          </label>
        </div>
      </template>

      <template v-else>
        <h2 class="q">看一下你的档案</h2>
        <ul class="review">
          <li><span>模式</span><b>大众模式</b></li>
          <li><span>称呼</span><b>{{ nickname || '朋友' }}</b></li>
          <li><span>年龄</span><b>{{ age || '—' }}</b></li>
          <li><span>目标</span><b>{{ goal || '—' }}</b></li>
          <li><span>经验</span><b>{{ experience || '—' }}</b></li>
          <li><span>可用时间</span><b>{{ join(availableTimes) }}</b></li>
          <li><span>器材</span><b>{{ join(equipment) }}</b></li>
          <li><span>场地</span><b>{{ join(availableVenues) }}</b></li>
          <li><span>需要避开</span><b>{{ join(restrictions) }}</b></li>
          <li><span>自动推荐</span><b>{{ blocked ? '不生成（仅记录与手工录入）' : '按以上条件生成' }}</b></li>
        </ul>
        <p class="note">这些条件只用来筛选动作与生成解释文案，系统不会据此判断动作是否安全。</p>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="nav">
        <BaseButton variant="ghost" :disabled="step === 1" @click="back">上一步</BaseButton>
        <BaseButton v-if="step < total" @click="next">下一步</BaseButton>
        <BaseButton v-else :icon="Check" @click="finish">{{ editing ? '保存修改' : '完成建档' }}</BaseButton>
      </div>
    </BaseCard>

    <p class="privacy">档案与训练记录都只存在这台设备的浏览器里（localStorage），不会上传。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Check } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { useAppStore } from '@/stores/app'
import type { Mode } from '@/types/domain'
import { AUTO_RECOMMEND_MIN_AGE } from '@/services/planRules'
import { gateReason } from '@/services/exercises'

const router = useRouter()
const store = useAppStore()
const profile = store.userProfile
const editing = computed(() => store.hasProfile)

const stepTitles = [
  '选一个更接近你的方式，之后随时可以切换。',
  '这些信息决定推荐与解释的口径，都可以跳过。',
  '确认无误就可以开始了。'
]
const total = 3

const modeChoices: { id: Mode; label: string; desc: string; meta: string }[] = [
  { id: 'public', label: '大众模式', desc: '每天一小段，跟着计数做完就行', meta: '轻量推荐 · 摄像头计数' },
  { id: 'athlete', label: '运动员模式', desc: '按周期安排，关注负荷与完成质量', meta: '周期计划 · 负荷记录（部分功能开发中）' }
]

const goals = ['保持活力', '减脂', '增肌', '改善体态', '专项提升', '康复维持']
const experiences = ['几乎不运动', '偶尔运动', '有一定基础', '长期规律训练']
const timeOptions = ['10 分钟', '20 分钟', '30 分钟', '45 分钟', '60 分钟']
const equipmentOptions = ['无器材', '椅子', '弹力带', '哑铃', '单杠', '跑步机']
const venueOptions = ['宿舍或家', '健身房', '户外']
const restrictionOptions = ['无跳跃', '膝部负担小', '腰部负担小', '低强度起步']
/** 这几项不是动作过滤器，而是"是否进入自动推荐"的适用范围门槛 */
const gateOptions = ['孕期或产后', '伤病或遵医嘱限制']
const phases = ['基础准备', '强度建立', '量化提升', '减量与测试']

const step = ref(1)
const mode = ref<Mode>(profile?.mode ?? 'public')
const nickname = ref(profile?.nickname ?? '')
const age = ref<number>(profile?.age ?? 25)
const goal = ref<string>(profile?.goal ?? '')
const experience = ref<string>(profile?.experience ?? '')
const availableTimes = ref<string[]>([...(profile?.availableTimes ?? [])])
const equipment = ref<string[]>([...(profile?.equipment ?? [])])
const availableVenues = ref<string[]>([...(profile?.availableVenues ?? [])])
const restrictions = ref<string[]>([...(profile?.restrictions ?? [])])
const discipline = ref(profile?.discipline ?? '')
const cyclePhase = ref(profile?.cyclePhase ?? '')
const cycleStartDate = ref(profile?.cycleStartDate ?? '')
const cycleEndDate = ref(profile?.cycleEndDate ?? '')
const targetEvent = ref(profile?.targetEvent ?? '')
const weight = ref<number | ''>(profile?.weight ?? '')
const error = ref('')

function toggle(list: string[], value: string) {
  const i = list.indexOf(value)
  if (i === -1) list.push(value)
  else list.splice(i, 1)
}

function join(list: string[]) {
  return list.length ? list.join('、') : '未填写'
}

function back() {
  error.value = ''
  if (step.value > 1) step.value--
}

function next() {
  error.value = ''
  if (step.value === 2) {
    if (!age.value || age.value < 12 || age.value > 90) {
      error.value = '请填写 12–90 之间的年龄：12 岁起可记录，自动推荐面向 18 岁及以上。'
      return
    }
    if (!goal.value) {
      error.value = '至少选一个主要目标，推荐才会说明"为什么适合你"。'
      return
    }
    if (!experience.value) {
      error.value = '请选一项运动经验。'
      return
    }
  }
  if (step.value < total) step.value++
}

/** 自动推荐是否可用：年龄够且没有命中适用范围门槛 */
const blocked = computed(() => {
  if (!Number.isFinite(age.value)) return null
  if (age.value < AUTO_RECOMMEND_MIN_AGE) {
    return `未满 ${AUTO_RECOMMEND_MIN_AGE} 岁：本次建档后只提供记录与手工录入，不生成自动训练推荐。`
  }
  return gateReason({ restrictions: restrictions.value })
})

function finish() {
  error.value = ''
  const wasEditing = store.hasProfile
  if (mode.value === 'athlete' && step.value === 3 && cycleStartDate.value && cycleEndDate.value && cycleStartDate.value > cycleEndDate.value) {
    error.value = '周期开始日期不能晚于结束日期。'
    return
  }
  store.updateProfile({
    nickname: nickname.value.trim() || undefined,
    age: age.value,
    goal: goal.value,
    experience: experience.value,
    availableTimes: [...availableTimes.value],
    equipment: [...equipment.value],
    availableVenues: [...availableVenues.value],
    restrictions: [...restrictions.value],
    discipline: discipline.value.trim() || undefined,
    cyclePhase: cyclePhase.value || undefined,
    cycleStartDate: cycleStartDate.value || undefined,
    cycleEndDate: cycleEndDate.value || undefined,
    targetEvent: targetEvent.value.trim() || undefined,
    weight: weight.value === '' ? undefined : Number(weight.value)
  })
  if (mode.value !== store.currentMode) store.commitMode(mode.value)
  // 档案条件变了就明确重算本周计划，避免继续显示按旧条件生成的版本
  if (wasEditing) store.regenerateWeekPlan(new Date())
  store.showToast({
    type: 'success',
    title: wasEditing ? '档案已更新' : '档案已建好',
    message: blocked.value ? '按你的档案：不生成自动推荐，可手工录入与记录' : '概览页的称呼与推荐口径会按这份档案来。',
    duration: 3000
  })
  router.push('/dashboard')
}
</script>

<style scoped>
.page-wrap{max-width:760px;margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:22px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:28px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0}
.dots{display:flex;gap:6px}
.dots i{width:26px;height:5px;border-radius:999px;background:var(--color-border);transition:background var(--motion-base) var(--easing-ease-out)}
.dots i.on{background:var(--color-accent)}
.panel{padding:26px}
.q{font-size:18px;margin-bottom:16px}
.choices{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.choice{padding:18px;border-radius:16px;text-align:left;background:var(--color-neutral-soft);border:1px solid transparent;transition:all var(--motion-base) var(--easing-ease-out)}
.choice strong{display:block;font-size:15px;color:var(--color-ink)}
.choice small{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:6px;line-height:1.6}
.choice em{display:block;font-style:normal;font-size:11px;color:var(--color-text-muted);margin-top:10px}
.choice:hover{transform:translateY(-2px);box-shadow:var(--shadow-sm)}
.choice.active{background:var(--color-accent-soft);border-color:var(--color-accent-line);box-shadow:var(--shadow-accent)}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.field{display:block;margin-bottom:16px}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.chip.warn{background:var(--color-caution-soft);color:var(--color-caution)}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip.active{background:var(--color-accent);color:white}
.chip.warn.active{background:var(--color-caution);color:white}
.note{font-size:12px;color:var(--color-text-muted);line-height:1.7;margin:14px 0 0}
.fine{font-size:11.5px;color:var(--color-text-muted);line-height:1.6;margin:7px 0 0}
.gate{font-size:12.5px;color:var(--color-caution);background:var(--color-caution-soft);border-radius:11px;padding:10px 12px;margin:10px 0 0;line-height:1.65}
.field .chips + .fine,.field .chips + .gate{margin-top:9px}
.review{list-style:none;padding:0;margin:0 0 8px;display:grid;gap:10px}
.review li{display:flex;justify-content:space-between;gap:16px;font-size:13px;color:var(--color-text-secondary);border-bottom:1px solid var(--color-divider);padding-bottom:10px}
.review b{color:var(--color-ink);text-align:right}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:11px 14px;margin:16px 0 0}
.nav{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}
.nav :deep(button){width:auto;padding:0 22px}
.privacy{font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:16px}
@media(max-width:640px){.choices,.grid2{grid-template-columns:1fr}.nav{flex-direction:column-reverse}.nav :deep(button){width:100%}}
</style>
