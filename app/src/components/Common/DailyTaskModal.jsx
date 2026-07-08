import { useState, useMemo } from 'react'
import { FaCheck } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './DailyTaskModal.module.css'
import ConfirmModal from './ConfirmModal'
import RecurrencePicker from '../Calendar/Peek/RecurrencePicker.jsx'
import { useModalPresence } from '../../utils/modalPresence'
import { toast } from '../../utils/toast'
import logger from '../../utils/logger'

// recurrence stored value → RecurrencePicker shape (preset string | { mask }).
const toPickerValue = (rec) => {
    if (!rec) return 'every-day'
    if (typeof rec === 'object') return rec
    const s = String(rec)
    if (s.startsWith('{')) {
        try { const p = JSON.parse(s); if (Array.isArray(p?.mask)) return { mask: p.mask } } catch { /* fall through */ }
    }
    return s
}

function DailyTaskModal({ tasks, toggleCompletion, addDailyTask, updateDailyTask, deleteTask, batchToggleDailyTasks, batchDeleteDailyTasks, onOpenDetail, onClose }) {
    useModalPresence()
    const [taskTitle, setTaskTitle] = useState("")
    const [selectedPriority, setSelectedPriority] = useState('normal')
    // Optional recurrence: off → an ephemeral (24h) daily (existing behaviour); on → a recurring,
    // non-expiring daily that also shows on the calendar.
    const [repeats, setRepeats] = useState(false)
    const [recurrence, setRecurrence] = useState('every-day')
    // Which existing task's per-row recurrence picker is expanded (null = none).
    const [recurOpenId, setRecurOpenId] = useState(null)
    // Batch recurrence: select multiple tasks, then apply/clear a recurrence to all at once.
    const [batchMode, setBatchMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState(new Set())
    const [batchRecurrence, setBatchRecurrence] = useState('every-day')
    const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    // Batch state: pending changes tracked locally
    const [pendingCompletions, setPendingCompletions] = useState(new Map()) // Map<id, boolean>
    const [pendingDeletions, setPendingDeletions] = useState(new Set())     // Set<id>

    const hasPendingChanges = pendingCompletions.size > 0 || pendingDeletions.size > 0

    // Compute effective tasks with pending changes merged in
    const effectiveTasks = useMemo(() => {
        return tasks.map(t => {
            const isPendingDelete = pendingDeletions.has(t.id)
            const isPendingToggle = pendingCompletions.has(t.id)
            const effectiveCompleted = isPendingToggle ? pendingCompletions.get(t.id) : t.is_completed
            return {
                ...t,
                is_completed: effectiveCompleted,
                _pendingDelete: isPendingDelete,
                _pendingToggle: isPendingToggle
            }
        })
    }, [tasks, pendingCompletions, pendingDeletions])

    // Progress bar uses effective state, excluding pending-deleted tasks
    const visibleTasks = effectiveTasks.filter(t => !t._pendingDelete)
    const completedCount = visibleTasks.filter(t => t.is_completed).length
    const totalCount = visibleTasks.length

    // Priority columns
    const sortByCompletion = (a, b) => a.is_completed === b.is_completed ? 0 : a.is_completed ? 1 : -1
    const lowTasks    = effectiveTasks.filter(t => t.priority === 'low').sort(sortByCompletion)
    const normalTasks = effectiveTasks.filter(t => t.priority === 'normal').sort(sortByCompletion)
    const highTasks   = effectiveTasks.filter(t => t.priority === 'high').sort(sortByCompletion)
    const columns = [
        { key: 'high',   label: 'High',   tasks: highTasks   },
        { key: 'normal', label: 'Normal', tasks: normalTasks },
        { key: 'low',    label: 'Low',    tasks: lowTasks    },
    ].filter(col => col.tasks.length > 0)

    // --- Handlers ---

    const handleToggle = (taskId) => {
        setPendingCompletions(prev => {
            const next = new Map(prev)
            const original = tasks.find(t => t.id === taskId)?.is_completed
            const currentEffective = next.has(taskId) ? next.get(taskId) : original
            const newValue = !currentEffective

            // Net-zero: if toggling back to original, remove from pending
            if (newValue === original) {
                next.delete(taskId)
            } else {
                next.set(taskId, newValue)
            }
            return next
        })
    }

    const handleDelete = (taskId) => {
        setPendingDeletions(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) {
                next.delete(taskId) // undo
            } else {
                next.add(taskId)
            }
            return next
        })
    }

    const handleAdd = () => {
        if (!taskTitle.trim()) return
        addDailyTask(taskTitle, selectedPriority, repeats ? { recurrence } : {})
        setTaskTitle("")
    }

    // Make an existing daily recurring (or change its pattern). Immediate (not part of the staged
    // completion/deletion batch) since recurrence is a structural change.
    const handleSetRecurrence = async (taskId, value) => {
        const updated = await updateDailyTask?.(taskId, { recurrence: value })
        if (updated) toast.success('Now recurring')
    }
    // Turn a recurring daily back into a one-off.
    const handleStopRecurring = async (taskId) => {
        const updated = await updateDailyTask?.(taskId, { recurrence: null })
        if (updated) toast.success('Back to a one-off')
        setRecurOpenId(null)
    }

    const toggleBatchMode = () => {
        setBatchMode(m => !m)
        setSelectedIds(new Set())
        setRecurOpenId(null)
    }
    const toggleSelect = (id) => setSelectedIds(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })
    // Apply (or clear, when value === null) a recurrence to every selected task at once.
    const applyBatchRecurrence = async (value) => {
        const ids = [...selectedIds]
        if (!ids.length) return
        await Promise.all(ids.map(id => updateDailyTask?.(id, { recurrence: value })))
        toast.success(value == null ? `${ids.length} set to one-off` : `${ids.length} now recurring`)
        setSelectedIds(new Set())
        setBatchMode(false)
    }

    const handleSave = async () => {
        if (!hasPendingChanges) {
            onClose()
            return
        }

        setIsSaving(true)

        try {
            const promises = []

            // Batch toggle
            const toggleUpdates = Array.from(pendingCompletions.entries()).map(
                ([id, is_completed]) => ({ id, is_completed })
            )
            if (toggleUpdates.length > 0) {
                promises.push(batchToggleDailyTasks(toggleUpdates))
            }

            // Batch delete
            const deleteIds = Array.from(pendingDeletions)
            if (deleteIds.length > 0) {
                promises.push(batchDeleteDailyTasks(deleteIds))
            }

            await Promise.all(promises)

            toast.success('Changes saved')
            onClose()
        } catch (error) {
            logger.error('Batch save error:', error)
            toast.error('Some changes failed to save. Please try again.')
        } finally {
            setIsSaving(false)
        }
    }

    const handleCloseAttempt = () => {
        if (hasPendingChanges) {
            setShowUnsavedWarning(true)
        } else {
            onClose()
        }
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) handleCloseAttempt()
    }

    return (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <div className={styles.modal}>

                {/* Header */}
                <div className={styles.header}>
                    <h3 className={styles.title}>Today's Tasks</h3>
                    <div className={styles.headerActions}>
                        <button
                            className={`${styles.batchToggle} ${batchMode ? styles.batchToggleOn : ''}`}
                            onClick={toggleBatchMode}
                            title="Select multiple tasks to make recurring"
                        >
                            {batchMode ? 'Done' : '↻ Select'}
                        </button>
                        {hasPendingChanges && (
                            <button
                                className={styles.saveBtn}
                                onClick={handleSave}
                                disabled={isSaving}
                            >
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                        )}
                        <button className={styles.closeBtn} onClick={handleCloseAttempt}>✕</button>
                    </div>
                </div>

                {/* Progress */}
                <div className={styles.progress}>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{ width: totalCount ? `${(completedCount / totalCount) * 100}%` : '0%' }}
                        />
                    </div>
                    <span className={styles.progressText}>
                        {completedCount} / {totalCount} completed
                    </span>
                </div>

                {/* Add-task row */}
                <div className={styles.addRow}>
                    <input
                        type="text"
                        value={taskTitle}
                        onChange={e => setTaskTitle(e.target.value)}
                        placeholder="New task..."
                        className={styles.addInput}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                    />
                    <select
                        value={selectedPriority}
                        onChange={e => setSelectedPriority(e.target.value)}
                        className={styles.addSelect}
                    >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                    </select>
                    <button
                        type="button"
                        className={`${styles.repeatToggle} ${repeats ? styles.repeatToggleOn : ''}`}
                        onClick={() => setRepeats(r => !r)}
                        title={repeats ? 'Recurring — click for a one-off' : 'Make this a recurring daily'}
                        aria-pressed={repeats}
                    >↻</button>
                    <button className={styles.addBtn} onClick={handleAdd}>+</button>
                </div>

                {repeats && (
                    <div className={styles.recurrenceRow}>
                        <RecurrencePicker value={recurrence} onChange={setRecurrence} />
                    </div>
                )}

                {batchMode && (
                    <div className={styles.batchBar}>
                        <div className={styles.batchHint}>
                            Select tasks below, then apply: <strong>{selectedIds.size}</strong> selected
                        </div>
                        <RecurrencePicker value={batchRecurrence} onChange={setBatchRecurrence} />
                        <div className={styles.batchActions}>
                            <button
                                type="button"
                                className={styles.batchApply}
                                disabled={selectedIds.size === 0}
                                onClick={() => applyBatchRecurrence(batchRecurrence)}
                            >Make recurring ({selectedIds.size})</button>
                            <button
                                type="button"
                                className={styles.batchStop}
                                disabled={selectedIds.size === 0}
                                onClick={() => applyBatchRecurrence(null)}
                            >Stop repeating ({selectedIds.size})</button>
                        </div>
                    </div>
                )}

                {/* Columns */}
                {columns.length > 0 ? (
                    <div className={styles.columnsContainer}>
                        {columns.map(col => (
                            <div key={col.key} className={styles.column}>
                                <div className={`${styles.columnHeader} ${styles[col.key]}`}>
                                    {col.label}
                                </div>
                                <ul className={styles.taskList}>
                                    {col.tasks.map(task => (
                                        <li
                                            key={task.id}
                                            className={[
                                                styles.taskItem,
                                                styles.taskItemCol,
                                                task.is_completed ? styles.completed : '',
                                                task._pendingDelete ? styles.pendingDelete : '',
                                                task._pendingToggle ? styles.pendingToggle : '',
                                                batchMode && selectedIds.has(task.id) ? styles.taskItemSelected : '',
                                            ].filter(Boolean).join(' ')}
                                        >
                                            <div
                                                className={styles.taskRow}
                                                onClick={() => batchMode ? toggleSelect(task.id) : (!task._pendingDelete && onOpenDetail(task))}
                                            >
                                                {batchMode ? (
                                                    /* Selection checkbox (batch recurrence) */
                                                    <button
                                                        className={`${styles.checkbox} ${selectedIds.has(task.id) ? styles.checked : ''}`}
                                                        onClick={(e) => { e.stopPropagation(); toggleSelect(task.id) }}
                                                        aria-pressed={selectedIds.has(task.id)}
                                                    >
                                                        {selectedIds.has(task.id) && <FaCheck size={12} />}
                                                    </button>
                                                ) : (
                                                    /* Completion checkbox */
                                                    <button
                                                        className={`${styles.checkbox} ${task.is_completed ? styles.checked : ''}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            if (!task._pendingDelete) handleToggle(task.id)
                                                        }}
                                                    >
                                                        {task.is_completed && <FaCheck size={12} />}
                                                    </button>
                                                )}

                                                {/* Task Content */}
                                                <div className={styles.taskContent}>
                                                    <span className={styles.taskTitle}>{task.title}</span>
                                                    {task.recurrence != null && (
                                                        <span className={styles.recurTag} title="Recurring">↻</span>
                                                    )}
                                                    {task._pendingDelete && (
                                                        <span className={styles.pendingHint}>Will be deleted</span>
                                                    )}
                                                </div>

                                                {!batchMode && (
                                                    <>
                                                        {/* Recurrence toggle (opens this task's own picker) */}
                                                        <button
                                                            type="button"
                                                            className={`${styles.recurBtn} ${task.recurrence != null ? styles.recurBtnOn : ''} ${recurOpenId === task.id ? styles.recurBtnOpen : ''}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                if (!task._pendingDelete) setRecurOpenId(prev => prev === task.id ? null : task.id)
                                                            }}
                                                            title={task.recurrence != null ? 'Recurring — edit or stop' : 'Make recurring'}
                                                            aria-pressed={task.recurrence != null}
                                                        >↻</button>

                                                        {/* Delete / Undo Button */}
                                                        <button
                                                            className={`${styles.deleteBtn} ${task._pendingDelete ? styles.undoBtn : ''}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleDelete(task.id)
                                                            }}
                                                            title={task._pendingDelete ? 'Undo delete' : 'Mark for deletion'}
                                                        >
                                                            <HiOutlineTrash size={14} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>

                                            {!batchMode && recurOpenId === task.id && !task._pendingDelete && (
                                                <div className={styles.recurPanel} onClick={(e) => e.stopPropagation()}>
                                                    <RecurrencePicker
                                                        value={toPickerValue(task.recurrence)}
                                                        onChange={(v) => handleSetRecurrence(task.id, v)}
                                                    />
                                                    {task.recurrence != null && (
                                                        <button
                                                            type="button"
                                                            className={styles.recurStop}
                                                            onClick={() => handleStopRecurring(task.id)}
                                                        >Stop repeating</button>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.emptyState}>No tasks yet — add one above.</div>
                )}

            </div>

            {/* Unsaved Changes Warning */}
            <ConfirmModal
                isOpen={showUnsavedWarning}
                onClose={() => {
                    setShowUnsavedWarning(false)
                    onClose()
                }}
                onConfirm={() => {
                    setShowUnsavedWarning(false)
                    handleSave()
                }}
                title="Unsaved Changes"
                message="You have unsaved changes. Would you like to apply them before closing?"
                confirmText="Apply & Close"
                cancelText="Discard"
            />
        </div>
    )
}

export default DailyTaskModal
