import { Database, FileText, Inbox, Shield, User, X } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from '@/components/ui/drawer'

import type { GovernanceApiIssue } from '../../data/controlPlane'
import { formatDateTime } from '../../data/domain'

/**
 * 治理责任链：只呈现问题记录实际提供的关联字段。
 * 处置动作仍在质量问题工作台；缺失标识不从名称或其他字段推断。
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
    { icon: <Shield size={13} />, title: '质量问题', key: 'issueId', value: issue.id },
    { icon: <Database size={13} />, title: issue.objectLabel || '关联数据集', key: 'datasetId', value: issue.datasetId || '未提供' },
    { icon: <FileText size={13} />, title: '触发规则', key: 'ruleId', value: issue.ruleId || '未提供' },
    { icon: <User size={13} />, title: `${issue.ownerDepartment} · ${issue.ownerName}`, key: 'ownerId', value: issue.ownerId || '未提供' },
    { icon: <Inbox size={13} />, title: issue.ticketId ? '治理工单' : '尚未关联工单', key: 'ticketId', value: issue.ticketId || '未提供' },
  ] : []

  return (
    <Drawer open={open} onOpenChange={onOpenChange} position="right">
      <DrawerPopup className="max-w-[470px]" variant="straight" showCloseButton={false}>
        <DrawerClose className="absolute end-2 top-2 z-1" render={<Button size="icon" variant="ghost" aria-label="关闭" />}>
          <X />
        </DrawerClose>
        <DrawerHeader className="pr-14">
          <DrawerTitle>治理责任链</DrawerTitle>
          {issue ? <DrawerDescription>{`${issue.id} · 关联字段核对`}</DrawerDescription> : null}
        </DrawerHeader>
        <DrawerPanel>
          <Alert variant="info" role="note">
            <Shield />
            <AlertDescription>以下字段来自治理问题记录；数据集编号不等同于资产编号，未提供的标识不作推断。</AlertDescription>
          </Alert>
          <p className="mt-3 text-label text-muted-foreground">问题记录更新于 {updatedAt ? formatDateTime(updatedAt) : '未提供'}</p>
          <ol className="mt-4 ml-2 list-none border-l border-line-strong p-0">
            {nodes.map((node, index) => (
              <li key={node.key + index} className="relative pb-5 pl-7 last:pb-0">
                <span className="absolute top-0 -left-[13px] flex size-[26px] items-center justify-center rounded-chip border border-[#dee6f3] bg-[#f5f8fd] text-blue">{node.icon}</span>
                <strong className="block text-body-sm font-medium text-ink-soft">{node.title}</strong>
                <small className="mt-0.5 block break-all font-mono text-label text-muted-foreground">{node.key}: {node.value}</small>
              </li>
            ))}
          </ol>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  )
}
