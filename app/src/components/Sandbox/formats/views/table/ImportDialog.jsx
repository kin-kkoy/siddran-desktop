import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuX } from 'react-icons/lu'
import styles from '../../Table.module.css'
import { planImport, readCell, MAX_IMPORT_ROWS, MAX_IMPORT_COLS } from '../../importer'
import { FIELD_TYPES, cellText } from '../../fields'

/**
 * The preview before rows go in (pasted from a spreadsheet, or a CSV file):
 * which field each column lands in (or a new field, or skip), whether the
 * first row is headers, and — when a cell was selected — add as new records
 * or fill from that cell. Nothing changes until Import; then it's one undo step.
 */
const PREVIEW_ROWS = 8
const NEW_TYPES = FIELD_TYPES.filter(t => t.id !== 'formula' && t.id !== 'files')

export default function ImportDialog({ rows, from, fields, editable, canFill, startCol = 0, canAddFields = true, onImport, onClose }) {
    const [header, setHeader] = useState(null)   // null = as guessed
    const [mode, setMode] = useState('append')
    const [over, setOver] = useState({})        // column index → { target?, type?, name? }
    const base = useMemo(() => planImport(rows, fields, { header: header ?? undefined, startCol: mode === 'fill' ? startCol : 0, editable }), [rows, fields, header, mode, startCol, editable])
    const plan = useMemo(() => ({
        ...base,
        columns: base.columns.map((c, i) => {
            const o = over[i] || {}
            const col = { ...c, ...o }
            if (col.target === 'new' && !canAddFields) col.target = 'skip'
            if (col.target !== 'new' && col.target !== 'skip') col.type = fields.find(f => f.id === col.target)?.type || col.type
            return col
        }),
    }), [base, over, fields, canAddFields])
    const set = (i, patch) => setOver(o => ({ ...o, [i]: { ...o[i], ...patch } }))
    const used = plan.columns.filter(c => c.target !== 'skip')
    const nNew = plan.columns.filter(c => c.target === 'new').length
    const targets = fields.filter(f => f.type !== 'formula' && (!editable || editable.has(f.id)))
    const show = (c, raw) => {
        if (c.target === 'skip') return ''
        const f = c.target === 'new' ? { type: c.type } : fields.find(x => x.id === c.target)
        const v = readCell(f?.type || 'text', raw)
        return v === undefined ? '' : cellText(f, v)
    }

    return createPortal(
        <div className={styles.dialogBack} data-sb-handle="true" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}>
            <div className={styles.dialog} role="dialog" aria-label="Import rows">
                <div className={styles.dialogHead}>
                    <span className={styles.dialogTitle}>Import {plan.body.length} row{plan.body.length === 1 ? '' : 's'}</span>
                    <span className={styles.dialogFrom}>{from}</span>
                    <span className={styles.grow} />
                    <button className={styles.popIcon} onClick={onClose} aria-label="Close"><LuX size={15} /></button>
                </div>
                <div className={styles.dialogOpts}>
                    <label><input type="checkbox" checked={plan.header} onChange={(e) => { setHeader(e.target.checked); setOver({}) }} /> First row is headers</label>
                    {canFill && (
                        <>
                            <label><input type="radio" name="imode" checked={mode === 'append'} onChange={() => { setMode('append'); setOver({}) }} /> Add as new records</label>
                            <label><input type="radio" name="imode" checked={mode === 'fill'} onChange={() => { setMode('fill'); setOver({}) }} /> Fill from the selected cell</label>
                        </>
                    )}
                </div>
                {plan.truncated && <div className={styles.fxErr}>Only the first {MAX_IMPORT_ROWS} rows and {MAX_IMPORT_COLS} columns are imported at once — paste the rest after.</div>}
                <div className={styles.dialogScroll}>
                    <table className={styles.previewTable}>
                        <thead>
                            <tr>
                                {plan.columns.map((c, i) => (
                                    <th key={i}>
                                        <select className={styles.popSelect} value={c.target} aria-label={`Column ${i + 1} goes to`}
                                            onChange={(e) => set(i, { target: e.target.value })}>
                                            {targets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                            {canAddFields && <option value="new">New field: {c.name}</option>}
                                            <option value="skip">Skip</option>
                                        </select>
                                        {c.target === 'new' && (
                                            <select className={styles.popSelectTiny} value={c.type} aria-label="New field type" onChange={(e) => set(i, { type: e.target.value })}>
                                                {NEW_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                            </select>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {plan.body.slice(0, PREVIEW_ROWS).map((r, k) => (
                                <tr key={k}>{plan.columns.map((c, i) => <td key={i} className={c.target === 'skip' ? styles.dim : ''}>{show(c, r[i])}</td>)}</tr>
                            ))}
                        </tbody>
                    </table>
                    {plan.body.length > PREVIEW_ROWS && <div className={styles.popNote}>…and {plan.body.length - PREVIEW_ROWS} more.</div>}
                </div>
                <div className={styles.dialogFoot}>
                    <span className={styles.popNote}>
                        {mode === 'fill' ? 'Fills cells from the selected one; rows past the end become new records.' : `Adds ${plan.body.length} record${plan.body.length === 1 ? '' : 's'}.`}
                        {nNew ? ` Creates ${nNew} field${nNew === 1 ? '' : 's'}.` : ''} Ctrl+Z undoes it.
                    </span>
                    <span className={styles.grow} />
                    <button className={styles.popBtnQuiet} onClick={onClose}>Cancel</button>
                    <button className={`${styles.popBtn} ${styles.primaryBtn}`} disabled={!used.length || !plan.body.length} onClick={() => onImport(plan, mode)}>Import</button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
