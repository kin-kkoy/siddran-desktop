import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ColorPalette.module.css'

/**
 * Floating colour palette — opens beside the dock's current-colour swatch.
 *
 * Rendered through a portal with position:fixed and coords measured from the
 * anchor swatch, so it escapes the dock's `overflow-y:auto` clipping AND the
 * `backdrop-filter` containing-block (which would otherwise re-root a plain
 * fixed child). Layout mirrors the mock: the current colour sits larger on top,
 * a divider, then the remaining colours in a column. Closes on pick / Esc /
 * outside-click.
 */
function ColorPalette({ open, colors, current, anchorRef, onPick, onClose }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const PANEL_W = 48
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

    const cur = colors.find(c => c.value === current) || { value: current, name: 'current' }
    const rest = colors.filter(c => c.value !== current)

    return createPortal(
        <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left }}>
            <button
                className={`${styles.swatch} ${styles.current}`}
                style={{ backgroundColor: cur.value }}
                title={`Current: ${cur.name}`}
                aria-label={`Current colour ${cur.name}`}
                onClick={() => onPick(cur.value)}
            />
            <div className={styles.divider} />
            {rest.map(c => (
                <button
                    key={c.name}
                    className={styles.swatch}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                    aria-label={`Colour ${c.name}`}
                    onClick={() => onPick(c.value)}
                />
            ))}
        </div>,
        document.body,
    )
}

export default ColorPalette
