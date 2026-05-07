import type { AppConfig } from '../shared/config'
import { danmakuColorForCol } from '../shared/danmakuColor'
import type { DanmakuPayload } from '../shared/types'

interface QueuedDanmaku {
  base: string
  count: number
  /** 最近一次连击合并时间（毫秒），用于合并时间窗口 */
  lastMergeAt: number
  /** 已解析的弹幕色；null 表示用设置里的 fontColor */
  danmakuRgb: string | null
}

interface Bullet {
  x: number
  y: number
  base: string
  count: number
  w: number
  lane: number
  /** 当前主文案字号（插值动画） */
  fontPx: number
  /** 连击合并后的目标主文案字号 */
  targetFontPx: number
  lastMergeAt: number
  danmakuRgb: string | null
}

const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!

/** 连击角标相对主字号的缩放 */
const SUFFIX_FONT_RATIO = 0.5
/** 主文案与角标水平间距 */
const SUFFIX_GAP = 2
const WIDTH_PADDING = 8

let config: AppConfig | null = null
const queue: QueuedDanmaku[] = []
const bullets: Bullet[] = []
let lastTs = 0

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function laneHeight(cfg: AppConfig): number {
  return cfg.fontSize * 1.25 + cfg.lanePadding
}

function laneCount(cfg: AppConfig): number {
  return Math.max(1, Math.floor(window.innerHeight / laneHeight(cfg)))
}

function measureText(text: string, fontPx: number): number {
  ctx.font = `${fontPx}px system-ui, "Segoe UI", sans-serif`
  return ctx.measureText(text).width
}

function mergeFontPx(baseFont: number, count: number): number {
  if (count <= 1) return baseFont
  const scale = 1 + 0.16 * (count - 1)
  return Math.min(96, Math.round(baseFont * scale))
}

function suffixLabel(count: number): string {
  return `x${count}`
}

function suffixFontPx(mainFont: number): number {
  return Math.max(9, Math.round(mainFont * SUFFIX_FONT_RATIO))
}

function measureBulletWidthFields(base: string, count: number, fontPx: number): number {
  const mw = measureText(base, fontPx)
  if (count <= 1) return mw + WIDTH_PADDING
  const sw = measureText(suffixLabel(count), suffixFontPx(fontPx))
  return mw + SUFFIX_GAP + sw + WIDTH_PADDING
}

function measureBulletWidth(b: Bullet): number {
  return measureBulletWidthFields(b.base, b.count, b.fontPx)
}

function mergeWindowMs(cfg: AppConfig): number {
  return Math.max(1, cfg.duplicateMergeWindowSec) * 1000
}

/** 新弹幕入屏左边缘（略超出视口右侧） */
function spawnLeftX(): number {
  return window.innerWidth + 4
}

/** 同一轨道上横向间隔（像素），避免相邻弹幕贴边重叠 */
const SPAWN_HORIZONTAL_GAP = 14

/**
 * 在指定左边缘与宽度下，该轨道是否与现有弹幕水平重叠（含间隔）。
 */
function laneAcceptsSpawn(lane: number, newLeft: number, newW: number): boolean {
  const g = SPAWN_HORIZONTAL_GAP
  const newRight = newLeft + newW
  for (const b of bullets) {
    if (b.lane !== lane) continue
    const bl = b.x
    const br = b.x + b.w
    const separated = br <= newLeft - g || bl >= newRight + g
    if (!separated) return false
  }
  return true
}

function baseInFlight(base: string): boolean {
  for (const b of bullets) {
    if (b.base === base) return true
  }
  for (const q of queue) {
    if (q.base === base) return true
  }
  return false
}

function pushQueued(item: QueuedDanmaku): void {
  if (!config) return
  if (queue.length < config.maxQueue) queue.push(item)
  else queue.shift(), queue.push(item)
}

function trySpawn(cfg: AppConfig): void {
  if (bullets.length >= cfg.maxOnScreen) return
  if (queue.length === 0) return

  const lanes = laneCount(cfg)
  const lh = laneHeight(cfg)
  const item = queue[0]!
  const targetFontPx =
    cfg.duplicateDanmakuMode === 'merge' && item.count > 1
      ? mergeFontPx(cfg.fontSize, item.count)
      : cfg.fontSize
  const fontPx =
    cfg.duplicateDanmakuMode === 'merge' && item.count > 1 ? cfg.fontSize : targetFontPx

  let w = measureBulletWidthFields(item.base, item.count, fontPx)
  const sx = spawnLeftX()
  let chosenLane = -1
  for (let lane = 0; lane < lanes; lane++) {
    if (laneAcceptsSpawn(lane, sx, w)) {
      chosenLane = lane
      break
    }
  }
  if (chosenLane < 0) return

  queue.shift()
  const bullet: Bullet = {
    x: sx,
    y: chosenLane * lh + fontPx,
    base: item.base,
    count: item.count,
    w: w,
    lane: chosenLane,
    fontPx,
    targetFontPx,
    lastMergeAt: item.lastMergeAt,
    danmakuRgb: item.danmakuRgb
  }
  bullet.w = measureBulletWidth(bullet)
  bullets.push(bullet)
}

