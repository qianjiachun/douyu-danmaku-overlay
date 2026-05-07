/** 弹幕颜色等级（斗鱼 WS `col` 字段）→ CSS 颜色 */
export const DANMAKU_COLOR_BY_COL: Readonly<Record<string, string>> = {
  '2': 'rgb(30,135,240)',
  '3': 'rgb(122,200,75)',
  '6': 'rgb(255,105,180)',
  '4': 'rgb(255,127,0)',
  '5': 'rgb(155,57,244)',
  '1': 'rgb(255,0,0)'
}

export function danmakuColorForCol(col: string | undefined): string | null {
  if (col == null) return null
  const key = String(col).trim()
  if (!key) return null
  return DANMAKU_COLOR_BY_COL[key] ?? null
}
