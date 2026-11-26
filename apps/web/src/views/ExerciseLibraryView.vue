<template>
  <div class="page-wrap">
    <PageHeader
      pole="neutral"
      label="LIBRARY"
      title="动作库"
      :subtitle="coverage.covered === coverage.total
        ? `${coverage.total} 个动作都配了教学视频。视频来自 B 站等外部平台，点开会在新页面播放。`
        : `${coverage.total} 个动作，其中 ${coverage.covered} 个挂了教学视频；其余的给平台搜索出口。视频点开会在新页面播放。`"
    >
      <!-- 动作库不占导航位：有来路就回上一页，直接打开时回跟练开始页 -->
      <template #actions>
        <button type="button" class="back-link" @click="goBack">
          <ChevronLeft :size="14" aria-hidden="true" />返回
        </button>
      </template>
    </PageHeader>

    <div class="toolbar">
      <label class="search">
        <Search :size="15" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          placeholder="搜动作名、类型或要点，例如「蹲」「拉伸」"
          aria-label="搜索动作"
        />
        <button v-if="keyword" type="button" class="clear" aria-label="清空搜索" @click="keyword = ''">×</button>
      </label>
      <div class="chips">
        <button
          v-for="t in types"
          :key="t"
          type="button"
          class="chip"
          :class="{ active: typeFilter === t }"
          :aria-pressed="typeFilter === t"
          @click="typeFilter = typeFilter === t ? '' : t"
        >{{ t }}</button>
      </div>
    </div>

    <p v-if="rows.length" class="count" role="status">找到 {{ rows.length }} 个动作</p>

    <div v-if="rows.length" class="list">
      <BaseCard v-for="row in rows" :key="row.exercise.id" class="row">
        <div class="row-head">
          <h2>{{ row.exercise.name }}</h2>
          <span class="tag">{{ row.exercise.type }}</span>
          <span class="tag soft">{{ row.exercise.intensity }}强度</span>
        </div>
        <p class="meta">
          {{ doseOf(row.exercise) }}<template v-if="row.exercise.equipment.length"> · {{ row.exercise.equipment.join(' / ') }}</template>
          <template v-else> · 不需要器材</template>
        </p>
        <p class="howto">{{ row.exercise.howto }}</p>

        <div v-if="row.videos.length" class="videos">
          <a
            v-for="video in row.videos"
            :key="video.videoId"
            class="video-link"
            :href="videoUrl(video)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Play :size="14" aria-hidden="true" />
            <span class="video-title">{{ video.title }}</span>
            <span class="video-meta">
              {{ providerLabel(video) }}<template v-if="video.variant"> · {{ video.variant }}</template><template v-if="video.durationMin"> · 约 {{ video.durationMin }} 分钟</template><template v-if="!video.reviewedAt"> · 未核对</template>
            </span>
            <span v-if="video.note" class="video-note">{{ video.note }}</span>
          </a>
        </div>
        <div v-else class="videos empty-videos">
          <p>
            还没有挑好的教学视频 ·
            <a :href="providerSearchUrl(row.exercise.name)" target="_blank" rel="noopener noreferrer" class="video-search">去 B 站搜「{{ row.exercise.name }}」</a>
            <span class="tiny">（未筛选）</span>
          </p>
        </div>
      </BaseCard>
    </div>

    <div v-else class="empty">
      <p>{{ keyword.trim() ? `没有匹配「${keyword.trim()}」的动作。` : '这个类型下还没有动作。' }}</p>
      <button type="button" class="chip active" @click="reset">清空筛选</button>
    </div>

    <p class="foot">
      视频是第三方平台的内容，本产品不保证其可用性与质量，也不据此给出姿势结论。清单条目只核对了原标题 / 时长 / 分P / UP 主，没有逐条播放验证内容；播放前请自行判断是否适合自己。链接失效时清单需要人工更换，当前没有自动检测。
    </p>

    <!-- 页面很长，滚到底也能直接回去，不用再去找左侧导航 -->
    <div class="foot-back">
      <button type="button" class="back-link" @click="goBack">
        <ChevronLeft :size="14" aria-hidden="true" />返回
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Play, Search, ChevronLeft } from 'lucide-vue-next'
import BaseCard from '@/components/common/BaseCard.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import { useAppBack } from '@/composables/useAppBack'
import { exercises, type Exercise } from '@/services/exercises'
import {
  providerLabel,
  providerSearchUrl,
  videoCoverage,
  videoUrl,
  videosForExercise
} from '@/services/exerciseVideos'

const keyword = ref('')
const typeFilter = ref('')
/** 动作库的来路通常是跟练开始页；直接打开时退回那里 */
const goBack = useAppBack('/execution')

