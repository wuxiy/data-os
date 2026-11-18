import { LogIn, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AuthSnapshot } from '../../data/oidc'
import { startOidcLogin } from '../../data/oidc'
import { Button } from '../ui/button'
import { LoadingBlock } from '../ui/states'

/** 登录门（新主题）：未认证会话在进入任何工作区前阻断。 */
export function OidcLoginGate({ snapshot }: { snapshot: AuthSnapshot }) {
  const [busy, setBusy] = useState(false)

  async function login() {
    setBusy(true)
    try {
      await startOidcLogin()
    } catch (error) {
      setBusy(false)
      window.dispatchEvent(new CustomEvent('dataos:oidc-error', {
        detail: error instanceof Error ? error.message : 'OIDC 登录失败',
      }))
    }
  }

  if (snapshot.status === 'loading') {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas px-6">
        <section className="w-full max-w-[420px] rounded-panel border border-line bg-paper px-8 py-10 text-center shadow-panel">
          <ShieldCheck className="mx-auto mb-3 size-7 text-blue" />
          <LoadingBlock className="min-h-0">正在连接统一身份认证…</LoadingBlock>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6">
      <section aria-labelledby="oidc-title" className="w-full max-w-[420px] rounded-panel border border-line bg-paper px-8 py-9 shadow-panel">
        <div className="mb-4 inline-flex rounded-panel border border-blue-line bg-blue-soft p-3 text-blue">
          <ShieldCheck size={26} />
        </div>
        <p className="mb-1.5 text-label text-muted">医数中枢 · Data OS</p>
        <h1 id="oidc-title" className="mb-2.5 text-heading font-semibold tracking-[-0.5px]">登录数据运营平台</h1>
        <p className="mb-5 text-body-sm leading-relaxed text-muted">
          请使用医院或区域平台统一身份认证登录。平台会根据您的组织和角色加载可用数据范围。
        </p>
        {snapshot.error ? <p role="alert" className="mb-4 rounded-control border border-red-line bg-red-soft px-3 py-2 text-label text-red">{snapshot.error}</p> : null}
        <Button variant="primary" className="w-full" onClick={login} disabled={busy}>
          <LogIn size={16} />
          {busy ? '正在跳转…' : '使用统一身份认证登录'}
        </Button>
        <p className="mt-3.5 text-meta leading-relaxed text-muted">登录令牌仅保存在当前浏览器会话，退出页面后自动失效。</p>
      </section>
    </main>
  )
}
