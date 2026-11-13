import { useMemo, useRef, useState } from 'react'
import { LuPlay, LuEye, LuEyeOff, LuX, LuGripVertical } from 'react-icons/lu'
import { deckOrder, isHiddenSlide, fitFrameViewport, frameContents } from './slides'
import Thumbnail from './Thumbnail'
import styles from './SlidesPanel.module.css'

const DRAG_PX = 5
const FLY_MS = 260

/** Glide the board to `to` (timers, not rAF: a hidden window gets no frames). */
function fly(canvas, to) {
    const from = canvas.viewport
    const t0 = performance.now()
    const step = () => {
        const k = Math.min(1, (performance.now() - t0) / FLY_MS)
        const e = 1 - Math.pow(1 - k, 3)
        // Interpolate the zoom geometrically so the glide feels even.
        const zoom = from.zoom * Math.pow(to.zoom / from.zoom, e)
        canvas.setViewport({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom })
        if (k < 1) setTimeout(step, 16)
        else canvas.setViewport(to)
    }
    step()
}

/**
 * The Slides panel (spec §11.6 and §13.9): every frame is a slide. Drag to
 * reorder (the frames stay where they are on the board), the eye hides one
 * from the presentation, ▶ presents from it, and a click takes the board there.
 */
export default function SlidesPanel({ items, byId, canvas, onPresent, onReorder, onToggleHidden, onClose }) {
    const rootRef = useRef(null)
    const rowRefs = useRef(new Map())
    const drag = useRef(null)   // { id, from, y0, moved }
    const [dragId, setDragId] = useState(null)
    const [dropAt, setDropAt] = useState(-1)

    const deck = useMemo(() => deckOrder(items), [items])
    const contents = useMemo(() => new Map(deck.map(f => [f.id, frameContents(f, items)])), [deck, items])
    let shownNo = 0
    const numbers = deck.map(f => (isHiddenSlide(f) ? null : ++shownNo))

    const goTo = (f) => {
        const shell = rootRef.current?.parentElement?.getBoundingClientRect()
        const panel = rootRef.current?.getBoundingClientRect()
        if (!shell) return
        // Fit it in the part of the board the panel doesn't cover.
        const w = Math.max(200, (panel ? panel.left - shell.left : shell.width))
        canvas.setSelection([f.id])
        fly(canvas, fitFrameViewport(f, w, shell.height, 48))
    }

    const targetIndex = (clientY) => {
        let i = 0
        for (const f of deck) {
            const el = rowRefs.current.get(f.id)
            if (!el) continue
            const r = el.getBoundingClientRect()
            if (clientY > r.top + r.height / 2) i++
        }
        return i
    }

    const onRowDown = (e, f, i) => {
        if (e.button !== 0 || e.target.closest('button')) return
        drag.current = { id: f.id, from: i, y0: e.clientY, moved: false, pid: e.pointerId }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
    }
    const onRowMove = (e) => {
        const d = drag.current
        if (!d || d.pid !== e.pointerId) return
        if (!d.moved && Math.abs(e.clientY - d.y0) < DRAG_PX) return
        if (!d.moved) { d.moved = true; setDragId(d.id) }
        setDropAt(targetIndex(e.clientY))
    }
    const onRowUp = (e, f) => {
        const d = drag.current
        if (!d || d.pid !== e.pointerId) return
        drag.current = null
        setDragId(null)
        setDropAt(-1)
        if (!d.moved) { goTo(f); return }
        let to = targetIndex(e.clientY)
        if (to > d.from) to -= 1
        if (to !== d.from) onReorder(d.id, to)
    }
    const onRowCancel = () => { drag.current = null; setDragId(null); setDropAt(-1) }

    return (
        <aside ref={rootRef} className={styles.panel} aria-label="Slides" data-slides-panel="1"
            onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <header className={styles.head}>
                <span className={styles.heading}>Slides <span className={styles.n}>{shownNo}</span></span>
                <button className={styles.present} onClick={() => onPresent(false)} disabled={!shownNo} title="Present from the first slide (F5)">
                    <LuPlay size={14} /> Present
                </button>
                <button className={styles.icon} onClick={onClose} title="Close (Shift+F)" aria-label="Close slides"><LuX size={16} /></button>
            </header>

            {deck.length === 0 ? (
                <div className={styles.empty}>
                    Every frame is a slide.<br />Press <kbd>F</kbd> and drag on the board to make one.
                </div>
            ) : (
                <ol className={styles.list}>
                    {deck.map((f, i) => {
                        const hidden = isHiddenSlide(f)
                        const ratio = Math.max(0.35, Math.min(1.6, (f.h || 1) / (f.w || 1)))
                        return (
                            <li key={f.id} ref={el => { if (el) rowRefs.current.set(f.id, el); else rowRefs.current.delete(f.id) }}
                                className={`${styles.row} ${hidden ? styles.hidden : ''} ${dragId === f.id ? styles.dragging : ''}`}
                                data-frame-id={f.id}
                                onPointerDown={(e) => onRowDown(e, f, i)} onPointerMove={onRowMove}
                                onPointerUp={(e) => onRowUp(e, f)} onPointerCancel={onRowCancel}>
                                {dropAt === i && dragId && <span className={styles.dropLine} style={{ top: -5 }} />}
                                {dropAt === deck.length && i === deck.length - 1 && dragId && <span className={styles.dropLine} style={{ bottom: -5 }} />}
                                <div className={styles.rowTop}>
                                    <LuGripVertical className={styles.grip} size={14} />
                                    <span className={styles.num}>{numbers[i] ?? '–'}</span>
                                    <span className={styles.title} title={f.payload?.title || 'Frame'}>{f.payload?.title || 'Frame'}</span>
                                    <button className={styles.icon} onClick={() => onToggleHidden(f.id)}
                                        title={hidden ? 'Show in the presentation' : 'Hide from the presentation'}
                                        aria-label={hidden ? 'Show slide' : 'Hide slide'} aria-pressed={hidden}>
                                        {hidden ? <LuEyeOff size={15} /> : <LuEye size={15} />}
                                    </button>
                                    <button className={styles.icon} onClick={() => onPresent(f.id)} disabled={hidden}
                                        title="Present from this slide" aria-label="Present from this slide"><LuPlay size={14} /></button>
                                </div>
                                <div className={styles.thumb} style={{ aspectRatio: `${1 / ratio}` }}>
                                    <Thumbnail frame={f} contents={contents.get(f.id) || []} byId={byId} />
                                </div>
                            </li>
                        )
                    })}
                </ol>
            )}
        </aside>
    )
}
