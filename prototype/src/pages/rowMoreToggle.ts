// 行内「更多」菜单（rowMore/rowMoreMenu）的展开定位：菜单绝对定位在行内，
// 会被表格滚动区（overflow:auto/hidden 祖先）上下裁切。打开时实测可用空间：
// 下方够则向下弹，否则上方够则向上弹，两侧都不够（如单行表）则夹取在容器
// 内完整可见（允许覆盖本行）。菜单相对 details 定位，随行滚动，锚点不漂移。
// details 的属性不由 React 管理（className 静态），直接写内联样式安全。
const GAP = 4

export function rowMoreToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
  const details = event.currentTarget
  const menu = details.querySelector<HTMLElement>(':scope > div')
  if (!menu) return
  if (!details.open) {
    menu.style.top = ''
    menu.style.bottom = ''
    return
  }
  const summary = details.querySelector('summary')
  if (!summary) return
  let clipper: HTMLElement | null = null
  let node: HTMLElement | null = details.parentElement
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      clipper = node
      break
    }
    node = node.parentElement
  }
  const bounds = (clipper ?? document.body).getBoundingClientRect()
  const sum = summary.getBoundingClientRect()
  const height = menu.offsetHeight
  let top: number
  if (bounds.bottom - sum.bottom - GAP >= height) {
    top = sum.bottom + GAP
  } else if (sum.top - bounds.top - GAP >= height) {
    top = sum.top - GAP - height
  } else {
    // 两侧都不足（如单行表）：夹取在容器内，完全放不下时优先贴容器顶完整展示
    top = Math.max(bounds.top, Math.min(sum.bottom + GAP, bounds.bottom - GAP - height))
  }
  menu.style.bottom = 'auto'
  menu.style.top = `${Math.round(top - details.getBoundingClientRect().top)}px`
}
