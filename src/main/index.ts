import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  shell,
  dialog,
  type NativeImage
} from 'electron'
import type { DanmakuPayload } from '../shared/types'
import type { DouyuStatusPayload } from '../shared/douyuStatus'
import { IPC } from '../shared/ipc'
import {
  DEFAULT_CONFIG,
  mergeConfig,
  shouldBlock,
  type AppConfig,
  type OverlayAreaPreset
} from '../shared/config'
import { normalizeRoomId } from '../shared/room'
import { DouyuWsClient } from '../douyu/client'
import {
  applyTrayAndWindowIcons,
  fetchAnchorAvatarAsIcon,
  getDefaultIconImage,
  pushHomeLogoToRenderer,
  trayImageFromSource
} from './appIcons'
import { getWritableDataDirectory, isPortableExeDataMode } from './dataPaths'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 面向用户的软件名称（npm package name 仍为开发者用） */
const APP_DISPLAY_NAME = '斗鱼弹幕飘屏'

/** 解析 preload 绝对路径（dev/build 下均在 out/preload；兼容 cwd 与主入口差异） */
function getPreloadPath(): string {
  const nextToMain = resolve(__dirname, '..', 'preload', 'index.mjs')
  if (existsSync(nextToMain)) return nextToMain
  const underPkg = resolve(app.getAppPath(), 'out', 'preload', 'index.mjs')
  if (existsSync(underPkg)) return underPkg
  return nextToMain
}

/** 无边框 + 透明窗口下系统 maximize / isMaximized 不可靠：用工作区 bounds 模拟最大化并记住还原尺寸 */
interface ChromeLayoutState {
  normalBounds: Electron.Rectangle
  workAreaMaximized: boolean
}

const chromeLayoutByWindow = new WeakMap<BrowserWindow, ChromeLayoutState>()

/** 标题栏拖动会话：移动时用固定宽高 setBounds，避免 Windows 下尺寸漂移；记录上次位置避免重复 setBounds */
let dragSession: {
  win: BrowserWindow
  offsetX: number
  offsetY: number
  width: number
  height: number
  lastX: number
  lastY: number
} | null = null

function getChromeLayout(win: BrowserWindow): ChromeLayoutState {
  let s = chromeLayoutByWindow.get(win)
  if (!s) {
    s = { normalBounds: win.getBounds(), workAreaMaximized: false }
    chromeLayoutByWindow.set(win, s)
  }
  return s
}

function registerChromeWindow(win: BrowserWindow): void {
  getChromeLayout(win)
  win.on('resize', () => {
    const s = chromeLayoutByWindow.get(win)
    if (!s || s.workAreaMaximized) return
    if (dragSession && !dragSession.win.isDestroyed() && dragSession.win.id === win.id) return
    s.normalBounds = win.getBounds()
  })
}

function toggleWorkAreaMaximize(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return
  const s = getChromeLayout(win)
  const wa = screen.getDisplayMatching(win.getBounds()).workArea
  const target = {
    x: Math.round(wa.x),
    y: Math.round(wa.y),
    width: Math.round(wa.width),
    height: Math.round(wa.height)
  }

  if (s.workAreaMaximized) {
    s.workAreaMaximized = false
    win.setBounds(s.normalBounds)
    return
  }

  s.normalBounds = win.getBounds()
  s.workAreaMaximized = true
  win.setBounds(target)
}

function ensureUnmaximizedForDrag(win: BrowserWindow): void {
  const s = chromeLayoutByWindow.get(win)
  if (!s?.workAreaMaximized) return
  s.workAreaMaximized = false
  win.setBounds(s.normalBounds)
}

let overlayWin: BrowserWindow | null = null
let homeWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let tray: Tray | null = null
/** 为 true 时允许主窗口 close 真正销毁（否则 close 仅隐藏，会拦截 app.quit） */
let isAppQuitting = false
let douyu: DouyuWsClient | null = null
let simulateTimer: ReturnType<typeof setInterval> | null = null
/** 避免快速切换房间时异步图标请求乱序覆盖 */
let iconSyncGeneration = 0
let currentConfig: AppConfig = { ...DEFAULT_CONFIG }
let lastDouyuStatus: DouyuStatusPayload = {
  state: 'idle',
  detail: '在主界面输入房间号并点「开启飘屏」'
}

