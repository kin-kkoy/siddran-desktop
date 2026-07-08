import styles from './DayAgendaModal.module.css'
import { useModalPresence } from '../../utils/modalPresence'

// Read-only overview of everything on a single day (opened by clicking a populated Month cell).
// Each row deep-links to that item's own detail/edit (onItemClick → Calendar.handleEventClick);
// "New block" falls back to the quick-add flow for an empty-ish day.
//
// Props:
//   dateISO    — 'YYYY-MM-DD'
//   items      — itemsAt(dateISO): events + tasks + recurring dailies
//   ephemeral  — ephemeralAt(dateISO): one-off dailies
//   onItemClick(item) · onAdd() · onClose()

const fmtDate = (iso) => {
    if (!iso) return ''
    try {
        return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        })
    } catch { return iso }
}

const KIND = {
    event: { color: '#f0b840', label: 'Event' },
    task:  { color: '#5a9cf0', label: 'Task' },
    daily: { color: '#52c47a', label: 'Daily' },
}

function meta(it) {
    if (it.kind === 'event') return { color: it.color || KIND.event.color, label: it.ref_type ? it.ref_type : 'Event' }
    if (it.kind === 'daily') return { color: KIND.daily.color, label: it.ephemeral ? 'Daily · one-off' : 'Daily' }
    return { color: KIND.task.color, label: 'Task' }
}

export default function DayAgendaModal({ dateISO, items = [], ephemeral = [], onItemClick, onAdd, onClose }) {
    useModalPresence()

    // Merge + order: all-day/untimed first, then by time, then title.
    const all = [...items, ...ephemeral].sort((a, b) => {
        const at = a.time || '', bt = b.time || ''
        if (at !== bt) return at < bt ? -1 : 1
        return (a.title || '').localeCompare(b.title || '')
    })

    const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return (
        <div className={styles.backdrop} onClick={handleBackdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div>
                        <h3 className={styles.title}>{fmtDate(dateISO)}</h3>
                        <span className={styles.count}>{all.length} {all.length === 1 ? 'item' : 'items'}</span>
                    </div>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>

                <div className={styles.list}>
                    {all.map(it => {
                        const m = meta(it)
                        return (
                            <button
                                key={it.key}
                                type="button"
                                className={`${styles.row} ${it.done ? styles.rowDone : ''}`}
                                onClick={() => onItemClick?.(it)}
                            >
                                <span className={styles.dot} style={{ background: m.color }} />
                                <span className={styles.when}>{it.time || 'All day'}</span>
                                <span className={styles.rowTitle}>{it.title || '(untitled)'}</span>
                                <span className={styles.kind}>{m.label}</span>
                            </button>
                        )
                    })}
                    {all.length === 0 && <div className={styles.empty}>Nothing on this day.</div>}
                </div>

                <div className={styles.footer}>
                    <button className={styles.addBtn} onClick={onAdd}>+ New block</button>
                    <button className={styles.closeTextBtn} onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    )
}
