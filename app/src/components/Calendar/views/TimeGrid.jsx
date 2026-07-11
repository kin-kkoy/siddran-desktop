import { useRef, useState, useMemo, useEffect, useLayoutEffect } from 'react'
import styles from './TimeGrid.module.css'
import { isTodayISO, DAY_NAMES } from '../calendarDates'
import { useSettings } from '../../../contexts/SettingsContext'
import {
    HOUR_PX, MIN_BLOCK_PX, snap15, minutesToY, timeToMinutes, minutesToTime, pointToDayTime, packLanes,
    setVisibleHours, setHourPx, hourPx, gridHeight, hourToY,
} from './timeGridGeom'

const DRAG_THRESHOLD = 4
const DEFAULT_DUR = 60 // minutes — display height for items without a real end (tasks, dailies, end-less blocks)
const MIN_COL = 150    // px — each day column's minimum width; columns expand to fill, else scroll
const HOURS = Array.from({ length: 24 }, (_, h) => h)

const hourLabel = (h) => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : h === 24 ? '12 AM' : `${h - 12} PM`
const hourOf = (it) => Math.floor(timeToMinutes(it.time) / 60)
// 12-hour clock for the now-line hover hint, e.g. 787 → "1:07 PM".
const fmt12 = (min) => {
    const h = Math.floor(min / 60), m = min % 60
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

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

// End-of-block in minutes: a timed block's real end_at, else start + DEFAULT_DUR.
function endMinutesOf(it, startMin) {
    if (it.kind === 'event' && it.source?.end_at && !it.all_day) {
        const e = new Date(it.source.end_at)
        const m = e.getHours() * 60 + e.getMinutes()
        if (m > startMin) return m
    }
    return startMin + DEFAULT_DUR
}

// Continuous-timeline grid for Week (many days) and Day (one). Vertical axis = real time
// (HOUR_PX/hr); blocks are absolutely positioned (top = start, height = duration) and overlaps
// pack into side-by-side lanes. Drag a block to move it (snap 15 min); drag its bottom edge to
// resize (blocks only). Click empty space to create at that time. All-day items sit in the top row.
export default function TimeGrid({ days, itemsAt, ephemeralAt, onSlotClick, onEventClick, onRetime, onResizeEvent, onUnschedule, onToggleDaily, onDailyTime, onDailyDone, onJumpToDay, onDismissConflict, externalPreview, fill, day2col = false, dayBalanced = false, onRebalanceAvailable }) {
    const scrollRef = useRef(null)
    const { settings } = useSettings()
    const sideBySide = days.length === 1 // Day view → render ephemeral dailies; Week → just a badge
    const twoCol = day2col && sideBySide  // 2-column Day layout (morning / afternoon, no scroll)
    const ephAt = (iso) => (ephemeralAt ? ephemeralAt(iso) : [])

    // Hidden hours — per-view (Day/Week independent), persisted. The geometry mapping is a module
    // singleton synced here each render (only one TimeGrid renders at a time), so minutesToY /
    // pointToDayTime / the drawer all stay hidden-aware. Empty set → identity (default unchanged).
    const storageKey = `cinder_cal_hidden_hours_${sideBySide ? 'day' : 'week'}`
    const [hidden, setHidden] = useState(() => {
        try { const a = JSON.parse(localStorage.getItem(storageKey) || '[]'); return new Set(Array.isArray(a) ? a : []) } catch { return new Set() }
    })
    setVisibleHours(hidden)
    const anchorRef = useRef(null)
    const saveHidden = (next) => { setHidden(next); try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* */ } }
    const hideHour = (h, shift) => {
        const next = new Set(hidden)
        if (shift && anchorRef.current != null) {
            const lo = Math.min(anchorRef.current, h), hi = Math.max(anchorRef.current, h)
            for (let x = lo; x <= hi; x++) next.add(x)
        } else next.add(h)
        anchorRef.current = h
        saveHidden(next)
    }
    const revealRun = (s, e) => { const next = new Set(hidden); for (let h = s; h <= e; h++) next.delete(h); saveHidden(next) }
    const showAllHours = () => saveHidden(new Set())
    const visibleHours = HOURS.filter(h => !hidden.has(h))

    // Hidden-hours pop-over (top-left corner). Lists each hidden hour; click one to reveal it.
    const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false)
    const cornerRef = useRef(null)
    useEffect(() => {
        if (!hiddenPanelOpen) return
        const onDown = (e) => { if (cornerRef.current && !cornerRef.current.contains(e.target)) setHiddenPanelOpen(false) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [hiddenPanelOpen])
    useEffect(() => { if (hidden.size === 0) setHiddenPanelOpen(false) }, [hidden])

    // 2-column split: default at noon (visible hours before 12), or an equal-count split when the
    // user has rebalanced. `splitRow` is an index into the contiguous visible-hour axis.
    const noonSplit = visibleHours.filter(h => h < 12).length
    const splitRow = !twoCol ? 0 : (dayBalanced ? Math.ceil(visibleHours.length / 2) : noonSplit)
    const halvesUnequal = twoCol && noonSplit !== (visibleHours.length - noonSplit)
    const hoursColA = twoCol ? visibleHours.slice(0, splitRow) : visibleHours
    const hoursColB = twoCol ? visibleHours.slice(splitRow) : []

    // 2-column height: fit the taller column into the available viewport so nothing scrolls.
    const fitRef = useRef(null)
    const [fitPx, setFitPx] = useState(0)
    useLayoutEffect(() => {
        if (!twoCol) return
        const el = fitRef.current
        if (!el) return
        const measure = () => setFitPx(el.clientHeight)
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [twoCol])
    // Sync the module-level pixels-per-hour every render: fit in 2-column, default otherwise.
    if (twoCol) {
        const maxRows = Math.max(splitRow, visibleHours.length - splitRow) || 1
        setHourPx(fitPx > 0 ? Math.max(18, fitPx / maxRows) : HOUR_PX)
    } else {
        setHourPx(HOUR_PX)
    }
    // Rebalance is offered (button lives in DayView, beside Unscheduled) once hidden hours make
    // the two halves unequal, or while already rebalanced (to switch back to the noon split).
    const showRebalance = twoCol && (halvesUnequal || dayBalanced)
    useEffect(() => { onRebalanceAvailable?.(showRebalance) }, [showRebalance, onRebalanceAvailable])

    // Now-line position, refreshed each minute.
    const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })
    useEffect(() => {
        const id = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }, 60000)
        return () => clearInterval(id)
    }, [])

    // Auto-scroll on day change. With "center the now-line" on and a visible day being today,
    // center the current-time line; otherwise scroll to the earliest timed item (or ~7 AM).
    // The 2-column layout fits the viewport (no scroll), so skip it there.
    const centerNow = settings.centerNowLine !== false
    useEffect(() => {
        if (twoCol) return
        const el = scrollRef.current
        if (!el) return
        if (centerNow && days.some(isTodayISO) && !hidden.has(Math.floor(nowMin / 60))) {
            el.scrollTop = Math.max(0, minutesToY(nowMin) - el.clientHeight / 2)
            return
        }
        let earliest = null
        for (const iso of days) for (const it of itemsAt(iso)) if (it.time) {
            const m = timeToMinutes(it.time)
            if (earliest == null || m < earliest) earliest = m
        }
        el.scrollTop = minutesToY(Math.max(0, (earliest ?? 7 * 60) - 30))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days.join('|'), centerNow, twoCol])

    // Per-day positioned + lane-packed blocks.
    const dayLayouts = useMemo(() => {
        const map = {}
        for (const iso of days) {
            // Day view also lays out timed ephemeral dailies alongside blocks/tasks; Week doesn't.
            const base = itemsAt(iso).filter(it => it.time)
            const eph = sideBySide ? ephAt(iso).filter(it => it.time) : []
            // Items starting in a hidden hour drop off the grid (counted on the pill instead).
            const timed = [...base, ...eph].filter(it => !hidden.has(hourOf(it))).map(it => {
                const startMin = timeToMinutes(it.time)
                return { it, startMin, endMin: endMinutesOf(it, startMin) }
            })
            map[iso] = packLanes(timed)
        }
        return map
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days.join('|'), itemsAt, ephemeralAt, sideBySide, hidden])

    // All-day items per day, memoized so the per-minute now-tick (and drag-state changes) don't
    // re-filter every column's items on every render.
    const allDayByDay = useMemo(() => {
        const map = {}
        for (const iso of days) {
            map[iso] = {
                allDayItems: itemsAt(iso).filter(it => !it.time),
                ephUntimed: sideBySide ? ephAt(iso).filter(it => !it.time) : [],
                ephCount: sideBySide ? 0 : ephAt(iso).length,
            }
        }
        return map
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days.join('|'), itemsAt, ephemeralAt, sideBySide])

    // Drag/resize bookkeeping. `dragInfo` drives the live preview (and dims the source block).
    const drag = useRef(null)
    const [dragInfo, setDragInfo] = useState(null) // { key, mode, day, startMin, endMin }
    const [allDayOver, setAllDayOver] = useState(null) // { iso, title } while dragging over the all-day row

    const onBlockDown = (e, it) => {
        if (it.kind === 'daily' && !it.ephemeral) return // recurring is recurrence-bound; ephemeral is draggable
        const isResize = !!e.target.closest?.('[data-resize]')
        // All-day items have no time — default to 9:00 so dropping one on the timeline lands sensibly.
        const startMin = it.time ? timeToMinutes(it.time) : 9 * 60
        drag.current = {
            mode: isResize && it.kind === 'event' ? 'resize' : 'move',
            it, startX: e.clientX, startY: e.clientY, dragging: false,
            startMin, endMin: endMinutesOf(it, startMin),
        }
        e.stopPropagation()
        e.preventDefault() // stop the drag from starting a text selection (stuttery highlight)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* */ }
    }
    const onBlockMove = (e) => {
        const st = drag.current
        if (!st) return
        if (!st.dragging) {
            if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < DRAG_THRESHOLD) return
            st.dragging = true
        }
        // Over the all-day row → show an all-day drop indicator instead of the timeline ghost.
        if (st.mode === 'move') {
            const allDayCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-allday]')
            if (allDayCell) {
                setAllDayOver({ iso: allDayCell.getAttribute('data-col'), title: st.it.title })
                setDragInfo(null)
                return
            }
            setAllDayOver(null)
        }
        const pt = pointToDayTime(e.clientX, e.clientY)
        if (!pt) return
        if (st.mode === 'move') {
            const start = snap15(pt.minutes)
            const dur = st.endMin - st.startMin
            setDragInfo({ key: st.it.key, mode: 'move', day: pt.day, startMin: start, endMin: start + dur })
        } else {
            const end = Math.max(st.startMin + 15, snap15(pt.minutes))
            setDragInfo({ key: st.it.key, mode: 'resize', day: st.it.day, startMin: st.startMin, endMin: end })
        }
    }
    const onBlockUp = (e, it) => {
        const st = drag.current
        drag.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* */ }
        const info = dragInfo
        setDragInfo(null)
        setAllDayOver(null)
        if (!st?.dragging) { onEventClick(it); return }
        // Drop a dated task onto the unscheduled drawer → clear its due_date (un-schedule it).
        if (it.kind === 'task' && onUnschedule && document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-unschedule]')) {
            onUnschedule(it.id)
            return
        }
        // Ephemeral daily: dragging sets its time (drop on the all-day row → untimed); never changes day.
        if (it.ephemeral) {
            const onAllDay = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-allday]')
            onDailyTime?.(it.id, onAllDay ? null : minutesToTime((info ?? st).startMin))
            return
        }
        // Dropped on the all-day row → make this block/task all-day on that cell's day.
        if (it.kind === 'task' || it.kind === 'event') {
            const allDayCell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-allday]')
            if (allDayCell) {
                onRetime?.(it, allDayCell.getAttribute('data-col') || it.day, null)
                return
            }
        }
        if (st.mode === 'move' && info) onRetime?.(it, info.day, minutesToTime(info.startMin))
        else if (st.mode === 'resize' && info && it.kind === 'event') onResizeEvent?.(it, info.day, minutesToTime(info.endMin))
    }

    // Click empty column space → create at the clicked (snapped) time.
    const onColClick = (e, iso) => {
        const pt = pointToDayTime(e.clientX, e.clientY)
        onSlotClick(iso, minutesToTime(snap15(pt ? pt.minutes : 9 * 60)))
    }

    const renderBlock = (b, offsetPx = 0) => {
        const it = b.it
        const top = minutesToY(b.startMin) - offsetPx
        const height = Math.max(MIN_BLOCK_PX, minutesToY(b.endMin) - minutesToY(b.startMin))
        const short = height < 40 // collapse the pill + title onto one tight row when vertical room is scarce
        // Day view shows the block's real end time too (start–end); Week keeps start only.
        const hasEnd = it.kind === 'event' && it.source?.end_at && !it.all_day
        const timeLabel = (sideBySide && hasEnd) ? `${it.time}–${minutesToTime(endMinutesOf(it, b.startMin))}` : it.time
        const widthPct = 100 / b.colCount
        const leftPct = b.colIndex * widthPct
        const recurring = it.kind === 'daily' && !it.ephemeral
        const draggable = !recurring
        const resizable = it.kind === 'event'
        const dim = dragInfo && dragInfo.key === it.key
        return (
            <div
                key={it.key}
                className={[styles.block, srcClass(it), short ? styles.short : '', it.ephemeral ? styles.volatile : '', it.planState === 'new' ? styles.draft : '', it.planState === 'edited' ? styles.modified : '', it.conflict ? styles.conflict : '', it.done ? styles.done : '', draggable ? styles.draggable : '', dim ? styles.dim : ''].filter(Boolean).join(' ')}
                style={{ top, height, left: `calc(${leftPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, ...(it.color ? { '--src': it.color } : {}) }}
                title={it.title}
                onClick={(e) => { e.stopPropagation(); if (!draggable) onEventClick(it) }}
                onPointerDown={(e) => onBlockDown(e, it)}
                onPointerMove={draggable ? onBlockMove : undefined}
                onPointerUp={draggable ? (e) => { e.stopPropagation(); onBlockUp(e, it) } : undefined}
            >
                <div className={styles.blockBody}>
                    {it.kind === 'daily' && (
                        <button
                            className={`${styles.dailyCheck} ${it.done ? styles.dailyCheckOn : ''}`}
                            aria-label={it.done ? 'Mark not done' : 'Mark done'}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); it.ephemeral ? onDailyDone?.(it.id, !it.done) : onToggleDaily?.(it.id, it.day, !it.done) }}
                        >{it.done ? '✓' : ''}</button>
                    )}
                    {it.ephemeral && <span className={styles.volatileMark} title="Daily task (expires)">⏳</span>}
                    <span className={styles.bTime}>{timeLabel}</span>
                    <span className={styles.bTitle}>{it.title}</span>
                </div>
                {it.conflict && onDismissConflict && (
                    <button className={styles.conflictBadge} title="Time conflict — click to dismiss" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDismissConflict(it.id) }}>!</button>
                )}
                {resizable && <div className={styles.resizeHandle} data-resize="1" />}
            </div>
        )
    }

    // One half-column of the 2-column Day view: a gutter + day column showing only `hours`
    // (a slice of the visible-hour axis starting at `rowOffset`). Blocks/hour-lines are shifted
    // up by `offsetPx` so the slice reads from the top; the column carries `data-row-offset` so
    // pointToDayTime maps drags/clicks back to the real time.
    const renderPanel = (hours, rowOffset) => {
        const iso = days[0]
        const px = hourPx()
        const offsetPx = rowOffset * px
        const panelH = hours.length * px
        const hourSet = new Set(hours)
        const nowHour = Math.floor(nowMin / 60)
        const showNow = isTodayISO(iso) && hourSet.has(nowHour) && !hidden.has(nowHour)
        const colPreview = (dragInfo && dragInfo.day === iso) ? dragInfo
            : (externalPreview && externalPreview.type === 'timeline' && externalPreview.day === iso) ? externalPreview
            : null
        const previewHere = colPreview && hourSet.has(Math.floor(colPreview.startMin / 60))
        return (
            <div className={styles.panel} key={rowOffset}>
                <div className={styles.gutter} style={{ height: panelH }}>
                    {hours.map(h => (
                        <div key={h} className={styles.hourLabel} style={{ top: hourToY(h) - offsetPx }}>
                            <span>{hourLabel(h)}</span>
                            <button className={styles.hideHourBtn} title="Hide this hour (shift-click for a range)" onClick={(e) => { e.stopPropagation(); hideHour(h, e.shiftKey) }}>⊘</button>
                        </div>
                    ))}
                    {showNow && <div className={styles.nowLabel} style={{ top: minutesToY(nowMin) - offsetPx }}>{minutesToTime(nowMin)}<span className={styles.nowTip}>Current Time: {fmt12(nowMin)}</span></div>}
                </div>
                <div className={`${styles.col} ${isTodayISO(iso) ? styles.colToday : ''}`} data-col={iso} data-row-offset={rowOffset} style={{ height: panelH }} onClick={(e) => onColClick(e, iso)}>
                    {hours.map(h => <div key={h} className={styles.hourLine} style={{ top: hourToY(h) - offsetPx }} />)}
                    {showNow && <div className={styles.nowLine} style={{ top: minutesToY(nowMin) - offsetPx }}><span className={styles.nowDot} /></div>}
                    {dayLayouts[iso].filter(b => hourSet.has(Math.floor(b.startMin / 60))).map(b => renderBlock(b, offsetPx))}
                    {previewHere && (
                        <div className={styles.preview} style={{ top: minutesToY(colPreview.startMin) - offsetPx, height: Math.max(MIN_BLOCK_PX, minutesToY(colPreview.endMin) - minutesToY(colPreview.startMin)) }}>
                            {minutesToTime(colPreview.startMin)}{colPreview.mode === 'resize' ? `–${minutesToTime(colPreview.endMin)}` : ''}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const gridStyle = { gridTemplateColumns: `56px repeat(${days.length}, minmax(${MIN_COL}px, 1fr))` }

    return (
        <div className={`${styles.wrap} ${fill ? styles.fill : ''}`}>
          <div className={styles.hscroll}>
            {/* Day header */}
            <div className={styles.headRow} style={gridStyle}>
                <div className={styles.gutterCorner} ref={cornerRef}>
                    {hidden.size > 0 && (
                        <button className={styles.showAllBtn} title="Hidden hours" aria-expanded={hiddenPanelOpen} onClick={() => setHiddenPanelOpen(o => !o)}>👁 {hidden.size}</button>
                    )}
                    {hiddenPanelOpen && hidden.size > 0 && (
                        <div className={styles.hiddenPanel}>
                            <div className={styles.hiddenPanelHead}>Hidden hours</div>
                            <div className={styles.hiddenList}>
                                {[...hidden].sort((a, b) => a - b).map(h => (
                                    <button key={h} className={styles.hiddenRow} onClick={() => revealRun(h, h)} title="Show this hour">
                                        <span>{hourLabel(h)}</span><span className={styles.hiddenRowShow}>show</span>
                                    </button>
                                ))}
                            </div>
                            <button className={styles.hiddenShowAll} onClick={showAllHours}>Show all hours</button>
                        </div>
                    )}
                </div>
                {days.map(iso => {
                    const d = new Date(iso + 'T00:00:00')
                    return (
                        <div key={iso} className={`${styles.dayHead} ${isTodayISO(iso) ? styles.todayHead : ''}`}>
                            <span className={styles.dayName}>{DAY_NAMES[d.getDay()]}</span>
                            <span className={styles.dayDate}>{d.getDate()}</span>
                        </div>
                    )
                })}
            </div>

            {/* All-day row (data-allday → dropping an ephemeral daily here makes it untimed) */}
            <div className={styles.allDayRow} style={gridStyle}>
                <div className={styles.gutterLabel}>all-day</div>
                {days.map(iso => {
                    const { allDayItems, ephUntimed, ephCount } = allDayByDay[iso]
                    return (
                        <div key={iso} className={`${styles.allDayCell} ${(allDayOver?.iso === iso || (externalPreview?.type === 'allday' && externalPreview.day === iso)) ? styles.allDayCellOver : ''}`} data-col={iso} data-allday="1" onClick={() => onSlotClick(iso, null)}>
                            {(allDayOver?.iso === iso || (externalPreview?.type === 'allday' && externalPreview.day === iso)) && (
                                <div className={styles.allDayPreview}>{(allDayOver?.iso === iso ? allDayOver.title : externalPreview?.label) || 'All day'}</div>
                            )}
                            {allDayItems.map(it => {
                                // Events + tasks can be dragged onto the timeline (set a time), to
                                // another day's all-day cell, or (tasks) onto the drawer to unschedule.
                                // Recurring dailies stay recurrence-bound (click only).
                                const draggable = it.kind === 'event' || it.kind === 'task'
                                return (
                                <div
                                    key={it.key}
                                    className={[styles.chip, srcClass(it), it.planState === 'new' ? styles.draft : '', it.planState === 'edited' ? styles.modified : '', it.done ? styles.done : '', draggable ? styles.draggable : ''].filter(Boolean).join(' ')}
                                    style={it.color ? { '--src': it.color } : undefined}
                                    title={it.title}
                                    onClick={(e) => { e.stopPropagation(); if (!draggable) onEventClick(it) }}
                                    onPointerDown={draggable ? (e) => onBlockDown(e, it) : undefined}
                                    onPointerMove={draggable ? onBlockMove : undefined}
                                    onPointerUp={draggable ? (e) => { e.stopPropagation(); onBlockUp(e, it) } : undefined}
                                >
                                    {it.kind === 'daily' && onToggleDaily && (
                                        <button
                                            className={`${styles.dailyCheck} ${it.done ? styles.dailyCheckOn : ''}`}
                                            aria-label={it.done ? 'Mark not done' : 'Mark done'}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => { e.stopPropagation(); onToggleDaily(it.id, it.day, !it.done) }}
                                        >{it.done ? '✓' : ''}</button>
                                    )}
                                    <span className={styles.chipTitle}>{it.title}</span>
                                </div>
                                )
                            })}
                            {/* Untimed ephemeral dailies (Day) — drag onto the grid to give them a time */}
                            {ephUntimed.map(it => (
                                <div
                                    key={it.key}
                                    className={[styles.chip, styles.srcDaily, styles.volatile, styles.draggable, it.planState === 'edited' ? styles.modified : '', it.done ? styles.done : ''].filter(Boolean).join(' ')}
                                    title={it.title}
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => onBlockDown(e, it)}
                                    onPointerMove={onBlockMove}
                                    onPointerUp={(e) => { e.stopPropagation(); onBlockUp(e, it) }}
                                >
                                    <button
                                        className={`${styles.dailyCheck} ${it.done ? styles.dailyCheckOn : ''}`}
                                        aria-label={it.done ? 'Mark not done' : 'Mark done'}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => { e.stopPropagation(); onDailyDone?.(it.id, !it.done) }}
                                    >{it.done ? '✓' : ''}</button>
                                    <span className={styles.volatileMark}>⏳</span>
                                    <span className={styles.chipTitle}>{it.title}</span>
                                </div>
                            ))}
                            {/* Week: just a badge → jump into that day's Day view */}
                            {ephCount > 0 && (
                                <button className={styles.ephBadge} onClick={(e) => { e.stopPropagation(); onJumpToDay?.(iso) }} title="Daily tasks — open Day view">
                                    ⏳ {ephCount} {ephCount === 1 ? 'daily' : 'dailies'}
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* 2-column Day layout: whole day as two timelines, sized to fit (no scroll). */}
            {twoCol ? (
              <div className={styles.twoColBody} ref={fitRef}>
                {renderPanel(hoursColA, 0)}
                {renderPanel(hoursColB, splitRow)}
              </div>
            ) : (
            /* Scrollable timeline */
            <div className={styles.body} ref={scrollRef}>
                <div className={styles.grid} style={gridStyle}>
                    {/* Hour gutter — visible hours only; each label has a hide (eye-off) button. */}
                    <div className={styles.gutter} style={{ height: gridHeight() }}>
                        {visibleHours.map(h => (
                            <div key={h} className={styles.hourLabel} style={{ top: hourToY(h) }}>
                                <span>{hourLabel(h)}</span>
                                <button
                                    className={styles.hideHourBtn}
                                    title="Hide this hour (shift-click for a range)"
                                    onClick={(e) => { e.stopPropagation(); hideHour(h, e.shiftKey) }}
                                >⊘</button>
                            </div>
                        ))}
                        {days.some(isTodayISO) && !hidden.has(Math.floor(nowMin / 60)) && (
                            <div className={styles.nowLabel} style={{ top: minutesToY(nowMin) }}>{minutesToTime(nowMin)}<span className={styles.nowTip}>Current Time: {fmt12(nowMin)}</span></div>
                        )}
                    </div>

                    {/* Day columns */}
                    {days.map(iso => {
                        // Preview ghost: our own block drag (dragInfo) takes precedence; otherwise a
                        // timeline drag coming from the Unscheduled drawer (externalPreview).
                        const colPreview = (dragInfo && dragInfo.day === iso) ? dragInfo
                            : (externalPreview && externalPreview.type === 'timeline' && externalPreview.day === iso) ? externalPreview
                            : null
                        return (
                        <div
                            key={iso}
                            className={`${styles.col} ${isTodayISO(iso) ? styles.colToday : ''}`}
                            data-col={iso}
                            style={{ height: gridHeight() }}
                            onClick={(e) => onColClick(e, iso)}
                        >
                            {visibleHours.map(h => <div key={h} className={styles.hourLine} style={{ top: hourToY(h) }} />)}

                            {isTodayISO(iso) && !hidden.has(Math.floor(nowMin / 60)) && (
                                <div className={styles.nowLine} style={{ top: minutesToY(nowMin) }}><span className={styles.nowDot} /></div>
                            )}

                            {dayLayouts[iso].map(b => renderBlock(b))}

                            {colPreview && (
                                <div
                                    className={styles.preview}
                                    style={{ top: minutesToY(colPreview.startMin), height: Math.max(MIN_BLOCK_PX, minutesToY(colPreview.endMin) - minutesToY(colPreview.startMin)) }}
                                >
                                    {minutesToTime(colPreview.startMin)}{colPreview.mode === 'resize' ? `–${minutesToTime(colPreview.endMin)}` : ''}
                                </div>
                            )}
                        </div>
                        )
                    })}
                </div>
            </div>
            )}
          </div>
        </div>
    )
}
