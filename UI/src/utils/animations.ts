// ===== Animation Utilities =====

import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Number roll-up animation
 */
export function animateNumber(
  from: number,
  to: number,
  duration: number = 800,
  onUpdate: (value: number) => void
) {
  const startTime = Date.now()
  const diff = to - from

  function update() {
    const now = Date.now()
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1)

    // Easing function (ease-out cubic)
    const eased = 1 - Math.pow(1 - progress, 3)
    const current = from + diff * eased

    onUpdate(Math.round(current))

    if (progress < 1) {
      requestAnimationFrame(update)
    }
  }

  requestAnimationFrame(update)
}

/**
 * Stagger delay for multiple elements
 */
export function getStaggerDelay(index: number, baseDelay: number = 150): string {
  return `${index * baseDelay}ms`
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Composable for reduced motion detection
 */
export function useReducedMotion() {
  const reducedMotion = ref(prefersReducedMotion())

  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

  const handleChange = (e: MediaQueryListEvent) => {
    reducedMotion.value = e.matches
  }

  onMounted(() => {
    mediaQuery.addEventListener('change', handleChange)
  })

  onUnmounted(() => {
    mediaQuery.removeEventListener('change', handleChange)
  })

  return { reducedMotion }
}

/**
 * Get animation duration based on reduced motion preference
 */
export function getAnimationDuration(normalDuration: number): number {
  return prefersReducedMotion() ? 0 : normalDuration
}

/**
 * Intersection Observer for scroll animations
 */
export function useScrollAnimation(threshold: number = 0.1) {
  const observedElements = ref<Set<Element>>(new Set())
  let observer: IntersectionObserver | null = null

  const observe = (element: Element) => {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in-view')
            }
          })
        },
        { threshold }
      )
    }

    observer.observe(element)
    observedElements.value.add(element)
  }

  const unobserve = (element: Element) => {
    if (observer) {
      observer.unobserve(element)
      observedElements.value.delete(element)
    }
  }

  const cleanup = () => {
    if (observer) {
      observer.disconnect()
      observer = null
      observedElements.value.clear()
    }
  }

  onUnmounted(() => {
    cleanup()
  })

  return { observe, unobserve, cleanup }
}

/**
 * Create ripple effect
 */
export function createRipple(event: MouseEvent, element: HTMLElement) {
  if (prefersReducedMotion()) return

  const rect = element.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top

  const ripple = document.createElement('span')
  ripple.className = 'ripple'
  ripple.style.cssText = `
    position: absolute;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    pointer-events: none;
    left: ${x}px;
    top: ${y}px;
    transform: translate(-50%, -50%) scale(0);
    animation: ripple 600ms ease-out;
  `

  element.style.position = element.style.position || 'relative'
  element.style.overflow = 'hidden'
  element.appendChild(ripple)

  setTimeout(() => {
    ripple.remove()
  }, 600)
}
