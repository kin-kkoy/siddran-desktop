import { useMemo, useState } from 'react'
import { LuCheck, LuX, LuPlus, LuArrowUp, LuArrowDown, LuEye, LuEyeOff, LuArrowLeft, LuArrowRight, LuTrash2, LuRows3 } from 'react-icons/lu'
import styles from '../Table.module.css'
import { FIELD_TYPES, fieldTypeLabel, hasOptions, optionHue, filledCount } from '../fields'
import { opsFor, defaultOp, calcsFor } from '../query'

/**
 * The Table's menus. Each edits through `onConfig(fn)` (view settings in
 * payload.table, one undo step per change) or the source's field verbs
 * (dataSource.js). A text box commits on Enter or when it loses focus, never
 * per keystroke, so typing doesn't fill the undo stack.
 */

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A chip in an option's colour. */
export function OptionChip({ label, small }) {
    return (
        <span className={`${styles.opt} ${small ? styles.optSmall : ''}`} style={{ '--opt-hue': optionHue(label) }}>
            {label}
        </span>
    )
}

/** A text box that commits on Enter / blur and resets on Esc. */
function CommitInput({ value, onCommit, className = styles.popInput, ...rest }) {
    return (
        <input className={className} defaultValue={value ?? ''} {...rest}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            }}
            onBlur={(e) => { const v = e.currentTarget.value; if (v !== (value ?? '')) onCommit(v) }} />
    )
}

const Head = ({ children }) => <div className={styles.popHead}>{children}</div>

// ---- filter ----

