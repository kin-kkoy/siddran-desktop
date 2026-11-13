import { memo, useRef } from 'react'
import { LuCheck, LuTrash2, LuGripVertical, LuExternalLink, LuMaximize2 } from 'react-icons/lu'
import styles from '../../Table.module.css'
import Popover from '../../Popover'
import { cellText, isEmptyValue, TEXTLIKE, hasOptions } from '../../fields'
import { cellStyle } from '../../layout'
import { FONT_FAMILIES } from '../../../text/textStyle'
import { OptionPicker, OptionChip } from '../TableMenus'
import { AttachChip, AttachEditor } from './Attachments'
import { attKey } from './attachKinds'

/**
 * One table row, memoized: editing a cell re-renders only its own row
 * (TableView passes stable callbacks through `api` and the selection as plain
 * numbers). Cells are buttons so a press inside never selects the widget on
 * the board; the grid keeps keyboard focus (mousedown doesn't move it).
 */

const hrefFor = (field, v) => {
    const s = String(v || '').trim()
    if (!s) return null
    if (field.type === 'email') return /^mailto:/i.test(s) ? s : `mailto:${s}`
    return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
}

/** A cell style (layout.js) as CSS. */
function cellCss(st) {
    if (!st) return undefined
    const deco = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ')
    return {
        fontFamily: st.fontFamily ? FONT_FAMILIES[st.fontFamily]?.css : undefined,
        fontWeight: st.bold ? 700 : undefined,
        fontStyle: st.italic ? 'italic' : undefined,
        textDecoration: deco || undefined,
        color: st.color || undefined,
        backgroundColor: st.bg ? `color-mix(in srgb, ${st.bg} 30%, transparent)` : undefined,
        fontSize: st.scale ? `${(0.87 * st.scale).toFixed(3)}em` : undefined,
        justifyContent: st.textAlign === 'center' ? 'center' : st.textAlign === 'right' ? 'flex-end' : undefined,
        textAlign: st.textAlign || undefined,
    }
}

export function CellValue({ field, value, error, onOpen }) {
    if (error) return <span className={styles.fxError} title={error.message}>{error.code}</span>
    if (isEmptyValue(value)) return null
    switch (field.type) {
        case 'files': return <span className={styles.chips}>{(Array.isArray(value) ? value : []).map(a => <AttachChip key={attKey(a)} att={a} onOpen={onOpen} />)}</span>
        case 'select': return <OptionChip label={String(value)} small />
        case 'multi': return <span className={styles.chips}>{(Array.isArray(value) ? value : [value]).map(o => <OptionChip key={o} label={o} small />)}</span>
        case 'url': case 'email': return <span className={styles.link}>{String(value)}</span>
        default: return <span className={styles.cellText}>{cellText(field, value)}</span>
    }
}

/**
 * The editor for one cell. done({ value }) commits, done(null) cancels; `nav`
 * says where the selection goes next ('down', 'next', 'prev'). `seed` is a
 * key typed on a selected cell: it replaces the value, as in a spreadsheet.
 */
