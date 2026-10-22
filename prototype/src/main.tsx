import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { dataOsTheme, visualTokens } from './theme'
import { App } from './App'
import './styles/globals.css'

dayjs.locale('zh-cn')

// 自定义工作区与 antd 消费同一主题源，样式表的初始值仅用于首帧。
const cssTokens = {
  '--canvas': visualTokens.canvas, '--paper': visualTokens.paper,
  '--ink': visualTokens.ink, '--muted': visualTokens.muted,
  '--jade': visualTokens.jade, '--jade-dark': visualTokens.jadeDark,
  '--jade-soft': visualTokens.jadeSoft, '--sidebar': visualTokens.sidebar,
  '--bezel': visualTokens.bezel, '--line': visualTokens.line,
  '--line-strong': visualTokens.lineStrong, '--font-title': visualTokens.font,
  '--ease-standard': visualTokens.ease,
}
Object.entries(cssTokens).forEach(([name, value]) => document.documentElement.style.setProperty(name, value))
document.documentElement.style.fontFamily = visualTokens.font

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={dataOsTheme}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
