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
      <p v-if="isNativeSupplements" class="sup-copy">后台提醒由手机系统发送。开启横幅通知后，使用其他 App 时也能看到提醒。</p>
      <p v-else class="sup-copy">浏览器页面停止运行后，提醒可能无法送达。安卓 App 支持系统后台提醒。</p>
      <p v-if="isNativeSupplements && (scheduleStatus.error || permission === 'granted')" class="sup-hint" role="status">
        <template v-if="scheduleStatus.error">系统提醒预约失败：{{ scheduleStatus.error }}</template>
        <template v-else-if="scheduleStatus.count">已预约 {{ scheduleStatus.count }} 条每日提醒<span v-if="nextFireLabel">，下次 {{ nextFireLabel }}</span><span v-if="scheduleStatus.exact === false">，系统可能延后送达</span>。</template>
        <template v-else>暂无已预约的每日提醒。</template>
      </p>
      <p v-if="scheduleStatus.channelImportance !== null && scheduleStatus.channelImportance > 0 && scheduleStatus.channelImportance < ANDROID_HIGH_IMPORTANCE" class="sup-hint warn">
        「补剂提醒」当前只会显示在通知栏。请在通知设置中开启横幅或悬浮通知。
      </p>
      <ul v-if="checks.length" class="sup-checks">
        <li v-for="check in checks" :key="check.key" :class="{ bad: !check.ok }">
          <i aria-hidden="true"></i>
          <strong>{{ check.label }}</strong>
          <em>{{ check.detail }}</em>
        </li>
      </ul>
      <p v-if="testCountdown !== null" class="sup-hint" role="status">
        <template v-if="testCountdown > 0">测试提醒将在 {{ testCountdown }} 秒后送达，请现在按 Home 键回到桌面。</template>
        <template v-else>测试提醒应已送达：顶部横幅才算通过；只在通知栏说明横幅被系统关掉了。</template>
      </p>
      <div class="sup-actions">
        <button
          v-if="permission !== 'granted' && permission !== 'unsupported'"
          type="button"
          class="sup-btn dark"
          @click="enableNotifications"
        >{{ isNativeSupplements ? '开启系统通知' : '开启浏览器通知' }}</button>
        <button type="button" class="sup-btn ghost" @click="testNotification">{{ isNativeSupplements ? '测试后台提醒' : '发送测试提醒' }}</button>
        <button v-if="isAndroidSupplements && scheduleStatus.exact === false" type="button" class="sup-btn ghost" @click="enableExactAlarms">开启准时提醒</button>
        <button v-if="isAndroidSupplements" type="button" class="sup-btn ghost" @click="openNotificationSettings">通知设置</button>
        <button v-if="isAndroidSupplements && diagnostics && !diagnostics.batteryUnrestricted" type="button" class="sup-btn ghost" @click="allowBattery">允许后台运行</button>
        <button v-if="isNativeSupplements && permission === 'granted'" type="button" class="sup-btn ghost" @click="syncNativeSchedule(true)">重建系统提醒</button>
      </div>
      <p v-if="permission === 'denied'" class="sup-hint warn">{{ permissionSettingsHint }}</p>
      <p v-else-if="permission === 'unsupported'" class="sup-hint">当前浏览器不支持系统通知，仍会使用页面内提示。</p>
    </section>

    <section class="sup-card">
      <div class="sup-card-head">
        <h2>我的补剂</h2>
        <div class="sup-head-right">
          <span class="sup-count">{{ reminders.length }} 项</span>
          <button type="button" class="sup-btn dark small" @click="openAdd"><Plus :size="13" />添加提醒</button>
        </div>
      </div>

      <div v-if="reminders.length" class="sup-list">
        <article v-for="reminder in reminders" :key="reminder.id" class="sup-item" :class="{ off: !reminder.enabled, focus: focusedId === reminder.id }" :data-reminder-id="reminder.id">
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
      <p v-else class="sup-empty">还没有补剂提醒。点右上角「添加提醒」开始。</p>
    </section>

    <Teleport to="body">
      <div v-if="formOpen" class="sup-scrim" @click.self="closeForm">
        <div class="sup-dlg" role="dialog" aria-modal="true" aria-labelledby="sup-form-title">
          <header class="sup-dlg-head">
            <div>
              <span class="micro nut">SUPPLEMENTS · 每日</span>
              <h2 id="sup-form-title">{{ editingId ? '编辑补剂提醒' : '添加补剂提醒' }}</h2>
            </div>
            <button class="sup-dlg-x" type="button" aria-label="关闭" @click="closeForm">✕</button>
          </header>
          <div class="sup-dlg-body">
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
              <div class="sup-suggest" aria-label="常用时间">
                <button
                  v-for="preset in timePresets"
                  :key="preset.time"
                  type="button"
                  class="sup-suggest-btn"
                  :class="{ active: form.times.includes(preset.time) }"
                  :aria-pressed="form.times.includes(preset.time)"
                  @click="togglePreset(preset.time)"
                >{{ preset.label }} {{ preset.time }}</button>
              </div>
              <div class="sup-time-add">
                <input v-model="newTime" type="time" class="sup-time-input" aria-label="自定义提醒时间" />
                <button type="button" class="sup-btn ghost small" @click="addTime"><Plus :size="13" />自定义添加</button>
              </div>
            </div>
            <p v-if="error" class="sup-error" role="alert">{{ error }}</p>
            <div class="sup-form-actions">
              <button type="button" class="sup-btn dark" @click="save">{{ editingId ? '保存修改' : '添加提醒' }}</button>
              <button type="button" class="sup-btn ghost" @click="closeForm">取消</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <p class="sup-note">提醒只保存在本机。补剂使用请遵循产品说明或专业人士建议。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Pill, Plus, X } from 'lucide-vue-next'
