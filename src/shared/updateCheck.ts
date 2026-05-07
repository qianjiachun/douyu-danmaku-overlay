/** GitHub Release `tag_name` / package.json 版本号归一化与比较 */

export interface UpdateCheckResult {
  ok: boolean
  currentVersion: string
  hasUpdate: boolean
  latestVersion?: string
  /** 优先指向 Release 中的安装包直链，否则为 Release 页面 */
  openUrl?: string
  checkedAt: number
  error?: string
}

export function stripVersionPrefix(v: string): string {
  return v.trim().replace(/^v/i, '')
}

/** 语义化版本三段比较；非法或非数字段按 0 处理 */
export function compareSemver(a: string, b: string): number {
  const pa = stripVersionPrefix(a)
    .split('.')
    .slice(0, 3)
    .map((x) => {
      const n = parseInt(x.replace(/\D.*$/, ''), 10)
      return Number.isFinite(n) ? n : 0
    })
  const pb = stripVersionPrefix(b)
    .split('.')
    .slice(0, 3)
    .map((x) => {
      const n = parseInt(x.replace(/\D.*$/, ''), 10)
      return Number.isFinite(n) ? n : 0
    })
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}
