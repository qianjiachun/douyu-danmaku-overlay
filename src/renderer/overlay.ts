import type { AppConfig } from '../shared/config'
import { danmakuColorForCol } from '../shared/danmakuColor'
import type { DanmakuPayload } from '../shared/types'

interface QueuedDanmaku {
  base: string
  count: number
  /** 最近一次连击合并时间（毫秒），用于合并时间窗口 */
  lastMergeAt: number
  /** 已解析的弹幕色；null 表示用设置里的 fontColor（弹幕颜色） */
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

function edgeInsetPx(cfg: AppConfig): number {
  return Math.max(0, Math.min(160, Math.round(cfg.edgeInset)))
}

function usableHeight(cfg: AppConfig): number {
  return Math.max(0, window.innerHeight - 2 * edgeInsetPx(cfg))
}

function usableWidth(cfg: AppConfig): number {
  return Math.max(0, window.innerWidth - 2 * edgeInsetPx(cfg))
}

function laneCount(cfg: AppConfig): number {
  return Math.max(1, Math.floor(usableHeight(cfg) / laneHeight(cfg)))
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

/** 竖排：列宽取主文与角标中单字最大宽度，右侧仍留 WIDTH_PADDING 作轨距 */
function measureBulletWidthFieldsVertical(base: string, count: number, fontPx: number): number {
  let maxW = 0
  for (const ch of Array.from(base)) {
    maxW = Math.max(maxW, measureText(ch, fontPx))
  }
  if (maxW <= 0) maxW = fontPx * 0.5
  if (count > 1) {
    const sf = suffixFontPx(fontPx)
    for (const ch of Array.from(suffixLabel(count))) {
      maxW = Math.max(maxW, measureText(ch, sf))
    }
  }
  return maxW + WIDTH_PADDING
}

function measureBulletWidth(b: Bullet, cfg: AppConfig): number {
  if (cfg.danmakuScrollDirection === 'vertical') {
    return measureBulletWidthFieldsVertical(b.base, b.count, b.fontPx)
  }
  return measureBulletWidthFields(b.base, b.count, b.fontPx)
}

/** 竖向堆叠：相邻字基线间距 */
function verticalStackStep(fontPx: number): number {
  return fontPx * 1.12
}

function mergeWindowMs(cfg: AppConfig): number {
  return Math.max(1, cfg.duplicateMergeWindowSec) * 1000
}

/** 新弹幕入屏左边缘（略超出内容区右侧） */
function spawnLeftX(cfg: AppConfig): number {
  return window.innerWidth - edgeInsetPx(cfg) + 4
}

/** 竖向飘：整条先在屏幕上方，再缓慢进入视口 */
function spawnBaselineY(base: string, fontPx: number, count: number): number {
  const span = verticalTextStackSpan(0, base, fontPx, count)
  const h = Math.max(1, span.bottom - span.top)
  return -h - 4
}

function verticalLaneWidth(cfg: AppConfig): number {
  // 竖排是一列单字，列宽应接近单字宽度，而不是整行文字宽度。
  return Math.max(26, Math.round(cfg.fontSize * 1.65) + cfg.lanePadding * 2)
}

function laneCountVertical(cfg: AppConfig): number {
  return Math.max(1, Math.floor(usableWidth(cfg) / verticalLaneWidth(cfg)))
}

/** 竖向：列中心 X；lane 0 贴右侧内容区，lane 越大越靠左 */
function verticalLaneCenterX(lane: number, cfg: AppConfig): number {
  const lw = verticalLaneWidth(cfg)
  const right = window.innerWidth - edgeInsetPx(cfg)
  return right - (lane + 0.5) * lw
}

/** 横向排版弹幕在基线 y 上的外接竖直范围（横向飘用） */
function verticalSpanFromBaseline(y: number, fontPx: number, count: number): { top: number; bottom: number } {
  let bottom = y + fontPx * 0.35
  if (count > 1) {
    const sf = suffixFontPx(fontPx)
    const sy = y + Math.max(1, Math.round(fontPx * 0.15))
    bottom = Math.max(bottom, sy + sf)
  }
  return { top: y - fontPx * 1.12, bottom }
}

/** 竖向飘：首字基线在 y，正文逐字向下，角标接在最末字之下 */
function verticalTextStackSpan(
  yFirst: number,
  base: string,
  fontPx: number,
  count: number
): { top: number; bottom: number } {
  const chars = Array.from(base)
  const step = verticalStackStep(fontPx)
  const n = Math.max(1, chars.length)
  const lastBaseline = yFirst + (n - 1) * step
  let bottom = lastBaseline + fontPx * 0.35
  if (count > 1) {
    const sf = suffixFontPx(fontPx)
    const sy = lastBaseline + step * 0.92
    bottom = Math.max(bottom, sy + sf * 0.9)
  }
  return { top: yFirst - fontPx * 1.12, bottom }
}

function bulletVerticalSpan(b: Bullet, cfg: AppConfig): { top: number; bottom: number } {
  if (cfg.danmakuScrollDirection === 'vertical') {
    return verticalTextStackSpan(b.y, b.base, b.fontPx, b.count)
  }
  return verticalSpanFromBaseline(b.y, b.fontPx, b.count)
}

function laneAcceptsSpawnVertical(
  lane: number,
  baselineY: number,
  fontPx: number,
  count: number,
  base: string,
  cfg: AppConfig
): boolean {
  const g = Math.max(6, Math.min(18, Math.round(fontPx * 0.3)))
  const { top: nt, bottom: nb } = verticalTextStackSpan(baselineY, base, fontPx, count)
  for (const b of bullets) {
    if (b.lane !== lane) continue
    const { top: bt, bottom: bb } = bulletVerticalSpan(b, cfg)
    const separated = bb <= nt - g || bt >= nb + g
    if (!separated) return false
  }
  return true
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
  queue.push(item)
}

function trySpawn(cfg: AppConfig): void {
  if (queue.length === 0) return

  const item = queue[0]!
  const targetFontPx =
    cfg.duplicateDanmakuMode === 'merge' && item.count > 1
      ? mergeFontPx(cfg.fontSize, item.count)
      : cfg.fontSize
  const fontPx =
    cfg.duplicateDanmakuMode === 'merge' && item.count > 1 ? cfg.fontSize : targetFontPx

  let chosenLane = -1
  let x = 0
  let y = 0
  let w = 0

  if (cfg.danmakuScrollDirection === 'vertical') {
    const lanes = laneCountVertical(cfg)
    const sy = spawnBaselineY(item.base, fontPx, item.count)
    w = measureBulletWidthFieldsVertical(item.base, item.count, fontPx)
    for (let lane = 0; lane < lanes; lane++) {
      if (laneAcceptsSpawnVertical(lane, sy, fontPx, item.count, item.base, cfg)) {
        chosenLane = lane
        break
      }
    }
    if (chosenLane < 0) return
    x = verticalLaneCenterX(chosenLane, cfg)
    y = sy
  } else {
    const lanes = laneCount(cfg)
    const lh = laneHeight(cfg)
    w = measureBulletWidthFields(item.base, item.count, fontPx)
    const sx = spawnLeftX(cfg)
    for (let lane = 0; lane < lanes; lane++) {
      if (laneAcceptsSpawn(lane, sx, w)) {
        chosenLane = lane
        break
      }
    }
    if (chosenLane < 0) return
    x = sx
    y = edgeInsetPx(cfg) + chosenLane * lh + fontPx
  }

  queue.shift()
  const bullet: Bullet = {
    x,
    y,
    base: item.base,
    count: item.count,
    w,
    lane: chosenLane,
    fontPx,
    targetFontPx,
    lastMergeAt: item.lastMergeAt,
    danmakuRgb: item.danmakuRgb
  }
  bullet.w = measureBulletWidth(bullet, cfg)
  bullets.push(bullet)
}

function animateBulletFonts(cfg: AppConfig, dt: number): void {
  if (dt <= 0) return
  const lh = laneHeight(cfg)
  const k = 1 - Math.exp(-dt * 14)
  const vertical = cfg.danmakuScrollDirection === 'vertical'
  for (const b of bullets) {
    if (Math.abs(b.targetFontPx - b.fontPx) < 0.45) {
      if (b.fontPx !== b.targetFontPx) {
        b.fontPx = b.targetFontPx
        b.w = measureBulletWidth(b, cfg)
        if (vertical) b.x = verticalLaneCenterX(b.lane, cfg)
        else b.y = edgeInsetPx(cfg) + b.lane * lh + b.fontPx
      }
      continue
    }
    b.fontPx += (b.targetFontPx - b.fontPx) * k
    b.w = measureBulletWidth(b, cfg)
    if (vertical) b.x = verticalLaneCenterX(b.lane, cfg)
    else b.y = edgeInsetPx(cfg) + b.lane * lh + b.fontPx
  }
}

function bulletFillStyle(cfg: AppConfig, b: Bullet): string {
  if (cfg.showDanmakuColor && b.danmakuRgb) return b.danmakuRgb
  return cfg.fontColor
}

function danmakuBgFillStyle(cfg: AppConfig): string | null {
  const a = cfg.danmakuBgOpacity
  if (a <= 0) return null
  const hex = cfg.danmakuBgColor.trim()
  const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/i.exec(hex)
  if (!m) return `rgba(0,0,0,${a})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`
}

function drawDanmakuBackground(b: Bullet, cfg: AppConfig): void {
  const fill = danmakuBgFillStyle(cfg)
  if (!fill) return
  const span = bulletVerticalSpan(b, cfg)
  /** `b.w` 含 WIDTH_PADDING（轨距），衬底只包字形区域，左右对称 */
  const contentW = Math.max(0, b.w - WIDTH_PADDING)
  const padH = 5
  const vertical = cfg.danmakuScrollDirection === 'vertical'
  const x = vertical ? b.x - contentW / 2 - padH : b.x - padH
  const y = span.top - 2
  const w = contentW + 2 * padH
  const h = span.bottom - span.top + 4
  ctx.fillStyle = fill
  const r = Math.min(8, h / 2, w / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

/** 竖向飘：正文逐字自上而下，`b.x` 为列水平中心 */
function drawBulletVerticalStack(b: Bullet): void {
  const step = verticalStackStep(b.fontPx)
  const chars = Array.from(b.base)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${b.fontPx}px system-ui, "Segoe UI", sans-serif`
  let i = 0
  for (const ch of chars) {
    ctx.fillText(ch, b.x, b.y + i * step)
    i++
  }
  if (b.count > 1) {
    const sf = suffixFontPx(b.fontPx)
    const n = Math.max(1, chars.length)
    const lastBaseline = b.y + (n - 1) * step
    const sy = lastBaseline + step * 0.92
    ctx.font = `${sf}px system-ui, "Segoe UI", sans-serif`
    ctx.fillText(suffixLabel(b.count), b.x, sy)
  }
}

function drawBullet(b: Bullet, cfg: AppConfig): void {
  drawDanmakuBackground(b, cfg)
  ctx.fillStyle = bulletFillStyle(cfg, b)
  ctx.textBaseline = 'alphabetic'
  if (cfg.danmakuScrollDirection === 'vertical') {
    drawBulletVerticalStack(b)
    ctx.textAlign = 'start'
    return
  }
  ctx.textAlign = 'left'
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

  while (queue.length > 0) {
    const n = bullets.length
    trySpawn(cfg)
    if (bullets.length === n) break
  }

  const speed = cfg.speedPxPerSec
  const vertical = cfg.danmakuScrollDirection === 'vertical'
  const edge = edgeInsetPx(cfg)
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]!
    if (vertical) {
      b.y += speed * dt
      const { top } = bulletVerticalSpan(b, cfg)
      if (top > window.innerHeight - edge + 40) {
        bullets.splice(i, 1)
      }
    } else {
      b.x -= speed * dt
      if (b.x + b.w < edge - 12) {
        bullets.splice(i, 1)
      }
    }
  }

  animateBulletFonts(cfg, dt)

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  for (const b of bullets) {
    drawBullet(b, cfg)
  }

  while (queue.length > 0) {
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
      existingBullet.w = measureBulletWidth(existingBullet, cfg)
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
