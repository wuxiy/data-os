// v2 视觉方向「云峰中性」的 antd v6 主题映射。
// token 语义与 DESIGN.md「12. v2 视觉方向：云峰中性（antd 域）」一一对应；
// antd 组件一律从本文件取 token，页面/组件内不硬编码色值。
// 全站已完成 antd 迁移；globals.css 的语义变量与本文件保持同一色板。
import type { ThemeConfig } from 'antd'

export const dataOsTheme: ThemeConfig = {
  // v6 默认纯 CSS Variables 模式，无需 cssVar 开关
  token: {
    // 主色：青蓝（teal-blue），主动作/链接/选中态
    colorPrimary: '#0e7490',
    colorInfo: '#0e7490',
    // 状态色：健康 / 风险 / 阻断
    colorSuccess: '#15803d',
    colorWarning: '#b45309',
    colorError: '#b42318',
    // 中性阶：zinc 系画布与文字
    colorTextBase: '#1f2937',
    colorBgLayout: '#f6f7f8',
    colorBgContainer: '#ffffff',
    colorBorder: '#e3e6e8',
    colorBorderSecondary: '#eceef0',
    borderRadius: 6,
    fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 14,
    // 控件高度两档：默认 40 / 密集 32（表格行内、工具条、表单辅助动作用 size="small"）
    controlHeight: 40,
    controlHeightSM: 32,
    lineHeight: 1.6,
    motionDurationMid: '0.2s',
  },
  components: {
    Table: {
      headerBg: '#f9fafb',
      headerColor: '#4b5563',
      rowHoverBg: '#f3f6f7',
      // 行高约 48px、表头约 40px，与 v1 表格密度一致
      cellPaddingBlock: 13,
      cellPaddingBlockMD: 12,
      headerSplitColor: 'transparent',
    },
  },
}
