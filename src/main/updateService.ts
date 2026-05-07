import { app, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import {
  compareSemver,
  stripVersionPrefix,
  type UpdateCheckResult
} from '../shared/updateCheck'

const GITHUB_LATEST_API =
  'https://api.github.com/repos/qianjiachun/douyu-danmaku-overlay/releases/latest'

/** 命中缓存最短间隔（毫秒） */
const CACHE_MS = 60 * 60 * 1000
/** 启动后延迟首次检测 */
const START_DELAY_MS = 5000
/** 后台轮询间隔 */
const POLL_MS = 6 * 60 * 60 * 1000

interface GithubLatestReleaseJson {
  tag_name?: string
  html_url?: string
  assets?: { name?: string; browser_download_url?: string }[]
}

let cache: { at: number; result: UpdateCheckResult } | null = null

export function getCachedUpdateResult(): UpdateCheckResult | null {
  return cache?.result ?? null
}

function chooseOpenUrl(data: GithubLatestReleaseJson): string | undefined {
  const html = typeof data.html_url === 'string' ? data.html_url.trim() : ''
  const assets = Array.isArray(data.assets) ? data.assets : []
  const exe = assets.find((a) => typeof a?.name === 'string' && /\.exe$/i.test(a.name))
  const exeUrl =
    exe && typeof exe.browser_download_url === 'string'
      ? exe.browser_download_url.trim()
      : ''
  if (exeUrl) return exeUrl
  if (html) return html
  return undefined
}

async function fetchLatestRelease(): Promise<{ tag: string; openUrl: string }> {
  const res = await fetch(GITHUB_LATEST_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `douyu-danmaku-overlay/${app.getVersion()}`
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`)
  }
  const data = (await res.json()) as GithubLatestReleaseJson
  const rawTag = typeof data.tag_name === 'string' ? data.tag_name.trim() : ''
  const tag = stripVersionPrefix(rawTag)
  const openUrl = chooseOpenUrl(data)
  if (!tag || !openUrl) {
    throw new Error('Release 数据不完整')
  }
  return { tag, openUrl }
}

function buildResult(currentVersion: string, latestVersion: string, openUrl: string): UpdateCheckResult {
  const hasUpdate = compareSemver(currentVersion, latestVersion) < 0
  return {
    ok: true,
    currentVersion,
    hasUpdate,
    latestVersion,
    openUrl,
    checkedAt: Date.now()
  }
}

export async function checkForUpdates(forceRefresh: boolean): Promise<UpdateCheckResult> {
  const now = Date.now()
  const currentVersion = app.getVersion()

  if (!forceRefresh && cache && now - cache.at < CACHE_MS) {
    return cache.result
  }

  try {
    const { tag: latestVersion, openUrl } = await fetchLatestRelease()
    const result = buildResult(currentVersion, latestVersion, openUrl)
    cache = { at: now, result }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const result: UpdateCheckResult = {
      ok: false,
      currentVersion,
      hasUpdate: false,
      checkedAt: now,
      error: msg
    }
    cache = { at: now, result }
    return result
  }
}

export function pushUpdateToHome(
  homeWin: BrowserWindow | null | undefined,
  result: UpdateCheckResult
): void {
  if (!homeWin || homeWin.isDestroyed()) return
  homeWin.webContents.send(IPC.appUpdatePush, result)
}

export function scheduleUpdateChecks(
  getHomeWin: () => BrowserWindow | null | undefined,
  onAfterCheck: (result: UpdateCheckResult) => void
): void {
  const run = (force: boolean) => {
    void checkForUpdates(force).then((r) => {
      pushUpdateToHome(getHomeWin(), r)
      onAfterCheck(r)
    })
  }

  setTimeout(() => run(false), START_DELAY_MS)
  setInterval(() => run(true), POLL_MS)
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'github.com' || h.endsWith('.github.com')) return true
    if (h === 'objects.githubusercontent.com') return true
    if (h.endsWith('.githubusercontent.com')) return true
    return false
  } catch {
    return false
  }
}
