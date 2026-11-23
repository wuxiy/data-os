import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useLocation } from '@tanstack/react-router'
import { ChevronRight, House, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { portalRoutes, routeForPath } from '../navigation'
import { usePortalNavigate } from '../navigate'
import { useAuth } from '../providers'
import { Kbd } from '../../components/kit/panel'
import { cn } from '../../lib/utils'

/**
 * 命令面板（⌘/Ctrl K）：按页面名搜索并跳转。
 * 打开状态与快捷键由壳持有；面板本身不抢输入框焦点（输入框内按快捷键不打开）。
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = usePortalNavigate()
  const location = useLocation()
  const { technicalAccess } = useAuth()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo(() => {
    return portalRoutes
      .filter((route) => {
        if (!route.path.startsWith('/') || route.pattern) return false
        if (route.key === 'operations' && !technicalAccess) return false
        return true
      })
      .map((route) => ({ key: route.key, label: route.label, path: route.path, icon: route.icon, group: route.group }))
  }, [technicalAccess])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(keyword) || command.group.toLowerCase().includes(keyword))
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Base UI 自动聚焦首个可聚焦元素；这里显式把焦点给输入框。
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function go(path: string) {
    onOpenChange(false)
    navigate(path)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-[#1a294531]" />
        <DialogPrimitive.Popup
          className="fixed top-[12vh] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-modal border border-line bg-paper shadow-panel outline-none"
          onKeyDown={(event) => {
            // 搜索框使用方向键与回车；其他控件保留原生键盘行为。
            if (event.target !== inputRef.current) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => (filtered.length ? (index - 1 + filtered.length) % filtered.length : 0))
            }
            if (event.key === 'Enter' && filtered[activeIndex]) {
              event.preventDefault()
              go(filtered[activeIndex].path)
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">跳转到工作区</DialogPrimitive.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={15} className="text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索页面名称…"
              aria-label="搜索页面"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 border-0 bg-transparent text-body-sm placeholder:text-faint"
            />
            <DialogPrimitive.Close
              render={<button type="button" aria-label="关闭命令面板" className="inline-flex size-7 items-center justify-center rounded-chip text-faint hover:bg-wash" />}
            >
              <X size={14} />
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-3">
            {filtered.length === 0 ? <p className="px-3 py-6 text-center text-label text-muted">没有匹配的页面</p> : null}
            {filtered.map((command, index) => {
              const Icon = command.icon
              const current = location.pathname === command.path
              return (
                <button
                  key={command.key}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => go(command.path)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-control px-3 py-2.5 text-left text-body-sm text-ink-soft',
                    index === activeIndex ? 'bg-blue-soft text-blue' : 'hover:bg-wash',
                  )}
                >
                  <Icon size={16} />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  <small className="text-meta text-muted">{current ? '当前页面' : command.group}</small>
                  <ChevronRight size={13} className="text-muted" />
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-meta text-muted">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>选择</span>
            <span className="flex items-center gap-1"><Kbd>Enter</Kbd>打开</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd>关闭</span>
            <span className="ml-auto flex items-center gap-1 text-muted"><House size={11} />{routeForPath(location.pathname)?.label ?? '工作区'}</span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** 打开命令面板的快捷键（⌘/Ctrl K）；输入框内不抢占。 */
export function useCommandHotkey(onOpen: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpen])
}
