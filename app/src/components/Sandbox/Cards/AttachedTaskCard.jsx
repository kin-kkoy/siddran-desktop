import { memo } from 'react'
import { LuCheck, LuCalendarDays } from 'react-icons/lu'
import styles from './AttachedTaskCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'

/**
 * Live-reference task card. `item.payload.taskId` is stored; the task is read
 * from `tasks` each render. Reads as a to-do: a round check on the left, the
 * title, then a footer with a priority pill and (if set) a due chip. The left
 * edge is tinted by priority. The whole card drags (the check is data-sb-noedit).
 */
function AttachedTaskCard({ item, tasks, onUpdate, onRemove, onToggleTask, zoom, tool, selected, onSelect, beginTransaction, endTransaction }) {
    const task = tasks?.find(t => String(t.id) === String(item.payload.taskId))
    const { elRef, onPointerDown, onPointerMove, onPointerUp } = useCardPointer({
        item, tool, zoom, onSelect, onUpdate, onRemove, beginTransaction, endTransaction,
    })

    const common = {
        ref: elRef,
        'data-sb-card': 'true',
        'data-sb-id': item.id,
        style: cardBoxStyle(item, selected),
        onPointerDown, onPointerMove, onPointerUp,
    }

    if (!task) {
        return (
            <div {...common} className={`${styles.card} ${styles.deleted} ${selected ? styles.selected : ''}`}>
                <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Remove attachment">×</button>
                <div className={styles.label}>TASK GONE</div>
                <div className={styles.deletedNote}>The referenced task was deleted.</div>
            </div>
        )
    }

    const prio = task.priority || 'normal'
    const due = task.due_date ? new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null

    return (
        <div {...common} className={`${styles.card} ${styles['accent_' + prio]} ${task.is_completed ? styles.done : ''} ${selected ? styles.selected : ''}`}>
            <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Detach (task is not deleted)">×</button>
            <div className={styles.top}>
                <button
                    data-sb-noedit="true"
                    className={`${styles.check} ${task.is_completed ? styles.checked : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggleTask?.(task.id, !task.is_completed) }}
                    title={task.is_completed ? 'Mark incomplete' : 'Mark complete'}
                >
                    {task.is_completed ? <LuCheck size={13} strokeWidth={3} /> : null}
                </button>
                <div className={styles.title}>{task.title || 'Untitled task'}</div>
            </div>
            <div className={styles.meta}>
                <span className={styles.kind}>TASK</span>
                <span className={`${styles.prio} ${styles['p_' + prio]}`}>{prio}</span>
                {due && <span className={styles.due}><LuCalendarDays size={11} /> {due}</span>}
            </div>
        </div>
    )
}

export default memo(AttachedTaskCard)
