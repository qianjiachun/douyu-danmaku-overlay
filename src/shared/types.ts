/** 推送到飘屏窗口的单条弹幕 */
export interface DanmakuPayload {
  nick: string
  text: string
  /** 斗鱼弹幕颜色等级（`col` 字段），如 "1"～"6" */
  col?: string
}
