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
  appGetVersion: 'app:get-version',
  /** 检测 GitHub Release 是否有新版本（主进程缓存 + 限频） */
  appCheckUpdate: 'app:check-update',
  /** 主进程校验后打开外链（更新下载等） */
  appOpenExternal: 'app:open-external',
  /** 后台检测完成后推送给主界面 */
  appUpdatePush: 'app:update-push',
  /** 枚举显示器（飘屏设置） */
  displayList: 'display:list'
} as const
