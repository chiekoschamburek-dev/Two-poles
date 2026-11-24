<template>
  <div class="avatar-field">
    <div class="avatar-preview">
      <img v-if="modelValue" :src="modelValue" alt="头像预览" />
      <span v-else aria-hidden="true">{{ initial }}</span>
    </div>
    <div class="avatar-controls">
      <span class="field-label">头像（可留空）</span>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="choose" />
      <div class="avatar-actions">
        <BaseButton type="button" variant="secondary" size="sm" @click="fileInput?.click()">{{ modelValue ? '更换头像' : '选择头像' }}</BaseButton>
        <BaseButton v-if="modelValue" type="button" variant="ghost" size="sm" @click="remove">移除头像</BaseButton>
      </div>
      <p v-if="busy" class="fine" role="status">正在处理头像…</p>
      <p v-else-if="error" class="fine err" role="alert">{{ error }}</p>
      <p v-else class="fine">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { prepareModelImage } from '@/utils/modelImage'

/**
 * 档案头像选择：压缩、尺寸上限与取消逻辑只在这里维护。
 * 档案页和首次使用引导共用；loading 通过事件交给父级禁用保存按钮。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  nickname?: string
  hint?: string
}>(), {
  nickname: '',
  hint: '支持 JPG、PNG、WebP。点击「保存档案」后生效。'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:loading', value: boolean): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref('')
let request = 0

const initial = computed(() => props.nickname.trim().charAt(0) || '我')

function setBusy(next: boolean) {
  busy.value = next
  emit('update:loading', next)
}

async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const id = ++request
  setBusy(true)
  error.value = ''
  try {
    const preview = await prepareModelImage(file, 256)
    if (id !== request) return
    if (preview.length > 180_000) throw new Error('头像压缩后仍太大，请换一张图片。')
    emit('update:modelValue', preview)
  } catch (failure) {
    if (id === request) error.value = failure instanceof Error ? failure.message : '无法读取头像。'
  } finally {
    if (id === request) setBusy(false)
  }
}

function remove() {
  request++
  setBusy(false)
  error.value = ''
  emit('update:modelValue', '')
}
</script>

<style scoped>
.avatar-field{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.avatar-preview{width:68px;height:68px;display:grid;place-items:center;flex:none;overflow:hidden;border-radius:50%;background:var(--color-accent-soft);color:var(--color-accent);font-size:22px;font-weight:700}
.avatar-preview img{display:block;width:100%;height:100%;object-fit:cover}
.avatar-controls{min-width:0}
.field-label{display:block;font-size:12px;color:var(--color-text-muted);margin-bottom:7px}
.avatar-actions{display:flex;gap:8px;flex-wrap:wrap}
.fine{font-size:11.5px;color:var(--color-text-muted);line-height:1.6;margin:7px 0 0}
.fine.err{color:var(--color-danger)}
</style>