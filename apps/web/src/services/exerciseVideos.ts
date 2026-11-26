// 动作库的教学视频清单：只做外链，不做站内播放。
//
// 为什么是外链：把播放器嵌进来要过平台引用策略与商店审核两道关，本产品又没有后端，
// 外链跳转是唯一不需要额外基础设施的形态。代价是离开应用一下，换来的是不会因为
// 平台改播放器策略而整页失效。
//
// 三条口径，别在别处另写一套：
// 1. 每条都必须有人核对过再填 `reviewedAt`；空着表示"还没核对"，界面会如实标注。
//    核对的内容是"链接可达 + 原标题/时长/分P/UP 主对得上"，**不等于看过内容**；
//    所以不写"推荐""正确示范"，与全站"不输出姿势结论"同一条线。
// 2. key 必须是 exercises.ts 里的动作 id；动作改名/停用时由 selfcheck 兜住。
// 3. 视频是第三方内容，下架、地域限制、标题被改都不由本产品控制。清单只是指路，
//    界面必须把"平台 / 原题 / 是否核对过"三件事同时写出来。
//
// 当前覆盖：active 的 28 个动作各有 1–2 条（全部核对日期见各条 reviewedAt）。
// 核对方式：B 站公开接口 view 取原标题/时长/分P/UP 主，逐条与清单比对；
// 内容是否真的讲对了动作，只能靠标题与原题判断，界面上不做更强的承诺。
import { exercises } from './exercises'

/** 清单版本：内容变动时递增，方便排查"用户看到的是哪一版" */
export const VIDEO_CATALOG_VERSION = 'video-catalog-v2'

export type VideoProvider = 'bilibili' | 'youtube'