export function CellEditor({ field, value, seed, anchor, canCreate, onOpen, onDone }) {
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
        // Picking commits at once (one step each); closing the picker ends the edit.
        return (
            <Popover anchor={anchor} width={240} label={`${field.name} options`} onClose={() => finish(null)}>
                <OptionPicker field={field} value={value} query={seed || ''} canCreate={canCreate}
                    onChange={(v) => onDone({ value: v, keepOpen: true })} onClose={(nav) => finish(null, nav)} />
            </Popover>
        )
    }
    if (field.type === 'files') {
        // Each add or remove commits at once; closing just ends the edit.
        return (
            <Popover anchor={anchor} width={300} label={`${field.name} attachments`} onClose={() => finish(null)}>
                <AttachEditor value={value} onOpen={onOpen} onChange={(v) => onDone({ value: v, keepOpen: true })} />
            </Popover>
        )
    }
    const start = seed != null ? seed : null
    if (field.type === 'long') {
        // A press outside saves (as a blur would); only Esc throws the edit away.
        return (
            <Popover anchor={anchor} width={Math.max(300, anchor?.current?.offsetWidth || 0)} label={field.name}
                onClose={() => finish({ value: area.current?.value ?? value })} onEscape={() => finish(null)}>
                <textarea ref={area} className={styles.longEditor} autoFocus defaultValue={start ?? value ?? ''} aria-label={field.name}
                    onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
                    onKeyDown={keys} onBlur={(e) => finish({ value: e.currentTarget.value })} />
                <div className={styles.popNote}>Enter saves · Shift+Enter for a new line · Esc cancels</div>
            </Popover>
        )
    }
    const raw = field.type === 'number' ? (typeof value === 'number' ? String(value) : '') : (value ?? '')
    return (
        <input className={styles.cellInput} autoFocus defaultValue={field.type === 'date' ? raw : start ?? raw} aria-label={field.name}
            type={field.type === 'date' ? 'date' : 'text'}
            inputMode={field.type === 'number' ? 'decimal' : undefined}
            onFocus={(e) => {
                if (e.currentTarget.type !== 'text') return
                // The caret at the end, ready to type (not the whole value selected).
                const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={keys} onBlur={(e) => finish({ value: e.currentTarget.value })} />
    )
}

const noFocus = (e) => e.preventDefault()   // keep keyboard focus on the grid

function Row({ rec, gk, ri, fields, wrap, st, editFid, editSeed, selC0 = -1, selC1 = -1, focusC = -1, rowSel, editable,
    canRemove, canCreate, drop, dragging, stale, api }) {
    const editRef = useRef(null)
    const v = rec.values || {}
    const cls = [styles.trow, dragging && styles.dragging, drop === 'before' && styles.dropBefore, drop === 'after' && styles.dropAfter,
        rowSel && styles.rowSel, stale && styles.trowStale].filter(Boolean).join(' ')
    return (
        <div data-vkey={`${gk}|${rec.id}`} data-ri={ri} role="row" className={cls}
            title={stale ? 'Just added — the filter hides it once you change the filter' : undefined}>
            <div className={styles.gutter}>
                <button className={styles.grip} onMouseDown={noFocus} onPointerDown={(e) => api.gripDown(e, ri, rec.id)}
                    title="Select the row · drag to move it" aria-label="Select row">
                    <LuGripVertical size="1em" />
                </button>
                <button className={styles.expand} onMouseDown={noFocus} onPointerDown={(e) => e.stopPropagation()} onClick={() => api.openDetail(rec.id)}
                    title="Open the record (Space)" aria-label="Open record">
                    <LuMaximize2 size="0.85em" />
                </button>
            </div>
            {fields.map((f, ci) => {
                const val = v[f.id]
                const canEdit = editable.has(f.id)
                const inSel = ci >= selC0 && ci <= selC1
                const css = cellCss(cellStyle(st, rec.id, f.id))
                const wrapCls = [styles.cellWrap, inSel && styles.cellSel, ci === focusC && styles.cellFocus, editFid === f.id && styles.cellEditing].filter(Boolean).join(' ')
                const align = f.type === 'number' || f.type === 'formula' ? styles.right : f.type === 'check' ? styles.center : ''
                if (editFid === f.id && !hasOptions(f) && f.type !== 'long' && f.type !== 'check' && f.type !== 'files') {
                    return (
                        <div key={f.id} role="gridcell" className={wrapCls} style={css}>
                            <CellEditor field={f} value={val} seed={editSeed} onDone={(r, nav) => api.cellDone(rec.id, gk, f, r, nav)} />
                        </div>
                    )
                }
                const href = (f.type === 'url' || f.type === 'email') && !isEmptyValue(val) ? hrefFor(f, val) : null
                return (
                    <div key={f.id} role="gridcell" className={wrapCls} ref={editFid === f.id ? editRef : undefined}
                        style={css?.backgroundColor ? { backgroundColor: css.backgroundColor } : undefined}>
                        <button className={`${styles.cell} ${align} ${wrap ? styles.wrap : ''}`} style={css}
                            onMouseDown={noFocus}
                            onPointerDown={(e) => api.cellDown(e, ri, ci)}
                            onPointerEnter={() => api.cellEnter(ri, ci)}
                            onDoubleClick={() => api.startEdit(ri, ci)}
                            onClick={f.type === 'check' && canEdit ? () => api.toggle(rec.id, f.id, !val) : undefined}
                            aria-disabled={!canEdit || undefined}
                            title={f.type === 'formula' ? `= ${f.expr || ''}` : TEXTLIKE.has(f.type) ? cellText(f, val) || undefined : undefined}>
                            {f.type === 'check'
                                ? <span className={`${styles.box} ${val ? styles.boxOn : ''}`}>{val && <LuCheck size={11} strokeWidth={3} />}</span>
                                : <CellValue field={f} value={val} error={rec.errors?.[f.id]} onOpen={api.openAttachment} />}
                        </button>
                        {href && (
                            <button className={styles.openLink} title={`Open ${href}`} aria-label="Open link" onMouseDown={noFocus}
                                onPointerDown={(e) => e.stopPropagation()} onClick={() => api.openLink(href)}>
                                <LuExternalLink size={11} />
                            </button>
                        )}
                        {editFid === f.id && (
                            <CellEditor field={f} value={val} seed={editSeed} anchor={editRef} canCreate={canCreate} onOpen={api.openAttachment}
                                onDone={(r, nav) => api.cellDone(rec.id, gk, f, r, nav)} />
                        )}
                    </div>
                )
            })}
            <div className={styles.rowEnd}>
                {canRemove && (
                    <button className={styles.rowDel} onMouseDown={noFocus} onClick={() => api.remove(rec.id)} title="Delete record" aria-label="Delete record">
                        <LuTrash2 size="1em" />
                    </button>
                )}
            </div>
        </div>
    )
}

// Linked tasks rebuild their records on every change, so a row also counts as
// unchanged when its values are the same.
const sameRec = (a, b) => a === b || (a.id === b.id && JSON.stringify(a.values) === JSON.stringify(b.values) && JSON.stringify(a.errors) === JSON.stringify(b.errors))
function equal(p, n) {
    for (const k in n) {
        if (k === 'rec') { if (!sameRec(p.rec, n.rec)) return false } else if (p[k] !== n[k]) return false
    }
    return true
}

export default memo(Row, equal)
