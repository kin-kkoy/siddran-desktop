import { useEffect, useRef, useState } from 'react';
import { FiExternalLink } from 'react-icons/fi'
import styles from './TaskDetailsModal.module.css'
import DateTimePicker from './DateTimePicker.jsx'
import { fromPickerValue, toPickerValue } from '../../utils/deadline'
import { useModalPresence } from '../../utils/modalPresence'

function TaskDetailsModal({onClose, task, updateTask, isDailyTask, onOpenInHub}) {
    useModalPresence()

    const [titleData, setTitleData] = useState(task.title)
    const [descriptionData, setDescriptionData] = useState(task.description)
    const [prioritySelected, setPrioritySelected] = useState(task.priority)
    const [deadline, setDeadline] = useState(() => toPickerValue(task.due_date, task.due_all_day))
    const [remindAt, setRemindAt] = useState(task.remind_at ?? null)
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
        if (!isDailyTask && deadline !== toPickerValue(task.due_date, task.due_all_day)) {
            Object.assign(changes, fromPickerValue(deadline))
        }
        if (!isDailyTask && remindAt !== (task.remind_at ?? null)) changes.remind_at = remindAt
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

    // "1 hour before" is a way of PICKING a moment, not a rule that follows the
    // deadline around: it writes an absolute timestamp, so moving the deadline
    // later doesn't silently drag the reminder with it.
    const remindBefore = (minutes) => {
        const { due_date } = fromPickerValue(deadline)
        if (!due_date) return
        setRemindAt(new Date(new Date(due_date).getTime() - minutes * 60000).toISOString())
        isDirtyRef.current = true
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
                                <DateTimePicker
                                    value={deadline}
                                    onChange={(v) => { setDeadline(v); isDirtyRef.current = true }}
                                    placeholder="No deadline"
                                />
                            </div>
                        )}
                    </div>

                    {/* A reminder is a second thought about a deadline, so it sits
                        under one. Dailies don't have one — they ring at their own
                        time of day. */}
                    {!isDailyTask && (
                        <div className={styles.fieldGroup}>
                            <span className={styles.fieldLabel}>Remind Me At</span>
                            <div className={styles.remindRow}>
                                <DateTimePicker
                                    value={toLocalInput(remindAt)}
                                    onChange={(v) => {
                                        setRemindAt(v ? new Date(v).toISOString() : null)
                                        isDirtyRef.current = true
                                    }}
                                    placeholder="No reminder"
                                />
                                {deadline && (
                                    <div className={styles.remindShortcuts}>
                                        <button type="button" className={styles.remindChip} onClick={() => remindBefore(60)}>1 hour before</button>
                                        <button type="button" className={styles.remindChip} onClick={() => remindBefore(1440)}>1 day before</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}

export default TaskDetailsModal