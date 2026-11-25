// 动作库的教学视频清单：只做外链，不做站内播放。
//
// 为什么是外链：把播放器嵌进来要过平台引用策略与商店审核两道关，本产品又没有后端，
// 外链跳转是唯一不需要额外基础设施的形态。代价是离开应用一下，换来的是不会因为
// 平台改播放器策略而整页失效。
//
// 三条口径，别在别处另写一套：
// 1. 每条都必须有人看过再填 `reviewedAt`；空着表示"还没核对"，界面会如实标注。
//    不允许把没看过的视频写成"推荐"或"正确示范"——与全站"不输出姿势结论"同一条线。
//    已核对的只是"链接可达 + 标题/时长/分P 对得上"，不等于看过了内容。
// 2. key 必须是 exercises.ts 里的动作 id；动作改名/停用时由 selfcheck 兜住。
// 3. 视频是第三方内容，下架、地域限制、标题被改都不由本产品控制。清单只是指路，
//    界面必须把"平台 / 原题 / 是否核对过"三件事同时写出来。
import { exercises } from './exercises'

/** 清单版本：内容变动时递增，方便排查"用户看到的是哪一版" */
export const VIDEO_CATALOG_VERSION = 'video-catalog-v1'

export type VideoProvider = 'bilibili' | 'youtube'

export interface ExerciseVideo {
  provider: VideoProvider
  /** bilibili 用 BV 号，youtube 用 11 位 videoId；格式由 videoCatalogProblems() 校验 */
  videoId: string
  /** 平台上的原题，原样展示不改写，方便用户回去核对是不是同一支 */
  title: string
  /** 与动作条目的关系：讲的是哪个变式，例如「杠铃深蹲」。不填＝就是条目本身 */
  variant?: string
  /** 大约多长，分钟；拿不到就不填，界面不显示空括号。多 P 合集填目标那一 P 的时长 */
  durationMin?: number
  /** 多 P 合集：默认打开第几 P；不填就是第一 P */
  page?: number
  /** 从第几秒开始看（跳过片头），只影响链接，不影响播放器行为 */
  startAt?: number
  /** 人工核对日期 YYYY-MM-DD；空＝还没人看过，界面标「未核对」 */
  reviewedAt?: string
  /** 给复核的人看的一句话，例如"合集，第一节讲站距" */
  note?: string
}

/**
 * 视频清单。目前只有动作分析支持的那几个动作有确定出处的条目，
 * 其余动作留空、由界面给出"自己去平台搜"的出口——宁可不给，也不猜。
 */
export const EXERCISE_VIDEOS: Record<string, ExerciseVideo[]> = {
  // —— 动作分析支持的五个动作：分析结果页可以直接从这里给"看教学视频" ——
  'ex-squat': [
    {
      provider: 'bilibili',
      videoId: 'BV16jQrB5E7e',
      title: '深蹲Squat 基本技术',
      durationMin: 6,
      note: '多 P 合集（约 16 分钟）：第一 P 是基本技术，后面分别是下降、上升与热身'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1kWmCBkEKd',
      title: '每天学会一个健身动作：杠铃深蹲✅',
      variant: '杠铃深蹲',
      durationMin: 1,
      note: '68 秒竖屏速览，只有要点没有示范细讲；负重版本，徒手阶段先看上面那条'
    }
  ],
  'ex-deadlift': [
    {
      provider: 'bilibili',
      videoId: 'BV1tTMZ6AE4T',
      title: '张老师的传统硬拉教学',
      durationMin: 20,
      note: '8 节合集（合计约 20 分钟）：站距臀位、预张力、启动、锁定分节讲，想看一条就跳到对应 P'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1eG41137az',
      title: '【干货篇】不要再说自己不会硬拉了，硬拉发力详细攻略',
      durationMin: 4
    }
  ],
  'ex-plank': [
    {
      provider: 'bilibili',
      videoId: 'BV1V1hQzaErs',
      title: '平板支撑教学。',
      durationMin: 5
    },
    {
      provider: 'bilibili',
      videoId: 'BV1zqXqBTEVm',
      title: '每天3分钟平板支撑：训练指南',
      durationMin: 3,
      note: '含把 3 分钟拆成多组的建议，与本库"2 组 × 30 秒"的口径不同，按自己能力来'
    }
  ],
  'ex-stand-curl': [
    {
      provider: 'bilibili',
      videoId: 'BV1anmCYNEbK',
      title: '健身房教学指南｜哑铃弯举这么做更有效！(手臂训练技巧分享)',
      durationMin: 8,
      note: '属于 35 集的"手臂训练指南"专辑，偏增肌向；只借屈肘与上臂固定的部分'
    }
  ],
  // —— 有氧：现有两条讲的都是跑姿（落地/摆臂），不涉及配速与强度控制 ——
  'ex-easy-run': [
    {
      provider: 'bilibili',
      videoId: 'BV1ibcUzDExE',
      title: '掌握落地技巧与摆臂精髓',
      durationMin: 7,
      note: '译制内容（原视频来自真锅未央频道），讲落地与摆臂'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1K1XPBXEiR',
      title: '给刚开始跑步的人，和正在跑步的人',
      durationMin: 2,
      note: '2 分钟引子，点开是 374 期的"龙井教练"专辑；强度与配速控制仍缺一条专门的教学'
    }
  ],
  'ex-brisk-walk': [
    {
      provider: 'bilibili',
      videoId: 'BV1Gt421N7mF',
      title: '如何开始超慢跑、超慢跑姿势、注意事项｜班長超慢跑',
      variant: '超慢跑',
      page: 10,
      durationMin: 4,
      note: '14 P 合集（合计约 82 分钟）：默认跳到第 10 节"超慢跑要怎麼開始"，其余是逐题问答；快走/超慢跑同属低冲击有氧'
    }
  ]
}

