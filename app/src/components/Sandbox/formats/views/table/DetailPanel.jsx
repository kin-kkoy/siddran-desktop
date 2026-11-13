import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuX, LuChevronUp, LuChevronDown, LuTrash2, LuCheck } from 'react-icons/lu'
import styles from '../../Table.module.css'
import Popover from '../../Popover'
import { fieldTypeLabel, cellText, coerceValue } from '../../fields'
import { OptionPicker, OptionChip } from '../TableMenus'
import { AttachEditor } from './Attachments'

/**
 * One record, every field, in a sheet at the side of the window (spec
 * §13.4.3 "row detail panel"). Opened from a row's ⤢ button or Space on a
 * selected cell. ↑ / ↓ (or Alt+↑/↓) step through the records as the table
 * shows them; Esc closes. Edits go through the same source as the cells.
 */

/** A text-ish field: saved on Enter (Ctrl+Enter for long text) or leaving the box. */
function TextInput({ field, value, disabled, onCommit }) {
    const long = field.type === 'long'
    const raw = field.type === 'number' ? (typeof value === 'number' ? String(value) : '') : (value ?? '')
    const Tag = long ? 'textarea' : 'input'
    return (
        <Tag key={raw} className={long ? styles.detailArea : styles.detailInput} defaultValue={raw} disabled={disabled}
            inputMode={field.type === 'number' ? 'decimal' : undefined} rows={long ? 4 : undefined} aria-label={field.name}
            onKeyDown={(e) => { if (e.key === 'Enter' && (!long || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() } }}
            onBlur={(e) => { if (e.currentTarget.value !== raw) onCommit(e.currentTarget.value) }} />
    )
}

function OptionsInput({ field, value, disabled, canCreate, onCommit }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    const list = field.type === 'multi' ? (Array.isArray(value) ? value : []) : value ? [value] : []
    return (
        <>
            <button ref={ref} className={styles.detailPick} disabled={disabled} onClick={() => setOpen(o => !o)} aria-label={field.name}>
                {list.length ? list.map(o => <OptionChip key={o} label={o} small />) : <span className={styles.dim}>Choose…</span>}
            </button>
            {open && (
                <Popover anchor={ref} width={240} onClose={() => setOpen(false)} label={`${field.name} options`}>
                    <OptionPicker field={field} value={value} canCreate={canCreate} onChange={onCommit} onClose={() => setOpen(false)} />
                </Popover>
            )}
        </>
    )
}

function FieldValue({ field, rec, source, onOpen }) {
    const v = rec.values?.[field.id]
    const editable = source.editable.has(field.id)
    const commit = (raw) => {
        const nv = coerceValue(field, raw)
        if (JSON.stringify(nv) !== JSON.stringify(v)) source.update(rec.id, { [field.id]: nv })
    }
    if (field.type === 'formula') {
        const err = rec.errors?.[field.id]
        return (
            <div className={styles.detailRead}>
                {err ? <span className={styles.fxError} title={err.message}>{err.code}</span> : cellText(field, v) || <span className={styles.dim}>—</span>}
                <span className={styles.detailExpr}>= {field.expr || '…'}</span>
            </div>
        )
    }
    if (!editable && field.type !== 'check') return <div className={styles.detailRead}>{cellText(field, v) || <span className={styles.dim}>—</span>}</div>
    switch (field.type) {
        case 'check':
            return (
                <button className={styles.detailCheck} disabled={!editable} onClick={() => commit(!v)} aria-pressed={!!v} aria-label={field.name}>
                    <span className={`${styles.box} ${v ? styles.boxOn : ''}`}>{v && <LuCheck size={11} strokeWidth={3} />}</span>
                </button>
            )
        case 'date':
            return <input type="date" className={styles.detailInput} value={v || ''} aria-label={field.name} onChange={(e) => commit(e.target.value)} />
        case 'select': case 'multi':
            return <OptionsInput field={field} value={v} canCreate={!!source.fieldsEditable} onCommit={commit} />
        case 'files':
            return <div className={styles.detailFiles}><AttachEditor value={v} onOpen={onOpen} onChange={commit} /></div>
        default:
            return <TextInput field={field} value={v} onCommit={commit} />
    }
}

export default function DetailPanel({ rec, fields, primary, source, index, count, hidden, onStep, onOpen, onClose }) {
    const title = (primary && cellText(primary, rec.values?.[primary.id])) || 'Untitled'
    const panel = useRef(null)
    useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])   // once, on opening
    const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return   // the board's undo
        e.stopPropagation()
        const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
        if (e.key === 'Escape' && !inField) onClose()
        if ((e.altKey || !inField) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); onStep(e.key === 'ArrowUp' ? -1 : 1) }
    }
    return createPortal(
        <div className={styles.detail} role="dialog" aria-label={`Record: ${title}`} data-sb-handle="true" tabIndex={-1}
            ref={panel}
            onPointerDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
            <div className={styles.detailHead}>
                <span className={styles.detailTitle} title={title}>{title}</span>
                <span className={styles.detailCount}>{index >= 0 ? index + 1 : '–'} / {count}</span>
                <button className={styles.popIcon} disabled={index <= 0} onClick={() => onStep(-1)} title="Previous record (↑)" aria-label="Previous record"><LuChevronUp size={15} /></button>
                <button className={styles.popIcon} disabled={index >= count - 1} onClick={() => onStep(1)} title="Next record (↓)" aria-label="Next record"><LuChevronDown size={15} /></button>
                <button className={styles.popIcon} onClick={onClose} title="Close (Esc)" aria-label="Close"><LuX size={15} /></button>
            </div>
            {hidden && <div className={styles.detailNote}>Hidden by the table’s filter.</div>}
            <div className={styles.detailBody}>
                {fields.map(f => (
                    <div key={`${rec.id}:${f.id}`} className={styles.detailRow}>
                        <div className={styles.detailLabel}>
                            <span>{f.name}</span>
                            <span className={styles.popMeta}>{fieldTypeLabel(f.type)}</span>
                        </div>
                        <FieldValue field={f} rec={rec} source={source} onOpen={onOpen} />
                    </div>
                ))}
            </div>
            {source.canRemove && (
                <div className={styles.detailFoot}>
                    <button className={`${styles.popBtn} ${styles.dangerBtn}`} onClick={() => { source.remove(rec.id); onClose() }}>
                        <LuTrash2 size={13} /> Delete record
                    </button>
                    <span className={styles.popNote}>Ctrl+Z on the board brings it back.</span>
                </div>
            )}
        </div>,
        document.body,
    )
}
