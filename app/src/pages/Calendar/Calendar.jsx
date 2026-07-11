import { useState, useMemo, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiChevronLeft, FiChevronRight, FiMinimize2, FiMaximize2, FiColumns, FiSquare } from 'react-icons/fi'
import styles from './Calendar.module.css'
import MonthView from '../../components/Calendar/views/MonthView.jsx'
import WeekView from '../../components/Calendar/views/WeekView.jsx'
import DayView from '../../components/Calendar/views/DayView.jsx'
import EventModal from '../../components/Calendar/EventModal.jsx'
import ItemDetailsModal from '../../components/Calendar/ItemDetailsModal.jsx'
import DayAgendaModal from '../../components/Calendar/DayAgendaModal.jsx'
import ApplyDesignDialog from '../../components/Calendar/ApplyDesignDialog.jsx'
import SchedulesModal from '../../components/Calendar/SchedulesModal.jsx'
import { useCalendar } from '../../hooks/useCalendar.js'
import { useCalendarView } from '../../contexts/CalendarViewContext.jsx'
import {
    isoDate, parseISODate, monthGridDays, mondayOf, addDays,
    MONTH_NAMES, MONTH_NAMES_SHORT, DAY_NAMES, timeOf, taskDueStamp, toISOFromParts,
} from '../../components/Calendar/calendarDates.js'

const VIEWS = ['day', 'week', 'month']

