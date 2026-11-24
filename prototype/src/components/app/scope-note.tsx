import type { ReactNode } from 'react'

/** 范围声明行：列表顶部的浅底口径说明（没有 coss 对应物的版式件）。 */
export function ScopeNote({ children }: { children: ReactNode }) {
  return <div className="border-b border-line bg-wash px-[18px] py-2 text-meta text-muted-foreground">{children}</div>
}
