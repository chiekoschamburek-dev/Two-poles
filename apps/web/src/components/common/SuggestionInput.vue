<template>
  <div class="sugg" @focusout="onFocusOut">
    <input
      ref="inputEl"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :aria-label="label"
      :aria-expanded="showMenu"
      :aria-controls="listId"
      :aria-activedescendant="active >= 0 && filtered.length ? optionId(active) : undefined"
      aria-autocomplete="list"
      role="combobox"
      type="text"
      autocomplete="off"
      @focus="openMenu"
      @click="openMenu"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ChevronDown class="chev" :size="16" aria-hidden="true" />
    <ul v-if="showMenu" :id="listId" class="menu" role="listbox">
      <li
        v-for="(option, index) in filtered"
        :id="optionId(index)"
        :key="option"
        role="option"
        :aria-selected="index === active"
        :class="{ active: index === active }"
        @mousedown.prevent="pick(option)"
        @mouseenter="active = index"
      >{{ option }}</li>
    </ul>
  </div>
</template>

<script lang="ts">
/** 模块级序号：每个输入框拿到不同的 list/option id */
let suggSeq = 0
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

/**
 * 带候选的文本输入。
 * 原生 datalist 在部分 WebView / 浏览器里点击不展开候选，回车还会顺手提交外层表单，
 * 所以这里用一层自绘 listbox：聚焦/点击即展开全部候选，输入后按子串过滤，
 * 上下键移动、回车选中、Esc 关闭；回车只在候选面板展开时被拦截，避免误提交。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  suggestions: string[]
  label: string
  placeholder?: string
  maxlength?: number
}>(), {})

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const instanceId = `sugg-${++suggSeq}`

const inputEl = ref<HTMLInputElement | null>(null)
const open = ref(false)
const active = ref(-1)
const filtering = ref(false)

const listId = `${instanceId}-list`
const optionId = (index: number) => `${instanceId}-option-${index}`

const filtered = computed(() => {
  const query = filtering.value ? props.modelValue.trim().toLowerCase() : ''
  if (!query) return props.suggestions
  return props.suggestions.filter(option => option.toLowerCase().includes(query))
})

const showMenu = computed(() => open.value && filtered.value.length > 0)

function openMenu() {
  // 聚焦/点击时先给全量候选：用户填过自定义值时也能看到可选项目
  filtering.value = false
  open.value = true
  active.value = -1
}

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
  filtering.value = true
  open.value = true
  active.value = 0
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!open.value) openMenu()
    if (!filtered.value.length) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    active.value = (active.value + step + filtered.value.length) % filtered.value.length
    void scrollActive()
    return
  }
  if (event.key === 'Enter') {
    // 面板展开时回车只负责选中候选；否则交给表单默认行为
    if (!open.value) return
    event.preventDefault()
    const option = filtered.value[active.value]
    if (option) pick(option)
    else open.value = false
    return
  }
  if (event.key === 'Escape') {
    if (!open.value) return
    event.preventDefault()
    open.value = false
    active.value = -1
    return
  }
  if (event.key === 'Tab') {
    open.value = false
    active.value = -1
  }
}

async function scrollActive() {
  await nextTick()
  const menu = document.getElementById(listId)
  menu?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
}

function pick(option: string) {
  emit('update:modelValue', option)
  filtering.value = false
  open.value = false
  active.value = -1
  inputEl.value?.focus()
}

function onFocusOut() {
  open.value = false
  active.value = -1
}
</script>

<style scoped>
.sugg{position:relative}
.sugg input{
  width:100%;padding:11px 40px 11px 13px;border:1px solid var(--color-border);border-radius:12px;
  font-size:14px;font-family:inherit;color:var(--color-ink);background:var(--surface-field);
}
.sugg input:focus{outline:none;border-color:var(--color-accent);box-shadow:0 0 0 3px var(--color-accent-soft)}
.chev{position:absolute;top:calc(50% - 8px);right:13px;pointer-events:none;color:var(--color-text-muted)}
.menu{
  position:absolute;z-index:60;top:calc(100% + 6px);left:0;right:0;margin:0;padding:5px;
  list-style:none;max-height:280px;overflow:auto;
  background:var(--color-card);border:1px solid var(--color-border);border-radius:12px;
  box-shadow:var(--shadow-lg);
}
.menu li{
  padding:9px 10px;border-radius:8px;font-size:13px;line-height:1.4;
  color:var(--color-text-secondary);cursor:pointer;
}
.menu li.active,.menu li:hover{background:var(--color-accent-soft);color:var(--color-accent)}
</style>