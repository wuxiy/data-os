import { LogIn, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AuthSnapshot } from '../../data/oidc'
import { startOidcLogin } from '../../data/oidc'
import styles from './OidcLoginGate.module.css'

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
    return <main className={styles.page}><section className={styles.card}><ShieldCheck size={28} /><p>正在连接统一身份认证…</p></section></main>
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="oidc-title">
        <div className={styles.brandMark}><ShieldCheck size={26} /></div>
        <p className={styles.eyebrow}>医数中枢 · Data OS</p>
        <h1 id="oidc-title">登录数据运营平台</h1>
        <p className={styles.description}>请使用医院或区域平台统一身份认证登录。平台会根据您的组织和角色加载可用数据范围。</p>
        {snapshot.error ? <p className={styles.error} role="alert">{snapshot.error}</p> : null}
        <button className={styles.loginButton} onClick={login} disabled={busy}>
          <LogIn size={18} />
          {busy ? '正在跳转…' : '使用统一身份认证登录'}
        </button>
        <p className={styles.hint}>登录令牌仅保存在当前浏览器会话，退出页面后自动失效。</p>
      </section>
    </main>
  )
}
