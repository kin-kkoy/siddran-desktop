import { useState, useMemo } from 'react'
import styles from './DailyTaskModal.module.css'
import ConfirmModal from './ConfirmModal'
import { toast } from '../../utils/toast'
import logger from '../../utils/logger'
import { FaCheck } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import { useModalPresence } from '../../utils/modalPresence'


function BundleDetailModal({
    bundle, onClose, updateBundle, deleteBundle, addBundleTasks, batchUpdateBundleTasks, batchDeleteBundleTasks, toggleBundleTaskCompletion
}) {
    useModalPresence()
    const [bundleTitle, setBundleTitle] = useState(bundle.title)
    const [bundleTasks, setBundleTasks] = useState(bundle.tasks || [])

    const [pendingDeletes, setPendingDeletes] = useState(new Set())
    const [pendingAdds, setPendingAdds] = useState([])
    const [pendingToggles, setPendingToggles] = useState(new Map())
    const [isSaving, setIsSaving] = useState(false)

    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
    const [hue, setHue] = useState(() => {
        if (!bundle.color) return 120
        const match = bundle.color.match(/hsl\((\d+)/)
        return match ? Number(match[1]) : 120
    })
    const bundleColor = `hsl(${hue}, 70%, 50%)`
    const [taskTitle, setTaskTitle] = useState("")
    const [selectedPriority, setSelectedPriority] = useState("normal")

    const hasPendingChanges =
        pendingAdds.length > 0 ||
        pendingDeletes.size > 0 ||
        pendingToggles.size > 0 ||
        bundleTitle !== bundle.title ||
        bundleColor !== bundle.color

    const effectiveTasks = useMemo(() => {
        return bundleTasks.map(t => {
            const isPendingDelete = pendingDeletes.has(t.id)
            const isPendingToggle = pendingToggles.has(t.id)
            const isPendingAdd = pendingAdds.some(a => a.id === t.id)
            const effectiveCompleted = isPendingToggle ? pendingToggles.get(t.id) : t.is_completed
            return {
                ...t,
                is_completed: effectiveCompleted,
                _pendingDelete: isPendingDelete,
                _pendingToggle: isPendingToggle,
                _pendingAdd: isPendingAdd,
            }
        })
    }, [bundleTasks, pendingDeletes, pendingToggles, pendingAdds])

    const visibleTasks = effectiveTasks.filter(t => !t._pendingDelete)
    const completedCount = visibleTasks.filter(t => t.is_completed).length
    const totalCount = visibleTasks.length

    const addTaskHandler = () => {
        if (!taskTitle.trim()) return
        const taskToAdd = { id: Date.now(), title: taskTitle.trim(), priority: selectedPriority, is_completed: false }
        setBundleTasks(prev => [...prev, taskToAdd])
        setPendingAdds(prev => [...prev, taskToAdd])
        setTaskTitle("")
    }

    const deleteTaskHandler = (taskId) => {
        const isPendingAdd = pendingAdds.some(a => a.id === taskId)
        if (isPendingAdd) {
            setPendingAdds(prev => prev.filter(a => a.id !== taskId))
            setBundleTasks(prev => prev.filter(t => t.id !== taskId))
            return
        }

        setPendingDeletes(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) {
                next.delete(taskId)
            } else {
                next.add(taskId)
            }
            return next
        })
    }

    const completionToggleHandler = (taskId) => {
        setPendingToggles(prev => {
            const next = new Map(prev)
            const original = bundleTasks.find(t => t.id === taskId)?.is_completed
            const currentEffective = next.has(taskId) ? next.get(taskId) : original
            const newValue = !currentEffective
            if (newValue === original) {
                next.delete(taskId)
            } else {
                next.set(taskId, newValue)
            }
            return next
        })
    }

    const saveChangesHandler = async () => {
        if (!hasPendingChanges) {
            onClose()
            return
        }

        setIsSaving(true)

        const addsSnapshot = pendingAdds
        const deletesSnapshot = Array.from(pendingDeletes)
        const togglesSnapshot = Array.from(pendingToggles.entries())
            .filter(([id]) => !pendingDeletes.has(id))
            .map(([id, is_completed]) => ({ id, is_completed }))

        const promises = []

        if (addsSnapshot.length > 0) {
            const addedIds = new Set(addsSnapshot.map(a => a.id))
            const addsForApi = addsSnapshot.map(({ id, ...rest }) => rest)
            promises.push(
                addBundleTasks(bundle.id, addsForApi).then(() => {
                    setPendingAdds(prev => prev.filter(a => !addedIds.has(a.id)))
                    setBundleTasks(prev => prev.filter(t => !addedIds.has(t.id)))
                })
            )
        }

        if (deletesSnapshot.length > 0) {
            promises.push(
                batchDeleteBundleTasks(bundle.id, deletesSnapshot).then(() => {
                    setPendingDeletes(prev => {
                        const next = new Set(prev)
                        deletesSnapshot.forEach(id => next.delete(id))
                        return next
                    })
                })
            )
        }

        if (togglesSnapshot.length > 0) {
            promises.push(
                batchUpdateBundleTasks(bundle.id, togglesSnapshot).then(() => {
                    setPendingToggles(prev => {
                        const next = new Map(prev)
                        togglesSnapshot.forEach(({ id }) => next.delete(id))
                        return next
                    })
                })
            )
        }

        if (bundleTitle !== bundle.title || bundleColor !== bundle.color) {
            promises.push(updateBundle(bundle.id, { title: bundleTitle, color: bundleColor }))
        }

        try {
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

    const closeAttemptHandler = () => {
        if (hasPendingChanges) {
            setShowUnsavedWarning(true)
        } else {
            onClose()
        }
    }

    const backdropClickHandler = (e) => {
        if (e.target === e.currentTarget) closeAttemptHandler()
    }

    const deleteBundleHandler = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setShowDeleteModal(true)
    }
    const confirmDelete = () => {
        deleteBundle(bundle.id)
        setShowDeleteModal(false)
        onClose()
    }

    const modalBg = `color-mix(in srgb, ${bundleColor} 8%, var(--bg-elevated))`
    const headerBg = `color-mix(in srgb, ${bundleColor} 18%, var(--bg-elevated))`

    return (
        <div className={styles.backdrop} onClick={backdropClickHandler}>
            <div className={styles.modal} style={{ backgroundColor: modalBg }}>

                {/* Header */}
                <div className={`${styles.header} ${styles.bundleHeader}`} style={{ backgroundColor: headerBg }}>
                    <input
                        type="text"
                        className={styles.titleInput}
                        value={bundleTitle}
                        onChange={e => setBundleTitle(e.target.value)}
                        placeholder="Bundle title..."
                    />
                    <div className={styles.headerActions}>
                        {hasPendingChanges && (
                            <button
                                className={styles.saveBtn}
                                onClick={saveChangesHandler}
                                disabled={isSaving}
                            >
                                {isSaving ? 'Saving...' : 'Save'}
                            </button>
                        )}
                        <button
                            className={styles.deleteBundleBtn}
                            onClick={deleteBundleHandler}
                            title="Delete bundle"
                        >
                            <HiOutlineTrash size={16} />
                        </button>
                        <button className={styles.closeBtn} onClick={closeAttemptHandler}>✕</button>
                    </div>
                </div>

                {/* Progress + hue slider */}
                <div className={styles.progress}>
                    <div className={styles.progressWithSlider}>
                        <div style={{ flex: 1 }}>
                            <div className={styles.progressBar}>
                                <div
                                    className={styles.progressFill}
                                    style={{
                                        width: totalCount ? `${(completedCount / totalCount) * 100}%` : '0%',
                                        backgroundColor: bundleColor,
                                    }}
                                />
                            </div>
                            <span className={styles.progressText}>
                                {completedCount} / {totalCount} completed
                            </span>
                        </div>
                        <div className={styles.sliderGroup}>
                            <input
                                type="range"
                                min="0"
                                max="360"
                                value={hue}
                                onChange={e => setHue(Number(e.target.value))}
                                className={styles.hueSlider}
                            />
                            <span className={styles.colorSwatch} style={{ backgroundColor: bundleColor }} />
                        </div>
                    </div>
                </div>

                {/* Add-task row */}
                <div className={styles.addRow}>
                    <input
                        type="text"
                        value={taskTitle}
                        onChange={e => setTaskTitle(e.target.value)}
                        placeholder="New task..."
                        className={styles.addInput}
                        onKeyDown={e => { if (e.key === 'Enter') addTaskHandler() }}
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
                        className={styles.addBtn}
                        onClick={addTaskHandler}
                        style={{ backgroundColor: bundleColor }}
                    >
                        +
                    </button>
                </div>

                {/* Body */}
                {effectiveTasks.length > 0 ? (
                    <ul className={styles.taskList}>
                        {effectiveTasks.map(task => (
                            <li
                                key={task.id}
                                className={[
                                    styles.taskItem,
                                    task.is_completed ? styles.completed : '',
                                    task._pendingDelete ? styles.pendingDelete : '',
                                    task._pendingToggle ? styles.pendingToggle : '',
                                ].filter(Boolean).join(' ')}
                                style={task._pendingToggle ? { borderLeftColor: bundleColor } : undefined}
                            >
                                <button
                                    className={`${styles.checkbox} ${task.is_completed ? styles.checked : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        if (!task._pendingDelete) completionToggleHandler(task.id)
                                    }}
                                    style={task.is_completed ? { backgroundColor: bundleColor, borderColor: bundleColor } : undefined}
                                >
                                    {task.is_completed && <FaCheck size={12} />}
                                </button>

                                <div className={styles.taskContent}>
                                    <span className={styles.taskTitle}>{task.title}</span>
                                    {task._pendingDelete && (
                                        <span className={styles.pendingHint}>Will be deleted</span>
                                    )}
                                </div>

                                <span className={`${styles.priority} ${styles[task.priority]}`}>
                                    {task.priority}
                                </span>

                                <button
                                    className={`${styles.deleteBtn} ${task._pendingDelete ? styles.undoBtn : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        deleteTaskHandler(task.id)
                                    }}
                                    title={task._pendingDelete ? 'Undo delete' : 'Mark for deletion'}
                                >
                                    <HiOutlineTrash size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className={styles.emptyState}>No tasks yet — add one above.</div>
                )}
            </div>

            <ConfirmModal
                isOpen={showUnsavedWarning}
                onClose={() => {
                    setShowUnsavedWarning(false)
                    onClose()
                }}
                onConfirm={() => {
                    setShowUnsavedWarning(false)
                    saveChangesHandler()
                }}
                title="Unsaved Changes"
                message="You have unsaved changes. Would you like to apply them before closing?"
                confirmText="Apply & Close"
                cancelText="Discard"
            />

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
    )
}

export default BundleDetailModal
