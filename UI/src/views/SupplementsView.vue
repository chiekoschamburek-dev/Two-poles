<template>
  <div class="sup-page">
    <header class="sup-hero">
      <div class="sup-top">
        <div class="sup-id">
          <PoleMark pole="nutrition" :size="30" />
          <div>
            <span class="micro nut">右极 · NUTRITION</span>
            <h1>补剂提醒</h1>
          </div>
        </div>
        <span class="sup-chip" :class="permissionTone"><i aria-hidden="true"></i>{{ permissionLabel }}</span>
      </div>
      <span class="sup-kicker">SUPPLEMENTS · 按时提醒</span>
      <h2 class="sup-lead">鱼油、肌酸，<em>到点提醒</em></h2>
      <p class="sup-sub">添加补剂和每日提醒时间；提醒只保存在本机。</p>
    </header>

    <section class="sup-card">
      <div class="sup-card-head">
        <h2>系统通知</h2>
        <span>{{ permissionLabel }}</span>
      </div>
      <p class="sup-copy">开启后，应用切到后台时可以弹出浏览器通知；关闭浏览器后不会触发。</p>
      <div class="sup-actions">
        <button
          v-if="permission !== 'granted' && permission !== 'unsupported'"
          type="button"
          class="sup-btn dark"
          @click="enableNotifications"
        >开启浏览器通知</button>
        <button type="button" class="sup-btn ghost" @click="testNotification">发送测试提醒</button>
      </div>
      <p v-if="permission === 'denied'" class="sup-hint warn">通知权限被拒绝，请在浏览器站点设置里重新允许。</p>
      <p v-else-if="permission === 'unsupported'" class="sup-hint">当前浏览器不支持系统通知，仍会使用页面内提示。</p>
    </section>

    <section ref="formRef" class="sup-card">
      <div class="sup-card-head">
        <h2>{{ editingId ? '编辑补剂提醒' : '添加补剂提醒' }}</h2>
        <span>每日</span>
      </div>

      <label class="sup-field">
        <span class="sup-label">补剂名称</span>
        <input v-model="form.name" class="sup-input" type="text" maxlength="30" placeholder="例如 鱼油" />
      </label>
      <div class="sup-suggest" aria-label="常用补剂">
        <button
          v-for="name in suggestions"
          :key="name"
          type="button"
          class="sup-suggest-btn"
          @click="form.name = name"
        >{{ name }}</button>
      </div>

      <label class="sup-field">
        <span class="sup-label">剂量 / 备注（选填）</span>
        <input v-model="form.dosage" class="sup-input" type="text" maxlength="40" placeholder="例如 1 粒 / 5 g" />
      </label>

      <div class="sup-field">
        <span class="sup-label">提醒时间</span>
        <div class="sup-time-list">
          <span v-for="time in form.times" :key="time" class="sup-time-chip">
            {{ time }}
            <button type="button" :aria-label="`移除 ${time}`" @click="removeTime(time)"><X :size="12" /></button>
          </span>
          <span v-if="!form.times.length" class="sup-muted">还没有时间</span>
        </div>
        <div class="sup-time-add">
          <input v-model="newTime" type="time" class="sup-time-input" aria-label="新的提醒时间" />
          <button type="button" class="sup-btn ghost small" @click="addTime"><Plus :size="13" />添加时间</button>
        </div>
      </div>

      <p v-if="error" class="sup-error" role="alert">{{ error }}</p>
      <div class="sup-form-actions">
        <button type="button" class="sup-btn dark" @click="save">{{ editingId ? '保存修改' : '添加提醒' }}</button>
        <button v-if="editingId" type="button" class="sup-btn ghost" @click="resetForm">取消</button>
      </div>
    </section>

    <section class="sup-card">
      <div class="sup-card-head">
        <h2>我的补剂</h2>
        <span>{{ reminders.length }} 项</span>
      </div>

      <div v-if="reminders.length" class="sup-list">
        <article v-for="reminder in reminders" :key="reminder.id" class="sup-item" :class="{ off: !reminder.enabled }">
          <div class="sup-item-top">
            <span class="sup-item-ic"><Pill :size="15" /></span>
            <div class="sup-item-id">
              <h3>{{ reminder.name }}</h3>
              <p>{{ reminder.dosage || '每日' }}</p>
            </div>
            <button
              type="button"
              class="sup-switch"
              role="switch"
              :aria-checked="reminder.enabled"
              :aria-label="`${reminder.name}提醒${reminder.enabled ? '已开启' : '已暂停'}`"
              @click="toggleReminder(reminder.id)"
            ><i></i></button>
          </div>
          <div class="sup-item-times">
            <span v-for="time in reminder.times" :key="time">{{ time }}</span>
          </div>
          <div class="sup-item-foot">
            <span class="sup-next">{{ nextReminderLabel(reminder, new Date(nowTick)) }}</span>
            <div class="sup-item-actions">
              <button type="button" class="sup-text" @click="startEdit(reminder)">编辑</button>
              <template v-if="pendingDelete === reminder.id">
                <button type="button" class="sup-text danger" @click="confirmDelete(reminder.id)">确认删除</button>
                <button type="button" class="sup-text" @click="pendingDelete = null">取消</button>
              </template>
              <button v-else type="button" class="sup-text danger" @click="pendingDelete = reminder.id">删除</button>
            </div>
          </div>
        </article>
      </div>
      <p v-else class="sup-empty">还没有补剂提醒。可以从上面的常用补剂开始。</p>
    </section>

    <p class="sup-note">提醒只保存在本机；系统通知依赖浏览器权限。补剂使用请遵循产品说明或专业人士建议。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Pill, Plus, X } from 'lucide-vue-next'
