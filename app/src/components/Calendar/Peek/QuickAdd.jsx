import { useState } from 'react'
import styles from './CalendarPeek.module.css'
import RecurrencePicker from './RecurrencePicker.jsx'
import { toISOFromParts, dayFullLabel } from '../calendarDates'

// Quick-add a calendar BLOCK or a recurring DAILY on the focused day. Note/task creation from the
// peek is intentionally OUT OF SCOPE (block is calendar-native; daily exists for recurrence; notes
// and tasks are created in their own surfaces). onCreate = useCalendarEvents.addEvent;
// onCreateDaily = App's daily creator (persists + syncs the calendar's recurring set + TasksHub).
export default function QuickAdd({ day, onCreate, onCreateDaily }) {
    const [type, setType] = useState('block') // 'block' | 'daily'
    const [title, setTitle] = useState('')
    const [time, setTime] = useState('')
    const [recurrence, setRecurrence] = useState('every-day')

    const submit = () => {
        if (!title.trim()) return
        if (type === 'block') {
            const allDay = !time
            onCreate({
                title: title.trim(),
                start_at: toISOFromParts(day, allDay ? null : time),
                end_at: null,
                all_day: allDay,
                color: null,
            })
        } else {
            onCreateDaily?.(title.trim(), { recurrence, time: time || null })
        }
        setTitle('')
        setTime('')
    }

    const onKeyDown = (e) => {
        if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault()
            submit()
        }
    }

    return (
        <div className={styles.quick}>
            <div className={styles.quickTypes}>
                <button type="button" className={`${styles.quickType} ${type === 'block' ? styles.quickTypeOn : ''}`} onClick={() => setType('block')}>Block</button>
                <button type="button" className={`${styles.quickType} ${type === 'daily' ? styles.quickTypeOn : ''}`} onClick={() => setType('daily')}>Daily</button>
            </div>

            <input
                className={styles.quickInput}
                type="text"
                value={title}
                placeholder={type === 'block' ? 'New block…' : 'New daily…'}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={onKeyDown}
            />

            {type === 'daily' && <RecurrencePicker value={recurrence} onChange={setRecurrence} />}

            <div className={styles.quickFoot}>
                <input className={styles.quickTime} type="time" step={900} value={time} onChange={e => setTime(e.target.value)} title="Leave empty for all-day" />
                <span className={styles.quickDate}>{type === 'block' ? dayFullLabel(day) : 'repeats'}</span>
                <button className={styles.quickCreate} onClick={submit}>Create</button>
            </div>
        </div>
    )
}
