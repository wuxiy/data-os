import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 主题语义字号与文字颜色同属 text-* 前缀；明确分类以免字号被颜色覆盖。
const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['meta', 'label', 'body-sm', 'body', 'title', 'subject', 'heading', 'metric'] }],
    },
  },
})

/**
 * 类名合并：clsx 负责条件拼接，tailwind-merge 负责同族工具类后写覆盖。
 * shadcn 组件源码统一从这里取 cn——registry 快照里的 `cn` 依赖不是可下载条目。
 */
export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(clsx(inputs))
}
