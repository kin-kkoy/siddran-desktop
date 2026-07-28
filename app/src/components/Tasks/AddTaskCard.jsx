import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './TaskCard.module.css'
import RecurrencePicker from '../Calendar/Peek/RecurrencePicker.jsx'
import DateTimePicker from '../Common/DateTimePicker.jsx'
import { toast } from '../../utils/toast'
import { modalPresence } from '../../utils/modalPresence'

// Short label for a draft's recurrence value (preset string or { mask } → "Custom").
function recurLabel(rec) {
    if (!rec) return null
    if (typeof rec === 'object') return 'Custom'
    if (rec === 'every-day') return 'Every day'
    if (rec === 'weekdays') return 'Weekdays'
    if (rec === 'weekends') return 'Weekends'
    if (String(rec).startsWith('{')) return 'Custom'
    return String(rec)
}

function AddTaskCard({ addTask, addBundle, viewMode }) {
    const [taskType, setTaskType] = useState("normal") // normal: normal add task || daily: add daily tasks || bundle: add a bundle card similar to daily tasks
    const [showForm, setShowForm] = useState(false)
    const [title, setTitle] = useState("")
    const [bundleTitle, setBundleTitle] = useState("")
    const [description, setDescription] = useState("")
    const [priority, setPriority] = useState("normal")
    const [dueDate, setDueDate] = useState("")
    const [hue, setHue] = useState(120) // For Bundle color (hue 0-360)
    const color = `hsl(${hue}, 70%, 50%)` // derived from hue for the API

    // For daily tasks to be created/submitted to API in a batch (or all at once) (array/list of tasks)
    const [dailyTasksDraft, setDailyTasksDraft] = useState([])
    // Same thing as above but for bundle tasks this time
    const [bundleTasksDraft, setBundleTasksDraft] = useState([])
    const [submitting, setSubmitting] = useState(false)

    // Optional recurrence for daily-tab drafts (off → ephemeral; on → recurring, per task).
    const [dailyRepeats, setDailyRepeats] = useState(false)
    const [dailyRecurrence, setDailyRecurrence] = useState('every-day')

    // Count this as an open modal (pauses the StarCanvas) only while the form is showing.
    useEffect(() => {
        if (!showForm) return
        modalPresence.push()
        return () => modalPresence.pop()
    }, [showForm])

    // The command palette's "New task" navigates here and fires this event, so the
    // create form opens without the user having to find the card.
    useEffect(() => {
        const open = () => setShowForm(true)
        window.addEventListener('siddran:new-task', open)
        return () => window.removeEventListener('siddran:new-task', open)
    }, [])

    // ---------- for normal tasks ----------
    const handleSubmit = async (e) => {
        e.preventDefault()
        if (submitting) return

        if(taskType === 'normal'){
            setSubmitting(true)
            try {
                await addTask(title, description, priority, dueDate, taskType)
                setTitle("")
                setDescription("")
                setPriority("normal")
                setDueDate("")
                setShowForm(false)
            } finally {
                setSubmitting(false)
            }
        }
    }

    // ---------- For daily tasks (draft style) ----------
    const addToDailyDraft = e => {
        e.preventDefault()

        if(!title.trim()){
            toast.warning("Task title cannot be empty")
            return
        }

        setDailyTasksDraft([...dailyTasksDraft, {
            id: Date.now(),
            title: title.trim(),
            priority,
            recurrence: dailyRepeats ? dailyRecurrence : null,
        }])

        // Clear inputs (keep the recurrence setting so several recurring dailies add quickly)
        setTitle("")
        setPriority("normal")
    }

    // ---------- For bundle tasks (draft style) ----------
    const addToBundleDraft = e => {
        e.preventDefault()

        if(!title.trim()){
            toast.warning("Task title cannot be empty")
            return
        }

        setBundleTasksDraft([...bundleTasksDraft, {
            id: Date.now(),
            title: title.trim(),
            priority
        }])

        // Clear inputs
        setTitle("")
        setPriority("normal")
    }

    const removeFromDailyTaskDraft = id => {
        setDailyTasksDraft(dailyTasksDraft.filter( task => task.id !== id ))
    }
    const removeFromBundleDraft = id => {
        setBundleTasksDraft(bundleTasksDraft.filter( task => task.id !== id ))
    }

    const submitDailyTaskDraft = async () => {
        if (submitting) return
        if(dailyTasksDraft.length === 0){
            toast.warning("Add at least one task to the list")
            return
        }

        setSubmitting(true)
        try {
            // title will be an array/list of the tasks instead of a usual string, this happens for daily tasks only
            await addTask(dailyTasksDraft, null, null, null, "daily")
            setDailyTasksDraft([])
            setTitle("")
            setShowForm(false)
        } finally {
            setSubmitting(false)
        }
    }
    const submitBundleDraft = async () => {
        if (submitting) return
        if(bundleTasksDraft.length === 0) {
            toast.warning("Add at least one task to the list")
            return
        }

        setSubmitting(true)
        try {
            // title will be an array/list of the tasks instead of a usual string, this also happens to bundle tasks
            await addBundle(bundleTitle, bundleTasksDraft, color)
            setBundleTasksDraft([])
            setBundleTitle("")
            setShowForm(false)
        } finally {
            setSubmitting(false)
        }
    }

    const handleTitleKeyDown = (e) => {
        if (taskType !== 'daily' && taskType !== 'bundle') return
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            if(taskType === 'daily'){
                submitDailyTaskDraft()
            }else{
                submitBundleDraft()
            }
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if(taskType === 'daily'){
                addToDailyDraft(e)
            }else{
                addToBundleDraft(e)
            }
        }
    }

    // clicking outside the popup
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            setShowForm(false)
        }
    }

    // ========== Shared form (used by both card and list view) ==========
    const formModal = (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <form className={styles.modalForm} onSubmit={handleSubmit}>
                <h2 style={{ marginTop: 0, marginBottom: 20, color: '#fff' }}>Create Task</h2>

                {/* Task type toggle */}
                <div className={styles.toggleContainer}>
                    {/* Normal */}
                    <button type="button"
                        className={`${styles.toggleBtn} ${taskType === 'normal' ? styles.active : ''}`}
                        onClick={() => setTaskType("normal")}
                    >Normal Task</button>

                    {/* Daily */}
                    <button type='button'
                        className={`${styles.toggleBtn} ${taskType === 'daily' ? styles.active : ''}`}
                        onClick={() => setTaskType("daily")}
                    >Daily Tasks</button>

                    {/* Bundle */}
                    <button type='button'
                        className={`${styles.toggleBtn} ${taskType === 'bundle' ? styles.active : ''}`}
                        onClick={() => setTaskType("bundle")}
                    >Bundle</button>
                </div>

                {/* Bundle title + color swatches */}
                {taskType === 'bundle' && (
                    <div className={styles.formContent}>
                        <input
                            type="text"
                            value={bundleTitle}
                            onChange={e => setBundleTitle(e.target.value)}
                            placeholder='Bundle title...'
                            className={styles.input}
                            autoFocus
                            required
                            onKeyDown={handleTitleKeyDown}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <input
                                type="range"
                                min="0"
                                max="360"
                                value={hue}
                                onChange={e => setHue(Number(e.target.value))}
                                className={styles.hueSlider}
                            />
                            <span
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: '50%',
                                    backgroundColor: color,
                                    flexShrink: 0,
                                    border: '2px solid var(--border-strong)',
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Task title input */}
                {taskType === 'normal' ? (
                    <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Task title..."
                        className={styles.input}
                        autoFocus
                        required
                        onKeyDown={handleTitleKeyDown}
                    />
                ) : (
                    <div className={styles.inputWithBtn}>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Task title..."
                            className={styles.input}
                            autoFocus
                            onKeyDown={handleTitleKeyDown}
                        />
                        <button
                            type="button"
                            className={styles.inlineAddBtn}
                            onClick={taskType === 'daily' ? addToDailyDraft : addToBundleDraft}
                        >
                            +
                        </button>
                    </div>
                )}

                {/* Normal task fields */}
                {taskType === 'normal' && (
                    <div className={styles.formContent}>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Description (optional)"
                            className={styles.textarea}
                        />

                        <div className={styles.row}>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className={styles.select}
                            >
                                <option value="low">Low Priority</option>
                                <option value="normal">Normal Priority</option>
                                <option value="high">High Priority</option>
                            </select>

                            <DateTimePicker value={dueDate} onChange={setDueDate} placeholder="No deadline" />
                        </div>
                    </div>
                )}

                {/* Daily task fields */}
                {taskType === 'daily' && (
                    <div className={styles.formContent}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'}}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '14px', whiteSpace: 'nowrap' }}>Task's Priority:</span>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className={styles.select}
                            >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                            </select>

                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '14px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={dailyRepeats}
                                    onChange={e => setDailyRepeats(e.target.checked)}
                                    style={{ accentColor: 'var(--accent-warning)' }}
                                />
                                Repeats
                            </label>
                        </div>

                        {dailyRepeats && (
                            <div style={{ marginBottom: '16px' }}>
                                <RecurrencePicker value={dailyRecurrence} onChange={setDailyRecurrence} />
                            </div>
                        )}

                        {/* Draft Preview List */}
                        {dailyTasksDraft.length > 0 && (
                            <div className={styles.draftList}>
                                <h4 style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: '14px' }}>Tasks to create ({dailyTasksDraft.length}):</h4>
                                {dailyTasksDraft.map(task => (
                                    <div key={task.id} className={styles.draftItem}>
                                        <span className={styles.draftText}>{task.title}</span>
                                        {recurLabel(task.recurrence) && (
                                            <span className={styles.draftPriority} style={{ color: 'var(--accent-warning)' }}>↻ {recurLabel(task.recurrence)}</span>
                                        )}
                                        <span className={`${styles.draftPriority} ${styles[task.priority]}`}>{task.priority}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeFromDailyTaskDraft(task.id)}
                                            className={styles.removeBtn}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Bundle task fields */}
                {taskType === 'bundle' && (
                    <div className={styles.formContent}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'}}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '14px', whiteSpace: 'nowrap' }}>Task's Priority:</span>
                            <select
                                value={priority}
                                onChange={e => setPriority(e.target.value)}
                                className={styles.select}
                            >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                            </select>
                        </div>

                        {/* Draft Preview List */}
                        {bundleTasksDraft.length > 0 && (
                            <div className={styles.draftList}>
                                <h4 style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: '14px' }}>Tasks to create ({bundleTasksDraft.length}):</h4>
                                {bundleTasksDraft.map(task => (
                                    <div key={task.id} className={styles.draftItem}>
                                        <span className={styles.draftText}>{task.title}</span>
                                        <span className={`${styles.draftPriority} ${styles[task.priority]}`}>{task.priority}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeFromBundleDraft(task.id)}
                                            className={styles.removeBtn}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div className={styles.actions}>
                    <button type="button" onClick={() => setShowForm(false)} className={styles.cancelBtn}>
                        Cancel
                    </button>

                    {taskType === 'normal' && (
                        <button type="submit" className={styles.submitBtn} disabled={submitting}>
                            {submitting ? 'Creating…' : 'Create Task'}
                        </button>
                    )}
                    {taskType === 'daily' && dailyTasksDraft.length > 0 && (
                        <button type="button" onClick={submitDailyTaskDraft} className={styles.createAllBtn} disabled={submitting}>
                            {submitting ? 'Creating…' : `Create All (${dailyTasksDraft.length})`}
                        </button>
                    )}
                    {taskType === 'bundle' && bundleTasksDraft.length > 0 && (
                        <button type="button" onClick={submitBundleDraft} className={styles.createAllBtn} disabled={submitting}>
                            {submitting ? 'Creating…' : `Create All (${bundleTasksDraft.length})`}
                        </button>
                    )}
                </div>
            </form>
        </div>
    )


    // Card view (grid)
    if (viewMode === "card") {
        return (
            <>
                <div onClick={() => setShowForm(true)} className={styles.addCard}>
                    <span className={styles.addCardIcon}>+</span>
                    <h2>Add Task</h2>
                </div>
                {showForm && createPortal(formModal, document.body)}
            </>
        )
    }

    // List view (horizontal)
    return (
        <>
            <div onClick={() => setShowForm(true)} className={styles.addCardList}>
                <span className={styles.addCardListIcon}>+</span>
                <h4>Add Task</h4>
            </div>
            {showForm && createPortal(formModal, document.body)}
        </>
    )
}

export default AddTaskCard
