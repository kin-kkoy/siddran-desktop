import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { LuFilter, LuArrowUpDown, LuRows3, LuColumns3, LuPlus, LuX, LuChevronRight, LuChevronDown, LuExternalLink, LuCheck } from 'react-icons/lu'
import styles from '../Table.module.css'
import Popover from '../Popover'
import { tableConfig, tableRows, calculate, activeFilterCount, calcsFor } from '../query'
import { cellText, coerceValue, isEmptyValue, TEXTLIKE, hasOptions } from '../fields'
import { FilterMenu, SortMenu, GroupMenu, FieldsMenu, FieldMenu, AddFieldMenu, CalcMenu, OptionPicker, OptionChip } from './TableMenus'
import { requestOpenExternal } from '../../../../desktop/openExternal'

/**
 * The Table view (spec §13.4): records as rows, fields as typed columns,
 * with filter, sort, group, hidden fields, column widths and footer
 * calculations kept as view settings (payload.table, query.js).
 *
 * Reads and writes only through `source` (dataSource.js), so the same table
 * works over own records and linked tasks; with tasks, the fields are fixed
 * and only the task fields the source marks editable can be changed.
 *
 * Click a cell to edit it. Tab / Shift+Tab move along the row, Enter commits
 * and moves down, Esc cancels — one undo step per cell edit (R13.24).
 */

// Column widths in px at the default 15 px text; drawn in em so they grow with the widget's text size.
const BASE_FONT = 15
const DEFAULT_W = { text: 160, long: 220, number: 96, select: 124, multi: 170, date: 124, check: 76, url: 170, email: 180 }
const widthOf = (f, config) => config.widths?.[f.id] ?? (f.id === 'title' ? 220 : DEFAULT_W[f.type] || 160)
const em = (px) => `${(px / BASE_FONT).toFixed(3)}em`

const hrefFor = (field, v) => {
    const s = String(v || '').trim()
    if (!s) return null
    if (field.type === 'email') return /^mailto:/i.test(s) ? s : `mailto:${s}`
    return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
}

function CellValue({ field, value }) {
    if (isEmptyValue(value)) return null
    switch (field.type) {
        case 'select': return <OptionChip label={String(value)} small />
        case 'multi': return <span className={styles.chips}>{(Array.isArray(value) ? value : [value]).map(o => <OptionChip key={o} label={o} small />)}</span>
        case 'url': case 'email': return <span className={styles.link}>{String(value)}</span>
        default: return <span className={styles.cellText}>{cellText(field, value)}</span>
    }
}

/** The editor for one cell. Calls done({ value }) to commit, done(null) to cancel; `nav` says where to go next. */
function CellEditor({ field, value, anchor, canCreate, onDone }) {
    const finished = useRef(false)
    const area = useRef(null)
    const finish = (result, nav) => {
        if (finished.current) return
        finished.current = true
        onDone(result, nav)
    }
    const keys = (e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); finish(null) }
        else if (e.key === 'Tab') { e.preventDefault(); finish({ value: e.currentTarget.value }, e.shiftKey ? 'prev' : 'next') }
        else if (e.key === 'Enter' && !(field.type === 'long' && e.shiftKey)) { e.preventDefault(); finish({ value: e.currentTarget.value }, 'down') }
    }
    if (hasOptions(field)) {
        // Picking a value commits at once (one step each); closing the picker just ends the edit.
        return (
            <Popover anchor={anchor} width={240} label={`${field.name} options`} onClose={() => finish(null)}>
                <OptionPicker field={field} value={value} canCreate={canCreate} onChange={(v) => onDone({ value: v, keepOpen: true })} onClose={() => finish(null)} />
            </Popover>
        )
    }
    if (field.type === 'long') {
        // A press outside saves (as a blur would); only Esc throws the edit away.
        return (
            <Popover anchor={anchor} width={Math.max(300, anchor?.current?.offsetWidth || 0)} label={field.name}
                onClose={() => finish({ value: area.current?.value ?? value })} onEscape={() => finish(null)}>
                <textarea ref={area} className={styles.longEditor} autoFocus defaultValue={value ?? ''} aria-label={field.name}
                    onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
                    onKeyDown={keys} onBlur={(e) => finish({ value: e.currentTarget.value })} />
                <div className={styles.popNote}>Enter saves · Shift+Enter for a new line · Esc cancels</div>
            </Popover>
        )
    }
    const raw = field.type === 'number' ? (typeof value === 'number' ? String(value) : '') : (value ?? '')
    return (
        <input className={styles.cellInput} autoFocus defaultValue={raw} aria-label={field.name}
            type={field.type === 'date' ? 'date' : 'text'}
            inputMode={field.type === 'number' ? 'decimal' : undefined}
            onFocus={(e) => { if (e.currentTarget.type === 'text') e.currentTarget.select() }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={keys} onBlur={(e) => finish({ value: e.currentTarget.value })} />
    )
}

