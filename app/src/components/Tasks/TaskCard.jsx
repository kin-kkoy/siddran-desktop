import { useState, memo } from 'react'
import styles from './TaskCard.module.css'
import { FaCheck } from "react-icons/fa"
import { HiOutlineTrash } from "react-icons/hi"
import ConfirmModal from '../Common/ConfirmModal'

function TaskCard({ task, deleteTask, toggleCompletion, isSelectionMode, isSelected, onToggleSelect, onOpenDetail }) {
    const [showDeleteModal, setShowDeleteModal] = useState(false)

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dueDay = task.due_date ? new Date(task.due_date) : null; if (dueDay) dueDay.setHours(0, 0, 0, 0)
    const isOverdue = !task.is_completed && dueDay !== null && dueDay < today

    const handleDelete = e => {
        e.preventDefault()
        e.stopPropagation()
        setShowDeleteModal(true)
    }

    const confirmDelete = () => {
        deleteTask(task.id)
        setShowDeleteModal(false)
    }

    const handleToggle = e => {
        e.preventDefault()
        e.stopPropagation()
        toggleCompletion(task.id, !task.is_completed)
    }

    const handleCardClick = () => {
        if (isSelectionMode) {
            onToggleSelect(task.id)
        }else{
            onOpenDetail(task);
        }
    }


    return (
        <div
            className={`
                ${styles.card} 
                ${task.is_completed ? styles.completed : ''} 
                ${isSelected ? styles.selected : ''}
                ${isOverdue ? styles.overdue : ''}
            `}
            onClick={handleCardClick}
            // style={{ cursor: isSelectionMode ? 'pointer' : 'default' }}
            style={{cursor: 'pointer'}}
        >

            {/* Selection checkbox in selection mode */}
            {isSelectionMode && (
                <div className={styles.selectionCheckbox}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(task.id)}
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}

            {/* ------- Checkbox ------- */}
            {!isSelectionMode && (
                <button
                    className={`${styles.checkbox} ${task.is_completed ? styles.checked : ''}`}
                    onClick={handleToggle}
                >
                    {task.is_completed && <FaCheck size={12} />}
                </button>
            )}

            {/* ------- Contents ------- */}
            <div className={styles.content}>

                <h3 className={styles.title}>{task.title}</h3>
                {task.description && (
                <p className={styles.description}>
                    {task.description.substring(0, 100)}
                    {task.description.length > 100 ? '...' : ''}
                </p>
                )}

                {/* --- Metadata --- */}
                <div className={styles.metadata}>
                    <div className={styles.metaLeft}>
                        {task.due_date && (
                            <span className={styles.dueDate}>
                                Due: {new Date(task.due_date).toLocaleDateString()}
                            </span>
                        )}
                        {isOverdue && (
                            <span className={styles.overdueTag}>Overdue</span>
                        )}
                    </div>
                </div>

            </div>

            {/* ------- Right Column: Priority + Delete ------- */}
            {!isSelectionMode && (
                <div className={styles.rightCol}>
                    <span className={`${styles.priority} ${styles[task.priority]}`}>
                        {task.priority}
                    </span>
                    <button className={styles.deleteBtn} onClick={handleDelete}>
                        <HiOutlineTrash size={18} />
                    </button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                title="Delete Task"
                message={`Are you sure you want to delete "${task.title}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
            />

        </div>
    )
}

export default memo(TaskCard)