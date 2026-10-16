import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Mode, UserProfile, Toast, TrainingSession, SessionFeedback } from '@/types/domain'
import { newId } from '@/utils/id'

export const useAppStore = defineStore('app', () => {
  // === State ===
  const currentMode = ref<Mode>('public')
  const userProfile = ref<UserProfile | null>(null)
  const sessions = ref<TrainingSession[]>([])
  const toasts = ref<Toast[]>([])
  const initialized = ref(false)

  // === Computed ===
  const isPublicMode = computed(() => currentMode.value === 'public')
  const isAthleteMode = computed(() => currentMode.value === 'athlete')
  const hasProfile = computed(() => !!userProfile.value)

  // === Actions ===

  /**
   * Initialize app from localStorage
   */
  function init() {
    const stored = localStorage.getItem('twopoles_state')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        currentMode.value = data.mode || 'public'
        userProfile.value = data.profile || null
        sessions.value = Array.isArray(data.sessions) ? data.sessions : []
      } catch (error) {
        console.error('Failed to load state from localStorage:', error)
      }
    }
    initialized.value = true
  }

  /**
   * Save state to localStorage
   */
  function persistState() {
    const state = {
      mode: currentMode.value,
      profile: userProfile.value,
      sessions: sessions.value
    }
    localStorage.setItem('twopoles_state', JSON.stringify(state))
  }

  /**
   * Switch mode with confirmation
   */
  function switchMode(newMode: Mode) {
    const oldMode = currentMode.value
    currentMode.value = newMode

    if (userProfile.value) {
      userProfile.value.mode = newMode
      userProfile.value.modeChangedAt = new Date().toISOString()
    }

    persistState()

    showToast({
      type: 'success',
      title: `已切换到${newMode === 'public' ? '大众' : '运动员'}模式`,
      message: `从${oldMode === 'public' ? '大众' : '运动员'}模式切换成功`,
      duration: 3000
    })
  }

  /**
   * Update user profile
   */
  function updateProfile(profile: Partial<UserProfile>) {
    if (userProfile.value) {
      userProfile.value = { ...userProfile.value, ...profile }
    } else {
      userProfile.value = {
        id: newId(),
        mode: currentMode.value,
        modeChangedAt: new Date().toISOString(),
        age: 25,
        goal: '',
        experience: '',
        availableTimes: [],
        equipment: [],
        restrictions: [],
        ...profile
      } as UserProfile
    }
    persistState()
  }

  /**
   * Show toast notification
   */
  function showToast(toast: Omit<Toast, 'id' | 'dismissible'>) {
    const id = newId()
    const newToast: Toast = {
      id,
      dismissible: true,
      duration: 5000,
      ...toast
    }

    toasts.value.push(newToast)

    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        dismissToast(id)
      }, newToast.duration)
    }
  }

  /**
   * Dismiss toast
   */
  function dismissToast(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  /**
   * Record a finished training session
   */
  function addSession(input: Omit<TrainingSession, 'id' | 'userId' | 'createdAt'>): TrainingSession {
    const session: TrainingSession = {
      ...input,
      id: newId(),
      userId: userProfile.value?.id || 'demo-user',
      createdAt: new Date().toISOString()
    }
    sessions.value.push(session)
    persistState()
    showToast({
      type: 'success',
      title: '训练已记录',
      message: `${session.exerciseName} · ${session.actualReps ?? 0} 次 · ${session.completionStatus === 'completed' ? '全部完成' : '部分完成'}`,
      duration: 4000
    })
    return session
  }

  /**
   * Attach the post-session feedback (RPE, discomfort, reason, notes)
   */
  function applyFeedback(sessionId: string, feedback: SessionFeedback) {
    const session = sessions.value.find(s => s.id === sessionId)
    if (!session) return
    session.rpe = feedback.rpe
    session.discomfort = feedback.discomfort
    session.completionReason = feedback.reason
    session.notes = feedback.notes
    if (feedback.duration !== undefined) session.actualDuration = feedback.duration
    if (feedback.distance !== undefined) session.actualDistance = feedback.distance
    persistState()
    showToast({
      type: 'success',
      title: '训练反馈已保存',
      message: feedback.rpe === null
        ? 'RPE 记为"未记录"，不参与负荷计算'
        : `RPE ${feedback.rpe} · 本次负荷约 ${Math.round((session.actualDuration ?? 0) * feedback.rpe)}`,
      duration: 3000
    })
  }

  /**
   * Clear all data
   */
  function clearAllData() {
    currentMode.value = 'public'
    userProfile.value = null
    sessions.value = []
    localStorage.removeItem('twopoles_state')
    showToast({
      type: 'success',
      title: '数据已清除',
      message: '所有本地数据已删除',
      duration: 3000
    })
  }

  return {
    // State
    currentMode,
    userProfile,
    sessions,
    toasts,
    initialized,

    // Computed
    isPublicMode,
    isAthleteMode,
    hasProfile,

    // Actions
    init,
    persistState,
    switchMode,
    updateProfile,
    showToast,
    dismissToast,
    addSession,
    applyFeedback,
    clearAllData
  }
})
