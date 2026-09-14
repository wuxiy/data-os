import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RouteKey } from '../../types'
import styles from './CommandPalette.module.css'

export interface PaletteCommand {
  label: string
  hint?: string
  route: RouteKey
}

interface CommandPaletteProps {
  commands: PaletteCommand[]
  open: boolean
  onClose: () => void
  onNavigate: (route: RouteKey) => void
}

/**
 * 全局命令面板（⌘K / Ctrl+K）：键盘优先的路由导航。
 * 焦点圈定复用抽屉原语的语义（Esc 关闭、Tab 循环、关闭后焦点还原）。
 */
export function CommandPalette({ commands, open, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const restoreRef = useRef<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const matches = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter((command) => `${command.label}${command.hint ?? ''}`.toLowerCase().includes(keyword))
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActiveIndex(0)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      restoreRef.current?.focus({ preventScroll: true })
      restoreRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((current) => (matches.length ? (current + 1) % matches.length : 0))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => (matches.length ? (current - 1 + matches.length) % matches.length : 0))
        return
      }
      if (event.key === 'Enter') {
        const target = matches[activeIndex]
        if (target) {
          event.preventDefault()
          onNavigate(target.route)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, matches, activeIndex, onClose, onNavigate])

  if (!open) return null

  let list: ReactNode = null
  if (matches.length === 0) {
    list = <p className={styles.paletteEmpty}>没有匹配的页面，换个关键词试试。</p>
  } else {
    list = (
      <ul className={styles.paletteList} role="listbox" aria-label="页面导航结果">
        {matches.map((command, index) => (
          <li key={command.route}>
            <button
              role="option"
              aria-selected={index === activeIndex}
              className={`${styles.paletteItem} ${index === activeIndex ? styles.paletteItemActive : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { onNavigate(command.route); onClose() }}
            >
              <span>{command.label}</span>
              {command.hint ? <small>{command.hint}</small> : null}
              {index === activeIndex ? <CornerDownLeft size={13} aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <button className={styles.paletteBackdrop} aria-label="关闭命令面板" onClick={onClose} />
      <div className={styles.palettePanel} role="dialog" aria-modal="true" aria-label="全局导航">
        <div className={styles.paletteSearchRow}>
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
            placeholder="跳转到页面…（↑↓ 选择，Enter 打开）"
            aria-label="搜索页面"
            className={styles.paletteInput}
          />
          <kbd className={styles.paletteKbd}>Esc</kbd>
        </div>
        {list}
      </div>
    </>
  )
}
