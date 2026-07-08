import { useState } from 'react'
import styles from './Designer.module.css'
import { toast } from '../../utils/toast'

const SWATCHES = [
    { name: 'Amber', value: '#f0b840' }, { name: 'Blue', value: '#5a9cf0' },
    { name: 'Green', value: '#52c47a' }, { name: 'Purple', value: '#c084fc' }, { name: 'Red', value: '#e05c5c' },
]

// Names a designed week + a date range, then stamps the weekly pattern across it as a schedule.
export default function ApplyDesignDialog({ blockCount, editing, onApply, onClose }) {
    // On Edit, prefill From/To/Skip from the saved template context ({ pattern, from, to, skip }).
    const tpl = (editing?.template && !Array.isArray(editing.template)) ? editing.template : null
    const [name, setName] = useState(editing?.name || '')
    const [from, setFrom] = useState(tpl?.from || '')
    const [to, setTo] = useState(tpl?.to || '')
    const [color, setColor] = useState(editing?.color || null)
    const [skipInput, setSkipInput] = useState('')
    const [skip, setSkip] = useState(Array.isArray(tpl?.skip) ? tpl.skip : []) // 'YYYY-MM-DD' dates to skip

    const addSkip = () => {
        if (!skipInput) return
        if (!skip.includes(skipInput)) setSkip([...skip, skipInput].sort())
        setSkipInput('')
    }

    const submit = () => {
        if (!name.trim()) { toast.warning('Give this schedule a name.'); return }
        if (!from || !to) { toast.warning('Pick a start and end date.'); return }
        if (to < from) { toast.warning('The end date is before the start date.'); return }
        onApply({ name: name.trim(), color, from, to, exclude: skip })
    }
    const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

    return (
        <div className={styles.backdrop} onClick={handleBackdrop}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h3 className={styles.title}>{editing ? 'Update schedule' : 'Apply schedule'}</h3>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className={styles.body}>
                    <p className={styles.hint}>
                        {editing
                            ? `Re-stamp “${editing.name}” across a date range — this replaces all of its current blocks. A block on Monday repeats every Monday in the range.`
                            : `Stamp your ${blockCount}-block week across a date range — a block on Monday repeats every Monday in the range.`}
                    </p>
                    <input className={styles.input} type="text" autoFocus placeholder="Schedule name (e.g. Fall 2026)…" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} />
                    <div className={styles.row}>
                        <label className={styles.label}>From</label>
                        <input className={styles.field} type="date" value={from} onChange={e => setFrom(e.target.value)} />
                    </div>
                    <div className={styles.row}>
                        <label className={styles.label}>To</label>
                        <input className={styles.field} type="date" value={to} onChange={e => setTo(e.target.value)} />
                    </div>
                    <div className={styles.row}>
                        <label className={styles.label}>Skip</label>
                        <input className={styles.field} type="date" value={skipInput} title="Pick a date to skip (e.g. a holiday), then + (or Enter). Add as many as you like." onChange={e => setSkipInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkip() } }} />
                        {skipInput && <button type="button" className={styles.addBtn} onClick={addSkip} title="Add this date — you can add several">+</button>}
                    </div>
                    {skip.length > 0 && (
                        <div className={styles.chips}>
                            {skip.map(d => <button key={d} className={styles.chip} onClick={() => setSkip(skip.filter(x => x !== d))} title="Remove">{d} ✕</button>)}
                        </div>
                    )}

                    <div className={styles.row}>
                        <label className={styles.label}>Colour</label>
                        <div className={styles.swatches}>
                            <button className={`${styles.swatchNone} ${color == null ? styles.swatchOn : ''}`} onClick={() => setColor(null)} title="Keep per-block colours">∅</button>
                            {SWATCHES.map(s => <button key={s.value} className={`${styles.swatch} ${color === s.value ? styles.swatchOn : ''}`} style={{ background: s.value }} title={s.name} onClick={() => setColor(s.value)} />)}
                        </div>
                    </div>
                </div>
                <div className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
                    <button className={styles.saveBtn} onClick={submit}>{editing ? 'Update' : 'Apply'}</button>
                </div>
            </div>
        </div>
    )
}
