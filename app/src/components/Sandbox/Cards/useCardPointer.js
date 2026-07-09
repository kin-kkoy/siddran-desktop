import { useRef } from 'react'

/**
 * Shared pointer behaviour for DOM cards (note / task / text):
 *   - eraser tool  → click deletes
 *   - otherwise    → select on down (shift = additive) + drag to move
 * Drag is wrapped in a history transaction so a move is one undo step, and
 * zoom-compensated like the original AttachedNoteCard.
 *
 * Children that should NOT start a drag/select (links, buttons, edit areas)
 * carry `data-sb-card-title`, a <button>, or `data-sb-noedit`.
 */
export function useCardPointer({ item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction }) {
    const elRef = useRef(null)
    const dragRef = useRef(null)

    const onPointerDown = (e) => {
        if (e.target.closest('button') || e.target.closest('[data-sb-card-title]') || e.target.closest('[data-sb-noedit]')) return
        if (tool === 'eraser') { e.stopPropagation(); onRemove?.(item.id); return }
        e.stopPropagation()
        onSelect?.(item.id, e.shiftKey)
        beginTransaction?.()
        dragRef.current = {
            startX: e.clientX, startY: e.clientY,
            originX: item.x, originY: item.y,
            lastX: item.x, lastY: item.y,
            pointerId: e.pointerId, moved: false,
        }
        elRef.current?.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e) => {
        const d = dragRef.current
        if (!d || d.pointerId !== e.pointerId) return
        const dx = (e.clientX - d.startX) / zoom
        const dy = (e.clientY - d.startY) / zoom
        d.lastX = d.originX + dx
        d.lastY = d.originY + dy
        d.moved = true
        // Coalesce to one state commit per animation frame: a high-rate pointer
        // would otherwise fire many moves per frame, each re-rendering. Keeping the
        // store as the source of truth (vs. poking DOM) also keeps the selection
        // box in sync and survives any incidental re-render.
        if (!d.raf) {
            d.raf = requestAnimationFrame(() => {
                d.raf = 0
                if (dragRef.current === d) onUpdate(item.id, { x: d.lastX, y: d.lastY })
            })
        }
    }

    const onPointerUp = (e) => {
        const d = dragRef.current
        if (d?.pointerId !== e.pointerId) return
        if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0 }
        dragRef.current = null
        elRef.current?.releasePointerCapture?.(e.pointerId)
        if (d.moved) onUpdate(item.id, { x: d.lastX, y: d.lastY })
        endTransaction?.()
    }

    return { elRef, onPointerDown, onPointerMove, onPointerUp }
}

/** Inline box style shared by cards — position, size, rotation, selection ring. */
export function cardBoxStyle(item, selected) {
    return {
        left: item.x,
        top: item.y,
        width: item.w ?? 200,
        height: item.h != null ? item.h : undefined,
        transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
        transformOrigin: 'center center',
        outline: selected ? '2px solid var(--accent-warning)' : undefined,
        outlineOffset: 2,
    }
}
