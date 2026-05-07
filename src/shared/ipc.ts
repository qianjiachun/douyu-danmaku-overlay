/** IPC 通道名（主进程与 preload 约定） */
export const IPC = {
  configGet: 'config:get',
  configSet: 'config:set',
  overlayPushDanmaku: 'danmaku:push',
  overlayClearDanmaku: 'danmaku:clear',
  overlayPushConfig: 'config:push',
  douyuStatus: 'douyu:status',
  douyuReconnect: 'douyu:reconnect',
  windowOpenSettings: 'window:open-settings',
  windowClose: 'window:close',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowDragStart: 'window:drag-start',
  windowDragMove: 'window:drag-move',
  windowDragEnd: 'window:drag-end',
  homePushLogo: 'home:push-logo',
  appGetVersion: 'app:get-version'
} as const
