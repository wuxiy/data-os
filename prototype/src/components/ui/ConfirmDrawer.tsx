import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Drawer } from './Drawer'
import styles from '../../pages/Pages.module.css'

interface Props {
  titleId: string
  eyebrow: string
  title: string
  body: ReactNode
  confirmLabel: string
  /** 破坏性操作时为 danger 文案色。 */
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * 确认抽屉（2026-10-05 复评 P1）：不可逆/批量动作的统一确认面。
 * 门户裁决「弹窗=抽屉」，复用 Pages.module.css 抽屉表单体系。
 */
export function ConfirmDrawer({ titleId, eyebrow, title, body, confirmLabel, danger = false, busy = false, onConfirm, onClose }: Props) {
  return (
    <Drawer
      titleId={titleId}
      eyebrow={eyebrow}
      title={title}
      closeLabel={`关闭${title}确认`}
      onClose={onClose}
      footer={<>
        <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>取消</button>
        <button className={`${styles.primaryButton} ${danger ? styles.dangerButton : ''}`} type="button" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </>}
    >
      <div className={`${styles.drawerNotice} ${danger ? styles.drawerNoticeDanger : ''}`}>
        <AlertTriangle size={16} />
        <div>{body}</div>
      </div>
    </Drawer>
  )
}
