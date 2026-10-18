// 姿态几何与帧时序的纯函数：不碰 DOM，可在 selfcheck 里直接断言。
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type PoseMetrics = {
  kneeAngle: number | null
  hipAngle: number | null
  elbowAngle: number | null
  visibility: number
}

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }

export function angleAt(a: NormalizedLandmark, vertex: NormalizedLandmark, b: NormalizedLandmark): number | null {
  const v1x = a.x - vertex.x
  const v1y = a.y - vertex.y
  const v2x = b.x - vertex.x
  const v2y = b.y - vertex.y
  const magnitude = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!magnitude) return null
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / magnitude))
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

export function computeMetrics(landmarks: NormalizedLandmark[]): PoseMetrics {
  if (landmarks.length < 28) {
    return { kneeAngle: null, hipAngle: null, elbowAngle: null, visibility: 0 }
  }
  // 只取参与算角的 6 个关键点求均值：按 11..27 整段取会得到 17 个点，可见度会超过 1
  const joints = [LEFT.shoulder, LEFT.elbow, LEFT.wrist, LEFT.hip, LEFT.knee, LEFT.ankle]
  const visibility = joints.reduce((sum, i) => sum + (landmarks[i]?.visibility ?? 1), 0) / joints.length
  return {
    visibility,
    kneeAngle: angleAt(landmarks[LEFT.hip], landmarks[LEFT.knee], landmarks[LEFT.ankle]),
    hipAngle: angleAt(landmarks[LEFT.shoulder], landmarks[LEFT.hip], landmarks[LEFT.knee]),
    elbowAngle: angleAt(landmarks[LEFT.shoulder], landmarks[LEFT.elbow], landmarks[LEFT.wrist])
  }
}

/**
 * detectForVideo 要求时间戳严格递增。这里用媒体时间（帧自己的时间戳）而不是墙钟：
 * rAF 抖动、后台标签页与掉帧都不会再污染相邻两帧的间隔。
 * 返回 null 表示这一帧没有更新（重复帧或时钟倒退），应当跳过而不是硬塞一个相等的时间戳。
 */
export function nextTimestamp(mediaTimeMs: number, lastTs: number): number | null {
  if (!Number.isFinite(mediaTimeMs) || mediaTimeMs <= 0) return null
  return mediaTimeMs > lastTs ? mediaTimeMs : null
}