import PoleMark from '@/components/poles/PoleMark.vue'
import { useAppStore } from '@/stores/app'
import {
  useSupplementReminders,
  type SupplementReminder
} from '@/composables/useSupplementReminders'

const suggestions = ['鱼油', '肌酸', '维生素D', '蛋白粉', '钙片']
const store = useAppStore()
const {
  reminders,
  permission,
  addReminder,
  updateReminder,
  toggleReminder,
  removeReminder,
  requestSupplementPermission,
  sendSupplementNotification,
  nextReminderLabel
} = useSupplementReminders()

const form = reactive({
  name: '',
  dosage: '',
  times: ['08:00'] as string[]
})
const editingId = ref<string | null>(null)
const newTime = ref('20:00')
const error = ref('')
const pendingDelete = ref<string | null>(null)
const formRef = ref<HTMLElement | null>(null)
const nowTick = ref(Date.now())
let clockTimer: number | undefined

onMounted(() => {
  clockTimer = window.setInterval(() => { nowTick.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
})

const permissionLabel = computed(() => {
  if (permission.value === 'granted') return '通知已开启'
  if (permission.value === 'denied') return '通知被拒绝'
  if (permission.value === 'unsupported') return '浏览器不支持'
  return '通知未开启'
})
const permissionTone = computed(() => {
  if (permission.value === 'granted') return 'ok'
  if (permission.value === 'denied') return 'warn'
  return ''
})
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function addTime() {
  const value = newTime.value.trim().slice(0, 5)
  if (!TIME_RE.test(value)) {
    error.value = '请选择一个有效的时间。'
    return
  }
  if (form.times.includes(value)) {
    error.value = '这个时间已经添加过了。'
    return
  }
  form.times = [...form.times, value].sort()
  newTime.value = ''
  error.value = ''
}

function removeTime(time: string) {
  form.times = form.times.filter(item => item !== time)
  error.value = ''
}

function resetForm() {
  editingId.value = null
  form.name = ''
  form.dosage = ''
  form.times = ['08:00']
  newTime.value = '20:00'
  error.value = ''
  pendingDelete.value = null
}

function startEdit(reminder: SupplementReminder) {
  editingId.value = reminder.id
  form.name = reminder.name
  form.dosage = reminder.dosage
  form.times = [...reminder.times]
  newTime.value = ''
  error.value = ''
  pendingDelete.value = null
  formRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function save() {
  error.value = ''
  if (!form.name.trim()) {
    error.value = '填写补剂名称。'
    return
  }
  if (!form.times.length) {
    error.value = '至少添加一个提醒时间。'
    return
  }
  const payload = { name: form.name, dosage: form.dosage, times: [...form.times] }
  const previousId = editingId.value
  const saved = previousId ? updateReminder(previousId, payload) : addReminder(payload)
  if (!saved) {
    error.value = '保存失败，请检查名称和时间。'
    return
  }
  store.showToast({
    type: 'success',
    title: previousId ? '补剂提醒已更新' : '补剂提醒已添加',
    message: `${saved.times.join(' / ')} 每日提醒${saved.dosage ? ` · ${saved.dosage}` : ''}`,
    duration: 3000
  })
  resetForm()
}

function confirmDelete(id: string) {
  removeReminder(id)
  pendingDelete.value = null
  store.showToast({ type: 'info', title: '已删除补剂提醒', duration: 2500 })
}

async function enableNotifications() {
  const result = await requestSupplementPermission()
  if (result === 'granted') {
    store.showToast({
      type: 'success',
      title: '浏览器通知已开启',
      message: '应用在后台运行时也会收到补剂提醒。',
      duration: 3500
    })
  } else if (result === 'denied') {
    store.showToast({
      type: 'warning',
      title: '通知权限被拒绝',
      message: '请在浏览器站点设置中重新允许通知。',
      duration: 4500
    })
  } else if (result === 'unsupported') {
    store.showToast({
      type: 'warning',
      title: '浏览器不支持系统通知',
      message: '提醒仍会使用页面内提示。',
      duration: 4000
    })
  }
}

async function testNotification() {
  let state = permission.value
  if (state === 'default') state = await requestSupplementPermission()
  if (state === 'unsupported') {
    store.showToast({
      type: 'warning',
      title: '浏览器不支持系统通知',
      message: '当前环境只能使用页面内提醒。',
      duration: 4000
    })
    return
  }
  if (state === 'denied') {
    store.showToast({
      type: 'warning',
      title: '通知权限被拒绝',
      message: '请在浏览器站点设置中重新允许通知。',
      duration: 4000
    })
    return
  }
  if (state !== 'granted') {
    store.showToast({
      type: 'warning',
      title: '需要先开启浏览器通知',
      message: '允许通知后才能测试后台提醒。',
      duration: 4000
    })
    return
  }
  const sent = await sendSupplementNotification(
    '补剂提醒 · 测试',
    '如果你看到这条通知，后台提醒就能正常弹出。',
    'supplement-test'
  )
  store.showToast({
    type: sent ? 'success' : 'warning',
    title: sent ? '测试通知已发送' : '未能发送系统通知',
    message: sent ? '可以切换到其他标签页确认通知。' : '请检查浏览器通知权限。',
    duration: 4000
  })
}
</script>

<style scoped>
.sup-page { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

.sup-hero { padding: 2px 2px 1px; }
.sup-top { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.sup-id { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
.sup-id :deep(svg) { width: 30px; height: 30px; flex: none; overflow: visible; }
.micro { display: block; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .14em; color: var(--color-text-muted); }
.micro.nut { color: var(--pole-nutrition-strong); }
.sup-id h1 { margin: 2px 0 0; font-size: 26px; line-height: 1.1; letter-spacing: -.03em; }
.sup-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 23px;
  padding: 0 8px;
  flex: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-card);
  font-family: var(--font-num);
  font-size: 9px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.sup-chip i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.sup-chip.ok { background: var(--pole-nutrition-soft); border-color: var(--pole-nutrition-line); color: var(--pole-nutrition-strong); }
.sup-chip.warn { background: var(--color-caution-soft); border-color: rgba(138, 90, 0, .26); color: var(--color-caution); }
.sup-kicker { display: block; margin-top: 12px; font-family: var(--font-num); font-size: 8.5px; font-weight: 600; letter-spacing: .16em; color: var(--color-text-muted); }
.sup-lead { margin: 5px 0 0; font-size: 26px; line-height: 1.16; letter-spacing: -.035em; font-weight: 600; }
.sup-lead em { font-style: normal; color: var(--pole-nutrition); letter-spacing: -.04em; }
.sup-sub { margin: 6px 0 0; font-size: 11px; line-height: 1.65; color: var(--color-text-secondary); }

.sup-card {
  padding: 13px 14px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-card);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9);
}
.sup-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--color-divider); margin-bottom: 10px; }
.sup-card-head h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.005em; }
.sup-card-head > span { font-family: var(--font-num); font-size: 8.5px; letter-spacing: .04em; color: var(--color-text-muted); white-space: nowrap; }
.sup-copy { margin: 0; font-size: 10px; line-height: 1.65; color: var(--color-text-muted); }
.sup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.sup-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 31px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-base);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.sup-btn.dark { background: var(--color-ink); color: var(--color-on-accent); }
.sup-btn.ghost { background: var(--color-card); border-color: var(--hair-strong); color: var(--color-text-secondary); }
.sup-btn.ghost:hover { color: var(--color-ink); border-color: var(--color-ink); }
.sup-btn.small { height: 29px; padding: 0 9px; font-size: 9.5px; }
.sup-hint { margin: 9px 0 0; font-size: 9.5px; line-height: 1.6; color: var(--color-text-muted); }
.sup-hint.warn { color: var(--color-caution); }

