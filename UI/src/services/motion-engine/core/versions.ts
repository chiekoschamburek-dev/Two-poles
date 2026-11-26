// 引擎/特征/配置/规则/模型版本。
// 分析记录必须能回答"这条结论是哪一版算法算的"：规则阈值会变、特征口径会变、
// 模型权重也会变；趋势页只允许同口径比较，跨版本要断线（执行方案 §7）。
//
// 约定：MOTION_RULES_VERSION 仍由 motionRules.ts 导出（服务端有 ruleVersion 列），
// 这里只做统一再导出与引擎侧版本，避免两处各写一个字符串。

export const MOTION_ENGINE_VERSION = 'motion-engine-v2'
export const MOTION_FEATURE_VERSION = 'motion-feature-v1'
export const MOTION_CONFIG_VERSION = 'motion-config-v2'
export const MOTION_MODEL_VERSION = 'rule-baseline-0' // 还没有学习模型；影子模式占位

/** 与 motionRules.ts 的规则版本保持一致；M6 升 v4 时同步改这里 */
export { MOTION_RULES_VERSION } from '@/services/motionRules'

export const ENGINE_VERSIONS = {
  engine: MOTION_ENGINE_VERSION,
  feature: MOTION_FEATURE_VERSION,
  config: MOTION_CONFIG_VERSION,
  model: MOTION_MODEL_VERSION
} as const