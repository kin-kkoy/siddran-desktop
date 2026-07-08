import { useState, useEffect, useRef } from 'react'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './EventModal.module.css'
import RecurrencePicker from './Peek/RecurrencePicker.jsx'
import { toISOFromParts } from './calendarDates'
import { toast } from '../../utils/toast'
import logger from '../../utils/logger'
import { useModalPresence } from '../../utils/modalPresence'

// Create / view / edit a standalone calendar block (a "sticky"/event), optionally linked to an
// existing note/task/etc. Opening from a click starts in a read-only DETAILS view with a toggle
// to Edit and back; Create opens straight into the edit form. Saving an existing block returns
// to the details view (parent keeps the modal open); creating closes it.
//
// Props:
//   mode      — 'create' | 'edit'
//   draft     — { id?, title, description, day (ISO), all_day, startTime, endTime, color, ref_type, ref_id }
//   onSave    — (payload) => void   payload: { title, description, start_at, end_at, all_day, color, ref_type, ref_id }
//   onDelete  — (id) => void        (edit mode only)
//   onClose   — () => void

const SWATCHES = [
    { name: 'Amber',  value: '#f0b840' },
    { name: 'Blue',   value: '#5a9cf0' },
    { name: 'Green',  value: '#52c47a' },
    { name: 'Purple', value: '#c084fc' },
    { name: 'Red',    value: '#e05c5c' },
]

const REF_LABEL = { note: 'note', task: 'task', daily: 'daily', project: 'project', sandbox: 'sandbox' }

const REF_OPTIONS = [
    { value: '',        label: 'No link' },
    { value: 'note',    label: 'Note' },
    { value: 'task',    label: 'Task' },
    { value: 'daily',   label: 'Daily' },
    { value: 'project', label: 'Project' },
    { value: 'sandbox', label: 'Sandbox' },
]

// ref_type → how to fetch its id+title candidates. Sandboxes reuse the existing list endpoint
// (it already returns all id+title and must not be modified); the rest use ?picker=1.
const PICKER = {
    note:    { path: 'notes?picker=1',       key: 'items' },
    task:    { path: 'tasks?picker=1',       key: 'items' },
    daily:   { path: 'daily-tasks?picker=1', key: 'items' },
    project: { path: 'projects?picker=1',    key: 'items' },
    sandbox: { path: 'sandboxes',            key: 'sandboxes' },
}

// Field values derived from the incoming draft (used to seed state + restore on Cancel).
const seedFields = (draft) => ({
    title: draft.title || '',
    day: draft.day,
    allDay: draft.all_day ?? true,
    startTime: draft.startTime || '09:00',
    endTime: draft.endTime || '',
    color: draft.color || null,
    description: draft.description || '',
    refType: draft.ref_type || '',
    refId: draft.ref_id != null ? String(draft.ref_id) : '',
})

const fmtDate = (iso) => {
    if (!iso) return ''
    try {
        return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        })
    } catch { return iso }
}

