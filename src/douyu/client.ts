import WebSocket from 'ws'
import { inflateSync } from 'node:zlib'

const MSG_TYPE_SEND = 689

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function getRandom(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 斗鱼发送分包（对齐小淳 WebSocket_Packet + 常见 dy_encode：双 length + 689 + UTF-8 正文 + 尾 0x00）
 * 首 uint32 = 从第 4 字节到包尾的总字节数（含 duplicate、type、body、尾 0）
 */
export function buildDouyuPacket(text: string): Buffer {
  const msgBytes = Buffer.from(text, 'utf8')
  const dataLen = msgBytes.length + 9
  const total = 4 + dataLen
  const buf = Buffer.alloc(total)
  buf.writeUInt32LE(dataLen, 0)
  buf.writeUInt32LE(dataLen, 4)
  buf.writeUInt32LE(MSG_TYPE_SEND, 8)
  msgBytes.copy(buf, 12)
  buf.writeUInt8(0, 12 + msgBytes.length)
  return buf
}

export function parseDouyuFields(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = raw.split('/')
  for (const p of parts) {
    const idx = p.indexOf('@=')
    if (idx === -1) continue
    const k = p.slice(0, idx)
    let v = p.slice(idx + 2)
    v = v.replace(/@A/g, '@').replace(/@s/g, '/')
    out[k] = v
  }
  return out
}

function decodeDouyuValue(s: string): string {
  return s.replace(/@A/g, '@').replace(/@s/g, '/')
}

export function tryParseChatChunk(raw: string): ChatMessage | null {
  const t = raw.replace(/^\uFEFF/, '')
  if (!/(?:^|\/)type@=chatmsg(?:\/|$)/.test(t)) return null
  const nnM = t.match(/(?:^|\/)nn@=(.*?)(?=\/[a-z0-9_]+@=|$)/is)
  const txtM = t.match(/(?:^|\/)txt@=(.*?)(?=\/[a-z0-9_]+@=|$)/is)
  const colM = t.match(/(?:^|\/)col@=(.*?)(?=\/[a-z0-9_]+@=|$)/is)
  const dmsM = t.match(/(?:^|\/)dms@=(.*?)(?=\/[a-z0-9_]+@=|$)/is)
  const nick = decodeDouyuValue((nnM?.[1] ?? '').trim())
  const text = decodeDouyuValue((txtM?.[1] ?? '').trim())
  const colRaw = decodeDouyuValue((colM?.[1] ?? '').trim())
  const dmsRaw = decodeDouyuValue((dmsM?.[1] ?? '').trim())
  if (!text && !nick) return null
  const msg: ChatMessage = { nick, text }
  if (colRaw) msg.col = colRaw
  if (dmsRaw) msg.dms = dmsRaw
  return msg
}

export interface ChatMessage {
  nick: string
  text: string
  /** 颜色等级，对应弹幕 `col` 字段 */
  col?: string
  /** 斗鱼 `dms` 字段；缺失时常为机器人等非真人弹幕 */
  dms?: string
}

export function tryParseChat(fields: Record<string, string>): ChatMessage | null {
  if (fields.type !== 'chatmsg') return null
  const nick = fields.nn ?? ''
  const text = fields.txt ?? ''
  const colRaw = (fields.col ?? '').trim()
  const dmsRaw = (fields.dms ?? '').trim()
  if (!text && !nick) return null
  const msg: ChatMessage = { nick, text }
  if (colRaw) msg.col = colRaw
  if (dmsRaw) msg.dms = dmsRaw
  return msg
}

export function parseLoginRes(
  fields: Record<string, string>
): { ok: boolean; detail: string } | null {
  if ((fields.type ?? '').trim() !== 'loginres') return null
  const ret = (fields.ret ?? fields.res ?? '').trim()
  const rid = fields.roomid ?? fields.rid ?? ''
  const tail = [ret && `ret=${ret}`, rid && `roomid=${rid}`].filter(Boolean).join(' ')
  if (!ret) return { ok: true, detail: tail || 'loginres(无 ret 字段)' }
  const lower = ret.toLowerCase()
  if (lower === 'ok' || ret === '0') return { ok: true, detail: tail }
  if (lower === 'fail' || ret === '1') return { ok: false, detail: tail || '登录被拒绝' }
  return { ok: true, detail: tail }
}

export interface DouyuWsClientOptions {
  roomId: string
  onChat: (msg: ChatMessage) => void
  onError?: (err: Error) => void
  onStatus?: (s: 'connecting' | 'open' | 'closed') => void
  onLoginRes?: (ok: boolean, detail: string) => void
}

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data as ArrayBuffer)
}

function maybeDecompress(body: Buffer): string {
  if (body.length >= 2 && body[0] === 0x78 && (body[1] === 0x9c || body[1] === 0x01 || body[1] === 0xda)) {
    try {
      return inflateSync(body).toString('utf8')
    } catch {
      /* fallthrough */
    }
  }
  return body.toString('utf8')
}