export interface ExerciseVideo {
  provider: VideoProvider
  /** bilibili 用 BV 号，youtube 用 11 位 videoId；格式由 videoCatalogProblems() 校验 */
  videoId: string
  /** 平台上的原题，原样展示不改写，方便用户回去核对是不是同一支 */
  title: string
  /** 与动作条目的关系：讲的是哪个变式，例如「杠铃深蹲」。不填＝就是条目本身 */
  variant?: string
  /** 大约多长，分钟；取不到就不填，界面不显示空括号。多 P 合集填目标那一 P 的时长 */
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
 * 视频清单，按 exercises.ts 的顺序排列。
 * 每条只给 1–2 支：够看出动作长什么样即可，不堆砌；变式与局限写在 variant/note 里，
 * 宁可不给，也不把"看起来像"当成"就是这个动作"。
 */
export const EXERCISE_VIDEOS: Record<string, ExerciseVideo[]> = {
  // ——— 动态热身 ———
  'ex-shoulder-roll': [
    {
      provider: 'bilibili',
      videoId: 'BV1Py4y1r7ud',
      title: '教你三个肩关节热身的动作：1.肩绕环2.手肘环绕3.伸展肩环绕。我的左肩膀总是卡压，所以每次热身我会多注意左侧',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '59 秒连做三个肩部热身，第 1 个就是肩绕环；本库只说绕环这一段'
    }
  ],
  'ex-hip-swing': [
    {
      provider: 'bilibili',
      videoId: 'BV1NF4m1A75Y',
      title: '跑步训练动作演示：侧摆腿+前后摆腿',
      variant: '前后摆腿',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '跑前热身演示；本库是扶墙前后摆，只看后半段'
    }
  ],
  'ex-mark-march': [
    {
      provider: 'bilibili',
      videoId: 'BV11J4m1u7R3',
      title: '六步教你正确高抬腿！',
      variant: '跑姿高抬腿',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '跑步专项的高抬腿；本库是原地抬膝走（不跑跳），只借抬膝高度与躯干直立'
    }
  ],
  'ex-cat-cow': [
    {
      provider: 'bilibili',
      videoId: 'BV1dd4y1N7RM',
      title: '猫牛式 | 伸展脊柱 缓解腰背痛 新人必看',
      variant: '猫牛式',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '瑜伽语境的猫牛式，一拱一塌为一组，与条目动作一致'
    }
  ],
  'ex-lunge-twist': [
    {
      provider: 'bilibili',
      videoId: 'BV1EV411J7n9',
      title: '弓步转体——动态拉伸',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '66 秒演示；先弓步再转体，前膝别越过脚尖'
    }
  ],

  // ——— 坐站与上肢 ———
  'ex-chair-sitstand': [
    {
      provider: 'bilibili',
      videoId: 'BV1LJyqB3Er1',
      title: '推荐一个有椅子就能做的训练：坐起训练',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '一把椅子就能做，讲起身时重心前移与膝髋配合'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1A14y137bo',
      title: '膝盖康复必练动作---椅子起身',
      variant: '康复版',
      durationMin: 2,
      reviewedAt: '2026-11-26',
      note: '康复视角；膝盖不适时按这条的速度与幅度来'
    }
  ],
  'ex-stand-curl': [
    {
      provider: 'bilibili',
      videoId: 'BV1anmCYNEbK',
      title: '健身房教学指南｜哑铃弯举这么做更有效！(手臂训练技巧分享)',
      durationMin: 8,
      reviewedAt: '2026-11-26',
      note: '属于 35 集的"手臂训练指南"专辑，偏增肌向；只借屈肘与上臂固定的部分'
    }
  ],
  'ex-band-curl': [
    {
      provider: 'bilibili',
      videoId: 'BV19b41147d9',
      title: '弹力带二头弯举，肱二头肌训练',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '站姿弹力带弯举，讲固定大臂、别甩腰借力'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1zV411n7pf',
      title: '【Jeff】用弹力带练大二头',
      variant: 'Jeff Nippard 译制',
      durationMin: 9,
      reviewedAt: '2026-11-26',
      note: '译制内容，偏增肌向；只借弹力带阻力曲线那一段'
    }
  ],
  'ex-bottle-curl': [
    {
      provider: 'bilibili',
      videoId: 'BV1Mt411T7uR',
      title: '两瓶矿泉水练臂弯举，随时随地，练爆你的肱二头肌！！！',
      variant: '矿泉水瓶弯举',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '原题措辞夸张，动作就是负重弯举；水瓶换成任何等重物都成立'
    }
  ],

  // ——— 下肢 ———
  'ex-wall-sit': [
    {
      provider: 'bilibili',
      videoId: 'BV1PxAoePEhE',
      title: '正确靠墙静蹲养护膝盖',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '82 秒讲膝盖角度与背部贴墙'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1NEAJzXEWw',
      title: '靠墙静蹲30天：别盲目挑战，这样练才真护膝！',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '讲挑战式静蹲的风险与替代做法，与本库"不超过明显疼痛"的口径一致'
    }
  ],
  'ex-band-row': [
    {
      provider: 'bilibili',
      videoId: 'BV1M2c5zGEb4',
      title: '彈力帶划船',
      durationMin: 6,
      reviewedAt: '2026-11-26',
      note: '繁体中文讲解，从怎么固定带子讲起'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1NZGX6tErQ',
      title: '居家运动③ 练背 弹力带划船',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '居家练背第 3 集，讲俯身角度与肩胛后收'
    }
  ],
  'ex-knee-pushup': [
    {
      provider: 'bilibili',
      videoId: 'BV1pN4y157rD',
      title: '跪姿俯卧撑最详细动作讲解',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '3 分钟，从手位讲到身体一条线；膝盖下垫软垫'
    }
  ],
  'ex-glute-bridge': [
    {
      provider: 'bilibili',
      videoId: 'BV1kF411F7YG',
      title: '臀腿塑形王牌动作，臀桥教学。拒绝无效训练！',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '臀桥精讲：抬到髋膝同高、别用腰代偿'
    },
    {
      provider: 'bilibili',
      videoId: 'BV12etJebEft',
      title: '如何纠正臀桥动作细节？',
      variant: '错误纠正',
      durationMin: 5,
      reviewedAt: '2026-11-26',
      note: '常见错误（塌腰、顶髋过度）逐条演示'
    }
  ],
  'ex-calf-raise': [
    {
      provider: 'bilibili',
      videoId: 'BV1ZLuxz6Eyk',
      title: '一个随时随地都能练的力量——提踵训练，对跑者足踝力量很重要！',
      durationMin: 2,
      reviewedAt: '2026-11-26',
      note: '跑者向提踵，讲足踝力量与全幅度'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1Tv411b7do',
      title: '提踵，您做对了吗？',
      variant: '动作自检',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '64 秒讲膝盖直、起落节奏别弹震'
    }
  ],
  'ex-band-walk': [
    {
      provider: 'bilibili',
      videoId: 'BV1rs1HByEns',
      title: '弹力带侧步行走（蟹步）',
      durationMin: 2,
      reviewedAt: '2026-11-26',
      note: '蟹步示范，带子套在膝上，全程半蹲'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1wHBrYsE43',
      title: '被严重低估的下肢训练，弹力带螃蟹步。',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '讲为什么别只做小幅侧移，步幅与弹力要保持张力'
    }
  ],
  'ex-step-up': [
    {
      provider: 'bilibili',
      videoId: 'BV14M411D7Xf',
      title: '「如何正确做」上台阶【最强臀部激活】',
      durationMin: 8,
      reviewedAt: '2026-11-26',
      note: '8 分钟讲上台阶发力；用稳固矮凳或台阶，别用软凳'
    }
  ],
  'ex-squat': [
    {
      provider: 'bilibili',
      videoId: 'BV16jQrB5E7e',
      title: '深蹲Squat 基本技术',
      durationMin: 6,
      reviewedAt: '2026-11-26',
      note: '多 P 合集（约 16 分钟）：第一 P 是基本技术，后面分别是下降、上升与热身'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1kWmCBkEKd',
      title: '每天学会一个健身动作：杠铃深蹲✅',
      variant: '杠铃深蹲',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '68 秒竖屏速览，只有要点没有示范细讲；负重版本，徒手阶段先看上面那条'
    }
  ],
  'ex-deadlift': [
    {
      provider: 'bilibili',
      videoId: 'BV1tTMZ6AE4T',
      title: '张老师的传统硬拉教学',
      durationMin: 20,
      reviewedAt: '2026-11-26',
      note: '8 节合集（合计约 20 分钟）：站距臀位、预设张力、启动、锁定分节讲，想看一条就跳到对应 P'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1eG41137az',
      title: '【干货篇】不要再说自己不会硬拉了，硬拉发力详细攻略',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '4 分钟讲发力顺序；器材是杠铃，本库版本可用哑铃'
    }
  ],
  'ex-jumping-jack': [
    {
      provider: 'bilibili',
      videoId: 'BV1kJ411u7jW',
      title: '教你正确练习开合跳，避免膝盖受伤，这2个错误动作尽量不要做',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '71 秒，主要讲两个伤膝错误；落地用前脚掌'
    }
  ],
  'ex-squat-jump': [
    {
      provider: 'bilibili',
      videoId: 'BV1nE421u7Q4',
      title: '【深蹲跳】徒手健身动作介绍',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '1 分钟动作介绍；落地缓冲讲得少，按本库"落地微屈"来做'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1Fg411Y7sW',
      title: '【乐动力】深蹲跳（自用）',
      variant: '跟练节奏',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '58 秒跟练节奏演示，没有讲解'
    }
  ],

  // ——— 核心 ———
  'ex-dead-bug': [
    {
      provider: 'bilibili',
      videoId: 'BV1RXdUBiEsa',
      title: '一个标准的死虫式动作',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: '83 秒示范标准死虫式；对侧手脚同时伸出，腰背贴地'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1i1w7zYEyh',
      title: '10分钟核心跟练「死虫」',
      variant: '跟练版',
      durationMin: 10,
      reviewedAt: '2026-11-26',
      note: '跟练节奏偏慢；本库是 2 组 × 10 次，看前 2 分钟就够'
    }
  ],
  'ex-bird-dog': [
    {
      provider: 'bilibili',
      videoId: 'BV1ne411W7MV',
      title: '如何做鸟狗式 史上最全教程【科学康复】',
      durationMin: 2,
      reviewedAt: '2026-11-26',
      note: '2 分钟讲对侧手脚与骨盆稳定'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1bKKVzEEHP',
      title: '鸟狗式｜腰椎康复进阶动作首选',
      variant: '康复版',
      durationMin: 8,
      reviewedAt: '2026-11-26',
      note: '康复视角，强调腰椎不塌、幅度宁小勿大'
    }
  ],
  'ex-side-plank': [
    {
      provider: 'bilibili',
      videoId: 'BV1yh411R7VW',
      title: '【Keep】屈膝侧支撑动作要领',
      durationMin: 1,
      reviewedAt: '2026-11-26',
      note: 'Keep 的屈膝侧支撑要领，与本库变式一致'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1eF3tzjEMk',
      title: '侧腹王牌训练动作：侧平板支撑保姆级教学',
      variant: '侧平板支撑（直腿）',
      durationMin: 6,
      reviewedAt: '2026-11-26',
      note: '直腿标准版；屈膝版做稳了再往上走'
    }
  ],
  'ex-plank': [
    {
      provider: 'bilibili',
      videoId: 'BV1V1hQzaErs',
      title: '平板支撑教学。',
      durationMin: 5,
      reviewedAt: '2026-11-26',
      note: '5 分钟，讲前臂支撑与身体一条线'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1zqXqBTEVm',
      title: '每天3分钟平板支撑：训练指南',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '含把 3 分钟拆成多组的建议，与本库"2 组 × 30 秒"的口径不同，按自己能力来'
    }
  ],

  // ——— 有氧 ———
  'ex-easy-run': [
    {
      provider: 'bilibili',
      videoId: 'BV1ibcUzDExE',
      title: '掌握落地技巧与摆臂精髓',
      durationMin: 7,
      reviewedAt: '2026-11-26',
      note: '译制内容（原视频来自真锅未央频道），讲落地与摆臂'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1K1XPBXEiR',
      title: '给刚开始跑步的人，和正在跑步的人',
      durationMin: 2,
      reviewedAt: '2026-11-26',
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
      reviewedAt: '2026-11-26',
      note: '14 P 合集（合计约 82 分钟）：默认跳到第 10 节"超慢跑要怎麼開始"，其余是逐题问答；快走/超慢跑同属低冲击有氧'
    }
  ],

  // ——— 舒缓整理 ———
  'ex-ham-stretch': [
    {
      provider: 'bilibili',
      videoId: 'BV1oC4y1H7uT',
      title: '试试坐姿拉伸大腿后侧(腘绳肌)的时候，能不能够到脚尖？努力碰脚尖还会腰疼？',
      durationMin: 3,
      reviewedAt: '2026-11-26',
      note: '坐姿腘绳肌拉伸，讲够不到脚尖时别硬压'
    },
    {
      provider: 'bilibili',
      videoId: 'BV1M4411d7hU',
      title: '大腿后侧肌肉紧张？专业教练教你三个拉伸动作，简单有用！',
      variant: '三个拉伸动作',
      durationMin: 4,
      reviewedAt: '2026-11-26',
      note: '三个动作里取坐姿那一段，其余是站姿/仰卧变式'
    }
  ],
  'ex-breath': [
    {
      provider: 'bilibili',
      videoId: 'BV1gf4y1S73Z',
      title: '干货｜核心收紧不是憋气！保姆级教程，三步学会在健身时腹式呼吸『Yoyo｜Better Shape』',
      durationMin: 10,
      reviewedAt: '2026-11-26',
      note: '10 分钟，从核心收紧讲到腹式呼吸；睡前放松看后半段'
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