function animateBulletFonts(cfg: AppConfig, dt: number): void {
  if (dt <= 0) return
  const lh = laneHeight(cfg)
  const k = 1 - Math.exp(-dt * 14)
  for (const b of bullets) {
    if (Math.abs(b.targetFontPx - b.fontPx) < 0.45) {
      if (b.fontPx !== b.targetFontPx) {
        b.fontPx = b.targetFontPx
        b.w = measureBulletWidth(b)
        b.y = b.lane * lh + b.fontPx
      }
      continue
    }
    b.fontPx += (b.targetFontPx - b.fontPx) * k
    b.w = measureBulletWidth(b)
    b.y = b.lane * lh + b.fontPx
  }
}

function bulletFillStyle(cfg: AppConfig, b: Bullet): string {
  if (cfg.showDanmakuColor && b.danmakuRgb) return b.danmakuRgb
  return cfg.fontColor
}

function drawBullet(b: Bullet, cfg: AppConfig): void {
  ctx.fillStyle = bulletFillStyle(cfg, b)
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${b.fontPx}px system-ui, "Segoe UI", sans-serif`
  ctx.fillText(b.base, b.x, b.y)
  if (b.count > 1) {
    const mw = measureText(b.base, b.fontPx)
    const sf = suffixFontPx(b.fontPx)
    ctx.font = `${sf}px system-ui, "Segoe UI", sans-serif`
    const sx = b.x + mw + SUFFIX_GAP
    const sy = b.y + Math.max(1, Math.round(b.fontPx * 0.15))
    ctx.fillText(suffixLabel(b.count), sx, sy)
  }
}

function tick(ts: number): void {
  requestAnimationFrame(tick)
  if (!config) return
  const cfg = config
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0
  lastTs = ts

  while (queue.length > 0 && bullets.length < cfg.maxOnScreen) {
    const n = bullets.length
    trySpawn(cfg)
    if (bullets.length === n) break
  }

  const speed = cfg.speedPxPerSec
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]!
    b.x -= speed * dt
    if (b.x + b.w < -20) {
      bullets.splice(i, 1)
    }
  }

  animateBulletFonts(cfg, dt)

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  for (const b of bullets) {
    drawBullet(b, cfg)
  }

  while (queue.length > 0 && bullets.length < cfg.maxOnScreen) {
    const n = bullets.length
    trySpawn(cfg)
    if (bullets.length === n) break
  }
}

function normalizeIncomingText(d: DanmakuPayload): string {
  const t = d.text.trim()
  return t.length > 0 ? t : d.text
}

function resolvedDanmakuRgb(cfg: AppConfig, d: DanmakuPayload): string | null {
  if (!cfg.showDanmakuColor) return null
  return danmakuColorForCol(d.col)
}

function enqueueDanmaku(d: DanmakuPayload): void {
  if (!config) return
  const base = normalizeIncomingText(d)
  if (!base) return

  const cfg = config
  const mode = cfg.duplicateDanmakuMode
  const now = Date.now()
  const rgb = resolvedDanmakuRgb(cfg, d)
  const stamp = (): QueuedDanmaku => ({ base, count: 1, lastMergeAt: now, danmakuRgb: rgb })

  if (mode === 'once') {
    if (baseInFlight(base)) return
    pushQueued(stamp())
    return
  }

  if (mode === 'merge') {
    const wMs = mergeWindowMs(cfg)

    const existingBullet = bullets.find((b) => b.base === base)
    if (existingBullet && now - existingBullet.lastMergeAt <= wMs) {
      existingBullet.count++
      existingBullet.targetFontPx = mergeFontPx(cfg.fontSize, existingBullet.count)
      existingBullet.lastMergeAt = now
      existingBullet.w = measureBulletWidth(existingBullet)
      return
    }

    const existingQ = queue.find((q) => q.base === base && now - q.lastMergeAt <= wMs)
    if (existingQ) {
      existingQ.count++
      existingQ.lastMergeAt = now
      return
    }

    pushQueued(stamp())
    return
  }

  pushQueued(stamp())
}

function applyConfig(c: AppConfig): void {
  config = c
}

function clearDanmaku(): void {
  queue.length = 0
  bullets.length = 0
}

window.addEventListener('resize', () => {
  resize()
})

if (window.overlayApi) {
  window.overlayApi.onConfig((c) => {
    applyConfig(c)
  })

  window.overlayApi.onDanmaku((d) => {
    enqueueDanmaku(d)
  })

  window.overlayApi.onClearDanmaku(() => {
    clearDanmaku()
  })
}

resize()
requestAnimationFrame(tick)
