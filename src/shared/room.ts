/** 从输入中提取斗鱼房间数字 rid（支持粘贴完整 URL） */
export function normalizeRoomId(input: string): string {
  const s = input.trim()
  if (!s) return ''
  const urlRoom =
    s.match(/douyu\.com\/(?:topic\/)?([0-9]+)/i) ??
    s.match(/rid=([0-9]+)/i) ??
    s.match(/room[_-]?id[=:]\s*([0-9]+)/i)
  if (urlRoom?.[1]) return urlRoom[1]
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 4) return digits
  return digits
}
