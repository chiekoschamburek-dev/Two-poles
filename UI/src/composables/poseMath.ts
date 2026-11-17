// 姿态几何与帧时序的纯函数：不碰 DOM，可在 selfcheck 里直接断言。
// 这里是实时跟练与离线分析唯一的几何接缝：关节索引、算角、可见度、选侧都在这一份实现里。
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/** 只要求 x/y，NormalizedLandmark 与 motionAnalysis 的 MotionPoint 都能直接传进来 */
export interface GeometryPoint {
  x: number
  y: number
}

export type PoseMetrics = {
  kneeAngle: number | null
  hipAngle: number | null
  elbowAngle: number | null
  visibility: number
  kneeVisibility: number
  elbowVisibility: number
  hipVisibility: number
  kneeSide: 'left' | 'right' | null
  elbowSide: 'left' | 'right' | null
  hipSide: 'left' | 'right' | null
}

/** 12 关节并集：实时原本缺 heel/toe，离线原本缺 elbow/wrist */
export const LANDMARK_INDEX = {
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 },
  toe: { left: 31, right: 32 }
} as const

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 }
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }

/**
 * 帧级可见度口径：8 个双侧核心点均值，缺失按 0。
 * 缺失关键点不是「可见」的证据；此前实时侧取 6 个左侧点且缺失默认 1，
 * 同一个 0.5 门槛在两条路径上含义不同。统一到离线口径。
 * 注意：喂给状态机的是构成角的三点最小值（jointScore），不是这个帧级均值，
 * 所以本次统一不改变任何一侧的计数，只移动实时的置信度徽章与均值统计。
 */
export const CORE_VISIBILITY_INDICES = [11, 12, 23, 24, 25, 26, 27, 28]

export function clampVisibility(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0
}

export function frameVisibility(landmarks: NormalizedLandmark[]): number {
  return CORE_VISIBILITY_INDICES.reduce((sum, index) => sum + clampVisibility(landmarks[index]?.visibility), 0)
    / CORE_VISIBILITY_INDICES.length
}

export const EMPTY_POSE_METRICS: PoseMetrics = {
  kneeAngle: null, hipAngle: null, elbowAngle: null, visibility: 0,
  kneeVisibility: 0, elbowVisibility: 0, hipVisibility: 0,
  kneeSide: null, elbowSide: null, hipSide: null
}

export function angleAt(a: GeometryPoint, vertex: GeometryPoint, b: GeometryPoint): number | null {
  if (![a.x, a.y, vertex.x, vertex.y, b.x, b.y].every(Number.isFinite)) return null
  const v1x = a.x - vertex.x
  const v1y = a.y - vertex.y
  const v2x = b.x - vertex.x
  const v2y = b.y - vertex.y
  const magnitude = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (!magnitude) return null
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / magnitude))
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

/** 构成角的 3 点可见度最小值：喂状态机的可见度口径 */
export function jointVisibility(points: (GeometryPoint & { visibility?: number })[]): number {
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return 0
  return Math.min(...points.map(point => clampVisibility(point.visibility)))
}

/**
 * 选侧口径：用**顶点关节**自身的可见度（膝角看膝、髋角看髋），与离线原实现一致。
 * 曾试过用「三点最小值」选侧，实测会让 sit-to-stand、peso-muerto-sumo、test_squat
 * 的计数从 1/2/4 掉到 0 —— 椅子/杠铃遮挡使三点最小值在左右两侧剧烈翻转。
 * 统一是统一到既有离线语义，不是统一到新语义，这样才能保证真实素材计数不变。
 */
export function jointScore(vertex: GeometryPoint & { visibility?: number }): number {
  if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return 0
  return clampVisibility(vertex.visibility)
}

export function computeMetrics(landmarks: NormalizedLandmark[]): PoseMetrics {
  if (landmarks.length < 28) {
    return { ...EMPTY_POSE_METRICS }
  }
  const visibility = frameVisibility(landmarks)
  const joint = (left: number[], right: number[]) => {
    const read = (indices: number[], side: 'left' | 'right') => {
      const points = indices.map(i => landmarks[i])
      const angle = points.every(Boolean) ? angleAt(points[0], points[1], points[2]) : null
      // 选侧看顶点（indices[1]），对外可见度仍取三点最小值
      const score = angle === null ? 0 : jointScore(points[1])
      const visibility = angle === null ? 0 : jointVisibility(points)
      return { angle, visibility, side, score }
    }
    const l = read(left, 'left')
    const r = read(right, 'right')
    return r.score > l.score ? r : l
  }
  const knee = joint([LEFT.hip, LEFT.knee, LEFT.ankle], [RIGHT.hip, RIGHT.knee, RIGHT.ankle])
  const elbow = joint([LEFT.shoulder, LEFT.elbow, LEFT.wrist], [RIGHT.shoulder, RIGHT.elbow, RIGHT.wrist])
  const hip = joint([LEFT.shoulder, LEFT.hip, LEFT.knee], [RIGHT.shoulder, RIGHT.hip, RIGHT.knee])
  return {
    visibility,
    kneeAngle: knee.angle,
    hipAngle: hip.angle,
    elbowAngle: elbow.angle,
    kneeVisibility: knee.visibility,
    elbowVisibility: elbow.visibility,
    hipVisibility: hip.visibility,
    kneeSide: knee.angle === null ? null : knee.side,
    elbowSide: elbow.angle === null ? null : elbow.side,
    hipSide: hip.angle === null ? null : hip.side
  }
}

/**
 * detectForVideo 要求时间戳严格递增。这里用媒体时间（帧自己的时间戳）而不是墙钟：
 * rAF 抖动、后台标签页与掉帧都不会再污染相邻两帧的间隔。
 * 返回 null 表示这一帧没有更新（重复帧或时钟倒退），应当跳过而不是硬塞一个相等的时间戳。
 */
export function nextTimestamp(mediaTimeMs: number, lastTs: number): number | null {
  if (!Number.isFinite(mediaTimeMs) || mediaTimeMs <= 0) return null
  // MediaPipe 会把毫秒转换成整数微秒；浮点数虽递增，转换后仍可能是同一个时间戳。
  // 视频帧不需要亚毫秒精度，统一到整数毫秒，重复帧直接跳过。
  const timestamp = Math.floor(mediaTimeMs)
  return timestamp > lastTs ? timestamp : null
}
