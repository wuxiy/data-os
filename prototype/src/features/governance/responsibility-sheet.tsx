import { Database, FileText, Inbox, Shield, User } from 'lucide-react'
import { Sheet, SheetBody } from '../../components/ui/overlay'
import { InlineNotice } from '../../components/ui/panel'
import { formatDateTime } from '../../data/domain'
import type { GovernanceApiIssue } from '../../data/controlPlane'

/**
 * 治理责任链（Sheet，420–610px）：五类对象通过稳定编号关联。
 * 只读核对面，承载证据与来源；处置动作仍在质量问题工作台。
 */
export function ResponsibilitySheet({
  issue,
  open,
  onOpenChange,
  updatedAt,
}: {
  issue: GovernanceApiIssue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  updatedAt?: string | null
}) {
  const nodes = issue ? [
    { icon: <Shield size={13} />, title: '质量事件', key: 'issueId', value: issue.id, source: '质量检查服务' },
    { icon: <Database size={13} />, title: issue.objectLabel || issue.datasetId, key: 'assetId', value: issue.datasetId, source: '数据资产目录' },
    { icon: <FileText size={13} />, title: '触发规则', key: 'ruleId', value: issue.ruleId, source: '质量规则库' },
    { icon: <User size={13} />, title: `${issue.ownerDepartment} · ${issue.ownerName}`, key: 'ownerId', value: `${issue.ownerDepartment}/${issue.ownerName}`, source: '组织与权限目录' },
    { icon: <Inbox size={13} />, title: issue.ticketId ? '治理工单' : '尚未关联工单', key: 'ticketId', value: issue.ticketId || '—', source: '治理工单' },
  ] : []

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="治理责任链"
      subtitle={issue ? `${issue.id} · 五类对象与来源` : undefined}
      width={470}
    >
      <SheetBody>
        <InlineNotice icon={<Shield />}>五类对象通过稳定编号关联；来源与时间随节点展示，不把技术引擎名带进业务视图。</InlineNotice>
        <ol className="mt-4 ml-2 border-l border-[#e1e7ef] p-0 pl-0">
          {nodes.map((node, index) => (
            <li key={node.key + index} className="relative pb-5 pl-7 last:pb-0">
              <span className="absolute top-0 -left-[13px] flex size-[26px] items-center justify-center rounded-chip border border-[#dee6f3] bg-[#f5f8fd] text-[#6a86b1]">{node.icon}</span>
              <strong className="block text-body-sm font-medium text-[#536279]">{node.title}</strong>
              <small className="mt-0.5 block font-mono text-meta text-[#7188a8]">{node.key}: {node.value}</small>
              <small className="mt-0.5 block text-meta text-[#8a95a4]">来源：{node.source}{updatedAt ? ` · ${formatDateTime(updatedAt)}` : ''}</small>
            </li>
          ))}
        </ol>
      </SheetBody>
    </Sheet>
  )
}
