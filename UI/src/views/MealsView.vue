<template>
  <div class="page-wrap">
    <div class="page-head animate-slide-in-up">
      <div>
        <span class="eyebrow">MEAL LOG · {{ dateLabel }}</span>
        <h1>今天吃了什么，记个大概就好</h1>
        <p>只做结构记录（出现过哪些类别），不估算热量，也不评价吃得多不多。</p>
      </div>
      <StatusBadge :variant="summary.recorded === summary.planned ? 'success' : summary.recorded ? 'warning' : 'neutral'">
        {{ summary.recorded }} / {{ summary.planned }} 餐已记录
      </StatusBadge>
    </div>

    <div class="strip animate-slide-in-up" style="animation-delay:80ms" aria-live="polite">
      <div class="strip-item"><span>类别覆盖</span><b>{{ summary.coverage.length }} / 8</b></div>
      <div class="strip-item"><span>完整记录</span><b>{{ summary.completeCount }} 餐</b></div>
      <div class="strip-item"><span>部分记录</span><b>{{ summary.partialCount }} 餐</b></div>
      <div class="strip-item"><span>加餐</span><b>{{ summary.snackCount }} 次</b></div>
      <div class="strip-bar"><i :style="{ width: (summary.coverage.length / 8) * 100 + '%' }"></i></div>
    </div>

    <div class="slots">
      <BaseCard v-for="(slot, i) in summary.slots" :key="slot.id" class="slot animate-slide-in-up" :style="{ animationDelay: 140 + i * 70 + 'ms' }">
        <div class="slot-head">
          <h3>{{ slot.label }}</h3>
          <StatusBadge v-if="slot.meal" :variant="slot.meal.completeness === 'complete' ? 'success' : 'warning'">
            {{ slot.meal.completeness === 'complete' ? '完整记录' : '部分记录' }}
          </StatusBadge>
          <StatusBadge v-else variant="neutral">未记录</StatusBadge>
        </div>

        <template v-if="slot.meal">
          <p class="meal-time">{{ slot.meal.time }} · {{ slot.meal.items.length }} 项</p>
          <ul class="items">
            <li v-for="item in slot.meal.items" :key="item.id">
              <span class="iname">{{ item.foodName }}</span>
              <span class="icat">{{ item.category }}</span>
              <span class="ipart">{{ item.portionSize ? item.portionSize + (item.portionUnit || '') : '份量未填' }}</span>
            </li>
          </ul>
          <div class="analysis" v-if="slot.meal.analysis">
            <p><strong>本餐出现过的类别</strong><span class="cats">{{ slot.meal.analysis.categoryCoverage.join('、') || '仅"其他/油脂"，未落入 8 类' }}</span></p>
            <p v-if="slot.meal.analysis.unknownItems.length"><strong>类别待确认</strong><span>{{ slot.meal.analysis.unknownItems.join('、') }}</span></p>
            <p v-if="slot.meal.analysis.missingCategories.length"><strong>记完这餐后今天仍缺</strong><span>{{ slot.meal.analysis.missingCategories.join('、') }}</span></p>
            <p v-if="slot.meal.completeness === 'partial'" class="warn">份量没填全，所以这条记为"部分记录"，不会被当成完整一餐。</p>
          </div>
          <div class="slot-actions">
            <BaseButton variant="ghost" size="sm" @click="startEdit(slot.meal)">补记 / 修改</BaseButton>
            <BaseButton variant="secondary" size="sm" :icon="Trash2" @click="remove(slot.meal.id)">删除</BaseButton>
          </div>
        </template>

        <div v-else class="empty">
          <p>{{ slot.label === '晚餐' ? '晚餐还没记。没记只表示"未记录"，不代表没吃。' : `还没记录${slot.label}。` }}</p>
          <BaseButton size="sm" :icon="Plus" @click="startAdd(slot.id)">记录{{ slot.label }}</BaseButton>
        </div>
      </BaseCard>
    </div>

    <BaseCard class="snacks animate-slide-in-up" style="animation-delay:360ms">
      <div class="slot-head">
        <h3>加餐</h3>
        <BaseButton variant="ghost" size="sm" :icon="Plus" @click="startAdd('snack')">添加加餐</BaseButton>
      </div>
      <ul v-if="snacks.length" class="items">
        <li v-for="meal in snacks" :key="meal.id">
          <span class="iname">{{ meal.time }}</span>
          <span class="icat">{{ meal.items.map(i => i.foodName).join('、') }}</span>
          <button class="mini-del" :aria-label="`删除 ${meal.time} 的加餐`" @click="remove(meal.id)"><Trash2 :size="15" /></button>
        </li>
      </ul>
      <p v-else class="muted">今天没有记录加餐。不记录也是合法状态。</p>
    </BaseCard>

    <BaseCard v-if="editing" class="form animate-scale-in">
      <h3>{{ editing === 'new' ? '记录一餐' : '补记 / 修改' }}</h3>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">餐次</span>
          <select v-model="form.mealType">
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
            <option value="snack">加餐</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">时间</span>
          <input v-model="form.time" type="time" />
        </label>
      </div>

      <div class="rows">
        <div v-for="(row, i) in form.items" :key="i" class="row">
          <input v-model="row.foodName" type="text" class="r-name" placeholder="吃了什么，例如：燕麦粥" :aria-label="`第 ${i + 1} 项食物名称`" />
          <select v-model="row.category" class="r-cat" :aria-label="`第 ${i + 1} 项类别`">
            <option v-for="c in FOOD_CATEGORIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <input v-model.number="row.portionSize" type="number" min="0" step="1" class="r-size" placeholder="份量" :aria-label="`第 ${i + 1} 项份量`" />
          <select v-model="row.portionUnit" class="r-unit" :aria-label="`第 ${i + 1} 项单位`">
            <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
          </select>
          <button class="mini-del" aria-label="删除这一项" :disabled="form.items.length === 1" @click="removeRow(i)"><X :size="15" /></button>
        </div>
        <BaseButton variant="ghost" size="sm" :icon="Plus" @click="addRow">再加一项</BaseButton>
      </div>

      <p class="tip">份量可以留空——留空会记为"部分记录"，我们不会替你猜克数。</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="form-actions">
        <BaseButton variant="ghost" @click="cancel">取消</BaseButton>
        <BaseButton :icon="Check" @click="save">保存这一餐</BaseButton>
      </div>
    </BaseCard>

    <BaseCard class="rules animate-slide-in-up" style="animation-delay:420ms">
      <div class="why">
        <div class="why-icon"><Sparkles :size="20" /></div>
        <div>
          <span class="eyebrow">HOW THIS WORKS</span>
          <h3>这些结论是怎么来的</h3>
          <ul class="lims">
            <li v-for="l in LIMITATIONS" :key="l">{{ l }}</li>
          </ul>
          <p class="ver">规则版本 {{ RULE_VERSION }} · 是否含营养估算：否 · 数据仅存本机浏览器</p>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Plus, X, Check, Trash2, Sparkles } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import BaseButton from '@/components/common/BaseButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAppStore } from '@/stores/app'
