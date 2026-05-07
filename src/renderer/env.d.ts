import type { AppConfig, OverlayDisplayListItem } from '../shared/config'
import type { UpdateCheckResult } from '../shared/updateCheck'
import type { DanmakuPayload } from '../shared/types'
import type { DouyuStatusPayload } from '../shared/douyuStatus'

declare global {
  interface Window {
    overlayApi: {
      onDanmaku: (cb: (d: DanmakuPayload) => void) => () => void
      onClearDanmaku: (cb: () => void) => () => void
      onConfig: (cb: (c: AppConfig) => void) => () => void
    }
    settingsApi: {
      getConfig: () => Promise<AppConfig>
      setConfig: (partial: Partial<AppConfig>) => Promise<AppConfig>
      openSettingsWindow: () => Promise<boolean>
      reconnectDouyu: () => Promise<boolean>
      closeWindow: () => void
      minimizeWindow: () => void
      toggleMaximizeWindow: () => void
      windowDragStart: (screenX: number, screenY: number) => void
      windowDragMove: (screenX: number, screenY: number) => void
      windowDragEnd: () => void
      onHomeLogo: (cb: (dataUrl: string) => void) => () => void
      onConfig: (cb: (c: AppConfig) => void) => () => void
      onDouyuStatus: (cb: (s: DouyuStatusPayload) => void) => () => void
      getAppVersion: () => Promise<string>
      checkUpdate: (force?: boolean) => Promise<UpdateCheckResult>
      openExternal: (url: string) => Promise<boolean>
      onUpdateInfo: (cb: (r: UpdateCheckResult) => void) => () => void
      listDisplays: () => Promise<OverlayDisplayListItem[]>
    }
  }
}

export {}
