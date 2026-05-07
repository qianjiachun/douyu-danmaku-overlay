/** 无边框窗口：标题栏双击最大化与拖拽（避免 -webkit-app-region: drag 吞掉双击事件） */

const DRAG_THRESHOLD_PX = 5

export function bindTitlebarChrome(): void {
  const api = window.settingsApi
  if (!api?.windowDragStart || !api.windowDragMove || !api.windowDragEnd) return

  const bar = document.getElementById('titlebar')
  if (!bar) return

  bar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.titlebar-controls')) return
    e.preventDefault()
    api.toggleMaximizeWindow()
  })

  bar.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.titlebar-controls')) return
    if (e.detail >= 2) return

    const barEl = bar
    const pointerId = e.pointerId
    let armed = true
    let dragging = false
    const sx0 = e.screenX
    const sy0 = e.screenY

    let rafId = 0
    let pending: { sx: number; sy: number } | null = null

    const flushPending = (): void => {
      rafId = 0
      if (!armed || !dragging || !pending) {
        pending = null
        return
      }
      const { sx, sy } = pending
      pending = null
      api.windowDragMove(sx, sy)
    }

    const scheduleMove = (sx: number, sy: number): void => {
      if (!armed || !dragging) return
      pending = { sx, sy }
      if (!rafId) rafId = requestAnimationFrame(flushPending)
    }

    const teardown = (): void => {
      if (!armed) return
      armed = false

      barEl.removeEventListener('pointermove', onPointerMove)
      barEl.removeEventListener('pointerup', onPointerUp)
      barEl.removeEventListener('pointercancel', onPointerUp)
      barEl.removeEventListener('lostpointercapture', onLostCapture)

      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }

      try {
        if (barEl.hasPointerCapture(pointerId)) barEl.releasePointerCapture(pointerId)
      } catch {
        /* ignore */
      }

      if (dragging && pending) {
        api.windowDragMove(pending.sx, pending.sy)
        pending = null
      }
      if (dragging) api.windowDragEnd()
      dragging = false
    }

    const onPointerMove = (pe: PointerEvent): void => {
      if (!armed || pe.pointerId !== pointerId) return
      if (!dragging) {
        if (
          Math.abs(pe.screenX - sx0) < DRAG_THRESHOLD_PX &&
          Math.abs(pe.screenY - sy0) < DRAG_THRESHOLD_PX
        ) {
          return
        }
        dragging = true
        api.windowDragStart(pe.screenX, pe.screenY)
      }
      scheduleMove(pe.screenX, pe.screenY)
    }

    const onPointerUp = (pe: PointerEvent): void => {
      if (pe.pointerId !== pointerId) return
      teardown()
    }

    const onLostCapture = (): void => {
      teardown()
    }

    try {
      barEl.setPointerCapture(pointerId)
    } catch {
      /* 极少见：节点未在文档中 */
    }

    barEl.addEventListener('pointermove', onPointerMove)
    barEl.addEventListener('pointerup', onPointerUp)
    barEl.addEventListener('pointercancel', onPointerUp)
    barEl.addEventListener('lostpointercapture', onLostCapture)
  })
}
