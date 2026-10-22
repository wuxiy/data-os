// v3「银雾 · 精密工作台」：antd 与 CSS 语义色共用本文件的设计令牌。
import type { ThemeConfig } from 'antd'

export const visualTokens = {
  canvas: '#f1f3f3', paper: '#ffffff', ink: '#202d31', muted: '#5c6c72',
  jade: '#216b68', jadeDark: '#185653', jadeSoft: '#e6f0ee',
  sidebar: '#202f34', bezel: '#e7ebeb',
  line: 'rgba(32, 57, 61, 0.09)', lineStrong: 'rgba(32, 57, 61, 0.17)',
  font: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
  ease: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

export const dataOsTheme: ThemeConfig = {
  token: {
    colorPrimary: visualTokens.jade,
    colorInfo: visualTokens.jade,
    colorSuccess: '#287653', colorWarning: '#a56926', colorError: '#b0443b',
    colorTextBase: visualTokens.ink,
    colorTextSecondary: visualTokens.muted,
    colorBgLayout: visualTokens.canvas, colorBgContainer: visualTokens.paper,
    colorBorder: visualTokens.lineStrong, colorBorderSecondary: visualTokens.line,
    borderRadius: 12, borderRadiusLG: 24, borderRadiusSM: 8,
    fontFamily: visualTokens.font, fontSize: 14,
    controlHeight: 42, controlHeightSM: 32, lineHeight: 1.65,
    motionDurationMid: '0.28s', motionDurationSlow: '0.4s',
    motionEaseInOut: visualTokens.ease, motionEaseOut: visualTokens.ease,
    motionEaseInOutCirc: visualTokens.ease, motionEaseOutCirc: visualTokens.ease,
    boxShadow: '0 16px 64px -20px rgba(32,57,61,0.16)',
    boxShadowSecondary: '0 24px 72px -20px rgba(32,57,61,0.18)',
  },
  components: {
    Button: { borderRadius: 999, borderRadiusSM: 999, fontWeight: 500, paddingInline: 20, paddingInlineSM: 12, primaryShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)', defaultShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)' },
    Table: { headerBg: '#f6f8f7', headerColor: visualTokens.muted, rowHoverBg: '#f0f6f4', cellPaddingBlock: 15, cellPaddingBlockMD: 13, headerSplitColor: 'transparent' },
    Tabs: { horizontalItemGutter: 28, inkBarColor: visualTokens.jade, titleFontSize: 13 },
    Input: { paddingInline: 14, activeShadow: '0 0 0 4px rgba(33,107,104,0.08)' },
    Tag: { borderRadiusSM: 6 },
    Drawer: { footerPaddingBlock: 20, footerPaddingInline: 24 },
  },
}
