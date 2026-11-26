// 六层证据：把一次分析的"测到了什么、为什么这么判、哪些没评"打包成可持久化 JSON。
//
// 分层（与执行方案 §8 一致）：
// - pose：骨架定位与跟踪质量；
// - action：动作识别结果（来源/置信/候选分差）；
// - view：视角估计与可观测性；
// - event：分段/计数/半程动作；
// - metric：单项测量的可靠性（这里是摘要，细节在 metrics/segmentation 里）；
// - finding：关注项、参考观察与被准入闸门跳过的规则。
//
// 纯函数：不碰 DOM；结果直接进本机记录与服务端 evidence TEXT 列。

import type {
  AnalysisAction,
  AnalysisView,
  MotionAnalysisFinding,
  MotionAnalysisMetric
} from '@/types/domain'
import {
  MOTION_ENGINE_VERSION,
  MOTION_FEATURE_VERSION,
  MOTION_CONFIG_VERSION,
  MOTION_MODEL_VERSION
} from '@/services/motion-engine/core/versions'
import { MOTION_RULES_VERSION } from '@/services/motionRules'
import type { ViewEstimate } from '@/services/motion-engine/core/types'

export interface MotionEvidencePayload {
  [key: string]: unknown
  versions: {
    engine: string
    feature: string
    config: string
    model: string
    rules: string
  }
  pose: {
    usableRatio: number
    meanReliability: number | null
    gaps: number
  }
  action: {
    action: AnalysisAction
    family: string | null
    score: number | null
    margin: number | null
    confident: boolean | null
    source: 'rule' | 'model' | 'user'
  }
  view: {
    category: string
    yawDeg: number | null
    reliability: number
    stability: number
    observability: Record<string, number>
  } | null
  event: {
    count: number
    partialCount: number
    signal: string | null
    neutral: number | null
    bottom: number | null
    amplitude: number | null
    holdSeconds?: number | null
  }
  finding: {
    produced: number
    official: number
    reference: number
    skippedRules: { ruleId: string; reason: string }[]
  }
  metrics: { count: number }
  analyzedRange: { startMs: number; endMs: number; source: string } | null
}

export interface EvidenceInput {
  action: AnalysisAction
  view: AnalysisView
  usableRatio: number
  meanReliability?: number | null
  gaps?: number
  viewEstimate: ViewEstimate | null
  count: number
  partialCount: number
  segmentation?: { signal: string; neutral: number; bottom: number; amplitude: number } | null
  holdSeconds?: number | null
  findings: MotionAnalysisFinding[]
  metrics: MotionAnalysisMetric[]
  skippedRules: { ruleId: string; reason: string }[]
  analyzedRange?: { startMs: number; endMs: number; source: string } | null
  actionConfidence?: { confident: boolean; score: number | null; margin: number | null; family: string | null; source: 'rule' | 'model' | 'user' } | null
}

/** 组装证据 JSON；所有字段都可缺失，绝不为"看起来完整"编造数值 */
export function buildMotionEvidence(input: EvidenceInput): MotionEvidencePayload {
  const official = input.findings.filter(finding => finding.level !== 'reference').length
  const reference = input.findings.filter(finding => finding.level === 'reference').length
  return {
    versions: {
      engine: MOTION_ENGINE_VERSION,
      feature: MOTION_FEATURE_VERSION,
      config: MOTION_CONFIG_VERSION,
      model: MOTION_MODEL_VERSION,
      rules: MOTION_RULES_VERSION
    },
    pose: {
      usableRatio: Math.round(input.usableRatio * 1000) / 1000,
      meanReliability: input.meanReliability === undefined || input.meanReliability === null
        ? null : Math.round(input.meanReliability * 1000) / 1000,
      gaps: input.gaps ?? 0
    },
    action: {
      action: input.action,
      family: input.actionConfidence?.family ?? null,
      score: input.actionConfidence?.score ?? null,
      margin: input.actionConfidence?.margin ?? null,
      confident: input.actionConfidence?.confident ?? null,
      source: input.actionConfidence?.source ?? 'user'
    },
    view: input.viewEstimate
      ? {
          category: input.viewEstimate.category,
          yawDeg: input.viewEstimate.yawDeg,
          reliability: input.viewEstimate.reliability,
          stability: input.viewEstimate.temporalStability,
          observability: input.viewEstimate.observability
        }
      : null,
    event: {
      count: input.count,
      partialCount: input.partialCount,
      signal: input.segmentation?.signal ?? null,
      neutral: input.segmentation?.neutral ?? null,
      bottom: input.segmentation?.bottom ?? null,
      amplitude: input.segmentation?.amplitude ?? null,
      ...(input.holdSeconds !== undefined && input.holdSeconds !== null ? { holdSeconds: input.holdSeconds } : {})
    },
    finding: {
      produced: input.findings.length,
      official,
      reference,
      skippedRules: input.skippedRules
    },
    metrics: { count: input.metrics.length },
    analyzedRange: input.analyzedRange ?? null
  }
}

/** 证据 JSON 用于持久化时限制体积（服务端 TEXT 列，避免异常数据撑爆同步包） */
export function compactEvidence(evidence: MotionEvidencePayload, limit = 6000): string {
  const text = JSON.stringify(evidence)
  if (text.length <= limit) return text
  const trimmed = JSON.stringify({
    ...evidence,
    compacted: true,
    finding: {
      ...evidence.finding,
      skippedRules: evidence.finding.skippedRules.slice(0, 3).map(item => ({
        ruleId: item.ruleId,
        reason: item.reason.slice(0, 80)
      }))
    }
  })
  if (trimmed.length <= limit) return trimmed
  // 仍然超限：保留最小可追溯字段（版本/姿态/区间），不为了塞满字段丢可信度信息
  return JSON.stringify({
    versions: evidence.versions,
    pose: evidence.pose,
    analyzedRange: evidence.analyzedRange,
    event: evidence.event,
    compacted: true
  })
}