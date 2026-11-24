import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { Button } from '@/components/ui/button'
import { useNotice } from '@/components/app/notice'
import { AssistantLive } from '../../pages/AssistantLive'
import { useAuth } from '../../app/providers'
import { usePortalNavigate } from '../../app/navigate'

/**
 * 智能问数入口：`/assistant` 为受控问数面，`/assistant/workspace` 为专业工作区
 * （治理角色才出现问题治理区块；写操作仍由控制面逐端点强制）。
 */
export function AssistantPage({ professional = false }: { professional?: boolean }) {
  const notify = useNotice()
  const navigate = usePortalNavigate()
  const { assistantGovernance } = useAuth()

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '智能问数' }, ...(professional ? [{ label: '专业工作区' }] : [])]} />
      <PageHeading
        title={professional ? '专业问数工作区' : '智能问数'}
        description={professional
          ? '面向数据分析人员：已验证问题 · 受控执行 · 查询证据可复核。'
          : '已验证问题 · 受控执行 · 可复核证据。'}
        actions={
          professional
            ? <Button variant="outline" onClick={() => navigate('/assistant')}>返回问数面</Button>
            : assistantGovernance
              ? <Button variant="outline" onClick={() => navigate('/assistant/workspace')}>专业工作区</Button>
              : null
        }
      />
      <AssistantLive onNotice={notify} professional={professional} governance={professional && assistantGovernance} />
    </div>
  )
}