function configPath(): string {
  return join(getWritableDataDirectory(), 'config.json')
}

/** 旧版便携包曾把配置写在 Roaming，迁移后删除以免残留 */
function legacyRoamingConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function parseConfigFile(raw: string): AppConfig {
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  const merged = mergeConfig(parsed)
  if (!Object.prototype.hasOwnProperty.call(parsed, 'overlayEnabled')) {
    merged.overlayEnabled = true
  }
  return merged
}

function loadConfig(): AppConfig {
  try {
    const p = configPath()
    if (existsSync(p)) {
      return parseConfigFile(readFileSync(p, 'utf8'))
    }
    if (isPortableExeDataMode()) {
      const legacy = legacyRoamingConfigPath()
      if (existsSync(legacy)) {
        const merged = parseConfigFile(readFileSync(legacy, 'utf8'))
        saveConfig(merged)
        try {
          unlinkSync(legacy)
        } catch {
          /* 占用或无权限时保留原文件 */
        }
        return merged
      }
    }
    return { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(cfg: AppConfig): void {
  mkdirSync(getWritableDataDirectory(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

function broadcastConfig(): void {
  overlayWin?.webContents.send(IPC.overlayPushConfig, currentConfig)
  homeWin?.webContents.send(IPC.overlayPushConfig, currentConfig)
  settingsWin?.webContents.send(IPC.overlayPushConfig, currentConfig)
}

function sendDouyuStatus(payload: DouyuStatusPayload): void {
  lastDouyuStatus = payload
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send(IPC.douyuStatus, payload)
  }
  if (homeWin && !homeWin.isDestroyed()) {
    homeWin.webContents.send(IPC.douyuStatus, payload)
  }
  void syncAppIcons()
}

function applyOverlayWindowState(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  if (!currentConfig.overlayEnabled) return
  overlayWin.setOpacity(Math.min(1, Math.max(0.05, currentConfig.opacity)))
  overlayWin.setIgnoreMouseEvents(true, { forward: false })
}

function overlayBoundsForArea(
  area: OverlayAreaPreset,
  bounds: Electron.Rectangle
): { x: number; y: number; width: number; height: number } {
  const { x: dx, y: dy, width: dw, height: dh } = bounds
  const halfW = Math.floor(dw / 2)
  const halfH = Math.floor(dh / 2)
  switch (area) {
    case 'full':
      return { x: dx, y: dy, width: dw, height: dh }
    case 'halfTop':
      return { x: dx, y: dy, width: dw, height: halfH }
    case 'halfBottom':
      return { x: dx, y: dy + halfH, width: dw, height: dh - halfH }
    case 'halfLeft':
      return { x: dx, y: dy, width: halfW, height: dh }
    case 'halfRight':
      return { x: dx + halfW, y: dy, width: dw - halfW, height: dh }
    case 'quarterTL':
      return { x: dx, y: dy, width: halfW, height: halfH }
    case 'quarterTR':
      return { x: dx + halfW, y: dy, width: dw - halfW, height: halfH }
    case 'quarterBL':
      return { x: dx, y: dy + halfH, width: halfW, height: dh - halfH }
    case 'quarterBR':
      return { x: dx + halfW, y: dy + halfH, width: dw - halfW, height: dh - halfH }
    default:
      return { x: dx, y: dy, width: dw, height: dh }
  }
}

function applyOverlayBounds(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  const display = screen.getPrimaryDisplay()
  const b = overlayBoundsForArea(currentConfig.overlayArea, display.bounds)
  overlayWin.setBounds(b)
}

function applyOverlayVisibility(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  if (currentConfig.overlayEnabled) {
    applyOverlayBounds()
    overlayWin.show()
    applyOverlayWindowState()
  } else {
    overlayWin.hide()
    stopDouyu()
    stopSimulate()
    sendDouyuStatus({ state: 'idle', detail: '未连接' })
  }
}

function pushDanmaku(payload: DanmakuPayload): void {
  if (!currentConfig.overlayEnabled) return
  if (!overlayWin || overlayWin.isDestroyed()) return
  if (shouldBlock(currentConfig, payload)) return
  overlayWin.webContents.send(IPC.overlayPushDanmaku, payload)
}

/** WebSocket 断开或开始重连时清空飘屏，避免旧会话弹幕与新会话混在一起 */
function clearOverlayDanmaku(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return
  overlayWin.webContents.send(IPC.overlayClearDanmaku)
}

function stopDouyu(): void {
  douyu?.stop()
  douyu = null
}

function stopSimulate(): void {
  if (simulateTimer) {
    clearInterval(simulateTimer)
    simulateTimer = null
  }
}

function startDouyu(): void {
  stopDouyu()
  const rid = normalizeRoomId(currentConfig.roomId)
  if (!rid || currentConfig.simulateDanmaku) {
    if (currentConfig.overlayEnabled && !currentConfig.simulateDanmaku) {
      sendDouyuStatus({ state: 'idle', detail: '请先填写有效房间号' })
    }
    return
  }

  sendDouyuStatus({ state: 'connecting', detail: `正在连接房间 ${rid} …` })

  douyu = new DouyuWsClient({
    roomId: rid,
    onChat: (msg) => {
      if (currentConfig.filterRobotDanmaku && !msg.dms) return
      pushDanmaku({
        nick: msg.nick || '观众',
        text: msg.text,
        ...(msg.col ? { col: msg.col } : {})
      })
    },
    onError: (e) => {
      console.error('[douyu]', e)
      sendDouyuStatus({ state: 'error', detail: e.message })
    },
    onStatus: (s) => {
      if (s === 'connecting' || s === 'closed') {
        clearOverlayDanmaku()
      }
      if (s === 'open') {
        sendDouyuStatus({ state: 'socket-open', detail: '已连接，等待登录结果…' })
      } else if (s === 'closed') {
        sendDouyuStatus({ state: 'closed', detail: '连接已断开，将自动重试' })
      } else if (s === 'connecting') {
        sendDouyuStatus({ state: 'connecting', detail: `正在连接房间 ${rid} …` })
      }
    },
    onLoginRes: (ok, detail) => {
      if (ok) {
        sendDouyuStatus({ state: 'login-ok', detail: detail || '登录成功，等待弹幕…' })
      } else {
        sendDouyuStatus({ state: 'login-fail', detail: detail || '登录失败，请检查房间号或网络' })
      }
    }
  })
  douyu.start()
}

function startSimulate(): void {
  stopSimulate()
  if (!currentConfig.simulateDanmaku) return
  sendDouyuStatus({ state: 'login-ok', detail: '模拟弹幕模式（未连接斗鱼）' })
  const nicks = ['测试用户', '模拟弹幕', '性能压测', 'Electron', 'Canvas']
  const texts = ['这是一条模拟弹幕', 'Hello 斗鱼', '飘屏测试中……', '1234567890', '模拟洪峰']
  simulateTimer = setInterval(() => {
    pushDanmaku({
      nick: nicks[Math.floor(Math.random() * nicks.length)]!,
      text: texts[Math.floor(Math.random() * texts.length)]!
    })
  }, Math.max(200, currentConfig.simulateIntervalMs))
}

async function syncAppIcons(): Promise<void> {
  const gen = ++iconSyncGeneration
  const rid = normalizeRoomId(currentConfig.roomId)
  const windows = [homeWin, settingsWin, overlayWin]

  const useRoomAvatar =
    currentConfig.overlayEnabled &&
    Boolean(rid) &&
    !currentConfig.simulateDanmaku &&
    lastDouyuStatus.state === 'login-ok'

  const applyAndHomeLogo = (img: NativeImage): void => {
    applyTrayAndWindowIcons(tray, windows, img)
    pushHomeLogoToRenderer(homeWin, img, IPC.homePushLogo)
  }

  if (!useRoomAvatar) {
    applyAndHomeLogo(getDefaultIconImage())
    return
  }

  try {
    const avatarIcon = await fetchAnchorAvatarAsIcon(rid)
    if (gen !== iconSyncGeneration) return
    applyAndHomeLogo(avatarIcon ?? getDefaultIconImage())
  } catch (e) {
    console.error('[app-icons]', e)
    if (gen !== iconSyncGeneration) return
    applyAndHomeLogo(getDefaultIconImage())
  }
}

function refreshSources(): void {
  stopDouyu()
  stopSimulate()
  if (!currentConfig.overlayEnabled) {
    sendDouyuStatus({ state: 'idle' })
    void syncAppIcons()
    return
  }
  if (currentConfig.simulateDanmaku) {
    startSimulate()
    void syncAppIcons()
    return
  }
  startDouyu()
  void syncAppIcons()
}

/** 仅当弹幕源关键字段“实际变化”时才需重启（避免同值写入导致无意义重连） */
function sourceConfigChanged(prev: AppConfig, next: AppConfig): boolean {
  return (
    prev.overlayEnabled !== next.overlayEnabled ||
    prev.roomId !== next.roomId ||
    prev.simulateDanmaku !== next.simulateDanmaku
  )
}

function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const ob = overlayBoundsForArea(currentConfig.overlayArea, display.bounds)

  const win = new BrowserWindow({
    x: ob.x,
    y: ob.y,
    width: ob.width,
    height: ob.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      // 沙箱 + 经 Vite 打包的 ESM preload 在部分环境下会导致脚本未执行，从而无 settingsApi
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setMenuBarVisibility(false)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return win
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 480,
    show: false,
    frame: false,
    transparent: true,
    maximizable: true,
    title: `${APP_DISPLAY_NAME} - 设置`,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      // 沙箱 + 经 Vite 打包的 ESM preload 在部分环境下会导致脚本未执行，从而无 settingsApi
      sandbox: false
    }
  })

  registerChromeWindow(win)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/settings.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings.html'))
  }

  win.on('close', (e) => {
    if (isAppQuitting) return
    e.preventDefault()
    win.hide()
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send(IPC.douyuStatus, lastDouyuStatus)
  })

  return win
}

function createHomeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 410,
    minWidth: 380,
    show: false,
    frame: false,
    transparent: true,
    maximizable: true,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      sandbox: false
    }
  })

  registerChromeWindow(win)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/home.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/home.html'))
  }

  win.on('close', (e) => {
    if (isAppQuitting) return
    e.preventDefault()
    void (async () => {
      if (!currentConfig.dismissedTrayCloseHint) {
        try {
          await dialog.showMessageBox(win, {
            type: 'info',
            title: APP_DISPLAY_NAME,
            message: '已缩小到右下角托盘',
            detail:
              '关闭主窗口不会退出程序。请在任务栏右下角托盘通知区域找到本应用图标；双击可再次打开主界面，右键菜单中可选择「退出」彻底关闭。',
            buttons: ['知道了'],
            defaultId: 0,
            noLink: true
          })
        } catch {
          /* 窗口已销毁等 */
        }
        currentConfig = mergeConfig({
          ...currentConfig,
          dismissedTrayCloseHint: true
        })
        saveConfig(currentConfig)
      }
      if (!win.isDestroyed()) win.hide()
    })()
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send(IPC.douyuStatus, lastDouyuStatus)
    void syncAppIcons()
  })

  return win
}

