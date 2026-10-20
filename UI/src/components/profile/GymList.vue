<template>
  <section class="rec">
    <div class="rec-head">
      <div>
        
        <p class="hint">区分「实测 1RM」与「训练中最高重量」，两者不互相反推，也不给建议重量。</p>
      </div>
      <button v-if="!open" class="add" type="button" @click="startNew">＋ 添加</button>
    </div>

    <div v-if="open" class="form">
      <div class="grid">
        <label class="f">
          <span>动作</span>
          <input v-model="draft.lift" type="text" list="lift-presets" placeholder="深蹲 / 硬拉 / 卧推" />
          <datalist id="lift-presets">
            <option v-for="l in LIFT_PRESETS" :key="l" :value="l" />
          </datalist>
        </label>
        <label class="f">
          <span>重量 kg</span>
          <input v-model.number="draft.weight" type="number" min="1" max="500" step="0.5" placeholder="100" />
        </label>
        <label class="f">
          <span>次数（可留空）</span>
          <input v-model.number="draft.reps" type="number" min="1" max="30" step="1" placeholder="1" />
        </label>
        <label class="f">
          <span>日期（可留空）</span>
          <input v-model="draft.date" type="date" />
        </label>
      </div>
      <div class="f wide">
        <span>这条记录是</span>
        <div class="seg">
          <button type="button" :class="{ on: draft.kind === '1rm' }" @click="draft.kind = '1rm'">实测 1RM</button>
          <button type="button" :class="{ on: draft.kind === 'working' }" @click="draft.kind = 'working'">训练中最高重量</button>
        </div>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button class="btn primary" type="button" @click="save">{{ editingId ? '保存修改' : '加入列表' }}</button>
        <button class="btn ghost" type="button" @click="cancel">取消</button>
      </div>
    </div>

    <ul v-if="modelValue.length" class="rows">
      <li v-for="r in modelValue" :key="r.id" class="row">
        <span class="ev">{{ r.lift }}<i>{{ r.kind === '1rm' ? '1RM' : '训练最高' }}</i></span>
        <b class="res">{{ r.weight }}<em>kg</em></b>
        <span class="meta">{{ r.reps ? `${r.reps} 次` : '次数未填' }}<small>{{ r.date ? formatCnDate(r.date) : '日期未填' }}</small></span>
        <span class="acts">
          <button type="button" @click="startEdit(r)">改</button>
          <button type="button" class="del" @click="remove(r.id)">删</button>
        </span>
      </li>
    </ul>
    <p v-else-if="!open" class="empty">还没有极限数据。只记录你实际举起来过的重量。</p>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { GymRecord } from '@/types/domain'
import { newId } from '@/utils/id'
import { LIFT_PRESETS, formatCnDate } from '@/services/profileRules'

const props = defineProps<{ modelValue: GymRecord[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: GymRecord[]): void }>()

const open = ref(false)
const editingId = ref('')
const error = ref('')
const draft = reactive<{ lift: string; weight: number | ''; reps: number | ''; kind: '1rm' | 'working'; date: string }>({
  lift: '',
  weight: '',
  reps: '',
  kind: 'working',
  date: ''
})

function reset() {
  draft.lift = ''
  draft.weight = ''
  draft.reps = ''
  draft.kind = 'working'
  draft.date = ''
  error.value = ''
  editingId.value = ''
}

function startNew() {
  reset()
  open.value = true
}

function startEdit(r: GymRecord) {
  open.value = true
  editingId.value = r.id
  error.value = ''
  draft.lift = r.lift
  draft.weight = r.weight
  draft.reps = r.reps ?? ''
  draft.kind = r.kind
  draft.date = r.date ?? ''
}

function cancel() {
  open.value = false
  reset()
}

function save() {
  const lift = draft.lift.trim()
  if (!lift) {
    error.value = '请填写动作名称。'
    return
  }
  const weight = Number(draft.weight)
  if (!Number.isFinite(weight) || weight <= 0) {
    error.value = '重量填一个大于 0 的数字。'
    return
  }
  const record: GymRecord = {
    id: editingId.value || newId(),
    lift,
    weight,
    reps: draft.reps === '' ? undefined : Number(draft.reps),
    kind: draft.kind,
    date: draft.date || undefined
  }
  const next = editingId.value
    ? props.modelValue.map(r => (r.id === editingId.value ? record : r))
    : [...props.modelValue, record]
  emit('update:modelValue', next)
  open.value = false
  reset()
}

function remove(id: string) {
  emit('update:modelValue', props.modelValue.filter(r => r.id !== id))
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
.f input {
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
  display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--color-divider);
}
.ev { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.ev i { font-style: normal; font-size: 10.5px; font-weight: 500; color: var(--color-text-muted); margin-left: 6px; }
.res { font-family: var(--font-num); font-size: 16px; letter-spacing: -0.02em; color: var(--color-ink); }
.res em { font-style: normal; font-size: 10.5px; color: var(--color-text-muted); margin-left: 2px; letter-spacing: 0; }
.meta { display: flex; flex-direction: column; font-size: 11.5px; color: var(--color-text-muted); }
.acts { display: flex; gap: 4px; }
.acts button { font-size: 11.5px; padding: 5px 8px; border-radius: 7px; color: var(--color-text-secondary); }
.acts .del { color: var(--color-danger); }
.empty { font-size: 12px; color: var(--color-text-muted); margin: 10px 0 0; }
@media (max-width: 520px) {
  .grid { grid-template-columns: 1fr; }
  .row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
  .meta { grid-column: 1 / -1; }
}
</style>
