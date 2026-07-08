import styles from './ItemDetailsModal.module.css'
import { useModalPresence } from '../../utils/modalPresence'

// Read-only details for a non-event calendar item (task overlay, recurring daily, ephemeral
// daily). "Just click to see it" — no edit, no drag here; the only action is a deep-link to the
// item's home surface (TasksHub via the existing ?task=/?daily= bridge).
//
// Props:
//   item       — normalized calendar item ({ kind:'task'|'daily', id, title, day, done, time,
//                all_day, ephemeral, source })
//   onClose    — () => void
//   onOpenLink — (refType, refId) => void   (reuses Calendar's deep-link handler)

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const fmtDate = (iso) => {
    if (!iso) return ''
    try {
        return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        })
    } catch { return iso }
}

// Human-readable recurrence: 'every-day'|'weekdays'|'weekends' | '{"mask":[7 bools]}' (Sun-first).
function fmtRecurrence(rec) {
    if (rec == null) return null
    const fromMask = (mask) => Array.isArray(mask)
        ? (mask.map((on, i) => (on ? DAY_ABBR[i] : null)).filter(Boolean).join(', ') || null)
        : null
    if (typeof rec === 'object') return fromMask(rec.mask)
    const s = String(rec).trim()
    if (s === 'every-day') return 'Every day'
    if (s === 'weekdays') return 'Weekdays (Mon–Fri)'
    if (s === 'weekends') return 'Weekends (Sat–Sun)'
    if (s.startsWith('{')) {
        try { return fromMask(JSON.parse(s)?.mask) } catch { /* fall through */ }
    }
    return null
}

export default function ItemDetailsModal({ item, onClose, onOpenLink }) {
    useModalPresence()
    if (!item) return null

    const isTask = item.kind === 'task'
    const recurring = item.kind === 'daily' && !item.ephemeral
    const recurrence = recurring ? fmtRecurrence(item.source?.recurrence) : null

    const kindLabel = isTask
        ? 'Task'
        : item.ephemeral ? 'Daily task (one-off)' : 'Daily task (recurring)'
    const whenLabel = isTask ? 'Due' : 'When'
    const whenValue = `${fmtDate(item.day)}${item.all_day ? ' · All day' : ` · ${item.time}`}`

    const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return (
        <div className={styles.backdrop} onClick={handleBackdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>{item.title || '(untitled)'}</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>

                <div className={styles.body}>
                    <div className={styles.row}>
                        <span className={styles.label}>Type</span>
                        <span className={styles.value}>{kindLabel}</span>
                    </div>

                    <div className={styles.row}>
                        <span className={styles.label}>{whenLabel}</span>
                        <span className={styles.value}>{whenValue}</span>
                    </div>

                    {recurrence && (
                        <div className={styles.row}>
                            <span className={styles.label}>Repeats</span>
                            <span className={styles.value}>{recurrence}</span>
                        </div>
                    )}

                    <div className={styles.row}>
                        <span className={styles.label}>Status</span>
                        <span className={`${styles.status} ${item.done ? styles.statusDone : ''}`}>
                            {item.done ? '✓ Done' : 'Not done'}
                        </span>
                    </div>

                    {item.ephemeral && (
                        <p className={styles.note}>⏳ One-off daily — expires at the end of its day.</p>
                    )}
                </div>

                <div className={styles.footer}>
                    <span />
                    <div className={styles.footerRight}>
                        <button className={styles.cancelBtn} onClick={onClose}>Close</button>
                        {onOpenLink && (
                            <button
                                className={styles.openBtn}
                                onClick={() => onOpenLink(isTask ? 'task' : 'daily', item.id)}
                            >
                                Open {isTask ? 'task' : 'daily'} →
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