function openHome(): void {
  if (!homeWin || homeWin.isDestroyed()) return
  homeWin.show()
  homeWin.focus()
}

function openSettings(): void {
  if (!settingsWin || settingsWin.isDestroyed()) return
  settingsWin.show()
  settingsWin.focus()
}

function quitAppFully(): void {
  isAppQuitting = true
  app.quit()
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const on = currentConfig.overlayEnabled
  const menu = Menu.buildFromTemplate([
    {
      label: on ? '关闭飘屏（停止连接）' : '开启飘屏',
      click: () => {
        currentConfig.overlayEnabled = !currentConfig.overlayEnabled
        saveConfig(currentConfig)
        applyOverlayVisibility()
        broadcastConfig()
        refreshSources()
      }
    },
    {
      label: '打开主界面',
      click: () => {
        openHome()
      }
    },
    {
      label: '设置…',
      click: () => {
        openSettings()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitAppFully()
      }
    }
  ])
  tray.setContextMenu(menu)
}

function createTray(): void {
  tray = new Tray(trayImageFromSource(getDefaultIconImage()))
  tray.setToolTip(APP_DISPLAY_NAME)
  tray.on('double-click', () => openHome())
  rebuildTrayMenu()
}

function registerIpc(): void {
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  ipcMain.handle(IPC.configGet, () => currentConfig)

  ipcMain.handle(IPC.configSet, (_e, partial: Partial<AppConfig>) => {
    const prevConfig = currentConfig
    if (partial.roomId !== undefined) {
      partial.roomId = normalizeRoomId(String(partial.roomId))
    }
    currentConfig = mergeConfig({ ...currentConfig, ...partial })
    saveConfig(currentConfig)
    applyOverlayVisibility()
    applyOverlayWindowState()
    broadcastConfig()
    if (sourceConfigChanged(prevConfig, currentConfig)) {
      refreshSources()
    }
    rebuildTrayMenu()
    return currentConfig
  })

  ipcMain.handle(IPC.douyuReconnect, () => {
    refreshSources()
    return true
  })

  ipcMain.handle(IPC.windowOpenSettings, () => {
    openSettings()
    return true
  })

  ipcMain.on(IPC.windowClose, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) win.close()
  })

  ipcMain.on(IPC.windowMinimize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) win.minimize()
  })

  ipcMain.on(IPC.windowToggleMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    toggleWorkAreaMaximize(win)
  })

  ipcMain.on(IPC.windowDragStart, (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    ensureUnmaximizedForDrag(win)
    const b = win.getBounds()
    dragSession = {
      win,
      offsetX: screenX - b.x,
      offsetY: screenY - b.y,
      width: b.width,
      height: b.height,
      lastX: b.x,
      lastY: b.y
    }
  })

  ipcMain.on(IPC.windowDragMove, (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    if (!dragSession || dragSession.win.isDestroyed() || dragSession.win.id !== win.id) return
    const { offsetX, offsetY, width, height } = dragSession
    const nx = Math.round(screenX - offsetX)
    const ny = Math.round(screenY - offsetY)
    if (nx === dragSession.lastX && ny === dragSession.lastY) return
    dragSession.lastX = nx
    dragSession.lastY = ny
    win.setBounds({
      x: nx,
      y: ny,
      width,
      height
    })
  })

  ipcMain.on(IPC.windowDragEnd, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (
      win &&
      !win.isDestroyed() &&
      dragSession &&
      dragSession.win.id === win.id
    ) {
      const s = chromeLayoutByWindow.get(win)
      if (s && !s.workAreaMaximized) s.normalBounds = win.getBounds()
    }
    dragSession = null
  })
}

function whenReady(): void {
  currentConfig = loadConfig()
  registerIpc()
  overlayWin = createOverlayWindow()
  homeWin = createHomeWindow()
  settingsWin = createSettingsWindow()
  createTray()
  void syncAppIcons()

  screen.on('display-metrics-changed', () => {
    applyOverlayBounds()
  })

  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin?.webContents.send(IPC.overlayPushConfig, currentConfig)
    applyOverlayVisibility()
    applyOverlayWindowState()
    refreshSources()
  })

  openHome()

  app.on('activate', () => {
    openHome()
  })
}

app.setName(APP_DISPLAY_NAME)
app.whenReady().then(whenReady)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    /* 有托盘时保留后台 */
  }
})

app.on('before-quit', () => {
  isAppQuitting = true
  stopDouyu()
  stopSimulate()
  tray?.destroy()
  tray = null
})

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
})
