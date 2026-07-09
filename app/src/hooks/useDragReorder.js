import { useCallback, useEffect, useId, useRef, useState } from 'react'

// Pointer-based drag-to-reorder with LIVE reflow. We use pointer events (not
// HTML5 drag-and-drop) because Tauri/WebKitGTK swallows the DOM `drop` event when
// `dragDropEnabled` is on (needed for OS file drops) — so HTML5 DnD never fires.
//
// While dragging, the displayed order (`order`) is reshuffled as the pointer moves
// through item geometry, so surrounding items visibly make room. On release the
// final order is committed via onReorder(). Spread `dragProps(id)` onto each
// item's wrapper.
export function useDragReorder(ids, onReorder, enabled = true, groupName = 'reorder') {
  const [order, setOrder] = useState(ids)
  const [activeId, setActiveId] = useState(null)
  const reactId = useId()
  const groupId = `${groupName}-${reactId.replace(/:/g, '')}`
  const drag = useRef({ id: null, pointerId: null, active: false, x0: 0, y0: 0, captured: null })
  const itemRefs = useRef(new Map())
  const orderRef = useRef(ids)
  const onReorderRef = useRef(onReorder)
  const suppressClickRef = useRef(false)
  onReorderRef.current = onReorder

  // Resync the display order with incoming ids whenever we're not mid-drag
  // (covers external changes + the post-commit re-sort).
  useEffect(() => {
    if (!drag.current.active) { setOrder(ids); orderRef.current = ids }
  }, [ids])

  const setItemRef = useCallback((id, node) => {
    const key = String(id)
    if (node) itemRefs.current.set(key, node)
    else itemRefs.current.delete(key)
  }, [])

  const reorderAtPoint = useCallback((draggedId, clientX, clientY) => {
    setOrder((prev) => {
      const activeKey = String(draggedId)
      if (!prev.some((id) => String(id) === activeKey)) return prev

      const rest = prev.filter((id) => String(id) !== activeKey)
      const rects = rest
        .map((id, index) => {
          const el = itemRefs.current.get(String(id))
          if (!el) return null
          return { id, index, rect: el.getBoundingClientRect() }
        })
        .filter(Boolean)

      const firstRowTop = rects[0]?.rect.top ?? 0
      const firstRowHeight = rects[0]?.rect.height ?? 0
      const columns = rects.filter(({ rect }) => Math.abs(rect.top - firstRowTop) < firstRowHeight / 2).length

      let insertAt = rest.length
      for (const item of rects) {
        const { rect, index } = item
        const midY = rect.top + rect.height / 2
        const midX = rect.left + rect.width / 2
        if (columns <= 1) {
          if (clientY < midY) {
            insertAt = index
            break
          }
          continue
        }
        const rowBand = Math.max(12, rect.height / 2)
        if (clientY < midY - rowBand || (Math.abs(clientY - midY) <= rowBand && clientX < midX)) {
          insertAt = index
          break
        }
      }

      const next = rest.slice()
      next.splice(insertAt, 0, draggedId)
      if (next.length === prev.length && next.every((id, i) => String(id) === String(prev[i]))) return prev
      orderRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    const move = (e) => {
      const d = drag.current
      if (!d.id || (d.pointerId != null && e.pointerId !== d.pointerId)) return
      if (!d.active) {
        if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 10) return
        d.active = true
        suppressClickRef.current = true
        setActiveId(d.id)
        try { d.captured?.setPointerCapture?.(d.pointerId) } catch { /* ignore */ }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      e.preventDefault()
      reorderAtPoint(d.id, e.clientX, e.clientY)
    }
    const up = (e) => {
      const d = drag.current
      if (!d.id || (d.pointerId != null && e.pointerId !== d.pointerId)) return
      if (d.active) {
        e.preventDefault()
        onReorderRef.current(orderRef.current)
        setTimeout(() => { suppressClickRef.current = false }, 0)
      }
      try { d.captured?.releasePointerCapture?.(d.pointerId) } catch { /* ignore */ }
      drag.current = { id: null, pointerId: null, active: false, x0: 0, y0: 0, captured: null }
      setActiveId(null)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [reorderAtPoint])

  const dragProps = (id) => ({
    ref: (node) => setItemRef(id, node),
    draggable: false,
    'data-reorder-group': groupId,
    'data-reorder-id': id,
    'data-dragging': String(activeId) === String(id) ? '' : undefined,
    onPointerDown: (e) => {
      // Don't start a drag from controls inside a card. Card links are allowed:
      // a real drag suppresses the follow-up click, while a normal click still opens.
      if (!enabled || e.button !== 0 || e.target?.closest?.('button, input, textarea, select')) return
      suppressClickRef.current = false
      drag.current = { id, pointerId: e.pointerId, active: false, x0: e.clientX, y0: e.clientY, captured: e.currentTarget }
    },
    onClickCapture: (e) => {
      if (!suppressClickRef.current) return
      e.preventDefault()
      e.stopPropagation()
      suppressClickRef.current = false
    },
  })

  return { order, dragProps, activeId }
}
