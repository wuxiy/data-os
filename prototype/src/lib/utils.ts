import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 类名合并：clsx 负责条件拼接，tailwind-merge 负责同族工具类后写覆盖。
 * shadcn 组件源码统一从这里取 cn——registry 快照里的 `cn` 依赖不是可下载条目。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