.sup-field { display: block; margin-top: 10px; }
.sup-label { display: block; margin-bottom: 6px; font-size: 9px; color: var(--color-text-muted); }
.sup-input,
.sup-time-input {
  width: 100%;
  height: 38px;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--surface-field);
  color: var(--color-ink);
  font-family: inherit;
  font-size: 12px;
}
.sup-input:focus,
.sup-time-input:focus { outline: none; border-color: var(--pole-nutrition); box-shadow: 0 0 0 3px var(--pole-nutrition-soft); }
.sup-suggest { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.sup-suggest-btn {
  height: 25px;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
}
.sup-suggest-btn:hover { border-color: var(--pole-nutrition-line); color: var(--pole-nutrition-strong); background: var(--pole-nutrition-soft); }
.sup-time-list { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-height: 26px; }
.sup-time-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 25px;
  padding: 0 8px;
  border: 1px solid var(--pole-nutrition-line);
  border-radius: 999px;
  background: var(--pole-nutrition-soft);
  color: var(--pole-nutrition-strong);
  font-family: var(--font-num);
  font-size: 10px;
  font-weight: 600;
}
.sup-time-chip button { display: grid; place-items: center; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; }
.sup-time-add { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
.sup-time-input { width: 128px; flex: none; }
.sup-muted { font-size: 9px; color: var(--color-text-muted); }
.sup-error { margin: 9px 0 0; font-size: 10px; line-height: 1.6; color: var(--color-danger); }
.sup-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }

