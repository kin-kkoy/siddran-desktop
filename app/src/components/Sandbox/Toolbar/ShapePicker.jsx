import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ShapePicker.module.css'
import { SHAPES, QUICK_SHAPES, ALL_SHAPES } from '../shapes/registry'

/**
 * Shape picker flyout — anchored beside the single shape button in the dock.
 *
 * Two-level:
 *   1. Quick menu: the 4 most-used shapes (rect/ellipse/line/arrow) with key
 *      hints, plus a "More shapes" row.
 *   2. Grid: a 4-column grid showing all ~16 shapes as small canvas-drawn
 *      thumbnails, with a back-arrow to return to the quick menu.
 *
 * Portal + fixed positioning + click-outside + Escape mirrors ColorPalette.
 */

// ── Tiny shape thumbnail drawn on a <canvas> ──

function ShapeThumb({ kind, size = 20, color = 'currentColor' }) {
    const canvasRef = useRef(null)
    useLayoutEffect(() => {
        const cvs = canvasRef.current
        if (!cvs) return
        const ctx = cvs.getContext('2d')
        const dpr = window.devicePixelRatio || 1
        cvs.width = size * dpr
        cvs.height = size * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, size, size)
        // Canvas 2D can't parse the CSS `currentColor` keyword (it silently
        // falls back to black, invisible on the dark theme). Resolve it to the
        // canvas's inherited, theme-driven text colour instead.
        ctx.strokeStyle = color === 'currentColor'
            ? (getComputedStyle(cvs).color || '#fff')
            : color
        ctx.fillStyle = 'transparent'
        ctx.lineWidth = 1.4
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'

        const pad = 2
        const w = size - pad * 2
        const h = size - pad * 2
        ctx.translate(pad, pad)

        const entry = SHAPES[kind]
        if (!entry) return

        if (kind === 'ellipse') {
            ctx.beginPath()
            ctx.ellipse(w / 2, h / 2, w / 2 - 0.5, h / 2 - 0.5, 0, 0, Math.PI * 2)
            ctx.stroke()
            return
        }
        if (kind === 'rect') {
            ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
            return
        }
        if (kind === 'roundedRect') {
            const r = Math.min(4, w / 4, h / 4)
            ctx.beginPath()
            ctx.moveTo(r + 0.5, 0.5)
            ctx.arcTo(w - 0.5, 0.5, w - 0.5, r + 0.5, r)
            ctx.arcTo(w - 0.5, h - 0.5, w - r - 0.5, h - 0.5, r)
            ctx.arcTo(0.5, h - 0.5, 0.5, h - r - 0.5, r)
            ctx.arcTo(0.5, 0.5, r + 0.5, 0.5, r)
            ctx.closePath()
            ctx.stroke()
            return
        }
        if (kind === 'line' || kind === 'divider') {
            ctx.beginPath()
            ctx.moveTo(1, kind === 'divider' ? h / 2 : h - 1)
            ctx.lineTo(w - 1, kind === 'divider' ? h / 2 : 1)
            ctx.stroke()
            return
        }
        if (kind === 'arrow' || kind === 'elbowArrow') {
            ctx.beginPath()
            if (kind === 'elbowArrow') {
                ctx.moveTo(1, h - 1)
                ctx.lineTo(w - 1, h - 1)
                ctx.lineTo(w - 1, 1)
            } else {
                ctx.moveTo(1, h - 1)
                ctx.lineTo(w - 1, 1)
            }
            ctx.stroke()
            // arrowhead
            const tipX = w - 1, tipY = 1
            const aLen = 5
            ctx.beginPath()
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - aLen, tipY + aLen)
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - aLen, tipY)
            ctx.stroke()
            return
        }

        // All other shapes — use the registry render function
        if (entry.render) {
            ctx.beginPath()
            entry.render(ctx, w, h, 0)
            ctx.stroke()
        }
    }, [kind, size, color])

    return <canvas ref={canvasRef} width={size} height={size}
        style={{ width: size, height: size, display: 'block' }} />
}

// ── ShapePicker ──

function ShapePicker({ open, tool, anchorRef, onPick, onClose }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)
    const [showGrid, setShowGrid] = useState(false)

    // Reset to quick menu when re-opened
    useLayoutEffect(() => {
        if (open) setShowGrid(false)
    }, [open])

    // Position beside anchor
    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const PANEL_W = 172
        setPos({ top: r.top - 6, left: Math.max(8, r.left - GAP - PANEL_W) })
    }, [open, anchorRef, showGrid])

    // Close on outside-click + Escape
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

    const pick = (kind) => {
        onPick(kind)
        onClose?.()
    }

    // ── Grid view ──
    if (showGrid) {
        return createPortal(
            <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left }}>
                <div className={styles.gridHeader}>
                    <button className={styles.gridBackBtn} onClick={() => setShowGrid(false)} title="Back" aria-label="Back">←</button>
                    <span className={styles.gridTitle}>All shapes</span>
                </div>
                <div className={styles.divider} />
                <div className={styles.grid}>
                    {ALL_SHAPES.map(kind => {
                        const s = SHAPES[kind]
                        const isActive = tool === kind
                        return (
                            <button
                                key={kind}
                                className={isActive ? styles.gridCellActive : styles.gridCell}
                                onClick={() => pick(kind)}
                                title={s.label}
                                aria-label={s.label}
                            >
                                <ShapeThumb kind={kind} size={20} />
                            </button>
                        )
                    })}
                </div>
            </div>,
            document.body,
        )
    }

    // ── Quick menu view ──
    return createPortal(
        <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left }}>
            {QUICK_SHAPES.map(kind => {
                const s = SHAPES[kind]
                const isActive = tool === kind
                return (
                    <button
                        key={kind}
                        className={isActive ? styles.menuItemActive : styles.menuItem}
                        onClick={() => pick(kind)}
                    >
                        <ShapeThumb kind={kind} size={16} />
                        <span>{s.label}</span>
                    </button>
                )
            })}
            <div className={styles.divider} />
            <button className={styles.menuItem} onClick={() => setShowGrid(true)}>
                <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>⊞</span>
                <span>More shapes</span>
                <span className={styles.menuKey}>›</span>
            </button>
        </div>,
        document.body,
    )
}

export default ShapePicker
