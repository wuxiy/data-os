import { ArrowRight, FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, StatusTag } from './Primitives'
import { frontendDemoMode } from '../../data/runtime'
import styles from './DemoDataBoundary.module.css'

interface Props {
  moduleName: string
  children: ReactNode
  onNavigate?: (route: 'ingestion' | 'governance' | 'quality') => void
}

/**
 * Keeps static concept data useful for a deliberate demo while making the
 * production boundary explicit.  In live mode we do not render stale sample
 * rows at all; the user gets a path to the already-connected workspaces.
 */
export function DemoDataBoundary({ moduleName, children, onNavigate }: Props) {
  if (frontendDemoMode) {
    return <div className={styles.demoFrame} data-data-mode="demo"><div className={styles.demoRibbon}><FlaskConical size={14} /><StatusTag tone="warning">演示模式</StatusTag><span>{moduleName}使用脱敏/合成数据，仅用于交互验收；保存、确认和生成只改变演示状态，不写入控制面</span></div>{children}</div>
  }

  return (
    <section className={styles.liveBoundary} data-data-mode="live" role="status">
      <div className={styles.boundaryIcon}><FlaskConical size={20} /></div>
      <div className={styles.boundaryCopy}>
        <StatusTag>待接入真实服务</StatusTag>
        <h2>{moduleName}暂未接入真实数据服务</h2>
        <p>为避免把演示数据误认为生产结果，本构建不会展示静态样例。接入对应 BFF/Adapter 后即可启用；当前已落地的数据接入和治理问题闭环仍可直接使用。</p>
        {onNavigate ? <div className={styles.boundaryActions}>
          <Button onClick={() => onNavigate('ingestion')}>进入数据接入 <ArrowRight size={14} /></Button>
          <Button variant="quiet" onClick={() => onNavigate('governance')}>查看治理驾驶舱</Button>
          <Button variant="quiet" onClick={() => onNavigate('quality')}>进入质量闭环</Button>
        </div> : null}
      </div>
    </section>
  )
}
