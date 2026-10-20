<template>
  <Teleport to="body">
    <div v-if="open" class="photo-scrim" @click.self="close">
      <div class="photo-dialog" role="dialog" aria-modal="true" aria-labelledby="meal-photo-title">
        <header class="photo-head">
          <div>
            <span class="micro">PHOTO</span>
            <h2 id="meal-photo-title">{{ label || '这次记录的照片' }}</h2>
          </div>
          <button class="x" type="button" aria-label="关闭" @click="close">✕</button>
        </header>
        <div class="photo-stage">
          <div v-if="loading" class="loading" aria-live="polite">
            <span class="spin" aria-hidden="true"></span>
            <p>正在读取本机照片…</p>
          </div>
          <img
            v-else-if="src"
            :src="src"
            :alt="isOriginal ? `${label || '饮食记录'}的原图` : `${label || '饮食记录'}的缩略图`"
          />
          <p v-else class="empty">这张记录没有可查看的照片。</p>
        </div>
        <footer class="photo-foot">
          <span class="caption">
            {{ loading ? '正在读取…' : isOriginal ? '本机原图 · 仅存于这台设备' : '本机缩略图（原图未保存）' }}
          </span>
          <BaseButton variant="secondary" size="sm" @click="close">关闭</BaseButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import BaseButton from '@/components/common/BaseButton.vue'
import { getMealPhoto } from '@/services/mealPhotos'

const props = defineProps<{
  open: boolean
  photoId?: string
  fallback?: string
  label?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const src = ref('')
const isOriginal = ref(false)
const loading = ref(false)
let objectUrl = ''
let loadSeq = 0
let previousOverflow = ''

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(() => props.open, (open) => {
  if (open) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
  } else {
    document.body.style.overflow = previousOverflow
    window.removeEventListener('keydown', onKeydown)
  }
})

function release() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
}

async function load() {
  release()
  src.value = ''
  isOriginal.value = false
  loading.value = true
  const seq = ++loadSeq
  if (props.photoId) {
    try {
      const blob = await getMealPhoto(props.photoId)
      if (seq !== loadSeq) return
      if (blob) {
        objectUrl = URL.createObjectURL(blob)
        src.value = objectUrl
        isOriginal.value = true
      }
    } catch {
      /* 原图读不出来时退回缩略图 */
    }
  }
  if (seq !== loadSeq) return
  if (!src.value && props.fallback) {
    src.value = props.fallback
    isOriginal.value = false
  }
  loading.value = false
}

watch(
  [() => props.open, () => props.photoId],
  ([open]) => {
    if (!open) {
      loadSeq++
      release()
      src.value = ''
      loading.value = false
      return
    }
    void load()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  loadSeq++
  release()
  document.body.style.overflow = previousOverflow
  window.removeEventListener('keydown', onKeydown)
})

function close() {
  emit('close')
}
</script>

<style scoped>
.photo-scrim{position:fixed;inset:0;z-index:var(--z-modal-backdrop);background:rgba(17,22,26,.72);backdrop-filter:blur(4px);display:grid;place-items:center;padding:24px}
.photo-dialog{width:min(1060px,100%);max-height:94vh;display:flex;flex-direction:column;background:var(--color-card);border:1px solid var(--color-border);border-radius:var(--radius-xl);overflow:hidden;box-shadow:0 30px 90px -40px rgba(0,0,0,.7)}
.photo-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--color-divider)}
.photo-head h2{font-size:17px;margin:5px 0 0;overflow-wrap:anywhere}
.x{width:32px;height:32px;border-radius:9px;color:var(--color-text-muted);font-size:14px;flex:none}
.x:hover{background:var(--color-neutral-soft);color:var(--color-ink)}
.photo-stage{flex:1;min-height:0;display:grid;place-items:center;background:#0d1114;overflow:auto;padding:10px}
.photo-stage img{display:block;max-width:100%;max-height:78vh;width:auto;height:auto;object-fit:contain}
.loading,.empty{display:grid;gap:10px;place-items:center;color:#cbd5dc;padding:40px;font-size:13px}
.loading p,.empty{margin:0}
.empty{color:var(--color-text-muted)}
.spin{display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#e8edf1;animation:spin 900ms linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.photo-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid var(--color-divider);background:var(--color-neutral-soft);flex-wrap:wrap}
.caption{font-size:11px;line-height:1.6;color:var(--color-text-muted)}
.photo-foot :deep(button){width:auto}
@media(max-width:640px){
  .photo-scrim{padding:0}
  .photo-dialog{width:100%;height:100vh;max-height:100vh;border-radius:0;border:0}
  .photo-head{padding:14px 16px}
  .photo-stage img{max-height:calc(100vh - 150px)}
  .photo-foot{padding:10px 16px}
}
</style>
