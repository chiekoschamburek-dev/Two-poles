<template>
  <div class="page">
    <template v-if="record">
      <header class="detail-bar">
        <div class="bar-copy">
          <RouterLink to="/analysis" class="back">← 返回分析</RouterLink>
          <h1>{{ record.exerciseName }} · {{ viewLabel(record.view) }}视角</h1>
          <p>{{ record.date }} · 规则版本 {{ record.ruleVersion }}</p>
        </div>
        <StatusBadge :variant="record.status === 'low-confidence' ? 'warning' : 'success'">
          {{ record.status === 'low-confidence' ? '低置信度结果' : '分析完成' }}
        </StatusBadge>
      </header>

      <BaseCard v-if="record.status === 'low-confidence'" class="panel warn-panel">
        <strong>低置信度结果</strong>
        <ul class="warn-list">
          <li v-for="reason in record.lowConfidenceReasons" :key="reason">{{ reason }}</li>
        </ul>
      </BaseCard>

      <BaseCard class="panel">
        <h2>关注项</h2>
        <p v-if="!record.findings.length" class="muted">本次没有命中关注项。下面是对这次动作的客观测量。</p>
        <article v-for="finding in record.findings" :key="finding.id ?? finding.ruleId" class="finding">
          <header>
            <strong>{{ finding.title }}</strong>
            <span>{{ formatTime(finding.timeMs) }}</span>
          </header>
          <p>{{ finding.detail }}</p>
          <img
            v-if="finding.keyframeRef && keyframeUrls[finding.keyframeRef]"
            class="keyframe"
            :src="keyframeUrls[finding.keyframeRef]"
            alt="问题时刻的关键帧截图"
            loading="lazy"
          />
          <p v-else-if="finding.keyframeRef" class="muted small">关键帧截图仅保存在拍摄设备。</p>
          <dl>
            <div><dt>实测</dt><dd>{{ formatMeasured(finding) }}</dd></div>
            <div><dt>阈值</dt><dd>{{ finding.thresholdLabel }}</dd></div>
            <div><dt>出处</dt><dd>{{ finding.sourceLabel }}</dd></div>
          </dl>
        </article>
      </BaseCard>

      <BaseCard class="panel">
        <h2>测量值</h2>
        <dl class="metrics">
          <div v-for="metric in record.metrics" :key="metric.id">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}<small v-if="metric.unit"> {{ metric.unit }}</small></dd>
          </div>
        </dl>
      </BaseCard>

      <BaseCard class="panel">
        <h2>关联训练记录</h2>
        <template v-if="linkedSession">
          <p class="muted">{{ linkedSession.date }} · {{ linkedSession.exerciseName }}</p>
          <div class="actions">
            <BaseButton variant="ghost" size="sm" @click="unlink">取消关联</BaseButton>
          </div>
        </template>
        <template v-else>
          <p v-if="record.sessionId" class="muted">关联的训练记录已不存在，可以重新选择。</p>
          <div class="link-row">
            <label>
              <span>日期</span>
              <input v-model="linkDate" type="date" />
            </label>
            <label class="grow">
              <span>训练记录</span>
              <select v-model="selectedSessionId">
                <option value="">不关联</option>
                <option v-for="session in sessionsForDate" :key="session.id" :value="session.id">
                  {{ session.exerciseName }}{{ session.rpe !== null ? ` · RPE ${session.rpe}` : '' }}
                </option>
              </select>
            </label>
            <BaseButton size="sm" variant="secondary" @click="saveLink">保存关联</BaseButton>
          </div>
          <p v-if="!sessionsForDate.length" class="muted small">这一天没有训练记录，可换一个日期。</p>
        </template>
      </BaseCard>

      <p class="disclaimer">{{ disclaimer }}</p>
      <div class="actions">
        <BaseButton variant="danger" @click="remove">删除这条记录</BaseButton>
      </div>
    </template>

    <BaseCard v-else class="panel">
      <h2>分析记录不存在</h2>
      <p class="muted">这条记录可能已被删除，或只在其他设备上保存。</p>
      <div class="actions">
        <BaseButton variant="secondary" @click="router.push('/analysis')">返回分析</BaseButton>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseCard from '@/components/common/BaseCard.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import { getAnalysisKeyframe } from '@/services/analysisKeyframes'
import type { AnalysisView, MotionAnalysisFinding } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const record = computed(() => store.analyses.find(item => item.id === route.params.id) ?? null)
const keyframeUrls = ref<Record<string, string>>({})
const linkDate = ref('')
const selectedSessionId = ref('')
const sessionsForDate = computed(() => store.sessions.filter(session => session.date === linkDate.value))
const linkedSession = computed(() => {
  const id = record.value?.sessionId
  if (!id) return null
  return store.sessions.find(session => session.id === id || session.clientId === id || session.serverId === id) ?? null
})
const disclaimer = '规则参考各关注项所列文献，阈值由本项目自行翻译，未经运动医学或体能专业人士审核；结果仅供复盘参考，不构成诊断或训练处方。'