function FilterValue({ field, op, value, onChange }) {
    if (!op?.needsValue) return <span className={styles.grow} />
    if (field.type === 'select' || field.type === 'multi') {
        return (
            <select className={styles.popSelect} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
                <option value="">Choose…</option>
                {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
        )
    }
    if (field.type === 'date') return <input type="date" className={styles.popInput} defaultValue={value || ''} onChange={(e) => onChange(e.target.value || undefined)} />
    return <CommitInput value={value} placeholder="Value" inputMode={field.type === 'number' ? 'decimal' : undefined} onCommit={(v) => onChange(v.trim() ? v : undefined)} />
}

export function FilterMenu({ fields, config, onConfig }) {
    const filters = config.filters || []
    const byId = new Map(fields.map(f => [f.id, f]))
    const upd = (id, patch) => onConfig(c => ({ ...c, filters: (c.filters || []).map(f => f.id === id ? { ...f, ...patch } : f) }))
    const add = () => {
        const f = fields[0]
        if (f) onConfig(c => ({ ...c, filters: [...(c.filters || []), { id: uid(), field: f.id, op: defaultOp(f.type) }] }))
    }
    return (
        <>
            <Head>Show records where</Head>
            {filters.length === 0 && <div className={styles.popEmpty}>No filters. Every record shows.</div>}
            {filters.map((c, i) => {
                const field = byId.get(c.field) || fields[0]
                const ops = opsFor(field.type)
                const op = ops.find(o => o.id === c.op) || ops[0]
                return (
                    <div key={c.id || i} className={styles.popRow}>
                        {i === 0 ? <span className={styles.popWord}>Where</span> : i === 1 ? (
                            <select className={styles.popSelectTiny} value={config.match === 'any' ? 'any' : 'all'}
                                onChange={(e) => onConfig(x => ({ ...x, match: e.target.value }))} aria-label="Match all or any">
                                <option value="all">and</option><option value="any">or</option>
                            </select>
                        ) : <span className={styles.popWord}>{config.match === 'any' ? 'or' : 'and'}</span>}
                        <select className={styles.popSelect} value={field.id} aria-label="Field"
                            onChange={(e) => { const nf = byId.get(e.target.value); upd(c.id, { field: nf.id, op: defaultOp(nf.type), value: undefined }) }}>
                            {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                        <select className={styles.popSelect} value={op.id} aria-label="Condition"
                            onChange={(e) => upd(c.id, { op: e.target.value })}>
                            {ops.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        <FilterValue key={`${c.field}:${op.id}`} field={field} op={op} value={c.value} onChange={(v) => upd(c.id, { value: v })} />
                        <button className={styles.popIcon} title="Remove filter" aria-label="Remove filter"
                            onClick={() => onConfig(x => ({ ...x, filters: (x.filters || []).filter(f => f.id !== c.id) }))}><LuX size={13} /></button>
                    </div>
                )
            })}
            <div className={styles.popActions}>
                <button className={styles.popBtn} onClick={add}><LuPlus size={13} /> Add filter</button>
                {filters.length > 0 && <button className={styles.popBtnQuiet} onClick={() => onConfig(c => ({ ...c, filters: [] }))}>Clear</button>}
            </div>
        </>
    )
}

// ---- sort ----

export function SortMenu({ fields, config, onConfig }) {
    const sorts = config.sorts || []
    const used = new Set(sorts.map(s => s.field))
    const upd = (i, patch) => onConfig(c => ({ ...c, sorts: (c.sorts || []).map((s, j) => j === i ? { ...s, ...patch } : s) }))
    const free = fields.find(f => !used.has(f.id))
    return (
        <>
            <Head>Sort by</Head>
            {sorts.length === 0 && <div className={styles.popEmpty}>Records show in the order they were added.</div>}
            {sorts.map((s, i) => (
                <div key={`${s.field}-${i}`} className={styles.popRow}>
                    <span className={styles.popWord}>{i === 0 ? 'Sort' : 'then'}</span>
                    <select className={styles.popSelect} value={s.field} aria-label="Field" onChange={(e) => upd(i, { field: e.target.value })}>
                        {fields.filter(f => f.id === s.field || !used.has(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <button className={styles.popBtn} onClick={() => upd(i, { dir: s.dir === 'desc' ? 'asc' : 'desc' })}
                        title="Flip the direction">
                        {s.dir === 'desc' ? <><LuArrowDown size={13} /> Descending</> : <><LuArrowUp size={13} /> Ascending</>}
                    </button>
                    <button className={styles.popIcon} title="Remove sort" aria-label="Remove sort"
                        onClick={() => onConfig(c => ({ ...c, sorts: (c.sorts || []).filter((_, j) => j !== i) }))}><LuX size={13} /></button>
                </div>
            ))}
            <div className={styles.popActions}>
                {free && <button className={styles.popBtn} onClick={() => onConfig(c => ({ ...c, sorts: [...(c.sorts || []), { field: free.id, dir: 'asc' }] }))}><LuPlus size={13} /> Add sort</button>}
                {sorts.length > 0 && <button className={styles.popBtnQuiet} onClick={() => onConfig(c => ({ ...c, sorts: [] }))}>Clear</button>}
            </div>
        </>
    )
}

// ---- group ----

const Tick = ({ on }) => <span className={styles.popTick}>{on && <LuCheck size={13} />}</span>

export function GroupMenu({ fields, config, onConfig, onClose }) {
    const pick = (id) => { onConfig(c => { const n = { ...c }; if (id) n.groupBy = id; else delete n.groupBy; return n }); onClose() }
    return (
        <>
            <Head>Group by</Head>
            <button className={styles.popItem} onClick={() => pick(null)}><Tick on={!config.groupBy} /> None</button>
            {fields.filter(f => f.type !== 'long').map(f => (
                <button key={f.id} className={styles.popItem} onClick={() => pick(f.id)}>
                    <Tick on={config.groupBy === f.id} /> <span className={styles.popLabel}>{f.name}</span> <span className={styles.popMeta}>{fieldTypeLabel(f.type)}</span>
                </button>
            ))}
        </>
    )
}

// ---- show / hide fields ----

export function FieldsMenu({ fields, config, onConfig }) {
    const hidden = new Set(config.hidden || [])
    const toggle = (id) => onConfig(c => {
        const h = new Set(c.hidden || [])
        if (h.has(id)) h.delete(id); else h.add(id)
        return { ...c, hidden: [...h] }
    })
    const shown = fields.length - fields.filter(f => hidden.has(f.id)).length
    return (
        <>
            <Head>Fields shown</Head>
            {fields.map(f => {
                const on = !hidden.has(f.id)
                return (
                    <button key={f.id} className={styles.popItem} onClick={() => toggle(f.id)} disabled={on && shown <= 1} aria-pressed={on}>
                        <span className={styles.popTick}>{on ? <LuEye size={13} /> : <LuEyeOff size={13} className={styles.dim} />}</span>
                        <span className={`${styles.popLabel} ${on ? '' : styles.dim}`}>{f.name}</span>
                        <span className={styles.popMeta}>{fieldTypeLabel(f.type)}</span>
                    </button>
                )
            })}
            <div className={styles.popRowCheck}>
                <label><input type="checkbox" checked={config.wrap !== false} onChange={(e) => onConfig(c => ({ ...c, wrap: e.target.checked }))} /> Wrap long text</label>
            </div>
            {hidden.size > 0 && <div className={styles.popActions}><button className={styles.popBtnQuiet} onClick={() => onConfig(c => ({ ...c, hidden: [] }))}>Show all</button></div>}
        </>
    )
}

// ---- one field: rename, type, options, sort, group, hide, move, delete ----

function OptionsEditor({ field, source }) {
    return (
        <>
            <Head>Options</Head>
            {(field.options || []).map(o => (
                <div key={o} className={styles.popRow}>
                    <span className={styles.optDot} style={{ background: `hsl(${optionHue(o)}, 62%, 58%)` }} />
                    <CommitInput value={o} aria-label="Option name" onCommit={(v) => source.renameOption(field.id, o, v)} />
                    <button className={styles.popIcon} title="Remove option (clears it from records)" aria-label="Remove option"
                        onClick={() => source.removeOption(field.id, o)}><LuX size={13} /></button>
                </div>
            ))}
            <div className={styles.popRow}>
                <span className={styles.optDot} />
                <input className={styles.popInput} placeholder="+ Add an option" aria-label="New option"
                    onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        const v = e.currentTarget.value.trim()
                        if (v) source.addOption(field.id, v)
                        e.currentTarget.value = ''
                    }} />
            </div>
        </>
    )
}

export function FieldMenu({ field, fields, source, records, config, onConfig, onMove, onClose }) {
    const [confirm, setConfirm] = useState(false)
    const own = !!source.fieldsEditable
    const idx = fields.findIndex(f => f.id === field.id)
    const filled = useMemo(() => filledCount({ records }, field.id), [records, field.id])
    const sortBy = (dir) => { onConfig(c => ({ ...c, sorts: [{ field: field.id, dir }] })); onClose() }
    return (
        <>
            {own ? (
                <div className={styles.popRow}>
                    <CommitInput key={field.name} value={field.name} aria-label="Field name" autoFocus onFocus={(e) => e.currentTarget.select()}
                        onCommit={(v) => v.trim() && source.updateField(field.id, { name: v.trim() })} />
                </div>
            ) : <Head>{field.name} · linked task field</Head>}
            {own && (
                <div className={styles.popRow}>
                    <span className={styles.popWord}>Type</span>
                    <select className={styles.popSelect} value={field.type} aria-label="Field type"
                        onChange={(e) => source.updateField(field.id, { type: e.target.value })}>
                        {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                </div>
            )}
            {own && filled > 0 && <div className={styles.popNote}>Changing the type converts {filled} value{filled === 1 ? '' : 's'}. Ctrl+Z undoes it.</div>}
            {own && field.type === 'number' && (
                <div className={styles.popRow}>
                    <span className={styles.popWord}>Decimals</span>
                    <select className={styles.popSelect} value={Number.isInteger(field.decimals) ? field.decimals : ''} aria-label="Decimals"
                        onChange={(e) => source.updateField(field.id, { decimals: e.target.value === '' ? undefined : Number(e.target.value) })}>
                        <option value="">Auto</option>
                        {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
            )}
            {own && hasOptions(field) && <OptionsEditor field={field} source={source} />}
            <div className={styles.popSep} />
            <button className={styles.popItem} onClick={() => sortBy('asc')}><span className={styles.popTick}><LuArrowUp size={13} /></span> Sort ascending</button>
            <button className={styles.popItem} onClick={() => sortBy('desc')}><span className={styles.popTick}><LuArrowDown size={13} /></span> Sort descending</button>
            {field.type !== 'long' && (
                <button className={styles.popItem} onClick={() => { onConfig(c => ({ ...c, groupBy: c.groupBy === field.id ? undefined : field.id })); onClose() }}>
                    <span className={styles.popTick}><LuRows3 size={13} /></span> {config.groupBy === field.id ? 'Stop grouping' : 'Group by this field'}
                </button>
            )}
            <button className={styles.popItem} disabled={fields.length - (config.hidden?.length || 0) <= 1}
                onClick={() => { onConfig(c => ({ ...c, hidden: [...new Set([...(c.hidden || []), field.id])] })); onClose() }}>
                <span className={styles.popTick}><LuEyeOff size={13} /></span> Hide field
            </button>
            <button className={styles.popItem} disabled={idx <= 0} onClick={() => onMove(field.id, idx - 1)}>
                <span className={styles.popTick}><LuArrowLeft size={13} /></span> Move left
            </button>
            <button className={styles.popItem} disabled={idx >= fields.length - 1} onClick={() => onMove(field.id, idx + 1)}>
                <span className={styles.popTick}><LuArrowRight size={13} /></span> Move right
            </button>
            {own && (
                <>
                    {!confirm ? (
                        <button className={`${styles.popItem} ${styles.danger}`} disabled={fields.length <= 1} onClick={() => setConfirm(true)}>
                            <span className={styles.popTick}><LuTrash2 size={13} /></span> Delete field
                        </button>
                    ) : (
                        <div className={styles.popConfirm}>
                            <div>Delete “{field.name}”{filled ? ` and its values in ${filled} record${filled === 1 ? '' : 's'}` : ''}? Ctrl+Z brings it back.</div>
                            <div className={styles.popActions}>
                                <button className={`${styles.popBtn} ${styles.dangerBtn}`} onClick={() => { source.removeField(field.id); onClose() }}>Delete</button>
                                <button className={styles.popBtnQuiet} onClick={() => setConfirm(false)}>Keep</button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    )
}

export function AddFieldMenu({ source, onAdded }) {
    const [name, setName] = useState('')
    const add = (type) => { const id = source.addField({ name: name.trim(), type }); onAdded(id) }
    return (
        <>
            <Head>New field</Head>
            <div className={styles.popRow}>
                <input className={styles.popInput} autoFocus placeholder="Name (optional)" value={name} aria-label="Field name"
                    onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add('text') }} />
            </div>
            <div className={styles.typeGrid}>
                {FIELD_TYPES.map(t => <button key={t.id} className={styles.typeBtn} onClick={() => add(t.id)}>{t.label}</button>)}
            </div>
        </>
    )
}

// ---- footer calculation ----

export function CalcMenu({ field, config, onConfig, onClose }) {
    const cur = config.calcs?.[field.id]
    const pick = (id) => {
        onConfig(c => { const calcs = { ...(c.calcs || {}) }; if (id) calcs[field.id] = id; else delete calcs[field.id]; return { ...c, calcs } })
        onClose()
    }
    return (
        <>
            <Head>{field.name}</Head>
            <button className={styles.popItem} onClick={() => pick(null)}><Tick on={!cur} /> None</button>
            {calcsFor(field.type).map(c => <button key={c.id} className={styles.popItem} onClick={() => pick(c.id)}><Tick on={cur === c.id} /> {c.label}</button>)}
        </>
    )
}

// ---- picking a select / multi-select value in a cell ----

export function OptionPicker({ field, value, query = '', canCreate, onChange, onClose }) {
    const [q, setQ] = useState(query)
    const [hi, setHi] = useState(0)
    const multi = field.type === 'multi'
    const chosen = multi ? (Array.isArray(value) ? value : []) : value
    const opts = field.options || []
    const shown = opts.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()))
    const exact = opts.some(o => o.toLowerCase() === q.trim().toLowerCase())
    const create = canCreate && q.trim() && !exact
    const pick = (o) => {
        if (multi) { onChange(chosen.includes(o) ? chosen.filter(x => x !== o) : [...chosen, o]); setQ('') }
        else { onChange(o === chosen ? undefined : o); onClose() }
    }
    return (
        <>
            <div className={styles.popRow}>
                <input className={styles.popInput} autoFocus value={q} placeholder={canCreate ? 'Find or create an option' : 'Find an option'} aria-label="Find an option"
                    onChange={(e) => { setQ(e.target.value); setHi(0) }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - (create ? 0 : 1))) }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
                        else if (e.key === 'Enter') {
                            e.preventDefault()
                            if (hi < shown.length) pick(shown[hi])
                            else if (create) pick(q.trim())
                        } else if (e.key === 'Tab') { e.preventDefault(); onClose(e.shiftKey ? 'prev' : 'next') }
                    }} />
            </div>
            {shown.map((o, i) => (
                <button key={o} className={`${styles.popItem} ${i === hi ? styles.popHi : ''}`} onClick={() => pick(o)} onPointerEnter={() => setHi(i)}>
                    <Tick on={multi ? chosen.includes(o) : chosen === o} /> <OptionChip label={o} />
                </button>
            ))}
            {create && (
                <button className={`${styles.popItem} ${hi === shown.length ? styles.popHi : ''}`} onClick={() => pick(q.trim())}>
                    <span className={styles.popTick}><LuPlus size={13} /></span> Create <OptionChip label={q.trim()} />
                </button>
            )}
            {!shown.length && !create && <div className={styles.popEmpty}>{opts.length ? 'No match.' : 'No options yet.'}</div>}
            {(multi ? chosen.length > 0 : chosen) && (
                <div className={styles.popActions}><button className={styles.popBtnQuiet} onClick={() => { onChange(undefined); onClose() }}>Clear</button></div>
            )}
        </>
    )
}
