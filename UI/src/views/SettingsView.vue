<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h1>设置与数据</h1>
        <p>档案、训练与饮食记录只存在这台设备的浏览器里；没有账号。需要云端模型时，只发送这次操作所需的内容，密钥留在服务端。</p>
      </div>
      <StatusBadge :variant="store.hasProfile ? 'success' : 'neutral'">{{ store.hasProfile ? '已建档' : '未建档' }}</StatusBadge>
    </div>

    <BaseCard class="section animate-slide-in-up">
      <h2>使用方式</h2>
      <p class="sub">切换前会先列出差异与未完成的计划，确认后才生效；已有记录与计划版本不会被改写。</p>
      <div class="choices">
        <button
          v-for="m in modes"
          :key="m.id"
          class="choice"
          :class="{ active: store.currentMode === m.id }"
          :aria-pressed="store.currentMode === m.id"
          :disabled="store.pendingSwitch !== null"
          @click="store.requestModeSwitch(m.id)"
        >
          <strong>{{ m.label }}</strong><small>{{ m.desc }}</small>
        </button>
      </div>

      <div v-if="preview" class="switch-confirm" role="group" aria-labelledby="sw-title">
        <strong id="sw-title">切换到{{ preview.toLabel }}？</strong>
        <p class="sw-lead">{{ preview.openPlanNote }}</p>
        <div class="sw-cols">
          <div><span>会变化</span><ul><li v-for="d in preview.differences" :key="d">{{ d }}</li></ul></div>
          <div><span>保持不变</span><ul><li v-for="k in preview.keeps" :key="k">{{ k }}</li></ul></div>
        </div>
        <div class="actions">
          <BaseButton size="sm" @click="store.confirmModeSwitch()">确认切换</BaseButton>
          <BaseButton variant="ghost" size="sm" @click="store.cancelModeSwitch()">取消，保持{{ preview.fromLabel }}</BaseButton>
        </div>
      </div>
      <div class="row-line">
        <div><strong>档案</strong><small>{{ profileLine }}</small><em v-if="goalLine" class="goal-line">{{ goalLine }}</em></div>
        <RouterLink class="link" to="/onboarding">{{ store.hasProfile ? '修改档案' : '去建档' }} <ArrowRight :size="14" /></RouterLink>
      </div>
    </BaseCard>

    <!-- 大模型接入：配置只存本机，密钥不随导出带走 -->
    <BaseCard class="section animate-slide-in-up">
      <div class="llm-head">
        <div>
          <h2>模型接入</h2>
          <p class="sub">留空就用服务端的内置模型；填了自己的接口就用你自己的。计划生成与照片食物识别共用这份配置，识别照片时模型必须支持图片输入。</p>
        </div>
        <StatusBadge :variant="llmReady ? 'success' : 'neutral'">{{ llmBadge }}</StatusBadge>
      </div>

      <p class="llm-default" :class="{ dim: !store.llmDefault.available }">
        <template v-if="store.llmDefault.available">
          服务端默认模型：<b>{{ store.llmDefault.model }}</b>
        </template>
        <template v-else>
          服务端没有配置默认模型{{ hasCustom ? '' : '，需要自己填一个才能生成计划' }}。
        </template>
      </p>

      <!-- 用哪个模型是偏好，不是清空：切到内置后，下面填的配置原样保留 -->
      <div class="llm-pick" role="group" aria-label="使用哪个模型">
        <button type="button" :class="{ on: !usingBuiltin }" :aria-pressed="!usingBuiltin" @click="setPreference('custom')">
          使用我填的接口
        </button>
        <button
          type="button"
          :class="{ on: usingBuiltin }"
          :aria-pressed="usingBuiltin"
          :disabled="!store.llmDefault.available"
          @click="setPreference('default')"
        >
          使用内置模型
        </button>
        <span v-if="usingBuiltin" class="pick-note">已切到内置；下面填的配置都还在，随时切回来</span>
        <span v-else-if="!hasCustom" class="pick-note warn">还没填接口，会先回退到内置模型</span>
      </div>

      <div class="fields">
        <label class="field">
          <span class="field-label">base_url</span>
          <input v-model="llmForm.baseUrl" type="text" placeholder="https://api.deepseek.com/v1" autocomplete="off" />
        </label>
        <label class="field">
          <span class="field-label">模型名</span>
          <input v-model="llmForm.model" type="text" placeholder="deepseek-chat" autocomplete="off" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">API Key（只存本机，导出时不会带走）</span>
        <input v-model="llmForm.apiKey" type="password" placeholder="sk-..." autocomplete="off" />
      </label>

      <div class="llm-actions">
        <BaseButton size="sm" @click="saveLlm">保存配置</BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="testingLlm" @click="runTest">
          {{ testingLlm ? '测试中…' : '测试连接' }}
        </BaseButton>
        <span class="llm-msg" :class="{ bad: llmMsgBad }">{{ llmMsg }}</span>
      </div>

      <p class="fine">
        浏览器直连第三方接口会被 CORS 拦掉，所以请求经本机 Vite 中间件转发（<code>/api/llm/chat</code>）。
        你自己的密钥只存在这台设备上，只在这次请求里经过本机进程，不写日志、不入库；
        服务端默认模型的密钥只存在于服务端，不会下发到浏览器。两者都没有时，应用仍然按内置规则生成计划。
      </p>
      <p class="fine">
        拍照识别同样走这条代理，会把这一张照片发给所选模型；不支持图片输入的模型会在识别时报错。
        失败时仍可改用本机识别或手动补录，原图不保存。
      </p>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>隐私</h2>
      <p class="sub">当前实现里，摄像头画面只在本机做姿态推理，不上传、也不落盘。下面的开关记录的是你的偏好。</p>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.cameraEnabled" @change="setPrivacy('cameraEnabled', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>允许使用摄像头跟练</strong><small>关闭后，跟练页只保留"演示回放"来源。</small></span>
      </label>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.saveVideoLocally" @change="setPrivacy('saveVideoLocally', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>把原始画面存到本机</strong><small>本版本没有实现录制，因此这个开关目前不会改变任何行为。</small></span>
      </label>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.showEnergyEstimate" @change="setPrivacy('showEnergyEstimate', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>显示热量粗估</strong><small>默认关闭。开启后按"区间 + 来源"显示，依赖你填的份量与内置参考值（未与权威成分表核对），不作为营养建议。</small></span>
      </label>

      <label class="toggle">
        <input type="checkbox" role="switch" :checked="store.privacy.saveFoodPhotoLocally" @change="setPrivacy('saveFoodPhotoLocally', ($event.target as HTMLInputElement).checked)" />
        <span class="tg"><i></i></span>
        <span class="tlabel"><strong>保存饮食照片缩略图</strong><small>开启后，拍照记录会在本机随记录保存一张压缩缩略图，用于在饮食列表回看；不会上传，但会占用浏览器本地存储。关闭后新记录只保留识别结果，已有缩略图不会自动删除。</small></span>
      </label>

      <p class="fine">
        饮食拍照识别：使用上面「模型接入」里的配置（或服务端默认模型）时，拍照前会明确说明这张照片会发送到该服务并征得你的同意；
        没有配置模型时使用本机模型，照片不上传。两种方式下本应用都不保存原图；开启「保存饮食照片缩略图」时只在本机保存压缩缩略图。
      </p>

      <div class="fields">
        <label class="field">
          <span class="field-label">保留天数（偏好记录）</span>
          <input v-model.number="retention" type="number" min="7" max="3650" @change="setPrivacy('dataRetentionDays', retention)" />
          <small class="fine">目前没有自动清理逻辑，超过天数的数据不会被删除。</small>
        </label>
        <div class="field">
          <span class="field-label">导出格式</span>
          <div class="chips">
            <button
              v-for="f in formats"
              :key="f.id"
              class="chip"
              :class="{ active: store.privacy.exportFormat === f.id }"
              :aria-pressed="store.privacy.exportFormat === f.id"
              @click="setPrivacy('exportFormat', f.id)"
            >{{ f.label }}</button>
          </div>
        </div>
      </div>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>外观</h2>
      <p class="sub">默认跟随系统。手动选浅色或深色后就固定下来，不再跟着系统变；这个偏好只存在本机。</p>
      <div class="chips" role="group" aria-label="主题">
        <button
          v-for="t in themes"
          :key="t.id"
          class="chip"
          :class="{ active: store.themePref === t.id }"
          :aria-pressed="store.themePref === t.id"
          @click="store.setTheme(t.id)"
        >{{ t.label }}</button>
      </div>
      <p v-if="store.themePref === 'system'" class="fine">系统当前是{{ systemDark ? '深色' : '浅色' }}，页面已跟着切换。</p>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up">
      <h2>我的数据</h2>
      <div class="stats">
        <div class="stat"><span>训练记录</span><b>{{ store.sessions.length }}</b></div>
        <div class="stat"><span>餐食记录</span><b>{{ store.meals.length }}</b></div>
        <div class="stat"><span>缺 RPE 的训练</span><b>{{ rpeMissing }}</b></div>
        <div class="stat"><span>占用</span><b>{{ sizeKb }} KB</b></div>
      </div>
      <p class="sub">导出会把档案、训练与餐食按下面的格式写到本机下载目录，不经过任何服务器。JSON 会包含已保存的照片缩略图；CSV 不包含图片。</p>
      <div class="actions">
        <BaseButton :icon="Download" @click="exportData(store.privacy.exportFormat)">导出 {{ store.privacy.exportFormat === 'json' ? 'JSON' : 'CSV' }}</BaseButton>
        <BaseButton variant="secondary" :icon="RotateCcw" :disabled="!store.sessions.length && !store.meals.length" @click="exportData('json')">另存为 JSON</BaseButton>
      </div>
      <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
    </BaseCard>

    <BaseCard class="section danger animate-slide-in-up">
      <h2>清除全部数据</h2>
      <p class="sub">删除档案、模式、全部训练与餐食记录，并清空本机存储。此操作不可撤销。</p>
      <template v-if="!confirming">
        <BaseButton variant="danger" :icon="Trash2" :disabled="!hasData" @click="confirming = true">清除全部数据</BaseButton>
        <p v-if="!hasData" class="fine">现在没有任何可清除的记录。</p>
      </template>
      <div v-else class="confirm">
        <p><strong>确认删除 {{ store.sessions.length }} 条训练与 {{ store.meals.length }} 条餐食记录？</strong>导出后再清会更稳妥。</p>
        <div class="actions">
          <BaseButton variant="ghost" @click="confirming = false">取消</BaseButton>
          <BaseButton variant="danger" :icon="Trash2" @click="wipe">确认清除</BaseButton>
        </div>
      </div>
    </BaseCard>

    <p class="foot">版本 {{ RULE_VERSION }} · 记录规则与报告口径见周报页底部的数据质量说明。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowRight, Download, RotateCcw, Trash2 } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import type { PrivacySettings, ThemePreference } from '@/types/domain'
import { displayName } from '@/utils/time'
import { goalSummary } from '@/services/profileRules'
import { RULE_VERSION } from '@/services/mealRules'
import { canUseLlm, isLlmReady, testLlmConfig, usingDefault } from '@/services/llm'
import type { LlmConfig } from '@/services/llm'

const store = useAppStore()
const confirming = ref(false)
const exportError = ref('')
const retention = ref(store.privacy.dataRetentionDays)

const modes: { id: 'public' | 'athlete'; label: string; desc: string }[] = [
  { id: 'public', label: '大众模式', desc: '按器材与时长过滤的一周安排、摄像头计数、简单餐次确认' },
  { id: 'athlete', label: '运动员模式', desc: '周期与锁定训练、距离时长与 RPE 负荷、训练日用餐时间线' }
]
const formats: { id: PrivacySettings['exportFormat']; label: string }[] = [
  { id: 'json', label: 'JSON（完整结构）' },
  { id: 'csv', label: 'CSV（表格软件可开）' }
]
const themes: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' }
]
// ——— 模型接入 ———
const llmForm = ref<LlmConfig>({ ...store.llmConfig })
const hasCustom = computed(() => isLlmReady(llmForm.value))
const llmReady = computed(() => canUseLlm(llmForm.value, store.llmDefault))
const usingBuiltin = computed(() => usingDefault(llmForm.value))
const llmBadge = computed(() =>
  usingBuiltin.value ? (store.llmDefault.available ? '内置模型' : '未配置') : hasCustom.value ? '自己的接口' : '接口未填'
)
const testingLlm = ref(false)
const llmMsg = ref('')
const llmMsgBad = ref(false)

function saveLlm() {
  // 填完点保存 = 想用自己这份，所以顺手切到自定义偏好（而不是留着"内置"却存了一份不用的配置）
  const ready = isLlmReady(llmForm.value)
  store.setLlmConfig({ ...llmForm.value, preference: ready ? 'custom' : llmForm.value.preference })
  llmForm.value = { ...store.llmConfig }
  llmMsgBad.value = false
  llmMsg.value = ready ? '已保存，并切到这份配置' : '已保存（还没填全，仍会用内置模型）'
  store.showToast({
    type: 'success',
    title: '模型配置已保存',
    message: ready ? '建档完成后会用这份配置生成计划' : '接口没填全，生成时仍回退到服务端默认模型',
    duration: 3000
  })
}

/** 只切偏好：切到内置时不清空任何已填内容 */
function setPreference(preference: 'custom' | 'default') {
  store.setLlmPreference(preference)
  llmForm.value = { ...store.llmConfig }
  llmMsgBad.value = false
  llmMsg.value = preference === 'default'
    ? '已切到内置模型；你填的配置仍然保留'
    : '已切回你自己的接口'
}

async function runTest() {
  store.setLlmConfig({ ...llmForm.value })
  llmForm.value = { ...store.llmConfig }
  testingLlm.value = true
  llmMsgBad.value = false
  llmMsg.value = '正在请求模型…'
  try {
    const res = await testLlmConfig(store.llmConfig)
    llmMsg.value = res.message
    llmMsgBad.value = !res.ok
  } finally {
    testingLlm.value = false
  }
}

const systemDark = ref(typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false)

const profileLine = computed(() => {  const p = store.userProfile
  if (!p) return '还没有档案，可以先建档再看推荐说明。'
  const bits = [displayName(p.nickname), p.goal, p.experience].filter(Boolean)
  // 身体数据只并列展示，不做任何评价
  const body = [p.height ? `${p.height} cm` : '', p.weight ? `${p.weight} kg` : ''].filter(Boolean).join(' / ')
  if (body) bits.push(body)
  return bits.join(' · ')
})
/** 运动员档案多一行目标摘要：比赛目标与周期目标的说法由 profileRules 统一 */
const goalLine = computed(() => {
  const p = store.userProfile
  if (!p || store.currentMode !== 'athlete') return ''
  return goalSummary(p)
})
const rpeMissing = computed(() => store.sessions.filter(s => s.rpe === null).length)
const preview = computed(() => store.switchPreview)
const hasData = computed(() => store.sessions.length + store.meals.length + store.plans.length > 0 || store.hasProfile)
const payload = computed(() => ({
  exportedAt: new Date().toISOString(),
  profile: store.userProfile,
  mode: store.currentMode,
  modeLog: store.modeLog,
  privacy: store.privacy,
  sessions: store.sessions,
  meals: store.meals,
  plans: store.plans,
  planHistory: store.planHistory,
  unitGrams: store.unitGrams
}))
const sizeKb = computed(() => Math.max(1, Math.round(new Blob([JSON.stringify(payload.value)]).size / 1024)))

function setPrivacy<K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) {
  if (key === 'dataRetentionDays' && (!Number.isFinite(Number(value)) || Number(value) < 7)) {
    retention.value = store.privacy.dataRetentionDays
    return
  }
  store.updatePrivacy({ [key]: value } as Partial<PrivacySettings>)
  store.showToast({ type: 'success', title: '设置已保存', message: '只写在本机 localStorage', duration: 2000 })
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toCsv(): string {
  const head = ['类别', '日期', '时间', '名称', '类型或类别', '时长分钟', '距离米', '次数', '组数', '单位', 'RPE', '负荷', '不适', '状态', '备注']
  const rows = [
    ...store.sessions.map(s => [
      '训练', s.date, s.createdAt.slice(11, 16), s.exerciseName, s.type,
      s.actualDuration ?? '', s.actualDistance ?? '', s.actualReps ?? '', s.actualSets ?? '', '',
      s.rpe ?? '未记录', s.rpe === null || !s.actualDuration ? '未计入' : Math.round(s.actualDuration * s.rpe),
      s.discomfort ? '是' : '否', s.completionStatus, s.notes ?? ''
    ]),
    ...store.meals.flatMap(m => m.items.map(i => [
      // 餐食的量写在"次数/数量"列、单位写在"单位"列，其余数值列留空
      '餐食', m.date, m.time, i.foodName, i.category,
      '', '', i.portionSize ?? '', '', i.portionUnit ?? '', '', '', '', m.completeness, i.source === 'photo' ? '照片识别候选，已由用户确认' : ''
    ])),
    ...store.plans.flatMap(p => p.items.map(i => [
      '计划', i.date, '', i.exerciseName, i.type,
      i.plannedDuration ?? '', i.plannedDistance ?? '', i.plannedReps ?? '', i.plannedSets ?? '', '',
      '', '', '', i.completed ? '已完成' : '待完成', `v${p.version}｜${p.mode === 'public' ? '大众' : '运动员'}｜${p.reason}`
    ]))
  ]
  return '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}

function download(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportData(format: PrivacySettings['exportFormat']) {
  exportError.value = ''
  const stamp = new Date().toISOString().slice(0, 10)
  try {
    if (format === 'json') {
      download(`twopoles-${stamp}.json`, 'application/json;charset=utf-8', JSON.stringify(payload.value, null, 2))
    } else {
      download(`twopoles-${stamp}.csv`, 'text/csv;charset=utf-8', toCsv())
    }
    store.showToast({ type: 'success', title: '已开始下载', message: '文件由本机浏览器直接生成', duration: 2500 })
  } catch (err) {
    exportError.value = `导出失败：${(err as Error)?.message || '浏览器阻止了下载'}`
  }
}

function wipe() {
  store.clearAllData()
  confirming.value = false
  retention.value = 90
}
</script>

<style scoped>
.page-wrap{max-width:860px;margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
.eyebrow{display:inline-flex;align-items:center;font-size:11px;letter-spacing:var(--tracking-eyebrow);color:var(--color-accent);font-weight:700}.eyebrow::before{content:'';width:6px;height:6px;border-radius:2px;background:var(--color-accent);transform:rotate(45deg);margin-right:8px}
.page-head h1{font-size:28px;margin:9px 0 8px;color:var(--color-ink)}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0;line-height:1.7}
.section{padding:22px;margin-bottom:14px}
.section h2{font-size:17px;margin-bottom:6px}
.sub{font-size:12px;color:var(--color-text-muted);line-height:1.7;margin:0 0 14px}
.switch-confirm{display:grid;gap:10px;padding:14px;border-radius:14px;background:var(--color-neutral-soft);border:1px solid var(--color-accent-line);margin-bottom:14px}
.switch-confirm>strong{font-size:14px;color:var(--color-ink)}
.sw-lead{font-size:12px;color:var(--color-caution);background:var(--color-caution-soft);border-radius:10px;padding:9px 11px;margin:0;line-height:1.6}
.sw-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px}
.sw-cols span{display:block;font-weight:700;color:var(--color-text-muted);margin-bottom:4px}
.sw-cols ul{margin:0;padding-left:16px;line-height:1.7;color:var(--color-text-secondary)}
@media(max-width:560px){.sw-cols{grid-template-columns:1fr}}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.choice{padding:15px 16px;border-radius:14px;text-align:left;background:var(--color-neutral-soft);border:1px solid transparent;transition:all var(--motion-base) var(--easing-ease-out)}
.choice strong{display:block;font-size:14px;color:var(--color-ink)}
.choice small{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:5px;line-height:1.6}
.choice:hover{transform:translateY(-2px);box-shadow:var(--shadow-sm)}
.choice.active{background:var(--color-accent-soft);border-color:var(--color-accent-line);box-shadow:var(--shadow-accent)}
.row-line{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-top:14px;border-top:1px solid var(--color-divider)}
.row-line strong{display:block;font-size:13px;color:var(--color-ink)}
.row-line small{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:3px}
.link{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;color:var(--color-accent);white-space:nowrap}
.toggle{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-divider);cursor:pointer}
.toggle input{position:absolute;opacity:0;width:1px;height:1px}
.tg{width:42px;height:24px;border-radius:999px;background:var(--color-border);flex:none;padding:3px;transition:background var(--motion-base) var(--easing-ease-out)}
.tg i{display:block;width:18px;height:18px;border-radius:50%;background:var(--surface-field);box-shadow:var(--shadow-sm);transition:transform var(--motion-base) var(--easing-spring)}
.toggle input:checked+.tg{background:var(--color-accent)}
.toggle input:checked+.tg i{transform:translateX(18px)}
.toggle input:focus-visible+.tg{outline:2px solid var(--color-accent);outline-offset:2px}
.tlabel strong{display:block;font-size:13px;color:var(--color-ink)}
.tlabel small{display:block;font-size:12px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.fields{display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-top:16px}
.field{display:block}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 14px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip.active{background:var(--color-accent);color:var(--color-on-accent)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.stat{padding:14px;border-radius:14px;background:var(--color-neutral-soft)}
.stat span{display:block;font-size:11px;color:var(--color-text-muted)}
.stat b{display:block;font-size:20px;color:var(--color-ink);margin-top:4px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.actions :deep(button){width:auto;padding:0 20px}
.error{font-size:13px;color:var(--color-danger);background:var(--color-danger-soft);border-radius:11px;padding:10px 13px;margin:12px 0 0}
.fine{font-size:11px;color:var(--color-text-muted);margin:8px 0 0;line-height:1.6}
.confirm{padding:16px;border-radius:14px;background:var(--color-danger-soft);border:1px solid var(--color-danger)}
.confirm p{font-size:13px;color:var(--color-danger);margin:0 0 12px;line-height:1.7}
.section.danger h2{color:var(--color-danger)}
.foot{font-size:11px;color:var(--color-text-muted);text-align:center;margin:16px 0 0}
@media(max-width:767px){.choices,.fields,.stats{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.page-head{flex-direction:column;align-items:flex-start}.actions :deep(button){width:100%}}
.llm-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.llm-pick button{padding:8px 14px;border-radius:10px;font-size:12.5px;font-weight:600;min-height:38px;color:var(--color-text-secondary);background:var(--color-neutral-soft);border:1px solid transparent}
.llm-pick button.on{background:var(--color-accent);color:var(--color-on-accent)}
.llm-pick button:disabled{opacity:.45;cursor:not-allowed}
.pick-note{font-size:11.5px;color:var(--color-text-muted)}
.pick-note.warn{color:var(--color-caution)}
.llm-default{font-size:12px;color:var(--color-text-secondary);margin:-4px 0 14px;line-height:1.6}
.llm-default b{font-family:var(--font-num);color:var(--color-accent)}
.llm-default.dim{color:var(--color-text-muted)}
.llm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
.llm-head h2{margin:0}
.llm-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.llm-msg{font-size:12px;color:var(--color-text-muted);line-height:1.6}
.llm-msg.bad{color:var(--color-danger)}
.fine code{font-family:var(--font-mono);font-size:11.5px;background:var(--color-neutral-soft);padding:1px 5px;border-radius:4px}
</style>
