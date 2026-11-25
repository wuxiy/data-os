import { useLocation } from '@tanstack/react-router'
import { House, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { DialogTitle } from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'

import { usePortalNavigate } from '../navigate'
import { portalRoutes, routeForPath } from '../navigation'
import { useAuth } from '../providers'

type PageCommand = { key: string; label: string; path: string; icon: LucideIcon; group: string }

/**
 * 命令面板（⌘/Ctrl K）：按页面名搜索并跳转（coss Command，蓝本 p-command-1）。
 * 打开状态与快捷键由壳持有；面板本身不抢输入框焦点（输入框内按快捷键不打开）。
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = usePortalNavigate()
  const location = useLocation()
  const { technicalAccess } = useAuth()

  const commands = useMemo<PageCommand[]>(() => {
    return portalRoutes
      .filter((route) => {
        if (!route.path.startsWith('/') || route.pattern) return false
        if (route.key === 'operations' && !technicalAccess) return false
        return true
      })
      .map((route) => ({ key: route.key, label: route.label, path: route.path, icon: route.icon, group: route.group }))
  }, [technicalAccess])

  function go(path: string) {
    onOpenChange(false)
    navigate(path)
  }

  // 页面名或所属分组命中即算匹配。
  const matches = (command: PageCommand, keyword: string) => {
    const normalized = keyword.trim().toLowerCase()
    return command.label.toLowerCase().includes(normalized) || command.group.toLowerCase().includes(normalized)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <DialogTitle className="sr-only">跳转到工作区</DialogTitle>
        <Command
          items={commands}
          // coss Command 不带泛型：条目以 unknown 传入，这里按 PageCommand 收窄（列表只来自 commands）。
          itemToStringValue={(item) => (item as PageCommand).label}
          filter={(item, keyword: string) => matches(item as PageCommand, keyword)}
          onValueChange={(label) => {
            const command = commands.find((item) => item.label === label)
            if (command) go(command.path)
          }}
        >
          <CommandInput placeholder="搜索页面名称…" aria-label="搜索页面" autoComplete="off" />
          <CommandEmpty>没有匹配的页面</CommandEmpty>
          <CommandList>
            {(item) => {
              const command = item as PageCommand
              const Icon = command.icon
              const current = location.pathname === command.path
              return (
                <CommandItem key={command.key} value={command} className="gap-2.5" onClick={() => go(command.path)}>
                  <Icon />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  <CommandShortcut>{current ? '当前页面' : command.group}</CommandShortcut>
                </CommandItem>
              )
            }}
          </CommandList>
          <CommandFooter className="text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2"><KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup>选择</span>
              <span className="flex items-center gap-2"><Kbd>Enter</Kbd>打开</span>
              <span className="flex items-center gap-2"><Kbd>Esc</Kbd>关闭</span>
            </div>
            <span className="ml-auto flex items-center gap-1"><House className="size-3" />{routeForPath(location.pathname)?.label ?? '工作区'}</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
