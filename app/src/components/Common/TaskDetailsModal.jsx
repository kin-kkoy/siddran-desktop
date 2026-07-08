import { useEffect, useRef, useState } from 'react';
import { FiXCircle, FiExternalLink } from 'react-icons/fi'
import styles from './TaskDetailsModal.module.css'
import { useModalPresence } from '../../utils/modalPresence'

function TaskDetailsModal({onClose, task, updateTask, isDailyTask, onOpenInHub}) {
    useModalPresence()

    const [titleData, setTitleData] = useState(task.title)
    const [descriptionData, setDescriptionData] = useState(task.description)
    const [prioritySelected, setPrioritySelected] = useState(task.priority)
    const [dueDate, setDueDate] = useState(task.due_date)
    const [completion, setCompletion] = useState(task.is_completed)
    const isDirtyRef = useRef(false)

    // Warn user before closing tab with unsaved changes
    useEffect(() => {
        const handler = (e) => {
            if (isDirtyRef.current) {
                e.preventDefault()
            }
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [])

    // save the details with the newly updated fields
    const saveDetails = () => {
        if (!isDirtyRef.current) return

        const changes = {}
        if (titleData !== task.title) changes.title = titleData
        if (!isDailyTask && descriptionData !== task.description) changes.description = descriptionData
        if (prioritySelected !== task.priority) changes.priority = prioritySelected
        if (!isDailyTask && dueDate !== task.due_date) changes.due_date = dueDate
        if (completion !== task.is_completed) changes.is_completed = completion

        updateTask(task.id, changes)
    }

    const handleClose = () => {
        saveDetails()
        onClose()
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) handleClose()
    }

    // ISO timestamp → value for a <input type="datetime-local"> (local time, no seconds).
    const toLocalInput = (iso) => {
        if (!iso) return ''
        const d = new Date(iso)
        const pad = n => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    return (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <div className={styles.modal}>

                {/* Header — title + close */}
                <div className={styles.header}>
                    <input
                        type="text"
                        className={styles.titleInput}
                        value={titleData}
                        onChange={e => { setTitleData(e.target.value); isDirtyRef.current = true; }}
                        placeholder="Task title..."
                    />
                    <div className={styles.headerActions}>
                        {onOpenInHub && (
                            <button
                                type="button"
                                className={styles.hubBtn}
                                onClick={onOpenInHub}
                                title="Open in Tasks Hub"
                                aria-label="Open in Tasks Hub"
                            >
                                <FiExternalLink />
                            </button>
                        )}
                        <button type="button" className={styles.closeBtn} onClick={handleClose}>✕</button>
                    </div>
                </div>

                {/* Body */}
                <div className={styles.body}>

                    {/* Status */}
                    <div className={styles.fieldGroup}>
                        <span className={styles.fieldLabel}>Status</span>
                        <button
                            className={`${styles.statusBtn} ${completion ? styles.completed : ''}`}
                            onClick={() => { setCompletion(!completion); isDirtyRef.current = true; }}
                        >
                            <span className={styles.statusDot} />
                            {completion ? "Completed" : "In Progress"}
                        </button>
                    </div>

                    {/* Description */}
                    {!isDailyTask && (
                        <div className={styles.fieldGroup}>
                            <span className={styles.fieldLabel}>Description</span>
                            <textarea
                                className={styles.descriptionInput}
                                value={descriptionData || ''}
                                onChange={e => { setDescriptionData(e.target.value); isDirtyRef.current = true; }}
                                placeholder="Add a description..."
                            />
                        </div>
                    )}
                    

                    <div className={styles.divider} />

                    {/* Priority & Deadline */}
                    <div className={styles.metaRow}>
                        <div className={`${styles.metaItem} ${styles.priorityItem}`}>
                            <span className={styles.fieldLabel}>Priority</span>
                            <select
                                className={styles.prioritySelect}
                                value={prioritySelected}
                                onChange={e => { setPrioritySelected(e.target.value); isDirtyRef.current = true; }}
                            >
                                <option value="high">High</option>
                                <option value="normal">Normal</option>
                                <option value="low">Low</option>
                            </select>
                        </div>

                        {!isDailyTask && (
                            <div className={`${styles.metaItem} ${styles.deadlineItem}`}>
                                <span className={styles.fieldLabel}>Deadline</span>
                                <div className={styles.deadlineRow}>
                                    <input
                                        type="datetime-local"
                                        className={styles.dateInput}
                                        style={{ colorScheme: 'dark' }}
                                        value={toLocalInput(dueDate)}
                                        onChange={e => {
                                            setDueDate(e.target.value ? new Date(e.target.value).toISOString() : null)
                                            isDirtyRef.current = true
                                        }}
                                    />
                                    {dueDate && (
                                        <button
                                            type="button"
                                            className={styles.clearDeadlineBtn}
                                            onClick={() => { setDueDate(null); isDirtyRef.current = true }}
                                            title="Clear deadline"
                                            aria-label="Clear deadline"
                                        ><FiXCircle size={16} /></button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    )
}

export default TaskDetailsModal