/**
 * 斗鱼弹幕 WebSocket（未登录代理），对齐小淳 Ex_WebSocket_UnLogin + 二进制分包解析。
 */
export class DouyuWsClient {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectCount = 0
  private readonly maxReconnect = 12
  private destroyed = false
  private recvBuf = Buffer.alloc(0)

  constructor(private readonly options: DouyuWsClientOptions) {}

  start(): void {
    this.destroyed = false
    this.recvBuf = Buffer.alloc(0)
    this.connect()
  }

  private dispatchTextPayload(text: string): void {
    const chunks = text.split('\0')
    for (const chunk of chunks) {
      const c = chunk.replace(/^\uFEFF/, '')
      if (c.length <= 12) continue
      const fields = parseDouyuFields(c)
      const login = parseLoginRes(fields)
      if (login) {
        this.options.onLoginRes?.(login.ok, login.detail)
        continue
      }
      const chat = tryParseChatChunk(c) ?? tryParseChat(fields)
      if (chat) this.options.onChat(chat)
    }
  }

  /**
   * 下行：首 uint32 为「从第 4 字节到包尾」长度，总包长 = 4 + 该值（与 dy_encode 一致）
   */
  private feedBinary(buf: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, buf])
    const MAX = 2 * 1024 * 1024
    while (this.recvBuf.length >= 4) {
      const L = this.recvBuf.readUInt32LE(0)
      if (L < 9 || L > MAX) {
        const asText = this.recvBuf.toString('utf8')
        if (asText.includes('type@=')) {
          this.dispatchTextPayload(asText)
        }
        this.recvBuf = Buffer.alloc(0)
        return
      }
      const total = 4 + L
      if (this.recvBuf.length < total) return
      const packet = this.recvBuf.subarray(0, total)
      this.recvBuf = this.recvBuf.subarray(total)
      if (packet.length < 13) continue
      let body = packet.subarray(12, packet.length)
      while (body.length && body[body.length - 1] === 0) {
        body = body.subarray(0, body.length - 1)
      }
      let text = body.toString('utf8')
      if (!/type@=/i.test(text) && body.length > 8) {
        const inflated = maybeDecompress(body)
        if (/type@=/i.test(inflated)) text = inflated
      }
      if (text.length) this.dispatchTextPayload(text)
    }
  }

  /** 拆掉当前 socket 且不再触发其 close 里的重连（保证全局最多一条 WS） */
  private disposeWebSocketSilently(): void {
    this.clearTimer()
    const old = this.ws
    this.ws = null
    if (!old) return
    old.removeAllListeners()
    // CONNECTING 时 close() 会走 ws 内部 abortHandshake，并在 nextTick 上 emit('error')；
    // removeAllListeners 已去掉所有监听，若不先挂回吸收，会触发主进程未捕获异常（如拖动设置项触发 refreshSources -> stop）。
    const swallowHandshakeAbort = (): void => {}
    old.once('error', swallowHandshakeAbort)
    try {
      old.close()
    } catch {
      /* ignore */
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private connect(): void {
    if (this.destroyed) return
    this.clearReconnectTimer()
    this.recvBuf = Buffer.alloc(0)
    this.disposeWebSocketSilently()

    this.options.onStatus?.('connecting')
    const port = 8500 + getRandom(2, 5)
    const url = `wss://danmuproxy.douyu.com:${port}`
    const ws = new WebSocket(url, {
      perMessageDeflate: false,
      headers: {
        'User-Agent': CHROME_UA,
        Origin: 'https://www.douyu.com',
        Referer: 'https://www.douyu.com/'
      }
    })
    this.ws = ws

    ws.on('open', () => {
      this.reconnectCount = 0
      this.options.onStatus?.('open')
      const rid = this.options.roomId
      ws.send(buildDouyuPacket(`type@=loginreq/roomid@=${rid}/`))
      ws.send(buildDouyuPacket(`type@=joingroup/rid@=${rid}/gid@=-9999/`))
      this.timer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(buildDouyuPacket('type@=mrkl/'))
        }
      }, 40_000)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const b = rawDataToBuffer(data)
      this.feedBinary(b)
    })

    ws.on('error', (err) => {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)))
      this.closeSocketOnly()
    })

    ws.on('close', () => {
      this.clearTimer()
      this.options.onStatus?.('closed')
      if (!this.destroyed) this.scheduleReconnect()
    })
  }

  private closeSocketOnly(): void {
    this.clearTimer()
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    if (this.reconnectCount >= this.maxReconnect) {
      return
    }
    this.reconnectCount++
    const delay = Math.min(3000 * Math.pow(1.5, this.reconnectCount - 1), 60_000)
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  stop(): void {
    this.destroyed = true
    this.recvBuf = Buffer.alloc(0)
    this.clearReconnectTimer()
    this.disposeWebSocketSilently()
  }
}
