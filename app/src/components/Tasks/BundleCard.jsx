import { useState } from 'react'
import { FaCheck } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './BundleCard.module.css'
import ConfirmModal from '../Common/ConfirmModal'

function BundleCard({ bundle, toggleBundleTaskCompletion, deleteBundle, onOpenDetail }) {

    const [ showDeleteModal, setShowDeleteModal ] = useState(false);

    const handleDelete = e => {
        e.preventDefault()
        e.stopPropagation()
        setShowDeleteModal(true);
    }

    const confirmDelete = () => {
        deleteBundle(bundle.id)
        setShowDeleteModal(false)
    }

    const priorityOrder = { high: 0, normal: 1, low: 2 }
    const sortedTasks = [...bundle.tasks].sort((a, b) => {
        if(a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
        return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1)
    })

    const totalCount = bundle.tasks.length;
    const completedCount = bundle.tasks.filter(task => task.is_completed).length;

    return (
        <div
            className={styles.card}
            onClick={() => onOpenDetail(bundle)}
            style={bundle.color ? { backgroundColor: `color-mix(in srgb, ${bundle.color} 12%, var(--bg-elevated))` } : undefined}
        >

            {/* Header: title + bundle priority + delete button */}
            <div className={styles.header} style={bundle.color ? { backgroundColor: `color-mix(in srgb, ${bundle.color} 18%, var(--bg-elevated))` } : undefined}>
                <div className={styles.headerLeft}>
                    <h3 className={styles.title}>{bundle.title}</h3>
                </div>
                <div className={styles.headerRight}>
                    <span className={`${styles.bundlePriority} ${styles[`pp_${bundle.priority}`] || ''}`}>
                        {bundle.priority?.replace(/_/g, ' ')}
                    </span>
                    <button className={styles.deleteBtn} onClick={handleDelete}>
                        <HiOutlineTrash size={18} />
                    </button>
                </div>
            </div>

            {/* Task List: sorted tasks with checkbox + title + priority tag */}
            <ul className={styles.taskList}>
                {sortedTasks.map(task => (
                    <li key={task.id} className={`${styles.taskItem} ${task.is_completed ? styles.completed : ''}`}>
                        <button
                            className={`${styles.checkbox} ${task.is_completed ? styles.checked : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleBundleTaskCompletion(bundle.id, task.id, !task.is_completed)
                            }}
                        >
                            {task.is_completed && <FaCheck size={12} />}
                        </button>

                        <div className={styles.taskContent}>
                            <span className={styles.taskTitle}>{task.title}</span>
                        </div>

                        <span className={`${styles.priority} ${styles[task.priority]}`}>
                            {task.priority}
                        </span>
                    </li>
                ))}
            </ul>

            {/* Footer: progress bar + "X / Y completed" */}
            {totalCount > 0 && (
                <div className={styles.footer} style={bundle.color ? { backgroundColor: `color-mix(in srgb, ${bundle.color} 6%, var(--bg-primary))` } : undefined}>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{
                                width: `${(completedCount / totalCount) * 100}%`,
                                backgroundColor: bundle.color || undefined,
                            }}
                        />
                    </div>
                    <span className={styles.progressText}>
                        {completedCount} / {totalCount} completed
                    </span>
                </div>
            )}

            <div>
                <ConfirmModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={confirmDelete}
                    title="Delete Bundle"
                    message={`Are you sure you want to delete "${bundle.title}"? This action cannot be undone.`}
                    confirmText="Delete"
                    cancelText="Cancel"
                />
            </div>

        </div>
    )
}

export default BundleCard
