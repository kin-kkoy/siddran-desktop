import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LuAlarmClock, LuBellOff, LuCheck, LuClock } from 'react-icons/lu'
import styles from './AlarmModal.module.css'
import { modalPresence } from '../../utils/modalPresence'

// The one modal in this app that does NOT close on Escape or on a backdrop
// click. That is deliberate — "keeps going until I dismiss it" is the entire
// point of an alarm, and a dialog you can dismiss by looking at it funny is a
// notification. Please don't "fix" it.
//
// The sound is owned by useDeadlineAlarms, not by this component: it belongs to
// the queue, so an unmount for any reason can't leave it ringing forever.
function AlarmModal({ ringing = [], onDismiss, onDismissAll, onSnooze, onComplete, snoozeMinutes = 10 }) {
  const open = ringing.length > 0

  useEffect(() => {
    if (!open) return
    modalPresence.push()
    return () => modalPresence.pop()
  }, [open])

  if (!open) return null

  const fmt = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return createPortal(
    <div className={styles.backdrop} role="alertdialog" aria-modal="true" aria-label="Deadline reached">
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}><LuAlarmClock size={22} /></span>
          <div>
            <h2 className={styles.title}>
              {ringing.length === 1 ? 'Deadline reached' : `${ringing.length} deadlines reached`}
            </h2>
            <p className={styles.subtitle}>This won&apos;t stop until you say so.</p>
          </div>
        </div>

        <ul className={styles.list}>
          {ringing.map((item) => (
            <li key={item.key} className={styles.item}>
              <div className={styles.itemText}>
                <span className={styles.itemTitle}>{item.title || 'Untitled'}</span>
                <span className={styles.itemMeta}>
                  {item.kind === 'daily' ? 'Routine' : 'Task'} · due {fmt(item.at)}
                </span>
              </div>
              <div className={styles.itemActions}>
                {onComplete && (
                  <button className={styles.ghostBtn} onClick={() => onComplete(item)} title="Mark done">
                    <LuCheck size={15} /> Done
                  </button>
                )}
                <button className={styles.ghostBtn} onClick={() => onSnooze(item.key)} title={`Snooze ${snoozeMinutes} minutes`}>
                  <LuClock size={15} /> {snoozeMinutes}m
                </button>
                <button className={styles.dismissBtn} onClick={() => onDismiss(item.key)}>
                  <LuBellOff size={15} /> Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>

        {ringing.length > 1 && (
          <div className={styles.footer}>
            <button className={styles.dismissAllBtn} onClick={onDismissAll}>Dismiss all</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export default AlarmModal