import PoleMark from '@/components/poles/PoleMark.vue'
import { useAppStore } from '@/stores/app'
import { lockBodyScroll, unlockBodyScroll } from '@/services/scrollLock'
import {
  ANDROID_HIGH_IMPORTANCE,
  useSupplementReminders,
  isAndroidSupplements,
  isNativeSupplements,
  type SupplementReminder
} from '@/composables/useSupplementReminders'

const suggestions = ['鱼油', '肌酸', '维生素D', '蛋白粉', '钙片']
// 常用服药/补剂时间点：一键选中或取消，避免在手机上跟系统的双转盘时间选择器较劲；
// 精确时间仍可用下方自定义输入（原生 time 控件）
const timePresets = [
  { label: '晨起', time: '07:00' },
  { label: '早餐后', time: '08:00' },
  { label: '午餐后', time: '12:30' },
  { label: '晚餐后', time: '18:30' },
  { label: '睡前', time: '22:00' }
]
const store = useAppStore()
const route = useRoute()
const {
  reminders,
  permission,
  scheduleStatus,
  diagnostics,
  refreshNotificationDiagnostics,
  requestBatteryExemption,
  syncNativeSchedule,
  enableExactSupplementReminders,
  openSupplementNotificationSettings,
  addReminder,
  updateReminder,
  toggleReminder,
  removeReminder,
  requestSupplementPermission,
  scheduleSupplementTest,
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
const formOpen = ref(false)
let formScrollLock: symbol | null = null
const nowTick = ref(Date.now())
/** 测试提醒的计划送达时刻，用于在页面上倒计时，用户不必猜「约 30 秒」到底是多久 */
const pendingTestAt = ref<number | null>(null)
/** 从通知点进来时要高亮的那条提醒；非空期间加一圈提示框 */
const focusedId = ref<string | null>(null)
let clockTimer: number | undefined
let focusTimer: number | undefined

onMounted(() => {
  clockTimer = window.setInterval(() => { nowTick.value = Date.now() }, 1_000)
  void refreshNotificationDiagnostics()
  const target = typeof route.query.focus === 'string' ? route.query.focus : ''
  if (target) {
    focusedId.value = target
    window.setTimeout(() => {
      document.querySelector(`[data-reminder-id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
    focusTimer = window.setTimeout(() => { focusedId.value = null }, 5_000)
  }
})
onBeforeUnmount(() => {
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
  if (focusTimer !== undefined) window.clearTimeout(focusTimer)
})

const testCountdown = computed(() => {
  const at = pendingTestAt.value
  if (at === null) return null
  const rest = Math.ceil((at - nowTick.value) / 1000)
  return rest > 0 ? rest : 0
})

/** 系统里下一次会响的时刻：用户不必猜「到底排上了没有」 */
const nextReminderAt = computed(() => {
  if (!isNativeSupplements || permission.value !== 'granted') return null
  const now = nowTick.value
  let best: number | null = null
  for (const reminder of reminders.value) {
    if (!reminder.enabled) continue
    for (const time of reminder.times) {
      const [hours, minutes] = time.split(':').map(Number)
      const due = new Date()
      due.setHours(hours, minutes, 0, 0)
      if (due.getTime() <= now) due.setDate(due.getDate() + 1)
      if (best === null || due.getTime() < best) best = due.getTime()
    }
  }
  return best
})

const nextFireLabel = computed(() => {
  const at = nextReminderAt.value
  if (at === null) return null
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  const sameDay = date.toDateString() === new Date().toDateString()
  return `${sameDay ? '今天' : '明天'} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

/** 自检逐项：任一环不满足都不会有横幅，所以分开报告，不合成一个「正常」 */
const checks = computed(() => {
  if (!isNativeSupplements || !diagnostics.value) return []
  const state = diagnostics.value
  const list: { key: string; label: string; detail: string; ok: boolean }[] = []
  list.push({
    key: 'permission',
    label: '通知权限',
    detail: state.notificationsEnabled ? '已允许' : '被系统关闭',
    ok: state.notificationsEnabled
  })
  if (state.importance >= ANDROID_HIGH_IMPORTANCE) {
    list.push({ key: 'channel', label: '横幅通知', detail: '已开启', ok: true })
  } else if (state.importance === 0) {
    list.push({ key: 'channel', label: '横幅通知', detail: '「补剂提醒」类别被关闭', ok: false })
  } else if (state.importance < 0) {
    list.push({ key: 'channel', label: '横幅通知', detail: '类别尚未创建', ok: false })
  } else {
    list.push({ key: 'channel', label: '横幅通知', detail: '只显示在通知栏', ok: false })
  }
  if (state.batteryUnrestricted) {
    list.push({ key: 'battery', label: '后台不受限', detail: '已在电池白名单', ok: true })
  } else {
    list.push({ key: 'battery', label: '后台不受限', detail: '系统可能冻结闹钟', ok: false })
  }
  return list
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
const permissionSettingsHint = isNativeSupplements
  ? '请在手机设置中允许「两仪」发送通知。'
  : '请在浏览器站点设置里重新允许通知。'
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

function togglePreset(time: string) {
  error.value = ''
  if (form.times.includes(time)) {
    form.times = form.times.filter(item => item !== time)
  } else {
    form.times = [...form.times, time].sort()
  }
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

function openForm() {
  formOpen.value = true
  formScrollLock = lockBodyScroll()
}

function openAdd() {
  resetForm()
  openForm()
}

function closeForm() {
  formOpen.value = false
  unlockBodyScroll(formScrollLock)
  formScrollLock = null
  resetForm()
}

// 弹窗关闭（X / 取消 / 蒙层）以外的意外卸载也要释放滚动锁
watch(formOpen, (open) => {
  if (!open && formScrollLock) {
    unlockBodyScroll(formScrollLock)
    formScrollLock = null
  }
})

function startEdit(reminder: SupplementReminder) {
  editingId.value = reminder.id
  form.name = reminder.name
  form.dosage = reminder.dosage
  form.times = [...reminder.times]
  newTime.value = ''
  error.value = ''
  pendingDelete.value = null
  openForm()
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
  closeForm()
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
      title: '通知已开启',
      duration: 3500
    })
  } else if (result === 'denied') {
    store.showToast({
      type: 'warning',
      title: '通知权限被拒绝',
      message: permissionSettingsHint,
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

async function enableExactAlarms() {
  try {
    await enableExactSupplementReminders()
  } catch {
    store.showToast({
      type: 'warning',
      title: '未能打开准时提醒设置',
      message: '请在手机设置的「闹钟和提醒」中允许「两仪」。'
    })
  }
}

async function openNotificationSettings() {
  try {
    await openSupplementNotificationSettings()
  } catch {
    store.showToast({
      type: 'warning',
      title: '请在手机设置中打开「两仪」的通知',
      message: '选择「补剂提醒」，允许横幅或悬浮通知。'
    })
  }
}

async function allowBattery() {
  try {
    await requestBatteryExemption()
    store.showToast({
      type: 'info',
      title: '把「两仪」加入电池白名单',
      message: '在打开的页面里选择「不限制」或「允许后台运行」，国产 ROM 冻结闹钟时靠这一步。',
      duration: 6000
    })
  } catch {
    store.showToast({
      type: 'warning',
      title: '未能打开电池优化设置',
      message: '请到手机设置的「应用 → 两仪 → 电池」里选择不限制。'
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
      message: permissionSettingsHint,
      duration: 4000
    })
    return
  }
  if (state !== 'granted') {
    store.showToast({
      type: 'warning',
      title: '需要先开启通知',
      message: '允许通知后才能测试后台提醒。',
      duration: 4000
    })
    return
  }
  const title = '补剂通知测试'
  const message = '看到这条，说明后台提醒正常。'
  if (isNativeSupplements) {
    try {
      const at = await scheduleSupplementTest(title, message)
      pendingTestAt.value = at
      store.showToast({
        type: 'success',
        title: '测试提醒已预约',
        message: '按下 Home 键回到桌面或锁屏，约 12 秒后应出现顶部横幅；只出现在通知栏说明横幅被系统关掉了。',
        duration: 6000
      })
    } catch (error) {
      store.showToast({
        type: 'warning',
        title: '未能预约测试提醒',
        message: error instanceof Error ? error.message : String(error),
        duration: 6000
      })
    }
    void refreshNotificationDiagnostics()
    return
  }

  const sent = await sendSupplementNotification(title, message, 'supplement-test')
  store.showToast({
    type: sent ? 'success' : 'warning',
    title: sent ? '测试通知已发送' : '未能发送系统通知',
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
/* 通知自检：逐环列出，缺席的环用文字说明而不是只靠颜色 */
.sup-checks { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 5px; }
.sup-checks li { display: flex; align-items: baseline; gap: 7px; font-size: 9.5px; line-height: 1.6; color: var(--color-text-secondary); }
.sup-checks li i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--pole-movement); transform: translateY(-1px); }
.sup-checks li.bad i { background: transparent; box-shadow: inset 0 0 0 1.5px var(--color-caution); }
.sup-checks li strong { flex: none; font-weight: 600; color: var(--color-ink); }
.sup-checks li em { font-style: normal; color: var(--color-text-muted); }
.sup-checks li.bad em { color: var(--color-caution); }

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
.sup-suggest-btn.active,
.sup-suggest-btn.active:hover {
  border-color: var(--pole-nutrition);
  background: var(--pole-nutrition-soft);
  color: var(--pole-nutrition-strong);
  font-weight: 600;
}
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
.sup-head-right { display: flex; align-items: center; gap: 9px; }
.sup-count { font-size: 10.5px; color: var(--color-text-muted); }
.sup-scrim {
  position: fixed; inset: 0; z-index: var(--z-modal-backdrop);
  background: rgba(17, 22, 26, .46); backdrop-filter: blur(3px);
  display: grid; place-items: center; padding: 16px;
}
.sup-dlg {
  width: min(560px, 100%);
  max-height: min(88vh, 940px);
  display: flex; flex-direction: column;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: 0 30px 80px -40px rgba(11, 16, 20, .65);
  overflow: hidden;
}
.sup-dlg-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 16px 18px 12px; border-bottom: 1px solid var(--color-divider);
}
.sup-dlg-head h2 { font-size: 17px; margin: 5px 0 0; letter-spacing: -.01em; }
.sup-dlg-x {
  width: 30px; height: 30px; border-radius: 9px; flex: none;
  color: var(--color-text-muted); font-size: 13px;
}
.sup-dlg-x:hover { background: var(--color-neutral-soft); color: var(--color-ink); }
.sup-dlg-body {
  overflow-y: auto; padding: 14px 18px 18px; flex: 1; min-height: 0;
  display: grid; gap: 12px; align-content: start;
}
.sup-muted { font-size: 9px; color: var(--color-text-muted); }
.sup-error { margin: 9px 0 0; font-size: 10px; line-height: 1.6; color: var(--color-danger); }
.sup-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }

.sup-list { display: flex; flex-direction: column; }
.sup-item { padding: 9px 0; border-bottom: 1px solid var(--hair-soft); }
.sup-item:first-child { padding-top: 1px; }
.sup-item:last-child { border-bottom: 0; padding-bottom: 2px; }
.sup-item.off { opacity: .62; }
/* 从通知点进来时，圈出对应的那一条，几秒后自动褪去 */
.sup-item.focus { background: var(--pole-nutrition-soft); box-shadow: inset 3px 0 0 var(--pole-nutrition); padding-left: 9px; border-radius: var(--radius-sm); }
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
