<template>
  <section class="rec">
    <div class="rec-head">
      <div>
        
        <p class="hint">同一项目可以留多条历史；当前 PB 只是标出来，不会覆盖旧记录。</p>
      </div>
      <button v-if="!open" class="add" type="button" @click="startNew">＋ 添加</button>
    </div>

    <!-- 新增 / 编辑表单 -->
    <div v-if="open" class="form">
      <div class="grid">
        <label class="f">
          <span>项目</span>
          <select v-model="draft.eventPreset" @change="onPreset">
            <option v-for="e in [...TRACK_EVENTS, ...FIELD_EVENTS]" :key="e" :value="e">{{ e }}</option>
            <option value="__other">其他（自定义）</option>
          </select>
        </label>
        <label v-if="draft.eventPreset === '__other'" class="f">
          <span>项目名</span>
          <input v-model="draft.event" type="text" placeholder="例如：60m 栏" />
        </label>
        <div v-if="draft.eventPreset === '__other'" class="f">
          <span>类别</span>
          <div class="seg">
            <button type="button" :class="{ on: draft.track }" @click="draft.track = true">径赛（时间）</button>
            <button type="button" :class="{ on: !draft.track }" @click="draft.track = false">田赛（距离）</button>
          </div>
        </div>
        <label class="f">
          <span>成绩{{ draft.track ? '（如 11.23 或 2:05.3）' : '（如 6.85）' }}</span>
          <input v-model="draft.result" type="text" :placeholder="draft.track ? '11.23' : '6.85'" />
        </label>
        <label class="f">
          <span>日期（可留空）</span>
          <input v-model="draft.date" type="date" />
        </label>
      </div>
      <label class="f wide">
        <span>备注（可留空）</span>
        <input v-model="draft.notes" type="text" placeholder="例如：市运会预赛" />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button class="btn primary" type="button" @click="save">{{ editingId ? '保存修改' : '加入列表' }}</button>
        <button class="btn ghost" type="button" @click="cancel">取消</button>
      </div>
    </div>

    <ul v-if="modelValue.length" class="rows">
      <li v-for="pb in modelValue" :key="pb.id" class="row">
        <span class="ev">{{ pb.event }}<i>{{ pb.track ? '径赛' : '田赛' }}</i></span>
        <b class="res">{{ pb.result }}<em>{{ pb.track ? 's' : 'm' }}</em></b>
        <span class="meta">{{ pb.date ? formatCnDate(pb.date) : '日期未填' }}<small v-if="pb.notes">{{ pb.notes }}</small></span>
        <span v-if="isCurrentBest(pb, modelValue)" class="badge">当前 PB</span>
        <span v-else class="badge dim">历史</span>
        <span class="acts">
          <button type="button" @click="startEdit(pb)">改</button>
          <button type="button" class="del" @click="remove(pb.id)">删</button>
        </span>
      </li>
    </ul>
    <p v-else-if="!open" class="empty">还没有 PB 记录。没有记录不等于没有成绩，只是这里还没填。</p>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { PersonalBest } from '@/types/domain'
import { newId } from '@/utils/id'
import { FIELD_EVENTS, TRACK_EVENTS, formatCnDate, isCurrentBest, parseResult } from '@/services/profileRules'

const props = defineProps<{ modelValue: PersonalBest[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: PersonalBest[]): void }>()

const open = ref(false)
const editingId = ref('')
const error = ref('')
const draft = reactive({
  eventPreset: TRACK_EVENTS[0],
  event: '',
  track: true,
  result: '',
  date: '',
  notes: ''
})

function reset() {
  draft.eventPreset = TRACK_EVENTS[0]
  draft.event = ''
  draft.track = true
  draft.result = ''
  draft.date = ''
  draft.notes = ''
  error.value = ''
  editingId.value = ''
}

function onPreset() {
  if (draft.eventPreset === '__other') return
  draft.track = TRACK_EVENTS.includes(draft.eventPreset)
}

function startNew() {
  reset()
  open.value = true
}

function startEdit(pb: PersonalBest) {
  open.value = true
  editingId.value = pb.id
  error.value = ''
  const preset = [...TRACK_EVENTS, ...FIELD_EVENTS].includes(pb.event) ? pb.event : '__other'
  draft.eventPreset = preset
  draft.event = preset === '__other' ? pb.event : ''
  draft.track = pb.track
  draft.result = pb.result
  draft.date = pb.date ?? ''
  draft.notes = pb.notes ?? ''
}

