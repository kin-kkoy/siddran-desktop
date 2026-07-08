import { memo } from 'react'
import styles from './AttachedTaskCard.module.css'
import { useCardPointer, cardBoxStyle } from './useCardPointer'

/**
 * Live-reference task card. `item.payload.taskId` is stored; the task is read
 * from `tasks` each render. The checkbox toggles completion through
 * toggleTaskCompletion (reflected app-wide). Shares the card pointer hook for
 * select/move/erase.
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
            <div {...common} className={styles.deleted}>
                <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Remove attachment">×</button>
                <div className={styles.label}>TASK GONE</div>
                <div className={styles.deletedNote}>The referenced task was deleted.</div>
            </div>
        )
    }

    const due = task.due_date ? new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null

    return (
        <div {...common} className={`${styles.card} ${task.is_completed ? styles.done : ''}`}>
            <button className={styles.removeBtn} onClick={() => onRemove(item.id)} title="Detach (task is not deleted)">×</button>
            <div className={styles.label}>TASK</div>
            <div className={styles.row}>
                <button
                    data-sb-noedit="true"
                    className={`${styles.check} ${task.is_completed ? styles.checked : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggleTask?.(task.id, !task.is_completed) }}
                    title={task.is_completed ? 'Mark incomplete' : 'Mark complete'}
                >
                    {task.is_completed ? '✓' : ''}
                </button>
                <div className={styles.title}>{task.title || 'Untitled task'}</div>
            </div>
            <div className={styles.meta}>
                {task.priority ? <span className={`${styles.priority} ${styles['p_' + task.priority]}`}>{task.priority}</span> : null}
                {due ? <span className={styles.due}>{due}</span> : null}
            </div>
        </div>
    )
}

export default memo(AttachedTaskCard)
