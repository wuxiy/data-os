import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Button } from '../../components/kit/button'
import { useNotice } from '../../components/kit/toast'
import { MpiReviewLive } from '../../pages/MpiReviewLive'
import { usePortalNavigate } from '../../app/navigate'

/**
 * 患者主索引入口：复核工作台保持常驻宽对照（不被压进弹窗），
 * 黄金人详情与拆分分别走 Sheet 与 AlertDialog（见 MpiReviewLive）。
 */
export function MpiReviewPage() {
  const notify = useNotice()
  const navigate = usePortalNavigate()
  return (
    <div>
      <Breadcrumb items={[{ label: '数据管理' }, { label: '患者主索引' }]} />
      <PageHeading
        title="患者主索引"
        description="逐条复核候选身份，弱证据冲突一律人工决策；决策即审计。"
        actions={<Button onClick={() => navigate('/assets')}>查看资产目录</Button>}
      />
      <MpiReviewLive onNotice={notify} />
    </div>
  )
}
