import { useEffect } from 'react'

/**
 * 打开命令面板的快捷键（⌘/Ctrl K）；输入框内不抢占。
 * 单独成模块：壳只为监听快捷键而引用它，不必因此把命令面板本体（及其依赖）带进首屏。
 */
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
