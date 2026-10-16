<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">SETTINGS</span>
        <h1>设置与数据</h1>
        <p>这里的东西都只存在这台设备的浏览器里；没有账号，也没有服务器。</p>
      </div>
      <StatusBadge :variant="store.hasProfile ? 'success' : 'neutral'">{{ store.hasProfile ? '已建档' : '未建档' }}</StatusBadge>
    </div>

    <BaseCard class="section animate-slide-in-up" style="animation-delay:70ms">
      <h2>使用方式</h2>
      <p class="sub">切换会立即生效并写入本机；两种模式目前只有展示内容不同。</p>
      <div class="choices">
        <button
          v-for="m in modes"
          :key="m.id"
          class="choice"
          :class="{ active: store.currentMode === m.id }"
          :aria-pressed="store.currentMode === m.id"
          @click="store.switchMode(m.id)"
        >
          <strong>{{ m.label }}</strong><small>{{ m.desc }}</small>
        </button>
      </div>
      <div class="row-line">
        <div><strong>档案</strong><small>{{ profileLine }}</small></div>
        <RouterLink class="link" to="/onboarding">{{ store.hasProfile ? '修改档案' : '去建档' }} <ArrowRight :size="14" /></RouterLink>
      </div>
    </BaseCard>

    <BaseCard class="section animate-slide-in-up" style="animation-delay:130ms">
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

    <BaseCard class="section animate-slide-in-up" style="animation-delay:190ms">
      <h2>我的数据</h2>
      <div class="stats">
        <div class="stat"><span>训练记录</span><b>{{ store.sessions.length }}</b></div>
        <div class="stat"><span>餐食记录</span><b>{{ store.meals.length }}</b></div>
        <div class="stat"><span>缺 RPE 的训练</span><b>{{ rpeMissing }}</b></div>
        <div class="stat"><span>占用</span><b>{{ sizeKb }} KB</b></div>
      </div>
      <p class="sub">导出会把档案、训练与餐食按下面的格式写到本机下载目录，不经过任何服务器。</p>
      <div class="actions">
        <BaseButton :icon="Download" @click="exportData(store.privacy.exportFormat)">导出 {{ store.privacy.exportFormat === 'json' ? 'JSON' : 'CSV' }}</BaseButton>
        <BaseButton variant="secondary" :icon="RotateCcw" :disabled="!store.sessions.length && !store.meals.length" @click="exportData('json')">另存为 JSON</BaseButton>
      </div>
      <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
    </BaseCard>

    <BaseCard class="section danger animate-slide-in-up" style="animation-delay:250ms">
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
import type { PrivacySettings } from '@/types/domain'
import { displayName } from '@/utils/time'
import { RULE_VERSION } from '@/services/mealRules'

const store = useAppStore()
const confirming = ref(false)
const exportError = ref('')
const retention = ref(store.privacy.dataRetentionDays)

const modes: { id: 'public' | 'athlete'; label: string; desc: string }[] = [
  { id: 'public', label: '大众模式', desc: '轻量推荐、摄像头计数、简单餐次确认' },
  { id: 'athlete', label: '运动员模式', desc: '周期训练台与负荷记录（部分功能开发中）' }
]
const formats: { id: PrivacySettings['exportFormat']; label: string }[] = [
  { id: 'json', label: 'JSON（完整结构）' },
  { id: 'csv', label: 'CSV（表格软件可开）' }
]

const profileLine = computed(() => {
  const p = store.userProfile
  if (!p) return '还没有档案，可以先建档再看推荐说明。'
  const bits = [displayName(p.nickname), p.goal, p.experience].filter(Boolean)
  return bits.join(' · ')
})
const rpeMissing = computed(() => store.sessions.filter(s => s.rpe === null).length)
const hasData = computed(() => store.sessions.length + store.meals.length > 0 || store.hasProfile)
const payload = computed(() => ({
  exportedAt: new Date().toISOString(),
  profile: store.userProfile,
  mode: store.currentMode,
  privacy: store.privacy,
  sessions: store.sessions,
  meals: store.meals
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
  const head = ['类别', '日期', '时间', '名称', '类型或类别', '数量', '单位', 'RPE', '不适', '状态', '备注']
  const rows = [
    ...store.sessions.map(s => [
      '训练', s.date, s.createdAt.slice(11, 16), s.exerciseName, s.type,
      s.actualReps ?? '', s.actualSets ?? '', s.rpe ?? '未记录', s.discomfort ? '是' : '否',
      s.completionStatus, s.notes ?? ''
    ]),
    ...store.meals.flatMap(m => m.items.map(i => [
      '餐食', m.date, m.time, i.foodName, i.category,
      i.portionSize ?? '', i.portionUnit ?? '', '', '', m.completeness, ''
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
.tg i{display:block;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:var(--shadow-sm);transition:transform var(--motion-base) var(--easing-spring)}
.toggle input:checked+.tg{background:var(--color-accent)}
.toggle input:checked+.tg i{transform:translateX(18px)}
.toggle input:focus-visible+.tg{outline:2px solid var(--color-accent);outline-offset:2px}
.tlabel strong{display:block;font-size:13px;color:var(--color-ink)}
.tlabel small{display:block;font-size:12px;color:var(--color-text-muted);margin-top:3px;line-height:1.6}
.fields{display:grid;grid-template-columns:1fr 1.3fr;gap:16px;margin-top:16px}
.field{display:block}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.field input{width:100%;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;font-size:14px;font-family:inherit;color:var(--color-ink);background:#fff}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 14px;border-radius:999px;font-size:12px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast)}
.chip:hover{transform:translateY(-1px);box-shadow:var(--shadow-sm)}
.chip.active{background:var(--color-accent);color:white}
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
</style>