function cancel() {
  open.value = false
  reset()
}

function save() {
  const event = draft.eventPreset === '__other' ? draft.event.trim() : draft.eventPreset
  if (!event) {
    error.value = '请填写项目名。'
    return
  }
  if (parseResult(draft.result, draft.track) === null) {
    error.value = draft.track ? '成绩填成时间，例如 11.23 或 2:05.3。' : '成绩填成距离，例如 6.85。'
    return
  }
  const record: PersonalBest = {
    id: editingId.value || newId(),
    event,
    track: draft.track,
    result: draft.result.trim(),
    date: draft.date || undefined,
    notes: draft.notes.trim() || undefined
  }
  const next = editingId.value
    ? props.modelValue.map(p => (p.id === editingId.value ? record : p))
    : [...props.modelValue, record]
  emit('update:modelValue', next)
  open.value = false
  reset()
}

function remove(id: string) {
  emit('update:modelValue', props.modelValue.filter(p => p.id !== id))
  if (editingId.value === id) cancel()
}
</script>

<style scoped>
.rec { border-top: 1px solid var(--color-divider); padding-top: 14px; margin-top: 4px; }
.rec-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
.hint { font-size: 11.5px; color: var(--color-text-muted); margin: 5px 0 0; line-height: 1.6; }
.add {
  flex: none; font-size: 12px; font-weight: 700; color: var(--color-accent);
  background: var(--color-accent-soft); border-radius: 9px; padding: 8px 13px; min-height: 36px;
}
.form { margin-top: 12px; padding: 13px; border-radius: 12px; background: var(--color-neutral-soft); }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.f { display: flex; flex-direction: column; gap: 5px; font-size: 11.5px; color: var(--color-text-muted); }
.f.wide { margin-top: 10px; }
.f input, .f select {
  width: 100%; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 10px;
  font-size: 13px; font-family: inherit; color: var(--color-ink); background: var(--surface-field);
}
.seg { display: flex; gap: 6px; }
.seg button {
  flex: 1; font-size: 11.5px; font-weight: 600; padding: 8px 6px; border-radius: 9px; min-height: 36px;
  color: var(--color-text-secondary); background: var(--color-card); border: 1px solid var(--color-border);
}
.seg button.on { color: var(--color-on-accent); background: var(--color-accent); border-color: var(--color-accent); }
.form-actions { display: flex; gap: 8px; margin-top: 11px; }
.form-actions .btn { min-height: 40px; padding: 0 16px; border-radius: 10px; font-size: 13px; font-weight: 600; }
.form-actions .primary { background: var(--color-ink); color: #fff; }
.form-actions .ghost { border: 1px solid var(--color-border); color: var(--color-ink); }
.error { font-size: 12px; color: var(--color-danger); margin: 9px 0 0; }
.rows { list-style: none; margin: 12px 0 0; padding: 0; }
.row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.1fr) auto auto;
  align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--hair-soft, var(--color-divider));
}
.ev { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.ev i { font-style: normal; font-size: 10.5px; font-weight: 500; color: var(--color-text-muted); margin-left: 6px; }
.res { font-family: var(--font-num); font-size: 16px; letter-spacing: -0.02em; color: var(--color-ink); }
.res em { font-style: normal; font-size: 10.5px; color: var(--color-text-muted); margin-left: 2px; letter-spacing: 0; }
.meta { display: flex; flex-direction: column; font-size: 11.5px; color: var(--color-text-muted); }
.meta small { color: var(--color-text-muted); font-size: 11px; }
.badge {
  font-family: var(--font-num); font-size: 10px; letter-spacing: 0.06em; padding: 3px 7px; border-radius: 5px;
  background: var(--color-accent-soft); color: var(--color-accent-deep, var(--color-accent));
}
.badge.dim { background: transparent; color: var(--color-text-muted); box-shadow: inset 0 0 0 1px var(--color-border); }
.acts { display: flex; gap: 4px; }
.acts button { font-size: 11.5px; padding: 5px 8px; border-radius: 7px; color: var(--color-text-secondary); }
.acts .del { color: var(--color-danger); }
.empty { font-size: 12px; color: var(--color-text-muted); margin: 10px 0 0; }
@media (max-width: 520px) {
  .grid { grid-template-columns: 1fr; }
  .row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
  .meta { grid-column: 1 / -1; }
  .badge { justify-self: start; }
}
</style>
