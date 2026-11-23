import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installCookieStoreCompat } from './lib/cookie-store-compat'
import './styles/tokens.css'

// FE7 收口后全站只有一份主题：styles/tokens.css（Tailwind 4 拆分导入、无 preflight）。
// 旧组件库与 v3 主题已随旧页面退役。
installCookieStoreCompat()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
