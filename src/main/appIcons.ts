import { app, nativeImage, type BrowserWindow, type NativeImage, type Tray } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getWritableDataDirectory } from './dataPaths'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 与原先托盘占位图一致，文件缺失时作为兜底 */
const FALLBACK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAAGklEQVQoz2NkYGD4z0ABYBw1ClGECKH8P0gA0wQJ0V4N7K0AAAAASUVORK5CYII='

function tryLoadIconFromPath(p: string): NativeImage | null {
  if (!existsSync(p)) return null
  try {
    const buf = readFileSync(p)
    const img = nativeImage.createFromBuffer(buf)
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/**
 * 默认图标查找顺序：
 * 1. 打包：`process.resourcesPath/icon.png`（由 electron-builder extraResources 注入）
 * 2. 开发：项目根目录 `resources/icon.png`
 */
export function getDefaultIconImage(): NativeImage {
  const packaged = app.isPackaged ? join(process.resourcesPath, 'icon.png') : ''
  const dev = join(__dirname, '../../resources/icon.png')
  for (const p of [packaged, dev]) {
    if (!p) continue
    const img = tryLoadIconFromPath(p)
    if (img) return img
  }
  return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_PNG_BASE64}`)
}

interface EntryApiBody {
  error?: number
  data?: {
    anchorInfo?: {
      avatar?: string
    }
  }
}

function normalizeAvatarUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  const path = s.replace(/^\/+/, '')
  return `https://apic.douyucdn.cn/upload/${path}`
}

/** 用户数据目录下按房间号缓存主播头像 PNG，避免重复请求接口 */
const ROOM_AVATAR_CACHE_DIR = 'room-avatar-cache'
/** 缓存过期后重新拉取（按文件修改时间判断） */
const ROOM_AVATAR_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function safeRoomIdForFilename(rid: string): string {
  return rid.replace(/\D/g, '')
}

function getRoomAvatarCachePath(rid: string): string {
  const safe = safeRoomIdForFilename(rid)
  return join(getWritableDataDirectory(), ROOM_AVATAR_CACHE_DIR, `${safe || 'unknown'}.png`)
}

function readCachedRoomAvatar(rid: string): NativeImage | null {
  const safe = safeRoomIdForFilename(rid)
  if (!safe) return null
  const cachePath = getRoomAvatarCachePath(rid)
  if (!existsSync(cachePath)) return null
  try {
    const { mtimeMs } = statSync(cachePath)
    if (Date.now() - mtimeMs > ROOM_AVATAR_CACHE_MAX_AGE_MS) return null
  } catch {
    return null
  }
  return tryLoadIconFromPath(cachePath)
}

function writeCachedRoomAvatar(rid: string, png: Buffer): void {
  const safe = safeRoomIdForFilename(rid)
  if (!safe) return
  const dir = join(getWritableDataDirectory(), ROOM_AVATAR_CACHE_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${safe}.png`), png)
}

export async function fetchAnchorAvatarAsIcon(rid: string): Promise<NativeImage | null> {
  const cached = readCachedRoomAvatar(rid)
  if (cached) return cached

  const entryUrl = `https://www.douyu.com/wgapi/activitync/tm2024/entry?rid=${encodeURIComponent(rid)}`
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

  const entryRes = await fetch(entryUrl, {
    headers: { Accept: 'application/json', 'User-Agent': ua }
  })
  if (!entryRes.ok) return null

  const json = (await entryRes.json()) as EntryApiBody
  if (json.error !== 0 || !json.data?.anchorInfo?.avatar) return null

  const avatarUrl = normalizeAvatarUrl(json.data.anchorInfo.avatar)
  if (!avatarUrl) return null

  const imgRes = await fetch(avatarUrl, { headers: { 'User-Agent': ua } })
  if (!imgRes.ok) return null

  const buf = Buffer.from(await imgRes.arrayBuffer())
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return null

  try {
    writeCachedRoomAvatar(rid, buf)
  } catch (e) {
    console.error('[app-icons] cache write failed', e)
  }

  return img
}

function resizeForTray(img: NativeImage): NativeImage {
  const { width, height } = img.getSize()
  const target = 32
  if (width <= target && height <= target) return img
  return img.resize({ width: target, height: target, quality: 'good' })
}

/** 与 min 边长的比例，接近常见 App 图标圆角观感 */
const DISPLAY_CORNER_RADIUS_RATIO = 0.22

function pointInRoundedRect(px: number, py: number, w: number, h: number, r: number): boolean {
  const maxR = Math.floor(Math.min(w, h) / 2)
  const rr = Math.min(r, maxR)
  if (rr <= 0) return px >= 0 && py >= 0 && px < w && py < h
  if (px < 0 || py < 0 || px >= w || py >= h) return false
  if (px >= rr && px < w - rr) return true
  if (py >= rr && py < h - rr) return true
  if (px < rr && py < rr) {
    const dx = px - rr
    const dy = py - rr
    return dx * dx + dy * dy <= rr * rr
  }
  if (px >= w - rr && py < rr) {
    const dx = px - (w - rr)
    const dy = py - rr
    return dx * dx + dy * dy <= rr * rr
  }
  if (px < rr && py >= h - rr) {
    const dx = px - rr
    const dy = py - (h - rr)
    return dx * dx + dy * dy <= rr * rr
  }
  if (px >= w - rr && py >= h - rr) {
    const dx = px - (w - rr)
    const dy = py - (h - rr)
    return dx * dx + dy * dy <= rr * rr
  }
  return false
}

/**
 * 给 PNG/位图加圆角透明区域（任务栏/托盘/窗口图标 OS 不会自动圆角，需在像素层裁切）。
 */
function roundNativeImageCorners(img: NativeImage, radiusRatio: number): NativeImage {
  const { width: w, height: h } = img.getSize()
  if (w <= 0 || h <= 0 || img.isEmpty()) return img

  const rPx = Math.round(Math.min(w, h) * radiusRatio)
  if (rPx <= 0) return img

  let src: Buffer
  try {
    src = img.toBitmap({ scaleFactor: 1 })
  } catch {
    return img
  }

  const rowBytes = src.length / h
  if (!Number.isInteger(rowBytes) || rowBytes < w * 4) return img

  const out = Buffer.from(src)
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes
    for (let x = 0; x < w; x++) {
      if (pointInRoundedRect(x, y, w, h, rPx)) continue
      const i = row + x * 4
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = 0
    }
  }

  try {
    return nativeImage.createFromBitmap(out, { width: w, height: h, scaleFactor: 1 })
  } catch {
    return img
  }
}

/** 托盘：缩放至 32px 并加圆角透明边（与任务栏图标观感一致） */
export function trayImageFromSource(img: NativeImage): NativeImage {
  return roundNativeImageCorners(resizeForTray(img), DISPLAY_CORNER_RADIUS_RATIO)
}

function windowIconFromSource(img: NativeImage): NativeImage {
  return roundNativeImageCorners(img, DISPLAY_CORNER_RADIUS_RATIO)
}

/** 主界面 logo 用（约 2× CSS 56px，便于高分屏） */
const HOME_LOGO_EXPORT_PX = 112

/**
 * 将当前应用/房间图标以 PNG data URL 推送到主窗口（圆角由页面 CSS 处理）。
 */
export function pushHomeLogoToRenderer(
  win: BrowserWindow | null,
  image: NativeImage,
  ipcChannel: string
): void {
  if (!win || win.isDestroyed()) return
  const target = HOME_LOGO_EXPORT_PX
  const { width: w, height: h } = image.getSize()
  const sized =
    w <= target && h <= target ? image : image.resize({ width: target, height: target, quality: 'good' })
  try {
    const buf = sized.toPNG()
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
    win.webContents.send(ipcChannel, dataUrl)
  } catch (e) {
    console.error('[home-logo]', e)
  }
}

export function applyTrayAndWindowIcons(
  tray: Tray | null,
  windows: (BrowserWindow | null)[],
  image: NativeImage
): void {
  const trayImg = trayImageFromSource(image)
  const windowImg = windowIconFromSource(image)
  for (const w of windows) {
    if (w && !w.isDestroyed()) w.setIcon(windowImg)
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(windowImg)
  }
  if (tray && !tray.isDestroyed()) {
    tray.setImage(trayImg)
  }
}