// Full-route Calendar (also rendered in the half-split pane via mode="half"). View + focused day
// live in CalendarViewContext so the peek, the route, and the half pane all stay in sync. Calendar
// data + task mutations are passed in from App (shared with the peek — single fetch).
function Calendar({ authFetch, API, events, addEvent, updateEvent, deleteEvent, planning, enterPlan, applyPlan, discardPlan, planPending, designing, enterDesigner, exitDesigner, applyDesign, onDismissConflict, editingSchedule, schedules, onDeleteSchedule, onRecolorSchedule, onRenameSchedule, onReopenSchedule, onEditSchedule, dailyTasks, dailyCompletions, onToggleDaily, ephemeralDailies, onDailyTime, onDailyDone, onCreateDaily, tasks, undated, onTaskRetime, onTaskSchedule, onTaskUnschedule, onActivate, mode = 'full' }) {
    const { view, setView, focusedDay, setFocusedDay, unpin, tall, toggleTall, day2col, toggleDay2col, dayBalanced, toggleDayBalanced } = useCalendarView()
    // The 2-column Day layout fills the viewport (no scroll), so force fill height for it.
    const dayTwoCol = view === 'day' && day2col
    const navigate = useNavigate()
    const [modal, setModal] = useState(null) // { mode, draft } | null  (event create/edit)
    const [detail, setDetail] = useState(null) // normalized task/daily item, read-only view | null
    const [dayPeek, setDayPeek] = useState(null) // ISO of a Month day whose overview is open | null
    const [applyOpen, setApplyOpen] = useState(false)
    const [schedulesOpen, setSchedulesOpen] = useState(false)

    // Deep-link a linked block to its target. note/sandbox have real detail routes; task/daily/
    // project open their detail modal in TasksHub via a query param the TasksHub bridge consumes.
    const handleOpenLink = useCallback((refType, refId) => {
        if (!refType || !refId) return
        switch (refType) {
            case 'note': navigate(`/notes/${refId}`); break
            case 'sandbox': navigate(`/sandboxes/${refId}`); break
            case 'task': navigate(`/tasks?task=${refId}`); break
            case 'daily': navigate(`/tasks?daily=${refId}`); break
            case 'project': navigate(`/tasks?bundle=${refId}`); break
            default: break
        }
        setModal(null)
        setDetail(null)
    }, [navigate])

    // Tell App to start fetching calendar data (lazy-load) when this route/pane mounts.
    useEffect(() => { onActivate?.() }, [onActivate])

    const anchor = useMemo(() => parseISODate(focusedDay), [focusedDay])
    const monthDate = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1), [anchor])

    const range = useMemo(() => {
        if (view === 'month') {
            const days = monthGridDays(monthDate)
            return { from: days[0], to: days[days.length - 1] }
        }
        if (view === 'week') {
            const ws = mondayOf(anchor)
            return { from: ws, to: addDays(ws, 6) }
        }
        return { from: anchor, to: anchor }
    }, [view, monthDate, anchor])

    const { itemsAt, ephemeralAt, retime } = useCalendar({ events, tasks, dailyTasks, dailyCompletions, ephemeralDailies, range, updateEvent, updateTask: onTaskRetime })

    // Badge in Week/Month → jump into that day's Day view.
    const onJumpToDay = useCallback((dayISO) => { setFocusedDay(dayISO); setView('day') }, [setFocusedDay, setView])

    const shift = (dir) => {
        if (view === 'month') setFocusedDay(isoDate(new Date(anchor.getFullYear(), anchor.getMonth() + dir, Math.min(anchor.getDate(), 28))))
        else if (view === 'week') setFocusedDay(isoDate(addDays(anchor, dir * 7)))
        else setFocusedDay(isoDate(addDays(anchor, dir)))
    }
    const goToday = () => setFocusedDay(isoDate(new Date()))

    const headerLabel = useMemo(() => {
        if (view === 'month') return `${MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`
        if (view === 'week') {
            const ws = mondayOf(anchor), we = addDays(ws, 6)
            const left = `${MONTH_NAMES_SHORT[ws.getMonth()]} ${ws.getDate()}`
            const right = ws.getMonth() === we.getMonth() ? `${we.getDate()}` : `${MONTH_NAMES_SHORT[we.getMonth()]} ${we.getDate()}`
            return `${left} – ${right}, ${we.getFullYear()}`
        }
        return `${DAY_NAMES[anchor.getDay()]}, ${MONTH_NAMES_SHORT[anchor.getMonth()]} ${anchor.getDate()} ${anchor.getFullYear()}`
    }, [view, monthDate, anchor])

    const handleDayClick = useCallback((dayISO) => {
        setFocusedDay(dayISO)
        setModal({ mode: 'create', draft: { title: '', day: dayISO, all_day: true, startTime: '09:00', endTime: '', color: null } })
    }, [setFocusedDay])

    // Month: clicking a populated day opens its overview instead of quick-add.
    const handleDayPeek = useCallback((dayISO) => { setFocusedDay(dayISO); setDayPeek(dayISO) }, [setFocusedDay])

    const handleSlotClick = useCallback((dayISO, time) => {
        setModal({ mode: 'create', draft: { title: '', day: dayISO, all_day: time == null, startTime: time || '09:00', endTime: '', color: null } })
    }, [])

    const handleEventClick = useCallback((item) => {
        // Tasks + dailies (recurring and ephemeral) open a read-only details view, not the editor.
        if (item.kind !== 'event') { setDetail(item); return }
        const e = item.source
        setModal({
            mode: 'edit',
            draft: {
                id: e.id,
                title: e.title,
                day: isoDate(new Date(e.start_at)),
                all_day: e.all_day,
                startTime: e.all_day ? '09:00' : timeOf(e.start_at),
                endTime: e.end_at ? timeOf(e.end_at) : '',
                color: e.color || null,
                description: e.description || '',
                ref_type: e.ref_type || null,
                ref_id: e.ref_id || null,
            },
        })
    }, [])

    const handleSave = useCallback((payload) => {
        // A 'daily' payload (create-only, from the modal's Daily toggle) creates a recurring daily
        // task instead of a block.
        if (payload.type === 'daily') {
            onCreateDaily?.(payload.title, { recurrence: payload.recurrence, time: payload.time })
            setModal(null)
            return
        }
        // Edit persists but keeps the modal open — EventModal returns to its read-only details
        // view after saving. Create adds and closes.
        if (modal?.mode === 'edit') updateEvent(modal.draft.id, payload)
        else { addEvent(payload); setModal(null) }
    }, [modal, addEvent, updateEvent, onCreateDaily])

    const handleDelete = useCallback((id) => { deleteEvent(id); setModal(null) }, [deleteEvent])
    const handleSchedule = useCallback((taskId, dayISO, time) => { onTaskSchedule(taskId, taskDueStamp(dayISO, time)) }, [onTaskSchedule])
    const handleUnschedule = useCallback((taskId) => { onTaskUnschedule?.(taskId) }, [onTaskUnschedule])

    // Drag-resize a block's bottom edge → rewrite its end_at (blocks only; tasks/dailies have no
    // editable duration on the grid).
    const handleResize = useCallback((item, dayISO, endTime) => {
        if (item.kind !== 'event') return
        const newEndISO = toISOFromParts(dayISO, endTime)
        if (newEndISO) updateEvent(item.source.id, { end_at: newEndISO })
    }, [updateEvent])

    return (
        <div className={`${styles.page} ${(tall || dayTwoCol) ? styles.fill : ''} ${mode === 'half' ? styles.pageHalf : ''} ${(planning || designing) ? styles.planning : ''}`}>
            <div className={styles.head}>
                <h1 className={styles.title}>Cal<span className={styles.accent}>endar</span></h1>

                {designing ? (
                    <span className={styles.planPill}><span className={styles.planDot} /> Designer · {editingSchedule ? `editing "${editingSchedule.name}"` : 'blank week'}</span>
                ) : (
                    <div className={styles.monthNav}>
                        <button className={styles.navBtn} onClick={() => shift(-1)} aria-label="Previous"><FiChevronLeft /></button>
                        <button className={styles.todayBtn} onClick={goToday}>Today</button>
                        <button className={styles.navBtn} onClick={() => shift(1)} aria-label="Next"><FiChevronRight /></button>
                        <span className={styles.monthLabel}>{headerLabel}</span>
                    </div>
                )}

                <div className={styles.spacer} />

                {designing ? (
                    <div className={styles.planControls}>
                        <button className={styles.applyBtn} onClick={() => setApplyOpen(true)} disabled={events.length === 0} title="Apply this week across a date range">✓ Apply…</button>
                        <button className={styles.discardBtn} onClick={exitDesigner} title="Close the designer (discard the plot)">✕ Close</button>
                    </div>
                ) : (
                    <>
                        <div className={styles.planControls}>
                            {!planning ? (
                                <>
                                    <button className={styles.planBtn} onClick={enterPlan} title="Plan tentatively — changes apply only when you save">✎ Plan</button>
                                    <button className={styles.planBtn} onClick={() => enterDesigner()} title="Design a weekly schedule on a blank canvas, then stamp it across a date range">⊞ Designer</button>
                                    <button className={styles.planBtn} onClick={() => setSchedulesOpen(true)} title="Manage saved schedules">≡ Schedules</button>
                                </>
                            ) : (
                                <>
                                    <span className={styles.planPill}><span className={styles.planDot} /> Planning{planPending?.total ? ` · ${planPending.total}` : ''}</span>
                                    <button className={styles.applyBtn} onClick={applyPlan} disabled={!planPending?.total} title="Apply all changes">✓ Apply</button>
                                    <button className={styles.discardBtn} onClick={discardPlan} title="Discard changes">↩ Discard</button>
                                </>
                            )}
                        </div>

                        <div className={styles.seg}>
                            {VIEWS.map(v => (
                                <button key={v} className={view === v ? styles.segOn : ''} onClick={() => setView(v)}>{v}</button>
                            ))}
                        </div>

                        {view === 'day' && (
                            <button
                                className={`${styles.heightBtn} ${day2col ? styles.heightBtnOn : ''}`}
                                onClick={toggleDay2col}
                                title={day2col ? 'Single-column Day view' : '2-column Day view (whole day, no scrolling)'}
                                aria-pressed={day2col}
                            >
                                {day2col ? <FiSquare /> : <FiColumns />}
                            </button>
                        )}

                        <button
                            className={styles.heightBtn}
                            onClick={toggleTall}
                            title={tall ? 'Fit the view on screen (overview)' : 'Fill the height (more room)'}
                            aria-pressed={tall}
                        >
                            {tall ? <FiMinimize2 /> : <FiMaximize2 />}
                        </button>
                    </>
                )}

                {mode === 'half' && (
                    <button className={styles.collapseBtn} onClick={unpin} title="Collapse to peek"><FiMinimize2 /></button>
                )}
            </div>

            <div className={styles.viewArea}>
                {view === 'month' && (
                    <MonthView monthDate={monthDate} focusedDay={focusedDay} itemsAt={itemsAt} ephemeralAt={ephemeralAt} fill={tall} onDayClick={handleDayClick} onDayPeek={handleDayPeek} onEventClick={handleEventClick} onRetime={retime} onToggleDaily={onToggleDaily} onJumpToDay={onJumpToDay} />
                )}
                {view === 'week' && (
                    <WeekView anchor={anchor} itemsAt={itemsAt} ephemeralAt={ephemeralAt} fill={tall} onSlotClick={handleSlotClick} onEventClick={handleEventClick} onRetime={retime} onResizeEvent={handleResize} onToggleDaily={onToggleDaily} onDailyTime={onDailyTime} onDailyDone={onDailyDone} onJumpToDay={onJumpToDay} onDismissConflict={designing ? onDismissConflict : undefined} />
                )}
                {view === 'day' && (
                    <DayView dayISO={focusedDay} itemsAt={itemsAt} ephemeralAt={ephemeralAt} fill={tall || dayTwoCol} day2col={day2col} dayBalanced={dayBalanced} onToggleBalanced={toggleDayBalanced} onSlotClick={handleSlotClick} onEventClick={handleEventClick} onRetime={retime} onResizeEvent={handleResize} undated={undated} onSchedule={handleSchedule} onUnschedule={handleUnschedule} onToggleDaily={onToggleDaily} onDailyTime={onDailyTime} onDailyDone={onDailyDone} onJumpToDay={onJumpToDay} onDismissConflict={designing ? onDismissConflict : undefined} />
                )}
            </div>

            {modal && (
                <EventModal mode={modal.mode} draft={modal.draft} hideDate={view === 'day'} onSave={handleSave} onDelete={handleDelete} onClose={() => setModal(null)} onOpenLink={handleOpenLink} authFetch={authFetch} API={API} />
            )}

            {detail && (
                <ItemDetailsModal item={detail} onClose={() => setDetail(null)} onOpenLink={handleOpenLink} />
            )}

            {dayPeek && (
                <DayAgendaModal
                    dateISO={dayPeek}
                    items={itemsAt(dayPeek)}
                    ephemeral={ephemeralAt(dayPeek)}
                    onItemClick={(item) => { setDayPeek(null); handleEventClick(item) }}
                    onAdd={() => { setDayPeek(null); handleDayClick(dayPeek) }}
                    onClose={() => setDayPeek(null)}
                />
            )}

            {applyOpen && (
                <ApplyDesignDialog
                    blockCount={events.length}
                    editing={editingSchedule}
                    onApply={async (args) => { await applyDesign(args); setApplyOpen(false) }}
                    onClose={() => setApplyOpen(false)}
                />
            )}
            {schedulesOpen && (
                <SchedulesModal
                    schedules={schedules}
                    onDelete={onDeleteSchedule}
                    onRecolor={onRecolorSchedule}
                    onRename={onRenameSchedule}
                    onEdit={(s) => { setSchedulesOpen(false); onEditSchedule(s) }}
                    onDuplicate={(s) => { setSchedulesOpen(false); onReopenSchedule(s) }}
                    onClose={() => setSchedulesOpen(false)}
                />
            )}
        </div>
    )
}

export default Calendar
