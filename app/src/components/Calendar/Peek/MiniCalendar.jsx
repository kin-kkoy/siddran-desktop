import { memo } from 'react'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import styles from './CalendarPeek.module.css'
import { monthGridDays, isoDate, isTodayISO, MONTH_NAMES } from '../calendarDates'

const MINI_HEAD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

// Compact month picker. Clicking a day sets the focused day; arrows shift the month.
function MiniCalendar({ monthDate, focusedDay, onPick, onPrevMonth, onNextMonth, onToday, hasItems }) {
    const days = monthGridDays(monthDate)

    return (
        <div>
            <div className={styles.miniHead}>
                <span className={styles.miniMonth}>{MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}</span>
                <div className={styles.miniNav}>
                    <button onClick={onPrevMonth} aria-label="Previous month"><FiChevronLeft /></button>
                    <button onClick={onToday} title="Today" aria-label="Today"><span className={styles.miniTodayDot} /></button>
                    <button onClick={onNextMonth} aria-label="Next month"><FiChevronRight /></button>
                </div>
            </div>
            <div className={styles.miniGrid}>
                {MINI_HEAD.map(d => <span key={d} className={styles.miniWeekday}>{d}</span>)}
                {days.map(d => {
                    const iso = isoDate(d)
                    const dim = d.getMonth() !== monthDate.getMonth()
                    const cls = [
                        styles.miniCell,
                        dim ? styles.miniDim : '',
                        isTodayISO(iso) ? styles.miniToday : '',
                        iso === focusedDay ? styles.miniFocused : '',
                        hasItems(iso) ? styles.miniHas : '',
                    ].filter(Boolean).join(' ')
                    return (
                        <button key={iso} className={cls} onClick={() => onPick(iso)}>{d.getDate()}</button>
                    )
                })}
            </div>
        </div>
    )
}

export default memo(MiniCalendar)