function viewLabel(view: AnalysisView): string {
  return view === 'side' ? '侧面' : '正面'
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = ms / 1000
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

function formatMeasured(finding: MotionAnalysisFinding): string {
  if (finding.measured === null) return '—'
  return `${finding.measured}${finding.unit ? ` ${finding.unit}` : ''}`
}

function revokeKeyframeUrls() {
  for (const url of Object.values(keyframeUrls.value)) URL.revokeObjectURL(url)
  keyframeUrls.value = {}
}

async function loadKeyframes() {
  revokeKeyframeUrls()
  const current = record.value
  if (!current) return
  for (const finding of current.findings) {
    if (!finding.keyframeRef) continue
    try {
      const blob = await getAnalysisKeyframe(finding.keyframeRef)
      if (blob) keyframeUrls.value[finding.keyframeRef] = URL.createObjectURL(blob)
    } catch {
      // 读不到图时保留「仅保存在拍摄设备」的说明
    }
  }
}

function remove() {
  const current = record.value
  if (!current) return
  if (!window.confirm('删除后这条分析记录与关键帧截图都会从本机移除，确定删除？')) return
  store.removeAnalysis(current.id)
  router.push('/analysis')
}

function saveLink() {
  const current = record.value
  if (!current) return
  store.linkAnalysisToSession(current.id, selectedSessionId.value || undefined)
}

function unlink() {
  const current = record.value
  if (!current) return
  store.linkAnalysisToSession(current.id, undefined)
}

watch(record, (current) => {
  if (current) {
    linkDate.value = current.date
    selectedSessionId.value = current.sessionId ?? ''
  }
  void loadKeyframes()
}, { immediate: true })
onUnmounted(revokeKeyframeUrls)
</script>

<style scoped>
.page { max-width: var(--content-max-width); margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.detail-bar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 16px 0 12px; border-bottom: 1px solid var(--color-divider); }
.bar-copy { min-width: 0; }
.back { font-size: 12px; color: var(--color-text-muted); text-decoration: none; }
.back:hover { color: var(--color-accent-strong); }
.bar-copy h1 { margin: 6px 0 0; font-size: 22px; letter-spacing: -0.02em; }
.bar-copy p { margin: 5px 0 0; font-size: 12px; color: var(--color-text-muted); }
.panel { padding: 18px 20px; }
.panel h2 { margin: 0 0 12px; font-size: 16px; }
.muted { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.7; }
.small { font-size: 11.5px; }
.warn-panel { border-color: var(--color-caution); background: var(--color-caution-soft); }
.warn-list { margin: 8px 0 0; padding-left: 18px; color: var(--color-caution); font-size: 12.5px; line-height: 1.8; }
.finding { padding: 14px 0; border-top: 1px solid var(--color-divider); }
.finding:first-of-type { border-top: none; padding-top: 0; }
.finding header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.finding header strong { font-size: 14px; }
.finding header span { font-family: var(--font-num); font-size: 11px; color: var(--color-text-muted); }
.finding p { margin: 5px 0 8px; font-size: 13px; color: var(--color-text-secondary); line-height: 1.7; }
.finding dl { display: grid; gap: 4px; margin: 0; }
.finding dl div { display: grid; grid-template-columns: 48px 1fr; gap: 8px; font-size: 12px; }
.finding dt { color: var(--color-text-muted); }
.finding dd { margin: 0; color: var(--color-text-secondary); }
.keyframe { display: block; width: min(100%, 360px); margin: 8px 0 10px; border-radius: var(--radius-md); border: 1px solid var(--color-border); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0; }
.metrics div { padding: 12px 14px; border-radius: var(--radius-md); background: var(--color-neutral-soft); }
.metrics dt { font-size: 11.5px; color: var(--color-text-muted); }
.metrics dd { margin: 4px 0 0; font-family: var(--font-num); font-size: 18px; font-weight: 700; }
.metrics small { font-size: 11px; font-weight: 500; color: var(--color-text-muted); }
.disclaimer { margin: 2px 2px 0; font-size: 11.5px; line-height: 1.7; color: var(--color-text-muted); }
.link-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.link-row label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--color-text-muted); }
.link-row label.grow { flex: 1; min-width: 180px; }
.link-row input, .link-row select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-card);
  color: var(--color-ink);
  font: inherit;
  font-size: 13px;
}
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
@media (max-width: 767px) {
  .detail-bar { flex-direction: column; align-items: stretch; gap: 10px; padding: 13px 0 10px; }
  .panel { padding: 16px 14px; }
}
</style>
