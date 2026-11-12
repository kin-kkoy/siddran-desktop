import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ColorMenu.module.css'

// '#rrggbb' or '#rrggbbaa' → { hex: '#rrggbb', alpha: 0–100 }
function splitColor(v) {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v || '')
    if (!m) return { hex: '#ffffff', alpha: 100 }
    return { hex: `#${m[1]}`, alpha: m[2] ? Math.round(parseInt(m[2], 16) / 2.55) : 100 }
}
const joinColor = (hex, alpha) => (alpha >= 100 ? hex : `${hex}${Math.round(alpha * 2.55).toString(16).padStart(2, '0')}`)

/** Any colour, optionally with transparency: a native picker plus an opacity slider. */
export function CustomColor({ value, onPick, alpha: withAlpha = true, label = 'Custom' }) {
    const { hex, alpha } = splitColor(value)
    return (
        <div className={styles.customColor}>
            <span>{label}</span>
            <input type="color" value={hex} aria-label="Custom colour"
                onChange={(e) => onPick(withAlpha ? joinColor(e.target.value, alpha) : e.target.value)} />
            {withAlpha && (
                <>
                    <input type="range" min={5} max={100} step={5} value={alpha} className={styles.alphaSlider}
                        aria-label="Opacity" title={`Opacity ${alpha}%`}
                        style={{ backgroundImage: `linear-gradient(90deg, transparent, ${hex})` }}
                        onChange={(e) => onPick(joinColor(hex, Number(e.target.value)))} />
                    <span className={styles.alphaValue}>{alpha}%</span>
                </>
            )}
        </div>
    )
}

/** A grid of swatches, an optional "none", and a custom picker. */
export function ColorGrid({ colors, value, onPick, allowNone = false, alpha = true }) {
    const base = splitColor(value).hex.toLowerCase()
    return (
        <>
            <div className={styles.grid}>
                {allowNone && (
                    <button className={!value || value === 'transparent' ? styles.noneActive : styles.none}
                        title="None" aria-label="None" onClick={() => onPick('transparent')} />
                )}
                {colors.map(c => (
                    <button key={c} className={c.toLowerCase() === base || c === value ? styles.cellActive : styles.cell}
                        style={{ backgroundColor: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
                ))}
            </div>
            <CustomColor value={value && value !== 'transparent' ? value : '#ffffff'} onPick={onPick} alpha={alpha} />
        </>
    )
}

/**
 * A small panel that opens to the LEFT of its anchor (the dock and the flyout
 * sit on the right edge). Portalled with fixed, whole-pixel coordinates so it
 * escapes the dock's overflow clipping and stays crisp at fractional scaling.
 * Closes on Escape or a press outside it and its anchor.
 */
export function Popover({ open, anchorRef, onClose, width = 216, children, label }) {
    const panelRef = useRef(null)
    const [pos, setPos] = useState(null)

    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const r = anchorRef.current.getBoundingClientRect()
        const GAP = 12
        const top = Math.max(8, Math.min(Math.round(r.top - 8), window.innerHeight - 340))
        setPos({ top, left: Math.max(8, Math.round(r.left - GAP - width)) })
    }, [open, anchorRef, width])

    useEffect(() => {
        if (!open) return
        const onDown = (e) => {
            if (panelRef.current?.contains(e.target)) return
            if (anchorRef.current?.contains(e.target)) return
            onClose?.()
        }
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
        window.addEventListener('pointerdown', onDown, true)
        window.addEventListener('keydown', onKey, true)
        return () => {
            window.removeEventListener('pointerdown', onDown, true)
            window.removeEventListener('keydown', onKey, true)
        }
    }, [open, onClose, anchorRef])

    if (!open || !pos) return null
    return createPortal(
        <div ref={panelRef} className={styles.panel} style={{ top: pos.top, left: pos.left, width }}
            role="dialog" aria-label={label}>
            {children}
        </div>,
        document.body,
    )
}

/** A titled colour popover — the dock's fill bucket uses it. */
function ColorMenu({ open, anchorRef, onClose, title, colors, value, onPick, allowNone = false }) {
    return (
        <Popover open={open} anchorRef={anchorRef} onClose={onClose} label={title}>
            <div className={styles.title}>{title}</div>
            <ColorGrid colors={colors} value={value} onPick={onPick} allowNone={allowNone} />
        </Popover>
    )
}

export default ColorMenu