/** 某个动作挂了哪些视频；没有就是空数组，不是 undefined */
export function videosForExercise(exerciseId: string): ExerciseVideo[] {
  return EXERCISE_VIDEOS[exerciseId] ?? []
}

/** 拼外链：界面不各拼一套，改参数只改这里 */
export function videoUrl(video: ExerciseVideo): string {
  if (video.provider === 'youtube') {
    const start = video.startAt ? `&t=${video.startAt}s` : ''
    return `https://www.youtube.com/watch?v=${video.videoId}${start}`
  }
  // 多 P 合集必须能直接落到那一 P，否则 14 P 的视频点开只会看到第一节
  const query = [
    video.page && video.page > 1 ? `p=${video.page}` : '',
    video.startAt ? `t=${video.startAt}` : ''
  ].filter(Boolean).join('&')
  const base = `https://www.bilibili.com/video/${video.videoId}/`
  return query ? `${base}?${query}` : base
}

/** 平台名：界面上必须写清"这条视频在哪个平台"，别让用户点开才发现 */
export function providerLabel(video: ExerciseVideo): string {
  return video.provider === 'bilibili' ? 'B 站' : 'YouTube'
}

/**
 * 没有人工挑过的动作：给一个平台搜索地址，并明确标"未筛选"。
 * 这不是推荐，只是不让人卡死在空状态里。
 */
export function providerSearchUrl(name: string): string {
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(name)}`
}

/** 覆盖率：页面头部用，避免视图里再遍历一遍算第二份 */
export function videoCoverage(): { covered: number; total: number } {
  const active = exercises.filter(item => item.status === 'active')
  return {
    covered: active.filter(item => videosForExercise(item.id).length > 0).length,
    total: active.length
  }
}

/**
 * 清单自检（selfcheck 与开发期都能用）：动作 id 是否存在、BV 号/YouTube id 格式、
 * 重复挂载、停用动作是否还挂着视频。返回空数组表示没问题。
 */
export function videoCatalogProblems(): string[] {
  const problems: string[] = []
  const known = new Map(exercises.map(item => [item.id, item]))
  const seen = new Set<string>()
  for (const [exerciseId, list] of Object.entries(EXERCISE_VIDEOS)) {
    const exercise = known.get(exerciseId)
    if (!exercise) problems.push(`清单里的动作不存在：${exerciseId}`)
    if (exercise?.status === 'retired') problems.push(`已停用的动作还挂着视频：${exerciseId}`)
    if (!list.length) problems.push(`${exerciseId} 的条目是空的：要么删掉 key，要么补一条视频`)
    for (const video of list) {
      const key = `${video.provider}:${video.videoId}`
      if (seen.has(key)) problems.push(`同一个视频挂了两次：${key}`)
      seen.add(key)
      if (!video.title.trim()) problems.push(`${exerciseId} 的视频缺标题：${key}`)
      if (video.provider === 'bilibili' && !/^BV[0-9A-Za-z]{10}$/.test(video.videoId)) {
        problems.push(`BV 号格式不对：${exerciseId} → ${video.videoId}`)
      }
      if (video.provider === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) {
        problems.push(`YouTube id 格式不对：${exerciseId} → ${video.videoId}`)
      }
      if (video.startAt !== undefined && (!Number.isInteger(video.startAt) || video.startAt < 0)) {
        problems.push(`startAt 不合法：${key}`)
      }
      if (video.page !== undefined && (!Number.isInteger(video.page) || video.page < 1)) {
        problems.push(`page 不合法：${key}`)
      }
      if (video.reviewedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(video.reviewedAt)) {
        problems.push(`reviewedAt 不是 YYYY-MM-DD：${key}`)
      }
      if (video.durationMin !== undefined && (!Number.isFinite(video.durationMin) || video.durationMin <= 0)) {
        problems.push(`durationMin 不合法：${key}`)
      }
    }
  }
  return problems
}