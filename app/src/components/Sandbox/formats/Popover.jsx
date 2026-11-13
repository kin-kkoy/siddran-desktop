import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Table.module.css'

/**
 * A small panel beside an element — the Table's menus (filter, sort, field,
 * cell pickers). Portalled and fixed-positioned like SourceMenu, so the
 * board's zoom and the widget's clipping don't touch it. Below the anchor,
 * or above it when there's no room. Closes on a press outside or Esc; keys
 * inside never reach the board's shortcuts.
 */
export default function Popover({ anchor: anchorProp, width = 260, onClose, onEscape, children, className = '', label }) {
    // An element, or a ref to one — read in the effects, after commit, so a just-rendered anchor exists.
    const anchorEl = () => (anchorProp && 'current' in anchorProp ? anchorProp.current : anchorProp)
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        const r = anchorEl()?.getBoundingClientRect?.()
        if (!r) return
        const h = panelRef.current?.offsetHeight || 0
        const left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - width - 8)))
        const below = r.bottom + 4
        const top = h && below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below
        setPos({ top: Math.round(top), left, maxHeight: Math.max(160, window.innerHeight - top - 12) })
    }, [anchorProp, width])   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onDown = (e) => {
            if (panelRef.current?.contains(e.target) || anchorEl()?.contains?.(e.target)) return
            onClose()
        }
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); (onEscape || onClose)() } }
        window.addEventListener('pointerdown', onDown, true)
        window.addEventListener('keydown', onKey, true)
        return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
    }, [anchorProp, onClose, onEscape])   // eslint-disable-line react-hooks/exhaustive-deps

    return createPortal(
        <div ref={panelRef} role="dialog" aria-label={label}
            className={`${styles.pop} ${className}`}
            style={pos ? { top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight } : { top: -9999, left: -9999, width }}
            data-sb-handle="true"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}>
            {children}
        </div>,
        document.body,
    )
}
