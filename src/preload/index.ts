import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { AppConfig, OverlayDisplayListItem } from '../shared/config'
import type { UpdateCheckResult } from '../shared/updateCheck'
import type { DanmakuPayload } from '../shared/types'
import type { DouyuStatusPayload } from '../shared/douyuStatus'

contextBridge.exposeInMainWorld('overlayApi', {
  onDanmaku(cb: (d: DanmakuPayload) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, d: DanmakuPayload): void => cb(d)
    ipcRenderer.on(IPC.overlayPushDanmaku, handler)
    return () => ipcRenderer.removeListener(IPC.overlayPushDanmaku, handler)
  },
  onClearDanmaku(cb: () => void): () => void {
    const handler = (): void => cb()
    ipcRenderer.on(IPC.overlayClearDanmaku, handler)
    return () => ipcRenderer.removeListener(IPC.overlayClearDanmaku, handler)
  },
  onConfig(cb: (c: AppConfig) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, c: AppConfig): void => cb(c)
    ipcRenderer.on(IPC.overlayPushConfig, handler)
    return () => ipcRenderer.removeListener(IPC.overlayPushConfig, handler)
  }
})

contextBridge.exposeInMainWorld('settingsApi', {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
  setConfig: (partial: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke(IPC.configSet, partial),
  listDisplays: (): Promise<OverlayDisplayListItem[]> => ipcRenderer.invoke(IPC.displayList),
  openSettingsWindow: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowOpenSettings),
  reconnectDouyu: (): Promise<boolean> => ipcRenderer.invoke(IPC.douyuReconnect),
  closeWindow: (): void => ipcRenderer.send(IPC.windowClose),
  minimizeWindow: (): void => ipcRenderer.send(IPC.windowMinimize),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IPC.windowToggleMaximize),
  windowDragStart: (screenX: number, screenY: number): void =>
    ipcRenderer.send(IPC.windowDragStart, screenX, screenY),
  windowDragMove: (screenX: number, screenY: number): void =>
    ipcRenderer.send(IPC.windowDragMove, screenX, screenY),
  windowDragEnd: (): void => ipcRenderer.send(IPC.windowDragEnd),
  onHomeLogo(cb: (dataUrl: string) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, dataUrl: string): void => cb(dataUrl)
    ipcRenderer.on(IPC.homePushLogo, handler)
    return () => ipcRenderer.removeListener(IPC.homePushLogo, handler)
  },
  onConfig(cb: (c: AppConfig) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, c: AppConfig): void => cb(c)
    ipcRenderer.on(IPC.overlayPushConfig, handler)
    return () => ipcRenderer.removeListener(IPC.overlayPushConfig, handler)
  },
  onDouyuStatus(cb: (s: DouyuStatusPayload) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, s: DouyuStatusPayload): void => cb(s)
    ipcRenderer.on(IPC.douyuStatus, handler)
    return () => ipcRenderer.removeListener(IPC.douyuStatus, handler)
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appGetVersion),
  checkUpdate: (force?: boolean): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke(IPC.appCheckUpdate, Boolean(force)),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC.appOpenExternal, url),
  onUpdateInfo(cb: (r: UpdateCheckResult) => void): () => void {
    const handler = (_: Electron.IpcRendererEvent, r: UpdateCheckResult): void => cb(r)
    ipcRenderer.on(IPC.appUpdatePush, handler)
    return () => ipcRenderer.removeListener(IPC.appUpdatePush, handler)
  }
})