import type { Meal } from '@/types/domain'
import { FOOD_CATEGORIES, LIMITATIONS, MEAL_SLOTS, RULE_VERSION, summarizeDay } from '@/services/mealRules'
import { shortDate, toISODate } from '@/utils/time'

const store = useAppStore()
const UNITS = ['碗', '盘', '份', '个', '杯', '片', '克', '把']

const now = new Date()
const date = toISODate(now)
const dateLabel = shortDate(now)
const summary = computed(() => summarizeDay(store.meals, date))
const snacks = computed(() => store.meals.filter(m => m.date === date && m.mealType === 'snack'))

interface Row {
  foodName: string
  category: (typeof FOOD_CATEGORIES)[number]
  portionSize: number | ''
  portionUnit: string
}

const editing = ref<Meal | 'new' | null>(null)
const error = ref('')
const form = ref<{ mealType: Meal['mealType']; time: string; items: Row[] }>({
  mealType: 'breakfast',
  time: '08:00',
  items: [{ foodName: '', category: '谷薯类', portionSize: '', portionUnit: '碗' }]
})

function defaultTime(type: Meal['mealType']) {
  const slot = MEAL_SLOTS.find(s => s.id === type)
  if (slot) return slot.defaultTime
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function blankRow(): Row {
  return { foodName: '', category: '谷薯类', portionSize: '', portionUnit: '碗' }
}

function startAdd(type: Meal['mealType']) {
  error.value = ''
  editing.value = 'new'
  form.value = { mealType: type, time: defaultTime(type), items: [blankRow()] }
}

function startEdit(meal: Meal) {
  error.value = ''
  editing.value = meal
  form.value = {
    mealType: meal.mealType,
    time: meal.time,
    items: meal.items.map(i => ({
      foodName: i.foodName,
      category: i.category,
      portionSize: i.portionSize ?? '',
      portionUnit: i.portionUnit ?? '碗'
    }))
  }
}

function addRow() {
  form.value.items.push(blankRow())
}

function removeRow(index: number) {
  if (form.value.items.length > 1) form.value.items.splice(index, 1)
}

function cancel() {
  editing.value = null
  error.value = ''
}

function save() {
  const items = form.value.items
    .map(i => ({
      foodName: i.foodName.trim(),
      category: i.category,
      portionSize: i.portionSize === '' ? undefined : Number(i.portionSize),
      portionUnit: i.portionUnit || undefined
    }))
    .filter(i => i.foodName)

  if (!items.length) {
    error.value = '至少填一项食物名称，不然结构规则没有输入可判断。'
    return
  }
  if (!/^\d{2}:\d{2}$/.test(form.value.time)) {
    error.value = '时间格式应为 HH:MM。'
    return
  }

  const replaced = editing.value && editing.value !== 'new' ? editing.value.id : null
  if (replaced) store.meals = store.meals.filter(m => m.id !== replaced)
  store.addMeal({ date, mealType: form.value.mealType, time: form.value.time, items })
  editing.value = null
  error.value = ''
}

function remove(mealId: string) {
  if (editing.value && editing.value !== 'new' && editing.value.id === mealId) cancel()
  store.removeMeal(mealId)
}
</script>

<style scoped>
.page-wrap{max-width:var(--content-max-width);margin:auto}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}
.eyebrow{font-size:11px;letter-spacing:.12em;color:var(--color-teal);font-weight:700}
.page-head h1{font-size:28px;margin:7px 0 8px}
.page-head p{color:var(--color-text-secondary);font-size:13px;margin:0;max-width:620px;line-height:1.7}
.strip{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:16px 20px;margin-bottom:20px;border-radius:18px;background:linear-gradient(135deg,#eefaf7,#f1f6fc);border:1px solid #d6ecea;position:relative;overflow:hidden}
.strip-item{display:flex;flex-direction:column;gap:3px}
.strip-item span{font-size:11px;color:var(--color-text-muted)}
.strip-item b{font-size:18px;color:var(--color-navy)}
.strip-bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:#dfe8ee}
.strip-bar i{display:block;height:100%;background:var(--gradient-teal);transition:width var(--motion-slower) var(--easing-ease-out)}
.slots{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.slot{padding:20px;display:flex;flex-direction:column}
.slot-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.slot-head h3{font-size:17px}
.meal-time{font-size:12px;color:var(--color-text-muted);margin:0 0 10px}
.items{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:8px}
.items li{display:flex;align-items:center;gap:8px;font-size:13px;padding:8px 10px;border-radius:10px;background:#f5f8fa}
.iname{flex:1;color:var(--color-navy);font-weight:600;min-width:0;overflow-wrap:anywhere}
.icat{font-size:11px;color:var(--color-teal);background:#e6f5f2;padding:3px 8px;border-radius:999px;white-space:nowrap}
.ipart{font-size:11px;color:var(--color-text-muted);white-space:nowrap}
.analysis{border-top:1px solid var(--color-divider);padding-top:10px;margin-bottom:12px;display:grid;gap:6px}
.analysis p{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--color-text-secondary);margin:0}
.analysis strong{color:var(--color-navy);flex:none}
.analysis .warn{color:#8d6d26}
.slot-actions{display:flex;gap:8px;margin-top:auto}
.slot-actions :deep(button){width:auto;flex:1;padding:0 12px;font-size:13px}
.empty{margin-top:auto}
.empty p{font-size:13px;color:var(--color-text-secondary);line-height:1.7;margin:6px 0 12px}
.snacks{margin-top:16px}
.muted{font-size:13px;color:var(--color-text-muted)}
.mini-del{color:var(--color-text-muted);display:grid;place-items:center;padding:4px;border-radius:8px;transition:all var(--motion-fast);flex:none}
.mini-del:hover:not(:disabled){background:#fdeaea;color:var(--color-danger)}
.mini-del:disabled{opacity:.4;cursor:not-allowed}
.form{margin-top:16px;padding:22px}
.form h3{font-size:17px;margin-bottom:14px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.field{display:block}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:6px}
.field input,.field select,.row input,.row select{padding:10px 12px;border:1px solid var(--color-border);border-radius:11px;font-size:13px;font-family:inherit;color:var(--color-navy);background:#fff}
.rows{display:grid;gap:8px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center}
.r-name{flex:1;min-width:0}
.r-cat{width:104px;flex:none}
.r-size{width:72px;flex:none}
.r-unit{width:74px;flex:none}
.tip{font-size:12px;color:var(--color-text-muted);margin:0 0 10px;line-height:1.6}
.error{font-size:13px;color:var(--color-danger);background:#fdeaea;border-radius:11px;padding:10px 13px;margin:0 0 12px}
.form-actions{display:flex;gap:10px;justify-content:flex-end}
.form-actions :deep(button){width:auto;padding:0 22px}
.rules{margin-top:16px}
.why{display:flex;gap:16px;align-items:flex-start}
.why-icon{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:13px;color:white;background:var(--gradient-highlight)}
.why h3{font-size:16px;margin:5px 0 8px}
.lims{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.lims li{position:relative;padding-left:16px;font-size:12px;color:var(--color-text-secondary);line-height:1.7}
.lims li::before{content:'·';position:absolute;left:2px;top:-1px;color:var(--color-teal);font-weight:700;font-size:16px}
.ver{font-size:11px;color:var(--color-text-muted);margin:10px 0 0}
@media(max-width:1024px){.slots{grid-template-columns:1fr 1fr}}
@media(max-width:767px){.slots{grid-template-columns:1fr}.page-head{align-items:flex-start}.row{flex-wrap:wrap}.r-cat,.r-size,.r-unit{width:auto;flex:1}.r-name{flex:1 1 100%}.form-actions,.slot-actions{flex-direction:column}.form-actions :deep(button),.slot-actions :deep(button){width:100%}}
</style>
