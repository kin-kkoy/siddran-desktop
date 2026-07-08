import { useState } from 'react'
import { FaCheck } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import { LuRepeat } from 'react-icons/lu'
import styles from './DailyTaskCard.module.css'
import ConfirmModal from '../Common/ConfirmModal'

// Short label for a recurring daily's schedule (null = ephemeral one-off, no badge).
function recurrenceLabel(rec) {
    if (rec == null) return null
    const s = String(rec)
    if (s === 'every-day') return 'daily'
    if (s === 'weekdays') return 'weekdays'
    if (s === 'weekends') return 'weekends'
    if (s.startsWith('{')) {
        try {
            const p = JSON.parse(s)
            if (Array.isArray(p?.mask)) return `${p.mask.filter(Boolean).length}×/wk`
        } catch { /* ignore */ }
    }
    return 'repeats'
}

function DailyTaskCard({ tasks, toggleCompletion, deleteTask, onOpenDetail, onOpenCard }) {
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [taskToDelete, setTaskToDelete] = useState(null)

    const handleDeleteClick = (task) => {
        setTaskToDelete(task)
        setDeleteModalOpen(true)
    }

    const confirmDelete = () => {
        if (taskToDelete) {
            deleteTask(taskToDelete.id)
        }
        setDeleteModalOpen(false)
        setTaskToDelete(null)
    }

    // Sort tasks by priority: High -> Normal -> Low
    const priorityOrder = { high: 0, normal: 1, low: 2 }
    const sortedTasks = [...tasks].sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
        return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
    })
    // const [timeRemaining, setTimeRemaining] = useState('')

    // // Calculate time remaining until expiration
    // useEffect(() => {
    //     if (tasks.length === 0) return

    //     const updateCountdown = () => {
    //         const expiresAt = new Date(tasks[0].expires_at)
    //         const now = new Date()
    //         const diff = expiresAt - now

    //         if (diff <= 0) {
    //             setTimeRemaining('Expired')
    //             return
    //         }

    //         const hours = Math.floor(diff / (1000 * 60 * 60))
    //         const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
            
    //         setTimeRemaining(`${hours}h ${minutes}m remaining`)
    //     }

    //     updateCountdown()
    //     const interval = setInterval(updateCountdown, 60000) // Update every minute

    //     return () => clearInterval(interval)
    // }, [tasks])

    if (tasks.length === 0) return null

    const completedCount = tasks.filter(t => t.is_completed).length
    const totalCount = tasks.length

    return (
        <div className={styles.card}>
            {/* Header of Daily Task Card*/}
            <div className={styles.header} onClick={onOpenCard}>
                <div className={styles.headerLeft}>
                    <h3 className={styles.title}>Today's Tasks</h3>
                </div>
                {/* <span className={styles.countdown}>{timeRemaining}</span> */}
            </div>

            {/* Task List */}
            <ul className={styles.taskList}>
                {sortedTasks.map(task => (
                    <li key={task.id} className={`${styles.taskItem} ${task.is_completed ? styles.completed : ''}`} onClick={() => onOpenDetail(task)}>
                        {/* Checkbox */}
                        <button
                            className={`${styles.checkbox} ${task.is_completed ? styles.checked : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleCompletion(task.id, !task.is_completed)
                            }}
                        >
                            {task.is_completed && <FaCheck size={12} />}
                        </button>

                        {/* Task Content */}
                        <div className={styles.taskContent}>
                            <span className={styles.taskTitle}>{task.title}</span>
                            {recurrenceLabel(task.recurrence) && (
                                <span className={styles.recurBadge} title={`Recurring · ${recurrenceLabel(task.recurrence)}`}>
                                    <LuRepeat size={10} /> {recurrenceLabel(task.recurrence)}
                                </span>
                            )}
                        </div>

                        {/* Delete Button */}
                        <button
                            className={styles.deleteBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(task)
                            }}
                        >
                            <HiOutlineTrash size={14} />
                        </button>

                        <span className={`${styles.priority} ${styles[task.priority]}`}>
                            {task.priority}
                        </span>
                    </li>
                ))}
            </ul>

            {/* Footer - Progress */}
            <div className={styles.footer} onClick={onOpenCard}>
                <div className={styles.progressBar}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${(completedCount / totalCount) * 100}%` }}
                    />
                </div>
                <span className={styles.progressText}>
                    {completedCount} / {totalCount} completed
                </span>
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={deleteModalOpen}
                onClose={() => {
                    setDeleteModalOpen(false)
                    setTaskToDelete(null)
                }}
                onConfirm={confirmDelete}
                title="Delete Daily Task"
                message={taskToDelete ? `Are you sure you want to delete "${taskToDelete.title}"? This action cannot be undone.` : ''}
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    )
}

export default DailyTaskCard