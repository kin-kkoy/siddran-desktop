import { memo } from 'react'
import styles from './CalendarPeek.module.css'

// Reused for the "Today" and "On focused day" sections. Read-only list of derived items.
const KIND_CLASS = {
    note: styles.srcNote,
    task: styles.srcTask,
    daily: styles.srcDaily,
}

function srcClass(item) {
    if (item.kind === 'task') return styles.srcTask
    if (item.kind === 'daily') return styles.srcDaily
    if (item.kind === 'event') {
        if (item.ref_type === 'note') return styles.srcNote
        if (item.ref_type === 'project') return styles.srcBundle
        if (item.ref_type === 'sandbox') return styles.srcSandbox
        return KIND_CLASS[item.ref_type] || styles.srcEvent
    }
    return styles.srcEvent
}

function FocusedDayList({ items, emptyText, onToggleDaily }) {
    if (!items.length) {
        return <div className={styles.empty}>{emptyText || 'Nothing here.'}</div>
    }
    return (
        <div className={styles.evtList}>
            {items.map(it => (
                <div
                    key={it.key}
                    className={`${styles.evt} ${srcClass(it)} ${it.done ? styles.evtDone : ''}`}
                    style={it.color ? { borderLeftColor: it.color } : undefined}
                    title={it.title}
                >
                    {it.kind === 'daily' && onToggleDaily && (
                        <button
                            className={`${styles.dailyCheck} ${it.done ? styles.dailyCheckOn : ''}`}
                            aria-label={it.done ? 'Mark not done' : 'Mark done'}
                            onClick={() => onToggleDaily(it.id, it.day, !it.done)}
                        >{it.done ? '✓' : ''}</button>
                    )}
                    <span className={styles.evtBody}>{it.title}</span>
                    {it.time && <span className={styles.evtTime}>{it.time}</span>}
                </div>
            ))}
        </div>
    )
}

export default memo(FocusedDayList)
