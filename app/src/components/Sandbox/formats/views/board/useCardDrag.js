import { useRef, useState } from 'react'

const DRAG_PX = 5

/**
 * Dragging cards between cells (Kanban, Matrix). A press on a card that moves
 * more than a few pixels lifts it: the card follows the pointer (a transform,
 * only while dragging) and the cell and card under the pointer are tracked
 * through `data-cell` / `data-rid`. A press that doesn't move is a click.
 *
 * `drag` = { rid, cell, over, place } while a card is lifted — the view draws
 * the drop mark from it. The release is heard on the window, so it counts
 * wherever it happens; Esc (or losing the pointer) puts the card back.
 */
export function useCardDrag({ rootRef, scrollRef, onDrop, onClick }) {
    const [drag, setDragState] = useState(null)
    const ref = useRef(null)
    const setDrag = (v) => { ref.current = v; setDragState(v) }

    const autoScroll = (ev) => {
        const sc = scrollRef.current
        if (!sc) return
        const r = sc.getBoundingClientRect()
        if (ev.clientY < r.top + 30) sc.scrollTop -= 12
        else if (ev.clientY > r.bottom - 30) sc.scrollTop += 12
        if (ev.clientX < r.left + 30) sc.scrollLeft -= 12
        else if (ev.clientX > r.right - 30) sc.scrollLeft += 12
    }

    const down = (e, rid) => {
        if (e.button !== 0 || e.target.closest('button, input, textarea, select')) return
        e.stopPropagation()
        const card = e.currentTarget
        const x0 = e.clientX, y0 = e.clientY
        // Screen px per CSS px (the board's zoom): the card follows the pointer exactly.
        const scale = card.getBoundingClientRect().width / (card.offsetWidth || 1) || 1
        let dragging = false
        const sx0 = scrollRef.current?.scrollLeft || 0, sy0 = scrollRef.current?.scrollTop || 0
        const end = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', cancel)
            window.removeEventListener('keydown', esc, true)
            card.style.transform = ''
            card.style.pointerEvents = ''
            card.style.zIndex = ''
        }
        const move = (ev) => {
            if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return
            if (!dragging) {
                dragging = true
                card.style.pointerEvents = 'none'   // so the point below it is the cell, not the card
                card.style.zIndex = '30'
            }
            autoScroll(ev)
            const dsx = (scrollRef.current?.scrollLeft || 0) - sx0, dsy = (scrollRef.current?.scrollTop || 0) - sy0
            card.style.transform = `translate(${(ev.clientX - x0) / scale + dsx}px, ${(ev.clientY - y0) / scale + dsy}px) rotate(1.5deg)`
            const el = document.elementFromPoint(ev.clientX, ev.clientY)
            const cellEl = el?.closest?.('[data-cell]')
            if (!cellEl || !rootRef.current?.contains(cellEl)) { if (ref.current?.cell != null) setDrag({ rid }); else if (!ref.current) setDrag({ rid }); return }
            const cell = cellEl.getAttribute('data-cell')
            const overEl = el.closest('[data-rid]')
            let over = null, place = null
            if (overEl && cellEl.contains(overEl) && overEl.getAttribute('data-rid') !== rid) {
                const r = overEl.getBoundingClientRect()
                over = overEl.getAttribute('data-rid')
                place = ev.clientY < r.top + r.height / 2 ? 'before' : 'after'
            }
            const cur = ref.current
            if (!cur || cur.cell !== cell || cur.over !== over || cur.place !== place) setDrag({ rid, cell, over, place })
        }
        const up = (ev) => {
            end()
            const d = ref.current
            setDrag(null)
            if (!dragging) { onClick?.(ev, rid); return }
            if (d?.cell != null) onDrop(d)
        }
        const cancel = () => { end(); setDrag(null) }
        const esc = (ev) => { if (ev.key === 'Escape' && dragging) { ev.stopPropagation(); cancel() } }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', cancel)
        window.addEventListener('keydown', esc, true)
    }

    return { drag, down }
}
