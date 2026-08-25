import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// Pointer-based drag-to-reorder with LIVE reflow. We use pointer events (not
// HTML5 drag-and-drop) because Tauri/WebKitGTK swallows the DOM `drop` event when
// `dragDropEnabled` is on (needed for OS file drops) — so HTML5 DnD never fires.
//
// While dragging, the displayed order (`order`) is reshuffled as the pointer moves
// through item geometry, so surrounding items visibly make room. On release the
// final order is committed via onReorder(). Spread `dragProps(id)` onto each
// item's wrapper.
// opts.animate — when true, items SLIDE to their new positions via FLIP as the order
// changes (browser-tab feel) instead of snapping. Off by default so existing callers
// (the vertical note/notebook lists) keep their current instant behaviour untouched.
// opts.glue — the dragged item follows the cursor. Separate from `animate`: FLIP
// for the OTHER items is only sane for a handful of them, and on a grid of forty
// notes it thrashes (every reorder re-measures every card, and stale rects from a
// previous filter make the whole grid slide in from wherever it used to be).
// `glue` gives the "I am holding this" feedback without any of that.
//
// opts.dropSelector / opts.onDropZone — external targets a dragged item can be
// released onto instead of being reordered (the notebook strip, so a note can be
// filed by dragging). Any element matching `dropSelector` with a `data-drop-zone`
// is a target; while the pointer is over one, reordering is suspended and
// `hoverZone` names it so the target can light up. Hit-tested with
// elementFromPoint rather than a registry of rects, so nothing has to stay in
// sync as the strip re-renders under the drag.
//
// Pointer events, not HTML5 drag: WebKitGTK swallows `drop` when Tauri's
// file-drop is on, which is why this hook exists at all.
export function useDragReorder(ids, onReorder, enabled = true, groupName = 'reorder', opts = {}) {
  const { animate = false, axis = 'both', glue = animate, dropSelector = null, onDropZone = null } = opts
  const [order, setOrder] = useState(ids)
  const [activeId, setActiveId] = useState(null)
  const reactId = useId()
  const groupId = `${groupName}-${reactId.replace(/:/g, '')}`
  const drag = useRef({ id: null, pointerId: null, active: false, x0: 0, y0: 0, grabDX: 0, grabDY: 0, captured: null })
  const itemRefs = useRef(new Map())
  const orderRef = useRef(ids)
  const onReorderRef = useRef(onReorder)
  const suppressClickRef = useRef(false)
  const pointerRef = useRef({ x: 0, y: 0 })   // latest pointer, for cursor-glue
  const [hoverZone, setHoverZone] = useState(null)
  const hoverZoneRef = useRef(null)
  const onDropZoneRef = useRef(onDropZone)
  onDropZoneRef.current = onDropZone
  const prevRects = useRef(new Map())          // last measured item positions, for FLIP
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

  // Glue the actively-dragged item to the cursor. We clear its transform, read its
  // TRUE laid-out slot (which shifts as siblings reorder around it), then translate it
  // so the point the user grabbed stays under the pointer. Because we re-measure each
  // call, it stays correct no matter how the slot moved. `axis` pins it to one axis
  // (tabs: 'x'), so a tab doesn't fly out of the strip.
  const glueActive = useCallback(() => {
    const d = drag.current
    if (!glue || !d.active || d.id == null) return
    const el = itemRefs.current.get(String(d.id))
    if (!el) return
    el.style.transition = 'none'
    el.style.transform = ''
    const base = el.getBoundingClientRect()
    const { x, y } = pointerRef.current
    const tx = axis === 'y' ? 0 : (x - d.grabDX) - base.left
    const ty = axis === 'x' ? 0 : (y - d.grabDY) - base.top
    el.style.transform = `translate(${tx}px, ${ty}px)`
    el.style.zIndex = '6'
  }, [glue, axis])

  // Which registered zone contains the pointer, or null. Cheap: a handful of
  // elements, and only while a drag is actually in flight.
  const zoneAt = useCallback((x, y) => {
    if (!dropSelector) return null
    // The dragged card is glued under the cursor, so it would be the topmost
    // element at that point and every hit test would find itself. Lift it out of
    // hit-testing for the length of the call rather than leaving it
    // pointer-events:none, which can drop the pointer capture mid-drag.
    const self = itemRefs.current.get(String(drag.current.id))
    const prev = self ? self.style.pointerEvents : null
    if (self) self.style.pointerEvents = 'none'
    const hit = document.elementFromPoint(x, y)
    if (self) self.style.pointerEvents = prev || ''
    return hit?.closest?.(dropSelector)?.dataset?.dropZone ?? null
  }, [dropSelector])

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
      pointerRef.current = { x: e.clientX, y: e.clientY }

      // A drop zone wins over the grid: while the pointer is over one, the item is
      // being filed, not moved, so the grid must stop reshuffling under it.
      const zone = zoneAt(e.clientX, e.clientY)
      if (zone !== hoverZoneRef.current) {
        hoverZoneRef.current = zone
        setHoverZone(zone)
      }
      if (zone == null) reorderAtPoint(d.id, e.clientX, e.clientY)
      glueActive() // follow the cursor even when the pointer moves without a reorder
    }
    const up = (e) => {
      const d = drag.current
      if (!d.id || (d.pointerId != null && e.pointerId !== d.pointerId)) return
      if (d.active) {
        e.preventDefault()
        const zone = hoverZoneRef.current
        if (zone != null && onDropZoneRef.current) onDropZoneRef.current(d.id, zone)
        else onReorderRef.current(orderRef.current)
        if (glue) {
          // Settle the lifted item into its committed slot, then let the next FLIP
          // pass treat it as fresh (drop its stale rect so it doesn't jump).
          const el = itemRefs.current.get(String(d.id))
          if (el) {
            el.style.transition = 'transform 0.16s ease'
            el.style.transform = ''
            el.style.zIndex = ''
            prevRects.current.delete(String(d.id))
          }
        }
        setTimeout(() => { suppressClickRef.current = false }, 0)
      }
      try { d.captured?.releasePointerCapture?.(d.pointerId) } catch { /* ignore */ }
      drag.current = { id: null, pointerId: null, active: false, x0: 0, y0: 0, grabDX: 0, grabDY: 0, captured: null }
      hoverZoneRef.current = null
      setHoverZone(null)
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
  }, [reorderAtPoint, glueActive, animate, glue, zoneAt])

  // FLIP for the NON-dragged items: after each reorder, measure where each landed,
  // snap it back to its previous spot with no transition, then release it next frame
  // so it slides. The dragged item is glued to the cursor instead (skipped here).
  // Runs only for `animate` callers (a handful of items); never touches transform off.
  useLayoutEffect(() => {
    if (!animate) {
      prevRects.current = new Map()
      // Glue still has to be re-applied after a reorder re-render: the item's slot
      // has moved, and its inline transform is now measured against the old one.
      if (glue && drag.current.active) glueActive()
      return
    }
    const activeKey = drag.current.active ? String(drag.current.id) : null
    const next = new Map()
    for (const [key, el] of itemRefs.current) {
      if (!el) continue
      if (key === activeKey) { glueActive(); continue } // cursor-glued, not FLIP'd
      const rect = el.getBoundingClientRect()
      next.set(key, { left: rect.left, top: rect.top })
      const prev = prevRects.current.get(key)
      if (prev && (prev.left !== rect.left || prev.top !== rect.top)) {
        el.style.transition = 'none'
        el.style.transform = `translate(${prev.left - rect.left}px, ${prev.top - rect.top}px)`
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.16s ease'
          el.style.transform = ''
        })
      }
    }
    prevRects.current = next
  })

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
      // grabD* = where inside the item the pointer landed, so cursor-glue keeps that
      // exact point under the pointer rather than snapping the item's corner to it.
      const r = e.currentTarget.getBoundingClientRect()
      drag.current = { id, pointerId: e.pointerId, active: false, x0: e.clientX, y0: e.clientY, grabDX: e.clientX - r.left, grabDY: e.clientY - r.top, captured: e.currentTarget }
    },
    onClickCapture: (e) => {
      if (!suppressClickRef.current) return
      e.preventDefault()
      e.stopPropagation()
      suppressClickRef.current = false
    },
  })

  return { order, dragProps, activeId, hoverZone }
}
