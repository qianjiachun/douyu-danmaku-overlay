import type { DanmakuPayload } from './types'

/** 相同弹幕文案出现时的处理方式 */
export type DuplicateDanmakuMode = 'each' | 'once' | 'merge'

/** 飘屏绑定的显示器：主显示器（随系统主屏变化）或指定显示器 id */
export type OverlayDisplayMode = 'primary' | 'specific'

/** 设置页与 IPC 共用的显示器条目（仅元数据，不含原生 Display 对象） */
export interface OverlayDisplayListItem {
  id: string
  label: string
  isPrimary: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

/** 飘屏窗口相对目标显示器所占区域 */
export type OverlayAreaPreset =
  | 'full'
  | 'halfTop'
  | 'halfBottom'
  | 'halfLeft'
  | 'halfRight'
  | 'quarterTL'
  | 'quarterTR'
  | 'quarterBL'
  | 'quarterBR'

export const DEFAULT_CONFIG: AppConfig = {
  roomId: '',
  /** 总开关：关则隐藏飘屏窗口并停止拉流 */
  overlayEnabled: false,
  /** 飘屏层占据屏幕的区域（相对下方选中的显示器） */
  overlayArea: 'full',
  /** 飘屏绑定主显示器或指定显示器 */
  overlayDisplayMode: 'primary',
  /** `specific` 时使用 Electron display id，否则为空 */
  overlayDisplayId: '',
  fontSize: 22,
  fontColor: '#ffffff',
  opacity: 0.92,
  speedPxPerSec: 140,
  maxOnScreen: 40,
  maxQueue: 200,
  blockWords: [],
  /** 昵称（nn）黑名单：发送者昵称包含任一规则即屏蔽整条；逗号分隔，子串、不区分大小写 */
  blockNicks: [],
  /** 始终为 true，仅保留字段以兼容旧配置 */
  clickThrough: true,
  /** 相同文案弹幕：每条都显示 / 同屏与队列中只保留一条 / 合并并放大且显示 xN */
  duplicateDanmakuMode: 'each',
  /** 「合并变大」时：与上一条同文案间隔小于该秒数才计入连击并逐渐放大 */
  duplicateMergeWindowSec: 10,
  lanePadding: 6,
  simulateDanmaku: false,
  simulateIntervalMs: 800,
  /** 为 true 时用 WS 包中的 col 映射颜色，否则统一用 fontColor */
  showDanmakuColor: false,
  /** 为 true 时丢弃无 `dms` 字段的 chatmsg（通常为机器人弹幕） */
  filterRobotDanmaku: true,
  /** 用户是否已看过「关闭主窗口会收到托盘」提示（仅首次关闭主界面弹窗一次） */
  dismissedTrayCloseHint: false
}

export interface AppConfig {
  /** 斗鱼房间号 */
  roomId: string
  /** 是否显示飘屏并连接弹幕源 */
  overlayEnabled: boolean
  overlayArea: OverlayAreaPreset
  overlayDisplayMode: OverlayDisplayMode
  /** 仅在 overlayDisplayMode 为 specific 时有效 */
  overlayDisplayId: string
  fontSize: number
  fontColor: string
  /** 0–1，窗口整体透明度（Electron 层） */
  opacity: number
  speedPxPerSec: number
  maxOnScreen: number
  maxQueue: number
  blockWords: string[]
  /** 昵称（nn）黑名单：仅匹配发送者昵称，子串、不区分大小写；逗号分隔，规则与屏蔽词列表解析一致 */
  blockNicks: string[]
  clickThrough: boolean
  duplicateDanmakuMode: DuplicateDanmakuMode
  duplicateMergeWindowSec: number
  lanePadding: number
  simulateDanmaku: boolean
  simulateIntervalMs: number
  showDanmakuColor: boolean
  /** 过滤无 dms 的弹幕（斗鱼协议中真人弹幕常带该字段） */
  filterRobotDanmaku: boolean
  dismissedTrayCloseHint: boolean
}

/** 飘屏区域选项（UI 与校验共用） */
export const OVERLAY_AREA_OPTIONS: readonly {
  value: OverlayAreaPreset
  label: string
}[] = [
  { value: 'full', label: '全屏' },
  { value: 'halfTop', label: '上半屏' },
  { value: 'halfBottom', label: '下半屏' },
  { value: 'halfLeft', label: '左半屏' },
  { value: 'halfRight', label: '右半屏' },
  { value: 'quarterTL', label: '左上 1/4' },
  { value: 'quarterTR', label: '右上 1/4' },
  { value: 'quarterBL', label: '左下 1/4' },
  { value: 'quarterBR', label: '右下 1/4' }
]

const OVERLAY_AREA_PRESETS: readonly OverlayAreaPreset[] = OVERLAY_AREA_OPTIONS.map(
  (o) => o.value
)

function normalizeOverlayArea(v: unknown): OverlayAreaPreset {
  return OVERLAY_AREA_PRESETS.includes(v as OverlayAreaPreset)
    ? (v as OverlayAreaPreset)
    : DEFAULT_CONFIG.overlayArea
}

function normalizeOverlayDisplayMode(v: unknown): OverlayDisplayMode {
  return v === 'specific' ? 'specific' : 'primary'
}

const DUPLICATE_MODES: readonly DuplicateDanmakuMode[] = ['each', 'once', 'merge']

/** 屏蔽词分隔：英文逗号与中文逗号 */
const BLOCK_WORD_DELIMITER = /[,，]/

/** 从单行输入解析屏蔽词列表（设置页与合并配置共用） */
export function parseBlockWordsText(text: string): string[] {
  return text
    .split(BLOCK_WORD_DELIMITER)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 合并/加载配置时：数组项内若含逗号也会拆开，兼容旧版只存一条含「，」的字符串 */
export function normalizeBlockWords(value: unknown): string[] {
  if (typeof value === 'string') return parseBlockWordsText(value)
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const s = String(item).trim()
    if (!s) continue
    out.push(...parseBlockWordsText(s))
  }
  return out
}

function normalizeDuplicateMode(v: unknown): DuplicateDanmakuMode {
  return DUPLICATE_MODES.includes(v as DuplicateDanmakuMode)
    ? (v as DuplicateDanmakuMode)
    : DEFAULT_CONFIG.duplicateDanmakuMode
}

export function mergeConfig(partial: Partial<AppConfig> | undefined): AppConfig {
  const merged = { ...DEFAULT_CONFIG, ...(partial ?? {}) } as AppConfig & { blockUserIds?: unknown }
  merged.overlayArea = normalizeOverlayArea(merged.overlayArea)
  merged.overlayDisplayMode = normalizeOverlayDisplayMode(merged.overlayDisplayMode)
  merged.overlayDisplayId = String(merged.overlayDisplayId ?? '').trim()
  if (merged.overlayDisplayMode !== 'specific') {
    merged.overlayDisplayId = ''
  } else if (!merged.overlayDisplayId) {
    merged.overlayDisplayMode = 'primary'
  }
  merged.duplicateDanmakuMode = normalizeDuplicateMode(merged.duplicateDanmakuMode)
  merged.duplicateMergeWindowSec = Math.min(
    300,
    Math.max(1, Math.round(Number(merged.duplicateMergeWindowSec) || DEFAULT_CONFIG.duplicateMergeWindowSec))
  )
  merged.blockWords = normalizeBlockWords(merged.blockWords)
  const nickBlockRaw =
    partial !== undefined && Object.prototype.hasOwnProperty.call(partial, 'blockNicks')
      ? partial.blockNicks
      : partial !== undefined && Object.prototype.hasOwnProperty.call(partial, 'blockUserIds')
        ? merged.blockUserIds
        : merged.blockNicks
  merged.blockNicks = normalizeBlockWords(nickBlockRaw)
  delete merged.blockUserIds
  merged.clickThrough = true
  merged.showDanmakuColor = Boolean(merged.showDanmakuColor)
  merged.filterRobotDanmaku = merged.filterRobotDanmaku !== false
  merged.dismissedTrayCloseHint = Boolean(merged.dismissedTrayCloseHint)
  return merged
}

export function shouldBlock(config: AppConfig, payload: DanmakuPayload): boolean {
  const nick = (payload.nick ?? '').trim().toLowerCase()
  if (nick && config.blockNicks.length) {
    if (
      config.blockNicks.some((w) => {
        const t = w.trim().toLowerCase()
        return Boolean(t && nick.includes(t))
      })
    ) {
      return true
    }
  }
  const hay = `${payload.nick}${payload.text}`.toLowerCase()
  return config.blockWords.some((w) => w.trim() && hay.includes(w.trim().toLowerCase()))
}
