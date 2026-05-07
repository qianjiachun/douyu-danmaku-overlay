import type { AppConfig } from '../shared/config'
import type { DouyuStatusPayload } from '../shared/douyuStatus'
import type { UpdateCheckResult } from '../shared/updateCheck'
import { bindTitlebarChrome } from './titlebarChrome'

const roomEl = document.getElementById('roomId') as HTMLInputElement
const connEl = document.getElementById('connStatus')!
const toggleEl = document.getElementById('toggle') as HTMLButtonElement
const verEl = document.getElementById('appVersion')
const updateHintEl = document.getElementById('updateHint') as HTMLButtonElement | null

let lastUpdateOpenUrl: string | null = null

function applyUpdateHint(r: UpdateCheckResult): void {
  lastUpdateOpenUrl = null
  if (!updateHintEl) return
  if (r.ok && r.hasUpdate && r.openUrl && r.latestVersion) {
    lastUpdateOpenUrl = r.openUrl
    updateHintEl.hidden = false
    updateHintEl.textContent = `v${r.latestVersion} 可下载`
    updateHintEl.title = '前往下载新版安装包'
    return
  }
  updateHintEl.hidden = true
}

// Window controls
document.getElementById('winClose')?.addEventListener('click', () => {
  window.settingsApi?.closeWindow()
})
document.getElementById('winMin')?.addEventListener('click', () => {
  window.settingsApi?.minimizeWindow()
})
document.getElementById('winMax')?.addEventListener('click', () => {
  window.settingsApi?.toggleMaximizeWindow()
})

bindTitlebarChrome()

function setConnStatus(payload: DouyuStatusPayload): void {
  connEl.className = 'status-pill'
  let text = ''
  switch (payload.state) {
    case 'idle':
      text = payload.detail || '未连接'
      connEl.classList.add('warn')
      break
    case 'connecting':
      text = '连接中…'
      connEl.classList.add('warn')
      break
    case 'socket-open':
      text = '握手…'
      connEl.classList.add('warn')
      break
    case 'login-ok':
      text = '已连接'
      connEl.classList.add('ok')
      break
    case 'login-fail':
      text = '连接失败'
      connEl.classList.add('err')
      break
    case 'closed':
      text = '已断开连接'
      connEl.classList.add('warn')
      break
    case 'error':
      text = '发生错误'
      connEl.classList.add('err')
      break
    default:
      text = '未知状态'
  }
  connEl.textContent = text
}

function applyToggleUi(c: AppConfig): void {
  const iconSpan = toggleEl.querySelector('svg')!
  const textSpan = toggleEl.querySelector('span')!
  if (c.overlayEnabled) {
    textSpan.textContent = '停止飘屏'
    toggleEl.classList.remove('off')
    iconSpan.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>'
  } else {
    textSpan.textContent = '启动飘屏'
    toggleEl.classList.add('off')
    iconSpan.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>'
  }
}

async function load(): Promise<void> {
  if (!window.settingsApi) {
    connEl.textContent = '初始化失败，请重启程序'
    connEl.className = 'status-pill err'
    return
  }
  const c = await window.settingsApi.getConfig()
  roomEl.value = c.roomId
  applyToggleUi(c)

  if (verEl && window.settingsApi.getAppVersion && window.settingsApi.checkUpdate) {
    try {
      const [v, upd] = await Promise.all([
        window.settingsApi.getAppVersion(),
        window.settingsApi.checkUpdate(false)
      ])
      verEl.textContent = v ? `v${v}` : ''
      applyUpdateHint(upd)
    } catch {
      verEl.textContent = ''
      applyUpdateHint({
        ok: false,
        currentVersion: '',
        hasUpdate: false,
        checkedAt: Date.now()
      })
    }
  }
}

async function persistRoom(): Promise<void> {
  if (!window.settingsApi?.setConfig) return
  await window.settingsApi.setConfig({ roomId: roomEl.value.trim() })
}

toggleEl.addEventListener('click', async () => {
  if (!window.settingsApi?.setConfig) return
  const c = await window.settingsApi.getConfig()
  if (c.overlayEnabled) {
    await window.settingsApi.setConfig({ overlayEnabled: false })
    return
  }
  const rid = roomEl.value.trim()
  if (!c.simulateDanmaku && !rid) {
    setConnStatus({ state: 'idle', detail: '请先输入房间号' })
    roomEl.focus()
    return
  }
  await window.settingsApi.setConfig({
    roomId: rid || c.roomId,
    overlayEnabled: true
  })
})

roomEl.addEventListener('blur', () => {
  void persistRoom()
})

roomEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    roomEl.blur()
    if (toggleEl.classList.contains('off')) {
      toggleEl.click()
    }
  }
})

document.getElementById('openSettings')!.addEventListener('click', async () => {
  if (!window.settingsApi?.openSettingsWindow) return
  await window.settingsApi.openSettingsWindow()
})

updateHintEl?.addEventListener('click', async () => {
  if (!lastUpdateOpenUrl || !window.settingsApi?.openExternal) return
  await window.settingsApi.openExternal(lastUpdateOpenUrl)
})

void load()

if (window.settingsApi) {
  window.settingsApi.onHomeLogo((dataUrl) => {
    const el = document.getElementById('homeLogo') as HTMLImageElement | null
    if (el && dataUrl) el.src = dataUrl
  })

  window.settingsApi.onConfig((c) => {
    roomEl.value = c.roomId
    applyToggleUi(c)
  })

  window.settingsApi.onDouyuStatus((p) => {
    setConnStatus(p)
  })

  window.settingsApi.onUpdateInfo((r) => {
    applyUpdateHint(r)
  })
}