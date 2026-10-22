import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Surface.module.css'

/** 双层工作面：外托盘承载空间层级，内芯保留原有业务布局。 */
export function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!element || preference.matches) return
    let animation: Animation | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      animation = element.animate([
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 800, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
      observer.disconnect()
    }, { threshold: 0.06 })
    const reduceMotion = () => { if (preference.matches) { observer.disconnect(); animation?.cancel() } }
    observer.observe(element)
    preference.addEventListener('change', reduceMotion)
    return () => { observer.disconnect(); animation?.cancel(); preference.removeEventListener('change', reduceMotion) }
  }, [])

  return <div ref={ref} className={`${styles.frame} ${className}`} data-surface="">{children}</div>
}
