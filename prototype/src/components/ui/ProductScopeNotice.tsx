import styles from './ProductScopeNotice.module.css'

/**
 * Keeps the first release promise visible at the point of use.  Pages outside
 * the connected vertical are still useful as design references, but must not
 * look like live business workspaces.
 */
export function ProductScopeNotice() {
  return (
    <aside className={styles.notice} role="note" aria-label="首期产品范围">
      <span className={styles.label}>首期真实范围</span>
      <p>
        数据接入、采集运行、治理问题、质量复检和通知已接入控制面；数据标准、标准映射、MPI、资产、分析、问数、数据服务和交付中心仍为规划/待接入模块，生产模式不会把保存、确认或生成提示当作真实业务副作用。
      </p>
    </aside>
  )
}
