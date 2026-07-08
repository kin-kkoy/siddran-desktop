import { useRef, useState, useEffect } from 'react'
import styles from './MonthView.module.css'
import { monthGridDays, isoDate, isTodayISO } from '../calendarDates'

// Rough per-chip row height + the cell's non-chip overhead (day number + paddings), used to derive
// how many chips fit a cell before showing a "+N more" link. Approximate; the cell clips any slop.
const CHIP_ROW = 25
const CELL_RESERVE = 32

// Monday-start weekday header (prototype order).
const WEEK_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DRAG_THRESHOLD = 4 // px before a press becomes a drag rather than a click

// Map a normalized item to its left-border colour class. A block's own `color` (inline style)
// wins; otherwise we colour by kind / link target.
function srcClass(item) {
    if (item.kind === 'task') return styles.srcTask
    if (item.kind === 'daily') return styles.srcDaily
    if (item.kind === 'event') {
        switch (item.ref_type) {
            case 'note': return styles.srcNote
            case 'project': return styles.srcBundle
            case 'sandbox': return styles.srcSandbox
            case 'task': return styles.srcTask
            case 'daily': return styles.srcDaily
            default: return styles.srcEvent
        }
    }
    return styles.srcEvent
}

// Month grid. `itemsAt(iso)` returns the derived items for a day. Clicking an empty part of a
// cell calls onDayClick (quick-add + focus); clicking a chip calls onEventClick. Dragging a
// chip onto another day calls onRetime(item, newDayISO) — daily chips are recurrence-bound and
// not draggable.
export default function MonthView({ monthDate, focusedDay, itemsAt, ephemeralAt, fill, onDayClick, onDayPeek, onEventClick, onRetime, onToggleDaily, onJumpToDay }) {
    const days = monthGridDays(monthDate)

    // Drag bookkeeping kept in a ref so pointer-move doesn't re-render the whole grid; only the
    // ghost label (mount/unmount) and the hovered target day use state.
    const drag = useRef(null)
    const ghostRef = useRef(null)
    const [dragTitle, setDragTitle] = useState(null)
    const [overDay, setOverDay] = useState(null)

    // How many chips fit per cell (so the rest collapse into "+N more"). Measured from a real cell,
    // so it scales with the cell height — taller cells (Fill mode / big monitors) show more.
    const gridRef = useRef(null)
    const [capacity, setCapacity] = useState(4)
    useEffect(() => {
        const grid = gridRef.current
        if (!grid) return
        const measure = () => {
            const cell = grid.querySelector('[data-day]')
            if (cell) setCapacity(Math.max(1, Math.floor((cell.clientHeight - CELL_RESERVE) / CHIP_ROW)))
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(grid)
        return () => ro.disconnect()
    }, [])

    const positionGhost = (x, y) => {
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`
    }

    const onChipPointerDown = (e, item) => {
        if (item.kind === 'daily') return // recurrence governs the date — not draggable
        drag.current = { item, startX: e.clientX, startY: e.clientY, dragging: false }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no-op */ }
    }

    const onChipPointerMove = (e) => {
        const st = drag.current
        if (!st) return
        if (!st.dragging) {
            if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < DRAG_THRESHOLD) return
            st.dragging = true
            setDragTitle(st.item.title)
        }
        positionGhost(e.clientX, e.clientY)
        const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-day]')
        const day = cell ? cell.getAttribute('data-day') : null
        setOverDay(prev => (prev === day ? prev : day))
    }

    const onChipPointerUp = (e, item) => {
        const st = drag.current
        drag.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* no-op */ }
        const target = overDay
        setDragTitle(null)
        setOverDay(null)
        if (st?.dragging) {
            if (target && target !== item.day) onRetime?.(item, target)
        } else {
            onEventClick(item) // below threshold → treat as a click
        }
    }

    return (
        <div ref={gridRef} className={`${styles.grid} ${fill ? styles.fill : ''}`}>
            {WEEK_HEAD.map(d => <div key={d} className={styles.head}>{d}</div>)}

            {days.map(d => {
                const iso = isoDate(d)
                const dim = d.getMonth() !== monthDate.getMonth()
                const items = itemsAt(iso)
                const ephCount = ephemeralAt ? ephemeralAt(iso).length : 0
                // Populated day → clicking the cell opens a day overview; empty day → quick-add.
                const hasEntries = items.length > 0 || ephCount > 0
                const onCellClick = () => hasEntries ? onDayPeek?.(iso) : onDayClick(iso)
                // Cap chips to what fits; the rest collapse into "+N more" (reserve a row for the
                // eph badge, and a row for the "+N more" link itself when overflowing).
                const cap = Math.max(1, capacity - (ephCount > 0 ? 1 : 0))
                const overflow = items.length > cap
                const shown = overflow ? items.slice(0, Math.max(1, cap - 1)) : items
                const moreCount = items.length - shown.length

                const cellCls = [
                    styles.cell,
                    dim ? styles.dim : '',
                    isTodayISO(iso) ? styles.today : '',
                    iso === focusedDay ? styles.focused : '',
                    iso === overDay ? styles.over : '',
                ].filter(Boolean).join(' ')

                return (
                    <div
                        key={iso}
                        data-day={iso}
                        className={cellCls}
                        role="button"
                        tabIndex={0}
                        onClick={onCellClick}
                        onKeyDown={(e) => { if (e.key === 'Enter') onCellClick() }}
                    >
                        <span className={styles.dayNum}>{d.getDate()}</span>

                        {shown.map(it => {
                            const draggable = it.kind !== 'daily'
                            return (
                                <div
                                    key={it.key}
                                    className={[
                                        styles.chip,
                                        srcClass(it),
                                        it.planState === 'new' ? styles.draft : '',
                                        it.planState === 'edited' ? styles.modified : '',
                                        it.done ? styles.done : '',
                                        draggable ? styles.draggable : '',
                                    ].filter(Boolean).join(' ')}
                                    style={it.color ? { '--src': it.color } : undefined}
                                    title={it.title}
                                    onClick={(e) => { e.stopPropagation(); if (!draggable) onEventClick(it) }}
                                    onPointerDown={(e) => { e.stopPropagation(); onChipPointerDown(e, it) }}
                                    onPointerMove={draggable ? onChipPointerMove : undefined}
                                    onPointerUp={draggable ? (e) => { e.stopPropagation(); onChipPointerUp(e, it) } : undefined}
                                >
                                    {it.kind === 'daily' && onToggleDaily && (
                                        <button
                                            className={`${styles.dailyCheck} ${it.done ? styles.dailyCheckOn : ''}`}
                                            aria-label={it.done ? 'Mark not done' : 'Mark done'}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => { e.stopPropagation(); onToggleDaily(it.id, it.day, !it.done) }}
                                        >{it.done ? '✓' : ''}</button>
                                    )}
                                    {it.title}
                                </div>
                            )
                        })}

                        {overflow && (
                            <button
                                className={styles.moreBtn}
                                title={`${moreCount} more — open day overview`}
                                onClick={(e) => { e.stopPropagation(); onDayPeek?.(iso) }}
                            >+{moreCount} more</button>
                        )}

                        {ephCount > 0 && (
                            <button
                                className={styles.ephBadge}
                                title="Daily tasks — open Day view"
                                onClick={(e) => { e.stopPropagation(); onJumpToDay?.(iso) }}
                            >⏳ {ephCount} {ephCount === 1 ? 'daily' : 'dailies'}</button>
                        )}
                    </div>
                )
            })}

            {dragTitle && <div ref={ghostRef} className={styles.ghost}>{dragTitle}</div>}
        </div>
    )
}
