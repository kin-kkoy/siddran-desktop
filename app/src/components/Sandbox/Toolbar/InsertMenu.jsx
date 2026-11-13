import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuStickyNote, LuListTodo, LuImage, LuFileText, LuTable2, LuSquareKanban, LuGrid2X2, LuChartGantt, LuFilePen, LuPresentation } from 'react-icons/lu'
import styles from './ShapePicker.module.css'

/**
 * Insert flyout — merges the old Note / Task / Image dock buttons into one
 * "Insert +" menu. Portal + fixed positioning + click-outside + Escape, mirroring
 * ShapePicker (whose CSS it reuses).
 */
function InsertMenu({ open, anchorRef, onClose, onPickNote, onPickTask, onPickImage, onPickPdf, onPickFormat, onPickSlides }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const PANEL_W = 216
        setPos({ top: r.top - 6, left: Math.max(8, r.left - GAP - PANEL_W) })
    }, [open, anchorRef])
    // Taller than the button's room below it: move up so the whole list shows.
    useLayoutEffect(() => {
        const el = panelRef.current
        if (!el || !pos) return
        const max = window.innerHeight - el.offsetHeight - 8
        if (pos.top > max) setPos(p => ({ ...p, top: Math.max(8, max) }))
    }, [pos])

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
        { divider: true },
        // Format widgets: records you keep in the board, or your tasks — each a view of the same records.
        ...(onPickFormat ? [
            { label: 'Table', Icon: LuTable2, onClick: () => onPickFormat('table') },
            { label: 'Kanban', Icon: LuSquareKanban, onClick: () => onPickFormat('kanban') },
            { label: 'Timeline', Icon: LuChartGantt, onClick: () => onPickFormat('timeline') },
            { label: 'Matrix', Icon: LuGrid2X2, onClick: () => onPickFormat('matrix') },
            // A page of text (formats/doc): kept in the board, or a note.
            { label: 'Doc', Icon: LuFilePen, onClick: () => onPickFormat('doc') },
        ] : []),
        // A slide sized for your display; more come from the Slides panel or the slide's bar (slides/).
        ...(onPickSlides ? [{ label: 'Slides', Icon: LuPresentation, onClick: onPickSlides }] : []),
    ]

    return createPortal(
        <div ref={panelRef} className={`${styles.panel} ${styles.insertPanel}`} style={{ top: pos.top, left: pos.left }}>
            {/* Bigger rows than the shapes list: it opens now and then, and should read at a glance (the user's call). */}
            {ITEMS.map((it, i) => it.divider ? <div key={`d${i}`} className={styles.insertDivider} /> : (
                <button key={it.label} className={styles.insertItem} onClick={() => pick(it.onClick)}>
                    <it.Icon size={20} />
                    <span>{it.label}</span>
                </button>
            ))}
        </div>,
        document.body,
    )
}

export default InsertMenu
