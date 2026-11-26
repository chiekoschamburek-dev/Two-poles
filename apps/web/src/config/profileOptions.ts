// 档案录入的选项配置：档案页、首次使用引导与 PB/极限数据子组件共用。
// 只放"可选项/顺序/文案"，不放校验与保存逻辑（那些在 services/profileRules.ts
// 与 services/profileForm.ts）。

/** 径赛：按时间比，越短越好 */
export const PROFILE_TRACK_EVENTS = ['100m', '200m', '400m', '800m', '1500m', '5000m']
/** 田赛：按距离比，越远越好 */
export const PROFILE_FIELD_EVENTS = ['跳远', '三级跳', '铅球']
/** 常见举重动作，仍允许自定义 */
export const PROFILE_LIFT_PRESETS = ['深蹲', '硬拉', '卧推']

/** 主要目标（单选，可留空） */
export const PROFILE_GOALS = ['保持活力', '减脂', '增肌', '改善体态', '专项提升', '康复维持']

/** 运动经验（可留空，允许自定义） */
export const PROFILE_EXPERIENCES = ['几乎不运动', '偶尔运动', '有一定基础', '长期规律训练']

/**
 * 每次能用的时间预设档位（多选）。
 * 这里只是"点着快"的常用档；超出档位的用「其他时长」自己填，
 * 合法区间在 profileRules.TIME_RANGE，不在这张表里。
 */
export const PROFILE_TIME_OPTIONS = [
  '10 分钟', '15 分钟', '20 分钟', '30 分钟', '45 分钟', '60 分钟', '90 分钟', '120 分钟'
]

/** 可用器材（多选） */
export const PROFILE_EQUIPMENT_OPTIONS = ['无器材', '椅子', '弹力带', '哑铃', '单杠', '跑步机']

/** 常训练的场地（多选） */
export const PROFILE_VENUE_OPTIONS = ['宿舍或家', '健身房', '户外']

/** 需要避开的（多选，参与动作过滤） */
export const PROFILE_RESTRICTION_OPTIONS = ['无跳跃', '膝部负担小', '腰部负担小', '低强度起步']

/** 特殊情况（多选；不是动作过滤器，而是自动推荐的适用范围门槛） */
export const PROFILE_GATE_OPTIONS = ['孕期或产后', '伤病或遵医嘱限制']

/** 训练周期阶段（单选，可留空） */
export const PROFILE_PHASES = ['基础准备', '强度建立', '量化提升', '减量与测试']

/** 主项选项：与 PB 记录使用同一份径赛/田赛清单 */
export const PROFILE_EVENT_OPTIONS = [...PROFILE_TRACK_EVENTS, ...PROFILE_FIELD_EVENTS]

/**
 * 大众运动项目：专项是"你主要在练什么"，不是只有田径。
 * 按普及度排，客户先看到自己认得出的项目；竞技项目排在后面。
 */
export const PROFILE_COMMON_DISCIPLINES = [
  '力量训练', '跑步', '骑行', '游泳', '篮球', '足球', '羽毛球', '网球',
  '健身操', '瑜伽', '普拉提', '登山徒步', '体态改善'
]

/**
 * 专项候选项（可多选）：大众项目 + 田径项目。
 * PB 记录仍只用 PROFILE_EVENT_OPTIONS——那是比赛成绩口径，不能混进大众项目。
 */
export const PROFILE_DISCIPLINE_OPTIONS = [...PROFILE_COMMON_DISCIPLINES, ...PROFILE_EVENT_OPTIONS]