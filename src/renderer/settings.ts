import {
  OVERLAY_AREA_OPTIONS,
  parseBlockWordsText,
  type AppConfig,
  type DuplicateDanmakuMode,
  type OverlayAreaPreset,
  type OverlayDisplayListItem
} from '../shared/config'
import { bindTitlebarChrome } from './titlebarChrome'

const $ = (id: string) => document.getElementById(id) as HTMLInputElement
const areaGrid = document.getElementById('areaGrid')!

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

let areaButtons: HTMLButtonElement[] = []

function highlightArea(area: OverlayAreaPreset): void {
  for (const b of areaButtons) {
    b.classList.toggle('active', b.dataset.area === area)
  }
}

function updateLabels(): void {
  const op = Number($('opacity').value)
  const fs = Number($('fontSize').value)
  const sp = Number($('speed').value)
  const oEl = document.getElementById('opacityVal')
  const fEl = document.getElementById('fontSizeVal')
  const sEl = document.getElementById('speedVal')
  if (oEl) oEl.textContent = op.toFixed(2)
  if (fEl) fEl.textContent = String(Math.round(fs))
  if (sEl) sEl.textContent = String(Math.round(sp))
}

function readBlockWords(): string[] {
  return parseBlockWordsText($('block').value)
}

function readBlockNicks(): string[] {
  return parseBlockWordsText($('blockNicks').value)
}

function displaySelect(): HTMLSelectElement {
  return document.getElementById('overlayDisplay') as HTMLSelectElement
}

function syncDisplaySelection(c: AppConfig): void {
  const sel = displaySelect()
  if (c.overlayDisplayMode === 'specific' && c.overlayDisplayId) {
    const hit = [...sel.options].some((o) => o.value === c.overlayDisplayId)
    if (hit) {
      sel.value = c.overlayDisplayId
      return
    }
  }
  sel.value = 'primary'
}

function fillOverlayDisplayOptions(items: OverlayDisplayListItem[], c: AppConfig): void {
  const sel = displaySelect()
  sel.innerHTML = ''
  const prim = document.createElement('option')
  prim.value = 'primary'
  prim.textContent = '主显示器（默认）'
  sel.appendChild(prim)
  for (const it of items) {
    const o = document.createElement('option')
    o.value = it.id
    o.textContent = it.label
    sel.appendChild(o)
  }
  sel.disabled = items.length <= 1
  syncDisplaySelection(c)
}

async function refreshOverlayDisplayOptions(c: AppConfig): Promise<void> {
  if (!window.settingsApi?.listDisplays) return
  const items = await window.settingsApi.listDisplays()
  fillOverlayDisplayOptions(items, c)
}

function syncFormFromConfig(c: AppConfig): void {
  const blockEl = $('block')
  if (document.activeElement !== blockEl) blockEl.value = c.blockWords.join(', ')
  const blockNicksEl = $('blockNicks')
  if (document.activeElement !== blockNicksEl) blockNicksEl.value = c.blockNicks.join(', ')
  $('overlayOn').checked = c.overlayEnabled
  $('simulate').checked = c.simulateDanmaku
  $('simMs').value = String(c.simulateIntervalMs)
  $('opacity').value = String(c.opacity)
  $('fontSize').value = String(c.fontSize)
  $('speed').value = String(c.speedPxPerSec)
  $('maxOn').value = String(c.maxOnScreen)
  $('maxQ').value = String(c.maxQueue)
  $('lanePad').value = String(c.lanePadding)
  $('fontColor').value = c.fontColor
  $('showDanmakuColor').checked = c.showDanmakuColor
  $('filterRobotDanmaku').checked = c.filterRobotDanmaku
  $('dupMode').value = c.duplicateDanmakuMode
  $('dupWindowSec').value = String(c.duplicateMergeWindowSec)
  highlightArea(c.overlayArea)
  updateLabels()
}

function syncFromConfig(c: AppConfig): void {
  syncFormFromConfig(c)
  syncDisplaySelection(c)
}

