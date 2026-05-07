/** 推送到设置窗口的弹幕连接状态 */
export type DouyuStatusPayload =
  | { state: 'idle'; detail?: string }
  | { state: 'connecting'; detail?: string }
  | { state: 'socket-open'; detail?: string }
  | { state: 'login-ok'; detail?: string }
  | { state: 'login-fail'; detail: string }
  | { state: 'closed'; detail?: string }
  | { state: 'error'; detail: string }
