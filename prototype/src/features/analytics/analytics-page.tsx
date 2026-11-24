import { TableSkeleton } from '@/components/app/table-skeleton'
import { LoadingBlock } from '@/components/app/loading'
import { Badge } from '@/components/ui/badge'
import { FrameDescription, FrameHeader, FramePanel } from '@/components/ui/frame'
import { useQuery } from '@tanstack/react-query'
import { ChartNoAxesCombined, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { embedDashboard } from '@superset-ui/embedded-sdk'

import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/app/search-field'
import { Breadcrumb, PageHeading } from '../../components/app/page-heading'
import { EmptyState } from '@/components/app/empty-state'
import { TablePagination } from '../../components/table/data-table'
import { useNotice } from '@/components/app/notice'
import { fetchEmbeddableDashboards, fetchGuestToken, supersetEmbedOrigin } from '../../data/analyticsApi'
import { usePortalNavigate } from '../../app/navigate'

const PAGE_SIZE = 8

/**
 * 分析看板（嵌入式只读）：看板清单来自控制面，嵌入用一次性访客令牌，
 * 按仪表盘限权。切换看板或离开时清空挂载点，不保留会话内看板实例。
 * 引擎品牌不出现在业务文案（DESIGN.md 红线）。
 */
export function AnalyticsPage() {
  const notify = useNotice()
  const navigate = usePortalNavigate()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [embedReload, setEmbedReload] = useState(0)
  const [embedState, setEmbedState] = useState<'idle' | 'mounting' | 'mounted' | 'error'>('idle')
  const mountRef = useRef<HTMLDivElement | null>(null)

  const catalogRequest = useQuery({
    queryKey: ['analytics', 'dashboards'],
    queryFn: ({ signal }) => fetchEmbeddableDashboards(signal),
  })
  const dashboards = catalogRequest.data ?? []
  const selected = useMemo(() => dashboards.find((item) => item.id === selectedId) ?? dashboards[0] ?? null, [dashboards, selectedId])

  useEffect(() => {
    if (selected && !selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  useEffect(() => {
    if (!selected || !mountRef.current) return
    if (!selected.embeddedUuid) {
      setEmbedState('error')
      return
    }
    const mountPoint = mountRef.current
    setEmbedState('mounting')
    let cancelled = false
    embedDashboard({
      id: selected.embeddedUuid,
      supersetDomain: supersetEmbedOrigin,
      mountPoint,
      fetchGuestToken: async () => (await fetchGuestToken(selected.id)).token,
      dashboardUiConfig: { hideTitle: false, hideChartControls: true, hideTab: true },
    })
      .then(() => {
        if (!cancelled) setEmbedState('mounted')
      })
      .catch(() => {
        if (!cancelled) {
          setEmbedState('error')
          notify('分析仪表盘嵌入失败，请稍后重试')
        }
      })
    return () => {
      cancelled = true
      mountPoint.innerHTML = ''
    }
  }, [notify, selected, embedReload])

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return text ? dashboards.filter((item) => `${item.title}${item.id}`.toLowerCase().includes(text)) : dashboards
  }, [dashboards, keyword])
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)

  return (
    <div>
      <Breadcrumb items={[{ label: '数据应用' }, { label: '分析看板' }]} trailing={selected ? <span>只读嵌入 · 看板 {selected.id}</span> : null} />
      <PageHeading
        title="分析看板"
        description="业务人员在统一门户查看结果；访问范围以当前账号授权为准。"
        actions={
          <>
            <Button variant="outline" onClick={() => void catalogRequest.refetch()} disabled={catalogRequest.isFetching}><RefreshCw size={14} className={catalogRequest.isFetching ? 'animate-spin' : undefined} />刷新目录</Button>
            <Button variant="outline" onClick={() => setEmbedReload((value) => value + 1)} disabled={!selected || embedState === 'mounting'}>重新加载看板</Button>
          </>
        }
      />

      {catalogRequest.isPending ? <LoadingBlock>正在读取已授权看板…</LoadingBlock> : null}
      {catalogRequest.isError ? (
        <FramePanel className="p-0 overflow-clip">
          <EmptyState minHeight={240} icon={<ChartNoAxesCombined />} title="分析看板暂不可用" description="暂时无法读取看板目录。可重新读取；持续不可用时请联系平台运维核对服务连接。" action={<Button variant="outline" onClick={() => void catalogRequest.refetch()}>重新读取</Button>} />
        </FramePanel>
      ) : null}

      {catalogRequest.isSuccess && dashboards.length === 0 ? (
        <FramePanel className="p-0 overflow-clip">
          <EmptyState minHeight={240} icon={<ChartNoAxesCombined />} title="暂无已授权看板" description="当前账号没有可查看的已发布看板。请联系分析负责人核对发布与授权范围。" />
        </FramePanel>
      ) : null}

      {dashboards.length > 0 ? (
        <div className="grid grid-cols-[280px_minmax(0,1fr)_280px] gap-3.5 max-[1320px]:grid-cols-[260px_minmax(0,1fr)] max-[1100px]:grid-cols-1">
          <FramePanel className="flex flex-col p-0 overflow-clip">
            <FrameHeader className="px-[18px] pt-[18px] pb-3 gap-1">
              <div className="min-w-0">
                <h2 className="text-title font-semibold tracking-[-0.2px]">
                  已授权看板
                  {visible.length !== undefined ? <Badge variant="outline">{visible.length}</Badge> : null}
                </h2>
              </div>
            </FrameHeader>
            <div className="px-[18px] pb-2"><SearchField value={keyword} onValueChange={(value) => { setKeyword(value); setPage(0) }} placeholder="搜索看板名称" className="w-full" /></div>
            <ul className="m-0 min-h-0 flex-1 list-none px-2 pb-2">
              {visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((dashboard) => {
                const active = dashboard.id === selected?.id
                return (
                  <li key={dashboard.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setSelectedId(dashboard.id); setEmbedState('idle') }}
                      className={`mb-1 w-full rounded-control px-2.5 py-2 text-left ${active ? 'bg-blue-soft' : 'hover:bg-wash'}`}
                    >
                      <span className="block text-body-sm text-ink-soft">{dashboard.title}</span>
                      <span className="mt-0.5 block text-meta text-muted-foreground">只读视图 · 看板 {dashboard.id}</span>
                    </button>
                  </li>
                )
              })}
              {visible.length === 0 ? (
                <li className="px-3 py-6 text-center text-label text-muted-foreground">
                  没有匹配的看板。
                  {keyword ? <Button variant="link" size="sm" className="ml-1" onClick={() => { setKeyword(''); setPage(0) }}>清空搜索</Button> : null}
                </li>
              ) : null}
            </ul>
            <div className="border-t border-line px-2">
              <TablePagination compact page={currentPage} pageSize={PAGE_SIZE} total={visible.length} onPageChange={setPage} label="分析看板目录分页" className="border-t-0 px-1" />
            </div>
          </FramePanel>

          <FramePanel className="p-0 overflow-clip">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-chip bg-wash px-1.5 py-0.5 text-meta text-muted-foreground">只读嵌入 · 看板 {selected?.id}</span>
                  <Badge variant={embedState === 'mounted' ? 'success' : embedState === 'error' ? 'warning' : 'outline'}>{embedState === 'mounted' ? '已嵌入' : embedState === 'error' ? '嵌入失败' : '载入中'}</Badge>
                </div>
                <h2 className="mt-1.5 text-subject font-semibold text-ink">{selected?.title}</h2>
                <p className="mt-1 text-label text-muted-foreground">按当前账号授权查看；指标口径与来源可在资产目录中复核。</p>
              </div>
              <Badge variant="outline">只读</Badge>
            </div>

            {embedState === 'error' ? (
              <div className="px-5 py-3">
                <div role="status" className="rounded-control border border-[#eee2c5] bg-[#fdf9ef] px-3 py-2 text-label text-amber">
                  当前看板未能载入。可重新加载；持续失败时请联系平台运维核对访问配置。
                  <div className="mt-1.5"><Button variant="outline" size="sm" onClick={() => setEmbedReload((value) => value + 1)}>重新加载看板</Button></div>
                </div>
              </div>
            ) : null}
            {embedState === 'mounting' ? <div className="px-5 py-3"><TableSkeleton rows={4} /></div> : null}
            <div ref={mountRef} className="min-h-[520px] px-2 pb-3" aria-label="嵌入式分析仪表盘" data-embed-state={embedState} />
          </FramePanel>

          <FramePanel className="max-[1320px]:col-span-2 max-[1100px]:col-span-1 p-0 overflow-clip">
            <FrameHeader className="px-[18px] pt-[18px] pb-3 flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title font-semibold tracking-[-0.2px]">
                  访问证据
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">{<Badge variant="outline">受控只读</Badge>}</div>
            </FrameHeader>
            <div className="px-4 pb-4">
              <div className="mb-3 flex items-center gap-2 rounded-control border border-line bg-wash px-3 py-2">
                <span className="flex size-7 items-center justify-center rounded-chip bg-paper text-blue"><ShieldCheck size={15} /></span>
                <div>
                  <strong className="block text-label text-ink-soft">{selected?.title}</strong>
                  <span className="block text-meta text-muted-foreground">看板编号 {selected?.id}</span>
                </div>
              </div>
              <dl className="space-y-2 text-label">
                <div><dt className="text-meta text-muted-foreground">访问范围</dt><dd className="m-0 text-ink-soft">仅当前账号已授权的看板</dd></div>
                <div><dt className="text-meta text-muted-foreground">操作权限</dt><dd className="m-0 text-ink-soft">只读查看，不能在门户修改分析定义</dd></div>
                <div><dt className="text-meta text-muted-foreground">会话验证</dt><dd className="m-0 text-ink-soft">访问凭证短时有效，由平台自动续签</dd></div>
                <div><dt className="text-meta text-muted-foreground">加载状态</dt><dd className="m-0 text-ink-soft">{embedState === 'mounted' ? '已完成嵌入；数据结果以看板内刷新时间为准' : embedState === 'error' ? '加载失败，尚未确认数据结果' : '正在验证访问与加载看板'}</dd></div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <span className="text-meta text-muted-foreground">离开看板后嵌入实例释放</span>
                <Button variant="outline" size="sm" onClick={() => navigate('/assets')}>查看数据资产与血缘</Button>
              </div>
            </div>
          </FramePanel>
        </div>
      ) : null}
    </div>
  )
}
