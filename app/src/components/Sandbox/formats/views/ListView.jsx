import { memo, useState } from 'react'
import { LuCheck, LuX } from 'react-icons/lu'
import styles from '../FormatWidget.module.css'

/**
 * The plain list — every view's stand-in until it has its own (Table,
 * Kanban, Timeline, Matrix). One row per record: a done check, the title
 * (editable in place), the other fields as small chips, and × on own records.
 * It reads and writes only through `source` (dataSource.js), so the same rows
 * work for own records and linked tasks.
 */
function TitleInput({ value, onCommit, disabled }) {
    const [draft, setDraft] = useState(null)   // null = not editing; show the value
    const commit = () => {
        if (draft != null && draft !== value) onCommit(draft)
        setDraft(null)
    }
    return (
        <input
            className={styles.titleInput}
            value={draft ?? value}
            placeholder="Untitled"
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { setDraft(null); requestAnimationFrame(() => e.target.blur()) }
            }}
        />
    )
}

function chipText(field, v) {
    if (v == null || v === '') return null
    if (field.type === 'date') {
        const [y, m, d] = String(v).split('-').map(Number)
        if (!y || !m || !d) return String(v)
        return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    if (field.type === 'check') return v ? field.name : null
    return String(v)
}

function ListView({ source }) {
    const [adding, setAdding] = useState('')
    const { fields, records, editable } = source
    const hasStatus = fields.some(f => f.id === 'status')
    const chipFields = fields.filter(f => f.id !== 'title' && !(f.id === 'status' && hasStatus))

    const add = () => {
        const t = adding.trim()
        if (!t) return
        source.add({ title: t, ...(hasStatus ? { status: fields.find(f => f.id === 'status')?.options?.[0] || 'To do' } : null) })
        setAdding('')
    }

    return (
        <div className={styles.list}>
            {source.missing && <div className={styles.empty}>That project is gone. Pick another source.</div>}
            {!source.missing && records.length === 0 && (
                <div className={styles.empty}>{source.type === 'own' ? 'No records yet — add one below.' : 'Nothing here for this filter.'}</div>
            )}
            {records.map(rec => {
                const v = rec.values || {}
                const done = v.status === 'Done'
                return (
                    <div key={rec.id} className={`${styles.row} ${done ? styles.rowDone : ''}`}>
                        {hasStatus && (
                            <button
                                className={`${styles.check} ${done ? styles.checked : ''}`}
                                disabled={!editable.has('status')}
                                onClick={() => source.update(rec.id, { status: done ? 'To do' : 'Done' })}
                                title={done ? 'Mark not done' : 'Mark done'} aria-label={done ? 'Mark not done' : 'Mark done'}>
                                {done && <LuCheck size={11} strokeWidth={3} />}
                            </button>
                        )}
                        <TitleInput value={v.title || ''} disabled={!editable.has('title')} onCommit={(t) => source.update(rec.id, { title: t })} />
                        {chipFields.map(f => {
                            const t = chipText(f, v[f.id])
                            return t ? <span key={f.id} className={styles.chip} title={f.name}>{t}</span> : null
                        })}
                        {hasStatus && v.status && v.status !== 'Done' && v.status !== 'To do' && (
                            <span className={styles.chip} title="Status">{v.status}</span>
                        )}
                        {source.canRemove && (
                            <button className={styles.rowRemove} onClick={() => source.remove(rec.id)} title="Delete record" aria-label="Delete record">
                                <LuX size={12} />
                            </button>
                        )}
                    </div>
                )
            })}
            {source.canAdd && (
                <input
                    className={styles.addInput}
                    value={adding}
                    placeholder={source.type === 'own' ? '+ Add a record' : '+ Add a task'}
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') add(); if (e.key === 'Escape') e.currentTarget.blur() }}
                />
            )}
        </div>
    )
}

export default memo(ListView)
