import { useState } from 'react'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './Designer.module.css'

const SWATCHES = [
    { name: 'Amber', value: '#f0b840' }, { name: 'Blue', value: '#5a9cf0' },
    { name: 'Green', value: '#52c47a' }, { name: 'Purple', value: '#c084fc' }, { name: 'Red', value: '#e05c5c' },
]

// Manage saved schedules: rename (inline), recolour (color button → popover; repaints all its blocks),
// Edit (re-open & update in place), Duplicate (re-open & save as new), delete (cascades blocks).
export default function SchedulesModal({ schedules, onDelete, onRecolor, onRename, onEdit, onDuplicate, onClose }) {
    const [confirmId, setConfirmId] = useState(null)
    const [colorOpenId, setColorOpenId] = useState(null)
    const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return (
        <div className={styles.backdrop} onClick={handleBackdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>Schedules</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className={styles.body}>
                    {schedules.length > 0 && (
                        <p className={styles.hint}>
                            <b>Edit</b> re-opens a schedule to change it <b>in place</b> · <b>Duplicate</b> saves
                            your tweaks as a <b>new</b> one · click a block on the calendar to change a single class.
                        </p>
                    )}
                    {schedules.length === 0 ? (
                        <div className={styles.empty}>No saved schedules yet. Build one in the Designer.</div>
                    ) : schedules.map(s => (
                        <div key={s.id} className={styles.schedRow}>
                            <input
                                className={styles.schedName}
                                defaultValue={s.name}
                                onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.name) onRename(s.id, v) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            />
                            <span className={styles.schedCount}>{s.block_count} block{s.block_count === 1 ? '' : 's'}</span>

                            <div className={styles.colorWrap}>
                                <button
                                    className={styles.colorBtn}
                                    style={s.color ? { background: s.color, borderColor: s.color } : undefined}
                                    title="Change colour"
                                    onClick={() => setColorOpenId(colorOpenId === s.id ? null : s.id)}
                                >{s.color ? '' : '🎨'}</button>
                                {colorOpenId === s.id && (
                                    <div className={styles.colorPop}>
                                        {SWATCHES.map(sw => (
                                            <button key={sw.value} className={styles.swatchSm} style={{ background: sw.value }} title={sw.name} onClick={() => { onRecolor(s.id, sw.value); setColorOpenId(null) }} />
                                        ))}
                                        <button className={styles.swatchNoneSm} title="No colour" onClick={() => { onRecolor(s.id, null); setColorOpenId(null) }}>∅</button>
                                    </div>
                                )}
                            </div>

                            {onEdit && s.template && <button className={styles.rowBtn} onClick={() => onEdit(s)} title="Re-open this schedule in the Designer and update it in place">Edit</button>}
                            {onDuplicate && s.template && <button className={styles.rowBtn} onClick={() => onDuplicate(s)} title="Re-open this pattern and save your tweaks as a new schedule">Duplicate</button>}

                            {confirmId === s.id ? (
                                <button className={styles.confirmDel} onClick={() => { onDelete(s.id); setConfirmId(null) }} title="Delete this schedule and all its blocks">Delete?</button>
                            ) : (
                                <button className={styles.delBtn} onClick={() => setConfirmId(s.id)} title="Delete schedule + its blocks"><HiOutlineTrash size={14} /></button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
