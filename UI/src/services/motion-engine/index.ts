// Motion Engine V2 公共入口。
// 旧 motionAnalysis.ts 暂时保留为 facade（实时/离线都还在用它），
// 新代码从这里取共享特征、视角、识别、分段与证据模块。
// 这样新引擎可以增量替换判别层，不必一次性搬迁 12 个目录。

export * from './core/types'
export * from './core/versions'
export { assessPoseQuality, POSE_QUALITY_CONFIG } from './pose/quality'
export type { PoseQualityResult } from './pose/quality'
export {
  buildMotionFeatureSeries,
  sliceFeatureSeries,
  angleSequence,
  timeSequence
} from './features/series'
export type { BuildFeatureSeriesOptions } from './features/series'
export { findPeaks, tallestPeak } from './temporal/peaks'
export type { Peak, PeakOptions } from './temporal/peaks'
export {
  pearson,
  laggedAlternation,
  autocorrelation,
  zeroCrossings,
  CORRELATION_THRESHOLDS
} from './temporal/correlation'
export {
  detectActiveWindows,
  unionRange,
  mostActiveSpan
} from './temporal/activeWindow'
export type {
  ActiveWindowOptions,
  ActiveWindowResult,
  MotionEnergyFrame
} from './temporal/activeWindow'
export {
  ACTIVE_WINDOW_RULES,
  planAnalysisWindow,
  coarseGridTimes,
  fineGridTimes
} from './pipeline/precheck'
export type { AnalysisWindowPlan } from './pipeline/precheck'
export {
  estimateView,
  viewToAnalysisView,
  suggestedViewFromEstimate,
  VIEW_THRESHOLDS
} from './view/estimate'
export type { ViewEstimateOptions } from './view/estimate'
export {
  extractRecognitionFeatures,
  hasMovements
} from './recognition/features'
export type { RecognitionFeatures, GaitEvidence } from './recognition/features'
export {
  decideFamily,
  familyLabel,
  FAMILY_THRESHOLDS
} from './recognition/family'
export type { MotionFamily, FamilyDecision } from './recognition/family'
export { recognizeAction, ACTION_CONFIDENCE } from './recognition/actions'
export type { RecognitionResult, ActionCandidate } from './recognition/actions'
export { segmentRepsAdaptive, signalFor } from './segmentation/reps'
export type { AdaptiveRepSegmentation, AdaptiveRepOptions, PartialRepetition, RepSignal } from './segmentation/reps'
export { buildMotionEvidence, compactEvidence } from './evidence/evidence'
export type { MotionEvidencePayload, EvidenceInput } from './evidence/evidence'