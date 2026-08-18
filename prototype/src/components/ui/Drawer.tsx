import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
// 抽屉样式与各页面共用 Pages.module.css；CSS Modules 按文件哈希类名，
// 跨文件引用同一份即可保持样式一处维护。
import styles from '../../pages/Pages.module.css'

interface DrawerProps {
  titleId: string
  eyebrow?: ReactNode
  title: ReactNode
  /** 背景遮罩按钮的可访问名称（如「关闭任务配置」）。 */
  closeLabel: string
  closeIcon?: ReactNode
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}

/**
 * 右侧责任链抽屉原语：背景遮罩、Esc 关闭、Tab 焦点圈定、滚动锁定与
 * 关闭后焦点还原。原先三处抽屉在页面内各自内联这整套行为。
 */
export function Drawer({ titleId, eyebrow, title, closeLabel, closeIcon, onClose, footer, children }: DrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      const drawer = drawerRef.current
      if (!drawer) return
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus({ preventScroll: true })
      restoreFocusRef.current = null
    }
  }, [])

  return <>
    <button className={styles.drawerBackdrop} aria-label={closeLabel} onClick={onClose} />
    <aside ref={drawerRef} className={styles.sideDrawer} role="dialog" aria-labelledby={titleId} aria-modal="true">
      <div className={styles.drawerHeader}><div>{eyebrow ? <span className={styles.drawerEyebrow}>{eyebrow}</span> : null}<h2 id={titleId}>{title}</h2></div><button autoFocus className={styles.iconButton} aria-label="关闭" onClick={onClose}>{closeIcon ?? <X size={17} />}</button></div>
      <div className={styles.drawerBody}>{children}</div>
      {footer ? <div className={styles.drawerFooter}>{footer}</div> : null}
    </aside>
  </>
}
