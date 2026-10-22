import type { ReactNode } from 'react'
import styles from './ActionIcon.module.css'

/** 文本动作的尾部图标岛，不改变按钮名称与点击区域。 */
export function ActionIcon({ children }: { children: ReactNode }) {
  return <span className={styles.island} aria-hidden="true">{children}</span>
}
