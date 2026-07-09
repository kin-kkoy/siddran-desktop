import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuStickyNote, LuListTodo, LuImage, LuFileText } from 'react-icons/lu'
import styles from './ShapePicker.module.css'

/**
 * Insert flyout — merges the old Note / Task / Image dock buttons into one
 * "Insert +" menu. Portal + fixed positioning + click-outside + Escape, mirroring
 * ShapePicker (whose CSS it reuses).
 */
function InsertMenu({ open, anchorRef, onClose, onPickNote, onPickTask, onPickImage, onPickPdf }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const PANEL_W = 172
        setPos({ top: r.top - 6, left: Math.max(8, r.left - GAP - PANEL_W) })
    }, [open, anchorRef])

    useEffect(() => {
        if (!open) return
        const onDown = (e) => {
            if (panelRef.current?.contains(e.target)) return
            if (anchorRef.current?.contains(e.target)) return
            onClose?.()
        }
        const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
        window.addEventListener('pointerdown', onDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('pointerdown', onDown, true)
            window.removeEventListener('keydown', onKey)
        }
    }, [open, onClose, anchorRef])

    if (!open || !pos) return null

    const pick = (fn) => { fn?.(); onClose?.() }

    const ITEMS = [
        { label: 'Note', Icon: LuStickyNote, onClick: onPickNote },
        { label: 'Task', Icon: LuListTodo, onClick: onPickTask },
        { label: 'Image', Icon: LuImage, onClick: onPickImage },
        { label: 'PDF', Icon: LuFileText, onClick: onPickPdf },
    ]

    return createPortal(
        <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left }}>
            {ITEMS.map(it => (
                <button key={it.label} className={styles.menuItem} onClick={() => pick(it.onClick)}>
                    <it.Icon size={15} />
                    <span>{it.label}</span>
                </button>
            ))}
        </div>,
        document.body,
    )
}

export default InsertMenu