/** 停用动作不进库：它们本来就不该被推荐，更不该配视频 */
const active = computed(() => exercises.filter(item => item.status === 'active'))
const types = computed(() => [...new Set(active.value.map(item => item.type))])
const coverage = videoCoverage()

const rows = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return active.value
    .filter(item => !typeFilter.value || item.type === typeFilter.value)
    .filter(item => {
      if (!needle) return true
      const haystack = [item.name, item.type, item.howto, item.reason ?? '', ...item.equipment].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
    .map(item => ({ exercise: item, videos: videosForExercise(item.id) }))
})

function reset() {
  keyword.value = ''
  typeFilter.value = ''
}

/** 剂量：保持秒数、次数、还是只看分钟，三种写法不能混 */
function doseOf(item: Exercise): string {
  if (item.holdSeconds) return `${item.sets} 组 × 保持 ${item.holdSeconds} 秒`
  if (item.reps) return `${item.sets} 组 × ${item.reps} 次`
  return `约 ${item.minutes} 分钟`
}
</script>

<style scoped>
.page-wrap{max-width:var(--page-max-width);margin:auto}

/* 返程：有来路回上一页，直接打开时回跟练开始页 */
.back-link{display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 12px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-card);font-family:inherit;font-size:12.5px;font-weight:600;color:var(--color-text-secondary);white-space:nowrap;cursor:pointer;transition:border-color var(--motion-fast),color var(--motion-fast)}
.back-link:hover{border-color:var(--color-ink);color:var(--color-ink)}
.back-link:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}

/* 搜索与筛选 */
.toolbar{display:grid;gap:10px;margin-bottom:14px}
.search{display:flex;align-items:center;gap:9px;padding:0 13px;border:1px solid var(--color-border);border-radius:12px;background:var(--surface-field);min-height:44px}
.search :deep(svg){color:var(--color-text-muted);flex:none}
.search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:13.5px;color:var(--color-ink);padding:11px 0}
.search input::-webkit-search-cancel-button{display:none}
.clear{flex:none;width:26px;height:26px;border-radius:var(--radius-sm);color:var(--color-text-muted);font-size:16px;line-height:1}
.clear:hover{background:var(--color-neutral-soft);color:var(--color-ink)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:8px 13px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--color-text-secondary);background:var(--color-neutral-soft);transition:all var(--motion-fast);min-height:36px}
.chip.active{background:var(--color-accent);color:var(--color-on-accent)}
.count{font-size:12px;color:var(--color-text-muted);margin:0 0 10px}

/* 动作条目 */
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;align-items:start}
.row{--card-pad:16px 17px}
.row-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.row-head h2{font-size:16px;margin:0;color:var(--color-ink)}
.tag{font-size:10.5px;font-weight:600;padding:3px 7px;border-radius:var(--radius-sm);background:var(--color-accent-soft);color:var(--color-accent)}
.tag.soft{background:var(--color-neutral-soft);color:var(--color-text-muted)}
.meta{font-size:11.5px;color:var(--color-text-muted);margin:7px 0 0}
.howto{font-size:13px;color:var(--color-text-secondary);line-height:1.7;margin:7px 0 0}

/* 视频区：外链一律带平台名与"是否核对过"，不给"推荐/标准"这类结论 */
.videos{display:grid;gap:7px;margin-top:12px;padding-top:12px;border-top:1px solid var(--color-divider)}
.video-link{display:grid;grid-template-columns:14px 1fr;gap:2px 8px;align-items:start;padding:9px 10px;border-radius:var(--radius-md);background:var(--color-neutral-soft);text-decoration:none;transition:background var(--motion-fast)}
.video-link:hover{background:var(--color-accent-soft)}
.video-link :deep(svg){color:var(--color-accent);margin-top:2px}
.video-title{font-size:12.5px;font-weight:600;color:var(--color-ink);line-height:1.5}
.video-meta{grid-column:2;font-size:10.5px;color:var(--color-text-muted)}
.video-note{grid-column:2;font-size:10.5px;color:var(--color-text-muted);line-height:1.6}
.empty-videos p{font-size:12px;color:var(--color-text-muted);margin:0;line-height:1.7}
.video-search{font-weight:600;color:var(--color-accent);text-decoration:none}
.video-search:hover{text-decoration:underline}
.tiny{font-size:10.5px;white-space:nowrap}

.empty{display:grid;gap:10px;justify-items:start;padding:28px 20px;border:1px dashed var(--color-border);border-radius:var(--radius-lg);color:var(--color-text-muted);font-size:13px}
.empty p{margin:0}
.foot{font-size:11.5px;color:var(--color-text-muted);line-height:1.75;margin:18px 0 0}
.foot-back{display:flex;justify-content:center;margin:20px 0 4px}

@media(max-width:640px){
  .page-head h1{font-size:24px}
  .list{grid-template-columns:1fr}
}
</style>