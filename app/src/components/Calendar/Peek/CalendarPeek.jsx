import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiColumns, FiExternalLink, FiX } from 'react-icons/fi'
import styles from './CalendarPeek.module.css'
import AccordionSection from './AccordionSection.jsx'
import MiniCalendar from './MiniCalendar.jsx'
import FocusedDayList from './FocusedDayList.jsx'
import QuickAdd from './QuickAdd.jsx'
import { useCalendarView } from '../../../contexts/CalendarViewContext.jsx'
import { useCalendar } from '../../../hooks/useCalendar.js'
import { parseISODate, monthGridDays, isoDate, dayFullLabel } from '../calendarDates.js'

const COLLAPSE_KEY = 'cinder_cal_peek_collapsed'

// Root-mounted peek drawer (fixed, right edge). Only renders in 'peek' mode — 'half' is rendered
// by the app shell as a split pane, 'hidden'/'full' render nothing here. Mirrors the Sandbox dock
// pattern (without touching any Sandbox file).
export default function CalendarPeek({ events, tasks, dailyTasks, dailyCompletions, onToggleDaily, addEvent, onCreateDaily }) {
    const cal = useCalendarView()
    const navigate = useNavigate()

    const [collapsed, setCollapsed] = useState(() => {
        try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {} } catch { return {} }
    })
    const toggleSection = (key) => setCollapsed(prev => {
        const next = { ...prev, [key]: !prev[key] }
        try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
    })

    // The drawer stays PERSISTENTLY mounted (offscreen when closed) — toggling the .open class on
    // a persistent element transitions reliably in BOTH directions (a freshly-mounted element
    // races the class flip and skips the enter transition). `render` only gates the heavy body
    // content, kept alive through the 260ms slide-out so the close animation has something to show.
    const [render, setRender] = useState(cal.isPeek)
    useEffect(() => {
        if (cal.isPeek) { setRender(true); return }
        const t = setTimeout(() => setRender(false), 260)
        return () => clearTimeout(t)
    }, [cal.isPeek])

    // monthDate keyed on the focusedDay STRING (stable ref) so memoized children don't re-render
    // when an accordion section is toggled.
    const monthDate = useMemo(() => {
        const f = parseISODate(cal.focusedDay)
        return new Date(f.getFullYear(), f.getMonth(), 1)
    }, [cal.focusedDay])
    const monthRange = useMemo(() => {
        const d = monthGridDays(monthDate)
        return { from: d[0], to: d[d.length - 1] }
    }, [monthDate])
    const { itemsAt } = useCalendar({ events, tasks, dailyTasks, dailyCompletions, range: monthRange })

    const todayISO = isoDate(new Date())
    const todayItems = itemsAt(todayISO)
    const focusedItems = itemsAt(cal.focusedDay)
    const markedCount = useMemo(
        () => monthGridDays(monthDate).filter(d => d.getMonth() === monthDate.getMonth() && itemsAt(isoDate(d)).length).length,
        [monthDate, itemsAt],
    )

    const shiftMonth = useCallback((dir) => {
        const f = parseISODate(cal.focusedDay)
        cal.setFocusedDay(isoDate(new Date(f.getFullYear(), f.getMonth() + dir, Math.min(f.getDate(), 28))))
    }, [cal])
    const prevMonth = useCallback(() => shiftMonth(-1), [shiftMonth])
    const nextMonth = useCallback(() => shiftMonth(1), [shiftMonth])
    const goToday = useCallback(() => cal.setFocusedDay(todayISO), [cal, todayISO])
    const hasItems = useCallback((iso) => itemsAt(iso).length > 0, [itemsAt])

    return (
        <>
            <div className={`${styles.shadow} ${cal.isPeek ? styles.shadowOn : ''}`} onClick={cal.close} />
            <aside className={`${styles.drawer} ${cal.isPeek ? styles.open : ''}`}>
                {(cal.isPeek || render) && (
                <>
                <header className={styles.head}>
                    <h4 className={styles.headTitle}>Cal<span className={styles.accent}>endar</span></h4>
                    <span className={styles.badge}>PEEK</span>
                    <div className={styles.grow} />
                    <button className={styles.iconBtn} title="Pin to half-split" onClick={cal.pin}><FiColumns /></button>
                    <button className={styles.iconBtn} title="Open full route" onClick={() => { cal.close(); navigate('/calendar') }}><FiExternalLink /></button>
                    <button className={styles.iconBtn} title="Close (Esc)" onClick={cal.close}><FiX /></button>
                </header>

                <div className={styles.body}>
                    <AccordionSection label={`${monthDate.toLocaleString('default', { month: 'long' })} ${monthDate.getFullYear()}`} meta={`${markedCount} marked`} collapsed={collapsed.mini} onToggle={() => toggleSection('mini')}>
                        <MiniCalendar
                            monthDate={monthDate}
                            focusedDay={cal.focusedDay}
                            onPick={cal.setFocusedDay}
                            onPrevMonth={prevMonth}
                            onNextMonth={nextMonth}
                            onToday={goToday}
                            hasItems={hasItems}
                        />
                    </AccordionSection>

                    <AccordionSection label="Today" meta={`${todayItems.length} items`} collapsed={collapsed.today} onToggle={() => toggleSection('today')}>
                        <FocusedDayList items={todayItems} emptyText="Nothing on today's plate." onToggleDaily={onToggleDaily} />
                    </AccordionSection>

                    <AccordionSection label="Quick Add" meta="⌘⏎" collapsed={collapsed.quick} onToggle={() => toggleSection('quick')}>
                        <QuickAdd day={cal.focusedDay} onCreate={addEvent} onCreateDaily={onCreateDaily} />
                    </AccordionSection>

                    <AccordionSection label={`On ${dayFullLabel(cal.focusedDay)}`} meta={`${focusedItems.length} items`} collapsed={collapsed.focused} onToggle={() => toggleSection('focused')}>
                        <FocusedDayList items={focusedItems} emptyText="No items on this day." onToggleDaily={onToggleDaily} />
                    </AccordionSection>
                </div>

                <footer className={styles.foot}>
                    <span className={styles.kbd}>Esc</span><span>close</span>
                    <span className={styles.kbd}>⌘;</span><span>toggle</span>
                    <div className={styles.grow} />
                    <button className={styles.pinLink} onClick={cal.pin}>Pin to half →</button>
                </footer>
                </>
                )}
            </aside>
        </>
    )
}
