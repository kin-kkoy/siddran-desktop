import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ShapePicker.module.css'
import { SHAPES, SHAPE_GROUPS, shapesInGroup } from '../shapes/registry'
import { SHAPE_COLORS } from '../ink/presets'

/**
 * Shape picker flyout — anchored beside the single shape button in the dock:
 * every shape as a small canvas-drawn icon, in sections (Basic / Flowchart /
 * Callouts / Lines).
 *
 * Portal + fixed positioning + click-outside + Escape mirrors ColorMenu's Popover.
 */

/**
 * Border and fill for the NEXT shape you draw. A row of swatches each plus a
 * native picker for anything else; fill also has "none". Shapes already on the
 * board are recoloured from their own floating bar.
 */
function StyleRows({ style, onChange }) {
    const row = (label, key, allowNone) => {
        const value = style[key]
        const none = !value || value === 'transparent'
        return (
            <div className={styles.styleRow}>
                <span className={styles.styleLabel}>{label}</span>
                {allowNone && (
                    <button className={none ? styles.styleNoneActive : styles.styleNone} title="No fill" aria-label="No fill"
                        onClick={() => onChange({ [key]: 'transparent' })} />
                )}
                {SHAPE_COLORS.map(c => (
                    <button key={c} className={c === value ? styles.styleCellActive : styles.styleCell}
                        style={{ backgroundColor: c }} title={c} aria-label={`${label} ${c}`}
                        onClick={() => onChange({ [key]: c })} />
                ))}
                <input type="color" className={styles.styleCustom} aria-label={`Custom ${label.toLowerCase()} colour`}
                    title="Custom colour" value={/^#[0-9a-f]{6}/i.exec(none ? '#ffffff' : value)?.[0] || '#ffffff'}
                    onChange={(e) => onChange({ [key]: e.target.value })} />
            </div>
        )
    }
    return (
        <>
            <div className={styles.divider} />
            {row('Border', 'stroke', false)}
            {row('Fill', 'fill', true)}
        </>
    )
}

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
        if (kind === 'taperedArrow') {
            ctx.beginPath()
            ctx.moveTo(1, h / 2 + 0.6); ctx.lineTo(w - 6, h / 2 + 1.6); ctx.lineTo(w - 6, h / 2 + 4.5)
            ctx.lineTo(w - 1, h / 2); ctx.lineTo(w - 6, h / 2 - 4.5); ctx.lineTo(w - 6, h / 2 - 1.6)
            ctx.lineTo(1, h / 2 - 0.6); ctx.closePath()
            ctx.fillStyle = ctx.strokeStyle
            ctx.fill()
            return
        }
        if (kind === 'arrow' || kind === 'elbowArrow') {
            // Shaft, then a two-barbed head aimed along the last segment. (The
            // old head drew one barb straight back down the shaft, so it looked
            // like a single line.)
            const tip = { x: w - 2, y: 2 }
            const from = kind === 'elbowArrow' ? { x: w - 2, y: h - 2 } : { x: 2, y: h - 2 }
            ctx.beginPath()
            if (kind === 'elbowArrow') { ctx.moveTo(2, h - 2); ctx.lineTo(w - 2, h - 2) } else ctx.moveTo(from.x, from.y)
            ctx.lineTo(tip.x, tip.y)
            ctx.stroke()
            const ang = Math.atan2(tip.y - from.y, tip.x - from.x)
            const aLen = 5.5, spread = Math.PI / 6
            ctx.beginPath()
            ctx.moveTo(tip.x - aLen * Math.cos(ang - spread), tip.y - aLen * Math.sin(ang - spread))
            ctx.lineTo(tip.x, tip.y)
            ctx.lineTo(tip.x - aLen * Math.cos(ang + spread), tip.y - aLen * Math.sin(ang + spread))
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

/**
 * Every shape as an icon, in sections — no labels (each icon's tooltip names
 * it). Then the border and fill for the next shape, when the dock passes them.
 */
function ShapePicker({ open, tool, anchorRef, onPick, onClose, shapeStyle, onShapeStyleChange }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)
    const styled = !!(shapeStyle && onShapeStyleChange)

    // Position beside anchor
    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const PANEL_W = styled ? 262 : 256
        setPos({ top: Math.round(r.top - 6), left: Math.max(8, Math.round(r.left - GAP - PANEL_W)) })
    }, [open, anchorRef, styled])

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

    return createPortal(
        <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label="Shapes">
            <div className={styles.sections}>
                {SHAPE_GROUPS.map(g => (
                    <div key={g.id}>
                        <div className={styles.sectionLabel}>{g.label}</div>
                        <div className={styles.grid}>
                            {shapesInGroup(g.id).map(kind => {
                                const s = SHAPES[kind]
                                return (
                                    <button
                                        key={kind}
                                        className={tool === kind ? styles.gridCellActive : styles.gridCell}
                                        onClick={() => pick(kind)}
                                        title={s.label}
                                        aria-label={s.label}
                                    >
                                        <ShapeThumb kind={kind} size={20} />
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
            {styled && <StyleRows style={shapeStyle} onChange={onShapeStyleChange} />}
        </div>,
        document.body,
    )
}

export default ShapePicker