function TableView({ source, item, onConfig }) {
    const config = tableConfig(item?.payload)
    // Records added here since the filter last changed stay shown even if it would hide them
    // (they'd vanish as you type them otherwise). Changing the filter lets it hide them.
    const [kept, setKept] = useState({ sig: '', ids: new Set() })
    const [edit, setEdit] = useState(null)                 // { gk, rid, fid }
    const [collapsed, setCollapsed] = useState(() => new Set())
    const [menu, setMenu] = useState(null)                 // { kind, anchor, fid? }
    const [resize, setResize] = useState(null)             // { fid, w } while a column edge is dragged
    const [adding, setAdding] = useState('')
    const editAnchor = useRef(null)

    const filterSig = JSON.stringify([config.filters || [], config.match || 'all'])
    const keep = useMemo(() => (kept.sig === filterSig ? kept.ids : new Set()), [kept, filterSig])
    const keepNew = (id) => { if (id) setKept(k => ({ sig: filterSig, ids: new Set(k.sig === filterSig ? k.ids : []).add(id) })) }
    const t = useMemo(() => tableRows(source, config, { keep }), [source, config, keep])
    const filteredIds = useMemo(() => keep.size ? new Set(tableRows(source, config).rows.map(r => r.id)) : null, [source, config, keep])
    const cfg = useCallback((fn) => onConfig?.(fn), [onConfig])
    const closeMenu = useCallback(() => setMenu(null), [])
    const openMenu = (kind, e, extra) => {
        const anchor = e.currentTarget
        setMenu(m => m && m.kind === kind && m.anchor === anchor ? null : { kind, anchor, ...extra })
    }

    const fields = t.fields
    const all = source.fields
    const w = (f) => (resize?.fid === f.id ? resize.w : widthOf(f, config))
    const cols = ['2em', ...fields.map(f => em(w(f))), '2.4em'].join(' ')
    const primary = all.find(f => f.id === 'title') || all.find(f => TEXTLIKE.has(f.type))
    const editFields = fields.filter(f => source.editable.has(f.id) && f.type !== 'check')
    const flat = useMemo(() => t.groups.flatMap(g => collapsed.has(g.key) ? [] : g.records.map(r => ({ gk: g.key, rid: r.id }))), [t.groups, collapsed])
    const recById = useMemo(() => new Map(source.records.map(r => [r.id, r])), [source.records])
    const anyCalc = fields.some(f => config.calcs?.[f.id])

    const commitCell = (rid, field, raw) => {
        const rec = recById.get(rid)
        if (!rec) return
        const v = coerceValue(field, raw)
        if (JSON.stringify(v) === JSON.stringify(rec.values?.[field.id])) return
        source.update(rid, { [field.id]: v })
    }

    const go = (from, nav) => {
        if (!nav) { setEdit(null); return }
        const ri = flat.findIndex(x => x.gk === from.gk && x.rid === from.rid)
        const fi = editFields.findIndex(f => f.id === from.fid)
        let r = ri, c = fi
        if (nav === 'next') { c++; if (c >= editFields.length) { c = 0; r++ } }
        else if (nav === 'prev') { c--; if (c < 0) { c = editFields.length - 1; r-- } }
        else if (nav === 'down') r++
        const target = flat[r]
        setEdit(target && editFields[c] ? { ...target, fid: editFields[c].id } : null)
    }

    const onCellDone = (cell, field) => (result, nav) => {
        if (result) commitCell(cell.rid, field, result.value)
        if (result?.keepOpen) return
        go(cell, nav)
    }

    const startResize = (e, f) => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        const head = e.currentTarget.parentElement
        const startW = w(f)
        const ratio = head.getBoundingClientRect().width / startW || 1   // screen px per stored px (zoom × text size)
        const x0 = e.clientX
        const el = e.currentTarget
        el.setPointerCapture?.(e.pointerId)
        let cur = startW
        const move = (ev) => { cur = Math.round(Math.max(48, Math.min(900, startW + (ev.clientX - x0) / ratio))); setResize({ fid: f.id, w: cur }) }
        const up = () => {
            el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
            setResize(null)
            if (cur !== startW) cfg(c => ({ ...c, widths: { ...(c.widths || {}), [f.id]: cur } }))
        }
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    }

    const addRecord = () => {
        const text = adding.trim()
        if (primary && !text) return
        keepNew(source.add(primary ? { [primary.id]: text } : {}))
        setAdding('')
    }

    const nFilters = activeFilterCount(config, all)
    const nSorts = (config.sorts || []).filter(s => all.some(f => f.id === s.field)).length
    const nHidden = all.length - fields.length
    const menuField = menu?.fid && all.find(f => f.id === menu.fid)

    const renderRow = (g, rec) => {
        const v = rec.values || {}
        const hiddenByFilter = filteredIds && !filteredIds.has(rec.id)
        return (
            <div key={`${g.key}|${rec.id}`} role="row"
                className={`${styles.trow} ${hiddenByFilter ? styles.trowStale : ''}`}
                title={hiddenByFilter ? 'Just added — the filter hides it once you change the filter' : undefined}>
                <div className={styles.gutter}>
                    {source.canRemove && (
                        <button className={styles.rowDel} onClick={() => source.remove(rec.id)} title="Delete record" aria-label="Delete record"><LuX size={12} /></button>
                    )}
                </div>
                {fields.map(f => {
                    const val = v[f.id]
                    const canEdit = source.editable.has(f.id)
                    const isEditing = edit && edit.rid === rec.id && edit.gk === g.key && edit.fid === f.id
                    const align = f.type === 'number' ? styles.right : f.type === 'check' ? styles.center : ''
                    if (f.type === 'check') {
                        return (
                            <button key={f.id} role="gridcell" className={`${styles.cell} ${align}`} disabled={!canEdit}
                                onClick={() => source.update(rec.id, { [f.id]: val ? undefined : true })} aria-label={`${f.name}: ${val ? 'checked' : 'not checked'}`}>
                                <span className={`${styles.box} ${val ? styles.boxOn : ''}`}>{val && <LuCheck size={11} strokeWidth={3} />}</span>
                            </button>
                        )
                    }
                    if (isEditing && !hasOptions(f) && f.type !== 'long') {
                        return (
                            <div key={f.id} role="gridcell" className={`${styles.cell} ${styles.cellEditing}`}>
                                <CellEditor field={f} value={val} onDone={onCellDone(edit, f)} />
                            </div>
                        )
                    }
                    const href = (f.type === 'url' || f.type === 'email') && !isEmptyValue(val) ? hrefFor(f, val) : null
                    return (
                        <div key={f.id} role="gridcell" className={`${styles.cellWrap} ${isEditing ? styles.cellEditing : ''}`}>
                            <button className={`${styles.cell} ${align} ${config.wrap ? styles.wrap : ''}`} disabled={!canEdit}
                                ref={isEditing ? editAnchor : undefined}
                                title={f.type === 'long' || TEXTLIKE.has(f.type) ? cellText(f, val) || undefined : undefined}
                                onClick={(e) => { editAnchor.current = e.currentTarget; setEdit({ gk: g.key, rid: rec.id, fid: f.id }) }}>
                                <CellValue field={f} value={val} />
                            </button>
                            {href && (
                                <button className={styles.openLink} title={`Open ${href}`} aria-label="Open link" onClick={() => requestOpenExternal(href)}>
                                    <LuExternalLink size={11} />
                                </button>
                            )}
                            {isEditing && (
                                <CellEditor field={f} value={val} anchor={editAnchor} canCreate={!!source.fieldsEditable}
                                    onDone={onCellDone(edit, f)} />
                            )}
                        </div>
                    )
                })}
                <div />
            </div>
        )
    }

    const calcRow = (records, key) => (
        <div key={key} className={`${styles.trow} ${styles.calcRow}`} role="row">
            <div className={styles.gutter} />
            {fields.map(f => {
                const c = config.calcs?.[f.id]
                const label = c && calcsFor(f.type).find(x => x.id === c)?.label
                return (
                    <button key={f.id} className={`${styles.calcCell} ${c ? styles.calcOn : ''}`}
                        onClick={(e) => openMenu('calc', e, { fid: f.id })} title="Calculate this column">
                        {c ? <><span className={styles.calcLabel}>{label}</span> {calculate(records, f, c)}</> : <span className={styles.calcHint}>Calculate</span>}
                    </button>
                )
            })}
            <div />
        </div>
    )

    return (
        <div className={styles.table} style={{ '--cols': cols }}>
            <div className={styles.toolbar}>
                <button className={`${styles.tool} ${nFilters ? styles.toolOn : ''}`} onClick={(e) => openMenu('filter', e)} aria-label="Filter">
                    <LuFilter size={12} /> Filter{nFilters ? ` · ${nFilters}` : ''}
                </button>
                <button className={`${styles.tool} ${nSorts ? styles.toolOn : ''}`} onClick={(e) => openMenu('sort', e)} aria-label="Sort">
                    <LuArrowUpDown size={12} /> Sort{nSorts ? ` · ${nSorts}` : ''}
                </button>
                <button className={`${styles.tool} ${t.groupField ? styles.toolOn : ''}`} onClick={(e) => openMenu('group', e)} aria-label="Group">
                    <LuRows3 size={12} /> {t.groupField ? `Group · ${t.groupField.name}` : 'Group'}
                </button>
                <button className={`${styles.tool} ${nHidden ? styles.toolOn : ''}`} onClick={(e) => openMenu('fields', e)} aria-label="Fields">
                    <LuColumns3 size={12} /> Fields{nHidden ? ` · ${nHidden} hidden` : ''}
                </button>
                <span className={styles.grow} />
                {t.rows.length !== t.total && <span className={styles.count}>{t.rows.length} of {t.total}</span>}
            </div>

            {/* data-sb-scroll: the board's wheel scrolls this (both ways) instead of zooming. */}
            <div className={styles.scroll} data-sb-scroll="true" role="grid" aria-rowcount={t.rows.length}>
                <div className={styles.grid}>
                    <div className={`${styles.trow} ${styles.headRow}`} role="row">
                        <div className={styles.gutter} />
                        {fields.map(f => {
                            const sorted = (config.sorts || []).find(s => s.field === f.id)
                            return (
                                <div key={f.id} className={styles.head} role="columnheader">
                                    <button className={styles.headBtn} onClick={(e) => openMenu('field', e, { fid: f.id })} title={`${f.name} — field settings`}>
                                        <span className={styles.headName}>{f.name}</span>
                                        {sorted && (sorted.dir === 'desc' ? ' ↓' : ' ↑')}
                                    </button>
                                    <div className={styles.resizer} onPointerDown={(e) => startResize(e, f)} title="Drag to resize" />
                                </div>
                            )
                        })}
                        {source.fieldsEditable && source.canAddField ? (
                            <button className={styles.addField} onClick={(e) => openMenu('addField', e)} title="Add a field" aria-label="Add a field"><LuPlus size={13} /></button>
                        ) : <div />}
                    </div>

                    {source.missing && <div className={styles.empty}>That project is gone. Pick another source.</div>}
                    {!source.missing && t.total === 0 && (
                        <div className={styles.empty}>{source.type === 'own' ? 'No records yet — add one below.' : 'Nothing here for this filter.'}</div>
                    )}
                    {!source.missing && t.total > 0 && t.rows.length === 0 && <div className={styles.empty}>No records match the filter.</div>}

                    {t.groups.map(g => {
                        if (!t.groupField) return g.records.map(r => renderRow(g, r))
                        const open = !collapsed.has(g.key)
                        return (
                            <div key={g.key} className={styles.group}>
                                <button className={styles.groupHead}
                                    onClick={() => setCollapsed(s => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
                                    {open ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
                                    {g.key !== 'empty' && hasOptions(t.groupField) ? <OptionChip label={g.label} small /> : <span className={styles.groupLabel}>{g.label}</span>}
                                    <span className={styles.groupCount}>{g.records.length}</span>
                                </button>
                                {open && g.records.map(r => renderRow(g, r))}
                                {open && anyCalc && g.records.length > 0 && calcRow(g.records, `calc-${g.key}`)}
                            </div>
                        )
                    })}

                    {source.canAdd && (
                        <div className={`${styles.trow} ${styles.addRow}`}>
                            <div className={styles.gutter}><LuPlus size={12} /></div>
                            {primary ? (
                                <input className={styles.addInput} value={adding}
                                    placeholder={source.type === 'own' ? `New record — type a ${primary.name.toLowerCase()}, Enter` : 'New task — type a title, Enter'}
                                    aria-label="New record"
                                    onChange={(e) => setAdding(e.target.value)}
                                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') addRecord(); if (e.key === 'Escape') e.currentTarget.blur() }} />
                            ) : <button className={styles.addBtn} onClick={addRecord}>New record</button>}
                        </div>
                    )}
                    {t.rows.length > 0 && calcRow(t.rows, 'calc-all')}
                </div>
            </div>

            {menu && (
                <Popover anchor={menu.anchor} onClose={closeMenu}
                    width={menu.kind === 'filter' ? 440 : menu.kind === 'sort' ? 360 : 250}
                    label={menu.kind}>
                    {menu.kind === 'filter' && <FilterMenu fields={all} config={config} onConfig={cfg} />}
                    {menu.kind === 'sort' && <SortMenu fields={all} config={config} onConfig={cfg} />}
                    {menu.kind === 'group' && <GroupMenu fields={all} config={config} onConfig={cfg} onClose={closeMenu} />}
                    {menu.kind === 'fields' && <FieldsMenu fields={all} config={config} onConfig={cfg} />}
                    {menu.kind === 'field' && menuField && (
                        <FieldMenu field={menuField} fields={all} source={source} records={source.records} config={config} onConfig={cfg} onClose={closeMenu} />
                    )}
                    {menu.kind === 'addField' && <AddFieldMenu source={source} onAdded={closeMenu} />}
                    {menu.kind === 'calc' && menuField && <CalcMenu field={menuField} config={config} onConfig={cfg} onClose={closeMenu} />}
                </Popover>
            )}
        </div>
    )
}

export default memo(TableView)
