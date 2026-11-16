import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { App } from './App'
import './styles/tokens.css'
import './styles/legacy.css'

dayjs.locale('zh-cn')

// 主题由 styles/tokens.css 承载；旧 v3 变量只在 #legacy-root 内生效（styles/legacy.css），
// 不再把旧主题写到整个 document（计划 §3.3）。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
