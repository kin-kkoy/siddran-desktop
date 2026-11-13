import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LuChevronLeft, LuChevronRight, LuMaximize, LuMinimize, LuX, LuSquare } from 'react-icons/lu'
import { fitFrameViewport, stepIndex } from './slides'
import { setFullscreen } from './usePresentation'
import styles from './Presentation.module.css'

const FADE_MS = 140
const HUD_IDLE_MS = 2200
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'])

/**
 * Presentation mode (spec §11.8): one frame at a time, fit to the screen and
 * letterboxed in black. It shows the LIVE board — the page has made the canvas
 * fill the window and hidden its chrome — and just steers the viewport, so a
 * slide looks exactly like its frame: cards, widgets, ink and all. A mask with
 * a frame-sized hole blacks out the rest.
 *
 * Keys: → ↓ PageDown Space Enter next · ← ↑ PageUp Backspace previous ·
 * Home/End · a number then Enter jumps · B or . blanks · F fullscreen · Esc
 * leaves (or un-blanks). Click the left third to go back, anywhere else for next.
 */
export default function Presentation({ frames, start = 0, canvas, onExit }) {
    const count = frames.length
    // `at` is a frame id, so the deck can change under us (live sync, a frame
    // deleted elsewhere) without the presentation jumping to another slide.
    const [at, setAt] = useState(() => frames[Math.min(start, count - 1)]?.id ?? null)
    const [ended, setEnded] = useState(false)
    const [blank, setBlank] = useState(false)
    const [veil, setVeil] = useState(true)   // black cover: starts on, lifts once the first slide is placed
    const [hud, setHud] = useState(true)
    const [full, setFull] = useState(true)
    const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
    const timers = useRef(new Set())
    const digits = useRef('')
    const lastIndex = useRef(Math.max(0, Math.min(start, count - 1)))

    const later = useCallback((fn, ms) => {
        const t = setTimeout(() => { timers.current.delete(t); fn() }, ms)
        timers.current.add(t)
    }, [])
    useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

    let index = frames.findIndex(f => f.id === at)
    if (index < 0) index = Math.min(lastIndex.current, count - 1)
    lastIndex.current = index
    const frame = frames[index] || null

    useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    // Steer the board to the slide. Re-fits when the frame itself changes
    // (resized or moved elsewhere) or the window does.
    const fx = frame?.x, fy = frame?.y, fw = frame?.w, fh = frame?.h
    const setViewport = canvas.setViewport
    useLayoutEffect(() => {
        if (fx == null) return
        setViewport(fitFrameViewport({ x: fx, y: fy, w: fw, h: fh }, size.w, size.h))
    }, [fx, fy, fw, fh, size.w, size.h, setViewport])

    // Lift the opening veil once the first slide has been placed.
    useEffect(() => { later(() => setVeil(false), 60) }, [later])

    const go = useCallback((i) => {
        if (!count) return
        if (i >= count) { setEnded(true); return }
        const target = frames[Math.max(0, i)]
        if (ended) setEnded(false)
        if (!target || (target.id === at && !ended)) return
        setVeil(true)
        later(() => {
            setAt(target.id)
            later(() => setVeil(false), 40)
        }, FADE_MS)
    }, [count, frames, at, ended, later])

    const next = useCallback(() => {
        if (ended) { onExit(); return }
        if (index >= count - 1) { setEnded(true); return }
        go(stepIndex(index, 1, count))
    }, [ended, index, count, go, onExit])
    const prev = useCallback(() => {
        if (ended) { setEnded(false); return }
        go(stepIndex(index, -1, count))
    }, [ended, index, count, go])

    const fullRef = useRef(true)
    const toggleFull = useCallback(() => {
        fullRef.current = !fullRef.current
        setFullscreen(fullRef.current)
        setFull(fullRef.current)
    }, [])

    // The HUD (and the cursor) fade out when the pointer rests.
    const hudTimer = useRef(0)
    const poke = useCallback(() => {
        setHud(true)
        clearTimeout(hudTimer.current)
        hudTimer.current = setTimeout(() => setHud(false), HUD_IDLE_MS)
    }, [])
    const holdHud = useCallback(() => { setHud(true); clearTimeout(hudTimer.current) }, [])
    useEffect(() => { poke(); return () => clearTimeout(hudTimer.current) }, [poke])

    // Keys go to the presentation alone: captured on the window and stopped,
    // so the board's shortcuts (and Space-to-pan) never see them.
    useEffect(() => {
        const onKey = (e) => {
            const k = e.key
            const swallow = () => { e.preventDefault(); e.stopImmediatePropagation() }
            if (e.ctrlKey || e.metaKey || e.altKey) {
                if (k === 'F5') swallow()
                return
            }
            swallow()
            if (/^[0-9]$/.test(k)) { digits.current = (digits.current + k).slice(-4); return }
            if (k === 'Enter' && digits.current) {
                const n = Number(digits.current); digits.current = ''
                if (n >= 1) go(Math.min(n, count) - 1)
                return
            }
            digits.current = ''
            if (k === 'Escape') { if (blank) setBlank(false); else onExit(); return }
            if (k === 'b' || k === 'B' || k === '.') { setBlank(b => !b); return }
            if (blank) { setBlank(false); return }
            if (k === 'f' || k === 'F') { toggleFull(); return }
            if (k === 'Home') { go(0); return }
            if (k === 'End') { go(count - 1); return }
            if (NEXT_KEYS.has(k)) { next(); return }
            if (PREV_KEYS.has(k)) { prev(); return }
        }
        window.addEventListener('keydown', onKey, true)
        // Space-to-pan listens to keyup too.
        const onKeyUp = (e) => { if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopImmediatePropagation() }
        window.addEventListener('keyup', onKeyUp, true)
        return () => {
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('keyup', onKeyUp, true)
        }
    }, [blank, count, go, next, prev, onExit, toggleFull])

    const onPointerDown = (e) => {
        if (e.button !== 0) return
        if (blank) { setBlank(false); return }
        if (e.clientX < size.w * 0.3) prev(); else next()
    }

    // The hole in the mask: the frame as actually drawn (the live viewport).
    const v = canvas.viewport
    const hole = frame ? {
        left: Math.round(frame.x * v.zoom + v.x), top: Math.round(frame.y * v.zoom + v.y),
        width: Math.round(frame.w * v.zoom), height: Math.round(frame.h * v.zoom),
    } : null
    const title = frame?.payload?.title || 'Untitled frame'

    return (
        <div className={styles.root} data-presenting="1" style={{ cursor: hud ? 'default' : 'none' }}
            onPointerMove={poke} onWheel={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
            {hole && !ended ? <div className={styles.hole} style={hole} /> : <div className={styles.black} />}
            <div className={styles.click} onPointerDown={onPointerDown} />
            {ended && (
                <div className={styles.end} onPointerDown={onPointerDown}>
                    <span>End of slides</span>
                    <small>Click or press → to leave · ← to go back</small>
                </div>
            )}
            <div className={styles.veil} style={{ opacity: veil || blank ? 1 : 0 }} />

            <div className={`${styles.hud} ${hud ? styles.hudOn : ''}`} onPointerDown={(e) => e.stopPropagation()}
                onPointerEnter={holdHud} onPointerLeave={poke}>
                <button className={styles.btn} onClick={prev} disabled={index <= 0 && !ended} title="Previous (←)" aria-label="Previous slide"><LuChevronLeft size={20} /></button>
                <span className={styles.count} data-slide={ended ? 'end' : index + 1} data-of={count}>
                    {ended ? 'End' : `${index + 1} / ${count}`}<span className={styles.title}>{ended ? '' : title}</span>
                </span>
                <button className={styles.btn} onClick={next} title="Next (→)" aria-label="Next slide"><LuChevronRight size={20} /></button>
                <span className={styles.sep} />
                <button className={styles.btn} onClick={() => setBlank(b => !b)} title="Blank the screen (B)" aria-label="Blank the screen"><LuSquare size={16} /></button>
                <button className={styles.btn} onClick={toggleFull} title={full ? 'Leave fullscreen (F)' : 'Fullscreen (F)'} aria-label="Toggle fullscreen">
                    {full ? <LuMinimize size={17} /> : <LuMaximize size={17} />}
                </button>
                <button className={styles.btn} onClick={onExit} title="Stop presenting (Esc)" aria-label="Stop presenting"><LuX size={19} /></button>
            </div>

            <div className={styles.sr} aria-live="polite">{ended ? 'End of slides' : `Slide ${index + 1} of ${count}: ${title}`}</div>
        </div>
    )
}