async function applyNow(partial: Partial<AppConfig>): Promise<void> {
  if (!window.settingsApi?.setConfig) return
  await window.settingsApi.setConfig(partial)
}

async function load(): Promise<void> {
  if (!window.settingsApi) return
  const c = await window.settingsApi.getConfig()
  syncFormFromConfig(c)
  await refreshOverlayDisplayOptions(c)
}

void load()

if (window.settingsApi) {
  window.settingsApi.onConfig((c) => {
    syncFromConfig(c)
  })
}

$('overlayDisplay').addEventListener('change', () => {
  const v = displaySelect().value
  if (v === 'primary') {
    void applyNow({ overlayDisplayMode: 'primary', overlayDisplayId: '' })
  } else {
    void applyNow({ overlayDisplayMode: 'specific', overlayDisplayId: v })
  }
})

window.addEventListener('focus', () => {
  if (!window.settingsApi?.getConfig || !window.settingsApi.listDisplays) return
  void (async () => {
    const c = await window.settingsApi!.getConfig()
    await refreshOverlayDisplayOptions(c)
  })()
})

for (const opt of OVERLAY_AREA_OPTIONS) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'area-btn'
  b.textContent = opt.label
  b.dataset.area = opt.value
  b.addEventListener('click', async () => {
    await applyNow({ overlayArea: opt.value })
    highlightArea(opt.value)
  })
  areaGrid.appendChild(b)
  areaButtons.push(b)
}

$('opacity').addEventListener('input', () => {
  updateLabels()
  const v = Math.min(1, Math.max(0.05, Number($('opacity').value) || 0.92))
  void applyNow({ opacity: v })
})

$('fontSize').addEventListener('input', () => {
  updateLabels()
  const v = Math.min(48, Math.max(12, Number($('fontSize').value) || 22))
  void applyNow({ fontSize: v })
})

$('speed').addEventListener('input', () => {
  updateLabels()
  const v = Math.min(320, Math.max(40, Number($('speed').value) || 140))
  void applyNow({ speedPxPerSec: v })
})

$('fontColor').addEventListener('input', () => {
  void applyNow({ fontColor: $('fontColor').value })
})

$('showDanmakuColor').addEventListener('change', () => {
  void applyNow({ showDanmakuColor: $('showDanmakuColor').checked })
})

$('filterRobotDanmaku').addEventListener('change', () => {
  void applyNow({ filterRobotDanmaku: $('filterRobotDanmaku').checked })
})

$('overlayOn').addEventListener('change', () => {
  void applyNow({ overlayEnabled: $('overlayOn').checked })
})

$('simulate').addEventListener('change', () => {
  void applyNow({ simulateDanmaku: $('simulate').checked })
})

$('dupMode').addEventListener('change', () => {
  void applyNow({ duplicateDanmakuMode: $('dupMode').value as DuplicateDanmakuMode })
})

function readNumericPartial(): Partial<AppConfig> {
  return {
    simulateIntervalMs: Math.max(200, Number($('simMs').value) || 800),
    maxOnScreen: Math.min(200, Math.max(5, Number($('maxOn').value) || 40)),
    maxQueue: Math.min(2000, Math.max(20, Number($('maxQ').value) || 200)),
    lanePadding: Math.min(40, Math.max(0, Number($('lanePad').value) || 6)),
    duplicateMergeWindowSec: Math.min(300, Math.max(1, Math.round(Number($('dupWindowSec').value) || 10)))
  }
}

for (const id of ['simMs', 'maxOn', 'maxQ', 'lanePad', 'dupWindowSec'] as const) {
  $(id).addEventListener('change', () => {
    void applyNow(readNumericPartial())
  })
}

$('block').addEventListener('blur', () => {
  void applyNow({ blockWords: readBlockWords() })
})

$('blockNicks').addEventListener('blur', () => {
  void applyNow({ blockNicks: readBlockNicks() })
})