.sup-list { display: flex; flex-direction: column; }
.sup-item { padding: 9px 0; border-bottom: 1px solid var(--hair-soft); }
.sup-item:first-child { padding-top: 1px; }
.sup-item:last-child { border-bottom: 0; padding-bottom: 2px; }
.sup-item.off { opacity: .62; }
.sup-item-top { display: flex; align-items: center; gap: 8px; }
.sup-item-ic { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: 1px solid var(--pole-nutrition-line); border-radius: var(--radius-base); background: var(--pole-nutrition-soft); color: var(--pole-nutrition-strong); }
.sup-item-id { flex: 1; min-width: 0; }
.sup-item-id h3 { margin: 0; font-size: 12px; font-weight: 600; line-height: 1.3; }
.sup-item-id p { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; color: var(--color-text-muted); }
.sup-switch { position: relative; width: 36px; height: 20px; flex: none; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-neutral-soft); cursor: pointer; }
.sup-switch i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--color-text-muted); transition: left var(--motion-fast), background var(--motion-fast); }
.sup-switch[aria-checked="true"] { border-color: var(--pole-nutrition); background: var(--pole-nutrition); }
.sup-switch[aria-checked="true"] i { left: 18px; background: var(--color-on-accent); }
.sup-item-times { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.sup-item-times span { height: 21px; display: inline-flex; align-items: center; padding: 0 7px; border: 1px solid var(--pole-nutrition-line); border-radius: 999px; background: var(--pole-nutrition-soft); font-family: var(--font-num); font-size: 9px; font-weight: 600; color: var(--pole-nutrition-strong); }
.sup-item-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
.sup-next { font-family: var(--font-num); font-size: 8.5px; color: var(--color-text-muted); }
.sup-item-actions { display: flex; align-items: center; gap: 8px; }
.sup-text { padding: 0; border: 0; background: none; color: var(--color-text-muted); font-family: inherit; font-size: 9px; cursor: pointer; }
.sup-text:hover { color: var(--color-ink); }
.sup-text.danger { color: var(--color-danger); }
.sup-empty { margin: 2px 0 0; font-size: 10px; line-height: 1.6; color: var(--color-text-muted); }
.sup-note { margin: 1px 2px 0; font-size: 9px; line-height: 1.7; color: var(--color-text-muted); }

@media (max-width: 767px) {
  .sup-page { gap: 10px; }
  .sup-id h1 { font-size: 24px; }
  .sup-lead { font-size: 24px; }
  .sup-card { padding: 12px 13px 13px; }
  .sup-time-add { flex-wrap: wrap; }
}
</style>