export default function EventModal({ mode, draft, hideDate, onSave, onDelete, onClose, onOpenLink, authFetch, API }) {
    useModalPresence()
    const [editMode, setEditMode] = useState(mode === 'create')

    // Block vs recurring-daily, create-only (editing an existing block stays a block). A 'daily'
    // create routes to the daily-task creator via onSave's `type` field, not addEvent.
    const [type, setType] = useState('block') // 'block' | 'daily'
    const [recurrence, setRecurrence] = useState('every-day')

    const [title, setTitle] = useState(draft.title || '')
    const [day, setDay] = useState(draft.day)
    const [allDay, setAllDay] = useState(draft.all_day ?? true)
    const [startTime, setStartTime] = useState(draft.startTime || '09:00')
    const [endTime, setEndTime] = useState(draft.endTime || '')
    const [color, setColor] = useState(draft.color || null)
    const [description, setDescription] = useState(draft.description || '')

    // Linking (P5b-2): a block can point at an existing note/task/daily/project/sandbox. refId is
    // kept as a string (DB ref_id is TEXT; sandbox ids are UUIDs).
    const [refType, setRefType] = useState(draft.ref_type || '')
    const [refId, setRefId] = useState(draft.ref_id != null ? String(draft.ref_id) : '')
    const [candidates, setCandidates] = useState([])
    const [pickerLoading, setPickerLoading] = useState(false)
    const [pickerFilter, setPickerFilter] = useState('')

    // Last committed field values (seeded from draft, updated on Save). Cancel restores from here
    // so discarding an in-progress edit returns to the most recently saved state, not the stale
    // open-time draft.
    const committed = useRef(null)
    if (committed.current === null) committed.current = seedFields(draft)

    // Cache picker candidates per refType for this modal's lifetime, so toggling link types back
    // and forth doesn't refetch the same list each time.
    const pickerCacheRef = useRef({})

    const restore = (vals) => {
        setTitle(vals.title); setDay(vals.day); setAllDay(vals.allDay)
        setStartTime(vals.startTime); setEndTime(vals.endTime); setColor(vals.color)
        setDescription(vals.description); setRefType(vals.refType); setRefId(vals.refId)
        setPickerFilter('')
    }

    // Fetch id+title candidates whenever a (non-empty) link type is selected — only needed while editing.
    useEffect(() => {
        if (!editMode) return
        const cfg = refType ? PICKER[refType] : null
        if (!cfg || !authFetch || !API) { setCandidates([]); return }
        // Already fetched this type during this edit session — reuse it, no network call.
        if (pickerCacheRef.current[refType]) { setCandidates(pickerCacheRef.current[refType]); return }
        let cancelled = false
        setPickerLoading(true)
        ;(async () => {
            try {
                const res = await authFetch(`${API}/${cfg.path}`)
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    const list = (data[cfg.key] || []).map(x => ({ id: String(x.id), title: x.title || '(untitled)' }))
                    pickerCacheRef.current[refType] = list
                    setCandidates(list)
                }
            } catch (error) {
                logger.error('Error fetching link candidates:', error)
            } finally {
                if (!cancelled) setPickerLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [editMode, refType, authFetch, API])

    const handleSave = () => {
        if (!title.trim()) {
            toast.warning("A title would be nice, don't you think?")
            return
        }
        // Recurring daily (create-only): no date/colour/link — recurrence governs the days. Parent
        // routes this to the daily-task creator and closes the modal.
        if (type === 'daily') {
            onSave({ type: 'daily', title: title.trim(), recurrence, time: allDay ? null : startTime })
            return
        }
        if (!day) {
            toast.warning('Pick a date for this block.')
            return
        }
        if (refType && !refId) {
            toast.warning('Pick something to link to, or set the link to "No link".')
            return
        }
        const start_at = toISOFromParts(day, allDay ? null : startTime)
        const end_at = (!allDay && endTime) ? toISOFromParts(day, endTime) : null
        onSave({
            title: title.trim(),
            description: description.trim() || null,
            start_at, end_at, all_day: allDay, color,
            ref_type: refType || null,
            ref_id: refType ? refId : null,
        })
        // Remember what we just saved, then return to the details view (parent keeps an edited
        // block's modal open; creating unmounts it).
        committed.current = { title: title.trim(), day, allDay, startTime, endTime, color, description, refType, refId }
        if (mode === 'edit') setEditMode(false)
    }

    const handleCancel = () => {
        if (mode === 'create') { onClose(); return }
        restore(committed.current)
        setEditMode(false)
    }

    const handleBackdrop = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    const linked = refType && refId
    const headerTitle = mode === 'create' ? 'New Event' : editMode ? 'Edit Event' : (title.trim() || '(untitled)')

    return (
        <div className={styles.backdrop} onClick={handleBackdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>{headerTitle}</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>

                {editMode ? (
                    <div className={styles.body}>
                        {mode === 'create' && (
                            <div className={styles.typeToggle}>
                                <button
                                    type="button"
                                    className={`${styles.typeBtn} ${type === 'block' ? styles.typeBtnOn : ''}`}
                                    onClick={() => setType('block')}
                                >Block</button>
                                <button
                                    type="button"
                                    className={`${styles.typeBtn} ${type === 'daily' ? styles.typeBtnOn : ''}`}
                                    onClick={() => setType('daily')}
                                >Daily</button>
                            </div>
                        )}

                        <input
                            className={styles.titleInput}
                            type="text"
                            value={title}
                            autoFocus
                            placeholder={type === 'daily' ? 'Recurring task…' : 'Title…'}
                            onChange={e => setTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                        />

                        {type === 'daily' ? (
                            <>
                                <div className={styles.fieldCol}>
                                    <label className={styles.label}>Repeats</label>
                                    <RecurrencePicker value={recurrence} onChange={setRecurrence} />
                                </div>

                                <div className={styles.row}>
                                    <label className={styles.checkRow}>
                                        <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
                                        <span>All day</span>
                                    </label>
                                    {!allDay && (
                                        <input
                                            className={`${styles.field} ${styles.checkRowInline}`}
                                            type="time"
                                            step={900}
                                            value={startTime}
                                            onChange={e => setStartTime(e.target.value)}
                                        />
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={styles.row}>
                                    {!hideDate && (
                                        <>
                                            <label className={styles.label}>Date</label>
                                            <input
                                                className={styles.field}
                                                type="date"
                                                value={day}
                                                onChange={e => setDay(e.target.value)}
                                            />
                                        </>
                                    )}
                                    <label className={`${styles.checkRow} ${styles.checkRowInline}`}>
                                        <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
                                        <span>All day</span>
                                    </label>
                                </div>

                                {!allDay && (
                                    <div className={styles.row}>
                                        <label className={styles.label}>Time</label>
                                        <div className={styles.timeGroup}>
                                            <input className={styles.field} type="time" step={900} value={startTime} onChange={e => setStartTime(e.target.value)} />
                                            <span className={styles.dash}>→</span>
                                            <input className={styles.field} type="time" step={900} value={endTime} onChange={e => setEndTime(e.target.value)} />
                                        </div>
                                    </div>
                                )}

                                <div className={styles.fieldCol}>
                                    <label className={styles.label}>Description</label>
                                    <textarea
                                        className={styles.textarea}
                                        value={description}
                                        placeholder="Optional notes…"
                                        rows={3}
                                        onChange={e => setDescription(e.target.value)}
                                    />
                                </div>

                                <div className={styles.row}>
                                    <label className={styles.label}>Link</label>
                                    <select
                                        className={styles.field}
                                        value={refType}
                                        onChange={e => { setRefType(e.target.value); setRefId(''); setPickerFilter('') }}
                                    >
                                        {REF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                </div>

                                {refType && (
                                    <div className={styles.picker}>
                                        <input
                                            className={styles.field}
                                            type="text"
                                            value={pickerFilter}
                                            placeholder={pickerLoading ? 'Loading…' : `Search ${REF_LABEL[refType] || 'item'}s…`}
                                            onChange={e => setPickerFilter(e.target.value)}
                                        />
                                        <div className={styles.pickerList}>
                                            {pickerLoading ? (
                                                Array.from({ length: 4 }, (_, i) => (
                                                    <div key={i} className={styles.pickerSkeleton} style={{ width: `${85 - i * 12}%` }} />
                                                ))
                                            ) : (
                                                <>
                                                    {candidates
                                                        .filter(c => !pickerFilter || c.title.toLowerCase().includes(pickerFilter.toLowerCase()))
                                                        .slice(0, 50)
                                                        .map(c => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                className={`${styles.pickerItem} ${refId === c.id ? styles.pickerItemOn : ''}`}
                                                                onClick={() => setRefId(c.id)}
                                                            >{c.title}</button>
                                                        ))}
                                                    {candidates.length === 0 && (
                                                        <div className={styles.pickerEmpty}>Nothing to link.</div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className={styles.row}>
                                    <label className={styles.label}>Colour</label>
                                    <div className={styles.swatches}>
                                        <button
                                            className={`${styles.swatchNone} ${color == null ? styles.swatchOn : ''}`}
                                            title="Default"
                                            onClick={() => setColor(null)}
                                        >∅</button>
                                        {SWATCHES.map(s => (
                                            <button
                                                key={s.value}
                                                className={`${styles.swatch} ${color === s.value ? styles.swatchOn : ''}`}
                                                style={{ background: s.value }}
                                                title={s.name}
                                                onClick={() => setColor(s.value)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className={styles.body}>
                        {linked && (
                            <button className={styles.openLink} onClick={() => onOpenLink?.(refType, refId)}>
                                Open linked {REF_LABEL[refType] || 'item'} →
                            </button>
                        )}

                        <div className={styles.row}>
                            <span className={styles.label}>When</span>
                            <span className={styles.viewValue}>
                                {fmtDate(day)}{allDay ? ' · All day' : ` · ${startTime}${endTime ? ` → ${endTime}` : ''}`}
                            </span>
                        </div>

                        {description.trim() && (
                            <div className={styles.fieldCol}>
                                <span className={styles.label}>Description</span>
                                <p className={styles.viewDesc}>{description}</p>
                            </div>
                        )}

                        <div className={styles.row}>
                            <span className={styles.label}>Colour</span>
                            <span
                                className={styles.viewDot}
                                style={{ background: color || 'transparent', borderColor: color || 'var(--border-strong)' }}
                            />
                        </div>
                    </div>
                )}

                <div className={styles.footer}>
                    {mode === 'edit' ? (
                        <button className={styles.deleteBtn} onClick={() => onDelete(draft.id)}>
                            <HiOutlineTrash size={14} /> Delete
                        </button>
                    ) : <span />}
                    <div className={styles.footerRight}>
                        {editMode ? (
                            <>
                                <button className={styles.cancelBtn} onClick={handleCancel}>Cancel</button>
                                <button className={styles.saveBtn} onClick={handleSave}>
                                    {mode === 'edit' ? 'Save' : 'Create'}
                                </button>
                            </>
                        ) : (
                            <>
                                <button className={styles.cancelBtn} onClick={onClose}>Close</button>
                                <button className={styles.saveBtn} onClick={() => setEditMode(true)}>Edit</button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
