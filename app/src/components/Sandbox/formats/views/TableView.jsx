import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuFilter, LuArrowUpDown, LuRows3, LuColumns3, LuPlus, LuChevronRight, LuChevronDown, LuEllipsisVertical } from 'react-icons/lu'
import styles from '../Table.module.css'
import Popover from '../Popover'
import { tableConfig, tableRows, calculate, activeFilterCount, calcsFor } from '../query'
import { coerceValue, TEXTLIKE, hasOptions } from '../fields'
import { selRange, applyStyle, cellStyle, rangeToTSV, moveColumn, orderRecords } from '../layout'
import { FilterMenu, SortMenu, GroupMenu, FieldsMenu, FieldMenu, AddFieldMenu, CalcMenu, OptionChip } from './TableMenus'
import Row from './table/Row'
import StyleBar from './table/StyleBar'
import { useVirtualRows } from './table/useVirtualRows'
import { requestOpenExternal } from '../../../../desktop/openExternal'

/**
 * The Table view (spec §13.4): records as rows, fields as typed columns,
 * with filter, sort, group, hidden fields, widths, column order, fonts and
 * footer calculations kept as view settings (payload.table: query.js,
 * layout.js).
 *
 * Reads and writes only through `source` (dataSource.js), so the same table
 * works over own records and linked tasks.
 *
 * Like a spreadsheet: a click selects a cell; a double-click (one tap on a
 * touch screen, or Enter / F2) edits it, with the caret at the end. Arrows move, Shift extends, drag
 * selects a block; the row grip selects a row, a column header its column, the
 * corner everything. Tab / Enter commit and move on, Esc cancels; Delete
 * clears; Ctrl+C copies the block as text; Ctrl+B/I/U style it. Rows drag
 * by their grip, columns by their header.
 *
 * Long tables draw only the rows in view (table/useVirtualRows.js), and an
 * edit re-renders only its own row (table/Row.jsx).
 */

// Column widths in px at the default 15 px text; drawn in em so they grow with the widget's text size.
const BASE_FONT = 15
const DEFAULT_W = { text: 160, long: 220, number: 96, select: 124, multi: 170, date: 124, check: 76, url: 170, email: 180 }
const widthOf = (f, config) => config.widths?.[f.id] ?? (f.id === 'title' ? 220 : DEFAULT_W[f.type] || 160)
const em = (px) => `${(px / BASE_FONT).toFixed(3)}em`
const DRAG_PX = 5

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return } catch { /* fall back below */ }
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } finally { ta.remove() }
}

function TableView({ source, item, onConfig }) {
    const config = tableConfig(item?.payload)
    // Records added here since the filter last changed stay shown even if it would hide them
    // (they'd vanish as you type them otherwise). Changing the filter lets it hide them.
    const [kept, setKept] = useState({ sig: '', ids: new Set() })
    const [edit, setEdit] = useState(null)        // { rid, gk, fid, seed }
    const [sel, setSel] = useState(null)          // { mode: 'cells'|'rows'|'cols'|'all', a: {ri, ci}, b: {ri, ci} }
    const [collapsed, setCollapsed] = useState(() => new Set())
    const [menu, setMenu] = useState(null)        // { kind, anchor, fid? }
    const [resize, setResize] = useState(null)    // { fid, w } while a column edge is dragged
    const [rowDrag, setRowDragState] = useState(null)  // { rid, overKey, overRid, place }
    const [colDrag, setColDragState] = useState(null)  // { fid, over, place }
    // Mirrored in refs so a drop reads the latest without side effects inside a state updater.
    const rowDragRef = useRef(null), colDragRef = useRef(null)
    const setRowDrag = (v) => { rowDragRef.current = v; setRowDragState(v) }
    const setColDrag = (v) => { colDragRef.current = v; setColDragState(v) }
    const [adding, setAdding] = useState('')
    const rootRef = useRef(null), gridRef = useRef(null), bodyRef = useRef(null), headRef = useRef(null)
    const dragSel = useRef(false)

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
    const cols = ['2.2em', ...fields.map(f => em(w(f))), '2.4em'].join(' ')
    const primary = all.find(f => f.id === 'title') || all.find(f => TEXTLIKE.has(f.type))
    const anyCalc = fields.some(f => config.calcs?.[f.id])
    const wrap = config.wrap !== false   // wrapping is the default; the Fields menu can turn it off
    const sorted = (config.sorts || []).some(s => all.some(f => f.id === s.field))
    const canReorder = !!source.canReorder && !sorted

    // Rows as they're shown (collapsed groups left out) — selection indexes into this.
    const flatRows = useMemo(() => t.groups.flatMap(g => collapsed.has(g.key) ? [] : g.records.map(rec => ({ gk: g.key, rec }))), [t.groups, collapsed])
    // Everything in the body, in order: group heads, rows, group totals.
    const items = useMemo(() => {
        const out = []
        let ri = 0
        for (const g of t.groups) {
            const open = !collapsed.has(g.key)
            if (t.groupField) out.push({ key: `g:${g.key}`, kind: 'group', g, open })
            if (!open) continue
            for (const rec of g.records) out.push({ key: `${g.key}|${rec.id}`, kind: 'row', gk: g.key, rec, ri: ri++ })
            if (t.groupField && anyCalc && g.records.length) out.push({ key: `c:${g.key}`, kind: 'gcalc', g })
        }
        return out
    }, [t.groups, t.groupField, collapsed, anyCalc])
    const virt = useVirtualRows(items, gridRef, bodyRef)
    const range = selRange(sel, flatRows.length, fields.length)

    // ---- selection helpers ----
    const focusGrid = () => gridRef.current?.focus({ preventScroll: true })
    const cellAt = (ri, ci) => ({ row: flatRows[ri], field: fields[ci] })
    const ensureVisible = (ri, ci) => {
        const sc = gridRef.current, body = bodyRef.current
        if (!sc || !body) return
        const headH = headRef.current?.offsetHeight || 0
        const footH = 34
        const idx = items.findIndex(x => x.kind === 'row' && x.ri === ri)
        if (idx >= 0) {
            let top, h
            const el = body.querySelector(`:scope > [data-ri="${ri}"]`)
            if (el) { top = el.offsetTop; h = el.offsetHeight } else { top = virt.offsetOf(idx); h = virt.heightOf(idx) }
            top += body.offsetTop
            if (top < sc.scrollTop + headH) sc.scrollTop = top - headH
            else if (top + h > sc.scrollTop + sc.clientHeight - footH) sc.scrollTop = top + h - sc.clientHeight + footH
        }
        const hc = headRef.current?.children[1 + ci]
        if (hc) {
            if (hc.offsetLeft < sc.scrollLeft) sc.scrollLeft = hc.offsetLeft
            else if (hc.offsetLeft + hc.offsetWidth > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = hc.offsetLeft + hc.offsetWidth - sc.clientWidth
        }
    }
    const selectCell = (ri, ci, extend = false) => {
        const p = { ri: Math.max(0, Math.min(flatRows.length - 1, ri)), ci: Math.max(0, Math.min(fields.length - 1, ci)) }
        setSel(s => (extend && s ? { ...s, mode: s.mode === 'all' ? 'cells' : s.mode, b: p } : { mode: 'cells', a: p, b: p }))
        requestAnimationFrame(() => ensureVisible(p.ri, p.ci))
    }
    const styleTarget = () => {
        if (!range || !sel) return null
        if (sel.mode === 'cols' || sel.mode === 'all') return { cols: fields.slice(range.c0, range.c1 + 1).map(f => f.id) }
        if (sel.mode === 'rows') return { rows: flatRows.slice(range.r0, range.r1 + 1).map(x => x.rec.id) }
        const cells = []
        for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) cells.push([flatRows[r].rec.id, fields[c].id])
        return { cells }
    }
    const curStyle = (() => {
        if (!sel || !range) return null
        const f = fields[Math.min(sel.b.ci, fields.length - 1)]
        if (sel.mode === 'cols' || sel.mode === 'all') return config.styles?.col?.[f?.id] || null
        const row = flatRows[Math.min(sel.b.ri, flatRows.length - 1)]
        if (sel.mode === 'rows') return config.styles?.row?.[row?.rec.id] || null
        return row && f ? cellStyle(config.styles, row.rec.id, f.id) : null
    })()
    const applySel = (patch) => {
        const target = styleTarget()
        if (target) cfg(c => ({ ...c, styles: applyStyle(c.styles, target, patch) }))
    }

    // ---- editing ----
    const commitCell = (rid, field, raw) => {
        const rec = source.records.find(r => r.id === rid)
        if (!rec) return
        const v = coerceValue(field, raw)
        if (JSON.stringify(v) === JSON.stringify(rec.values?.[field.id])) return
        source.update(rid, { [field.id]: v })
    }
    const startEdit = (ri, ci, seed = null) => {
        const { row, field } = cellAt(ri, ci)
        if (!row || !field || !source.editable.has(field.id)) return
        setSel({ mode: 'cells', a: { ri, ci }, b: { ri, ci } })
        if (field.type === 'check') { source.update(row.rec.id, { [field.id]: row.rec.values?.[field.id] ? undefined : true }); return }
        setEdit({ rid: row.rec.id, gk: row.gk, fid: field.id, seed })
    }
    const clearRange = () => {
        if (!range) return
        const list = []
        for (let r = range.r0; r <= range.r1; r++) {
            const rec = flatRows[r].rec, patch = {}
            for (let c = range.c0; c <= range.c1; c++) {
                const f = fields[c]
                if (!source.editable.has(f.id) || (source.type !== 'own' && f.id === 'title')) continue
                if (rec.values?.[f.id] !== undefined) patch[f.id] = undefined
            }
            if (Object.keys(patch).length) list.push({ id: rec.id, patch })
        }
        if (!list.length) return
        if (source.updateMany) source.updateMany(list); else list.forEach(x => source.update(x.id, x.patch))
    }

    // ---- pointer drags: rows by the grip, columns by the header ----
    const autoScroll = (sc, ev) => {
        const r = sc.getBoundingClientRect()
        if (ev.clientY < r.top + 36) sc.scrollTop -= 12
        else if (ev.clientY > r.bottom - 30) sc.scrollTop += 12
        if (ev.clientX < r.left + 30) sc.scrollLeft -= 12
        else if (ev.clientX > r.right - 30) sc.scrollLeft += 12
    }
    const trackDrag = (e, { onMove, onDrop, onClick }) => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        focusGrid()
        const x0 = e.clientX, y0 = e.clientY, shift = e.shiftKey
        let dragging = false
        // On the window, so the release counts wherever it happens.
        const move = (ev) => {
            if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_PX) return
            dragging = onMove(ev, !dragging) !== false
        }
        const up = (ev) => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
            if (dragging && ev.type === 'pointerup') onDrop(ev); else if (!dragging) onClick(shift); else onDrop(null)
        }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    }
    const gripDown = (e, ri, rid) => trackDrag(e, {
        onMove: (ev) => {
            if (!canReorder) return false
            const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-ri]')
            autoScroll(gridRef.current, ev)
            if (!row || !bodyRef.current?.contains(row)) { setRowDrag({ ...rowDragRef.current, rid }); return }
            const r = row.getBoundingClientRect()
            const key = row.getAttribute('data-vkey')
            setRowDrag({ rid, overKey: key, overRid: key.slice(key.indexOf('|') + 1), place: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' })
        },
        onDrop: (ev) => {
            const d = rowDragRef.current
            setRowDrag(null)
            if (!ev || !d?.overRid || d.overRid === d.rid) return
            // Before the row under the pointer, or before the record after it (in the full order, filtered-out ones included).
            const seq = orderRecords(source.records).map(r => r.id).filter(id => id !== d.rid)
            const before = d.place === 'before' ? d.overRid : seq[seq.indexOf(d.overRid) + 1] ?? null
            source.moveRecord?.(d.rid, before)
        },
        onClick: (shift) => {
            setEdit(null)
            setSel(s => (shift && s?.mode === 'rows' ? { ...s, b: { ri, ci: 0 } } : { mode: 'rows', a: { ri, ci: 0 }, b: { ri, ci: fields.length - 1 } }))
        },
    })
    const headDown = (e, ci, fid) => trackDrag(e, {
        onMove: (ev) => {
            const hc = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-col]')
            autoScroll(gridRef.current, ev)
            if (!hc || !headRef.current?.contains(hc)) { setColDrag({ ...colDragRef.current, fid }); return }
            const r = hc.getBoundingClientRect()
            setColDrag({ fid, over: hc.getAttribute('data-col'), place: ev.clientX < r.left + r.width / 2 ? 'before' : 'after' })
        },
        onDrop: (ev) => {
            const d = colDragRef.current
            setColDrag(null)
            if (!ev || !d?.over || d.over === d.fid) return
            // The full order (hidden fields included), with the dragged one beside the column it was dropped on.
            const ids = t.ordered.map(f => f.id).filter(id => id !== d.fid)
            const i = ids.indexOf(d.over) + (d.place === 'after' ? 1 : 0)
            ids.splice(i, 0, d.fid)
            cfg(c => ({ ...c, fieldOrder: ids }))
        },
        onClick: (shift) => {
            setEdit(null)
            setSel(s => (shift && s?.mode === 'cols' ? { ...s, b: { ri: 0, ci } } : { mode: 'cols', a: { ri: 0, ci }, b: { ri: 0, ci } }))
        },
    })
    const moveField = (fid, toVisibleIndex) => {
        const target = t.ordered[toVisibleIndex]
        if (!target) return
        cfg(c => ({ ...c, fieldOrder: moveColumn(t.ordered, fid, t.ordered.indexOf(target)) }))
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

    // ---- the callbacks rows get: one stable object reading the latest state ----
    const act = useRef(null)
    act.current = {
        cellDown: (e, ri, ci) => {
            if (e.button !== 0) return
            e.stopPropagation()
            // A press elsewhere ends an inline edit (the mousedown that would blur it is held back).
            const ae = document.activeElement
            if (ae && ae !== gridRef.current && gridRef.current?.contains(ae) && ae.tagName === 'INPUT') ae.blur()
            focusGrid()
            if (e.shiftKey && sel) { selectCell(ri, ci, true); return }
            // A finger can't double-tap comfortably: one tap edits (and brings up the on-screen keyboard).
            if (e.pointerType === 'touch' && fields[ci]?.type !== 'check') { startEdit(ri, ci); return }
            selectCell(ri, ci)
            dragSel.current = true
            const stop = () => { dragSel.current = false; window.removeEventListener('pointerup', stop, true) }
            window.addEventListener('pointerup', stop, true)
        },
        cellEnter: (ri, ci) => { if (dragSel.current) setSel(s => s && { ...s, mode: 'cells', b: { ri, ci } }) },
        startEdit: (ri, ci) => startEdit(ri, ci),
        toggle: (rid, fid, on) => source.update(rid, { [fid]: on || undefined }),
        cellDone: (rid, gk, field, result, nav) => {
            if (result) commitCell(rid, field, result.value)
            if (result?.keepOpen) return
            setEdit(null)
            const ri = flatRows.findIndex(x => x.gk === gk && x.rec.id === rid)
            const ci = fields.findIndex(f => f.id === field.id)
            if (ri >= 0 && ci >= 0) {
                if (nav === 'down') selectCell(ri + 1, ci)
                else if (nav === 'next') selectCell(ci + 1 < fields.length ? ri : ri + 1, ci + 1 < fields.length ? ci + 1 : 0)
                else if (nav === 'prev') selectCell(ci > 0 ? ri : ri - 1, ci > 0 ? ci - 1 : fields.length - 1)
                else selectCell(ri, ci)
            }
            requestAnimationFrame(focusGrid)
        },
        gripDown, openLink: (href) => requestOpenExternal(href),
        remove: (rid) => { setSel(null); source.remove(rid) },
    }
    const api = useMemo(() => {
        const out = {}
        for (const k of ['cellDown', 'cellEnter', 'startEdit', 'toggle', 'cellDone', 'gripDown', 'openLink', 'remove']) out[k] = (...a) => act.current[k](...a)
        return out
    }, [])

    // ---- keys on the grid (when no cell editor has them) ----
    const onKeyDown = (e) => {
        const mod = e.ctrlKey || e.metaKey
        if (mod && ['z', 'y', 'Z', 'Y'].includes(e.key)) return   // the board's undo
        if (mod && !['a', 'b', 'i', 'u', 'c'].includes(e.key.toLowerCase())) return
        if (e.key === 'Escape') {
            if (!sel) return   // nothing selected: let it reach the board / full screen
            e.stopPropagation(); setSel(null); return
        }
        e.stopPropagation()   // every other key stays in the table (board shortcuts would fire otherwise)
        if (mod) {
            const k = e.key.toLowerCase()
            e.preventDefault()
            if (k === 'a') { if (flatRows.length) setSel({ mode: 'all', a: { ri: 0, ci: 0 }, b: { ri: flatRows.length - 1, ci: fields.length - 1 } }) }
            else if (k === 'c') { if (range) copyText(rangeToTSV(flatRows.map(x => x.rec), fields, range)) }
            else if (sel) applySel({ [{ b: 'bold', i: 'italic', u: 'underline' }[k]]: !curStyle?.[{ b: 'bold', i: 'italic', u: 'underline' }[k]] })
            return
        }
        if (!sel || !flatRows.length) return
        const { ri, ci } = sel.b
        const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
        if (moves[e.key]) {
            e.preventDefault()
            const [dr, dc] = moves[e.key]
            if (e.shiftKey) selectCell(ri + dr, ci + dc, true)
            else if (sel.mode === 'cells') selectCell(ri + dr, ci + dc)
            else selectCell(sel.mode === 'cols' ? 0 : ri + dr, sel.mode === 'rows' ? 0 : ci + dc)
            return
        }
        if (e.key === 'Tab') {
            e.preventDefault()
            if (e.shiftKey) selectCell(ci > 0 ? ri : ri - 1, ci > 0 ? ci - 1 : fields.length - 1)
            else selectCell(ci + 1 < fields.length ? ri : ri + 1, ci + 1 < fields.length ? ci + 1 : 0)
            return
        }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(ri, ci); return }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearRange(); return }
        if (e.key === ' ' && fields[ci]?.type === 'check') { e.preventDefault(); startEdit(ri, ci); return }
        // Typing on a selected cell does nothing: editing starts with a double-click (the user's call).
    }

    // A press outside the widget (and outside its menus) ends the selection.
    useEffect(() => {
        if (!sel) return
        const onDown = (e) => {
            if (rootRef.current?.closest('[data-sb-id], [role="dialog"]')?.contains(e.target)) return
            if (e.target.closest?.('[data-sb-handle="true"]')) return
            setSel(null)
        }
        window.addEventListener('pointerdown', onDown, true)
        return () => window.removeEventListener('pointerdown', onDown, true)
    }, [sel])

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
    const colSel = range && sel && (sel.mode === 'cols' || sel.mode === 'all')

    const calcRow = (records, key, extra = '') => (
        <div key={key} data-vkey={key} className={`${styles.trow} ${styles.calcRow} ${extra}`} role="row">
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

    const renderItem = (it) => {
        if (it.kind === 'group') {
            const g = it.g
            return (
                <button key={it.key} data-vkey={it.key} className={styles.groupHead}
                    onClick={() => setCollapsed(s => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
                    {it.open ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
                    {g.key !== 'empty' && hasOptions(t.groupField) ? <OptionChip label={g.label} small /> : <span className={styles.groupLabel}>{g.label}</span>}
                    <span className={styles.groupCount}>{g.records.length}</span>
                </button>
            )
        }
        if (it.kind === 'gcalc') return calcRow(it.g.records, it.key, styles.gcalc)
        const { rec, gk, ri } = it
        const inRange = range && ri >= range.r0 && ri <= range.r1
        const editing = edit && edit.rid === rec.id && edit.gk === gk
        return (
            <Row key={it.key} rec={rec} gk={gk} ri={ri} fields={fields} wrap={wrap} st={config.styles}
                editFid={editing ? edit.fid : null} editSeed={editing ? edit.seed : null}
                selC0={inRange ? range.c0 : -1} selC1={inRange ? range.c1 : -1}
                focusC={sel && sel.b.ri === ri && sel.mode === 'cells' ? sel.b.ci : -1}
                rowSel={!!(inRange && (sel.mode === 'rows' || sel.mode === 'all'))}
                editable={source.editable} canRemove={source.canRemove} canCreate={!!source.fieldsEditable}
                drop={rowDrag?.overKey === it.key && rowDrag.overRid !== rowDrag.rid ? rowDrag.place : null}
                dragging={rowDrag?.rid === rec.id} stale={!!(filteredIds && !filteredIds.has(rec.id))} api={api} />
        )
    }

    const shown = virt.on ? items.slice(virt.first, virt.last + 1) : items

    return (
        <div ref={rootRef} className={styles.table} style={{ '--cols': cols }}>
            <div className={styles.toolbar}>
                <button className={`${styles.tool} ${nFilters ? styles.toolOn : ''}`} onClick={(e) => openMenu('filter', e)} aria-label="Filter">
                    <LuFilter size="1em" /> Filter{nFilters ? ` · ${nFilters}` : ''}
                </button>
                <button className={`${styles.tool} ${nSorts ? styles.toolOn : ''}`} onClick={(e) => openMenu('sort', e)} aria-label="Sort">
                    <LuArrowUpDown size="1em" /> Sort{nSorts ? ` · ${nSorts}` : ''}
                </button>
                <button className={`${styles.tool} ${t.groupField ? styles.toolOn : ''}`} onClick={(e) => openMenu('group', e)} aria-label="Group">
                    <LuRows3 size="1em" /> {t.groupField ? `Group · ${t.groupField.name}` : 'Group'}
                </button>
                <button className={`${styles.tool} ${nHidden ? styles.toolOn : ''}`} onClick={(e) => openMenu('fields', e)} aria-label="Fields">
                    <LuColumns3 size="1em" /> Fields{nHidden ? ` · ${nHidden} hidden` : ''}
                </button>
                {t.rows.length !== t.total && <span className={styles.count}>{t.rows.length} of {t.total}</span>}
                <span className={styles.grow} />
                <StyleBar cur={curStyle} enabled={!!range} apply={applySel} label="Format the selected cells" />
            </div>

            {/* data-sb-scroll: the board's wheel scrolls this (both ways) instead of zooming. */}
            <div ref={gridRef} className={styles.scroll} data-sb-scroll="true" role="grid" aria-rowcount={t.rows.length}
                aria-multiselectable="true" tabIndex={0} onKeyDown={onKeyDown}>
                <div className={styles.grid}>
                    <div ref={headRef} className={`${styles.trow} ${styles.headRow}`} role="row">
                        <button className={styles.corner} title="Select everything (Ctrl+A)" aria-label="Select all"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { focusGrid(); if (flatRows.length) setSel({ mode: 'all', a: { ri: 0, ci: 0 }, b: { ri: flatRows.length - 1, ci: fields.length - 1 } }) }} />
                        {fields.map((f, ci) => {
                            const s = (config.sorts || []).find(x => x.field === f.id)
                            const on = colSel && ci >= range.c0 && ci <= range.c1
                            const drop = colDrag?.over === f.id && colDrag.fid !== f.id ? colDrag.place : null
                            return (
                                <div key={f.id} data-col={f.id} role="columnheader"
                                    className={[styles.head, on && styles.headSel, colDrag?.fid === f.id && styles.dragging, drop === 'before' && styles.dropLeft, drop === 'after' && styles.dropRight].filter(Boolean).join(' ')}>
                                    <button className={styles.headBtn} onMouseDown={(e) => e.preventDefault()}
                                        onPointerDown={(e) => headDown(e, ci, f.id)}
                                        onContextMenu={(e) => { e.preventDefault(); openMenu('field', e, { fid: f.id }) }}
                                        title={`${f.name} — click to select the column, drag to move it`}>
                                        <span className={styles.headName}>{f.name}</span>
                                        {s && (s.dir === 'desc' ? ' ↓' : ' ↑')}
                                    </button>
                                    <button className={styles.headMenu} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}
                                        onClick={(e) => openMenu('field', e, { fid: f.id })} title={`${f.name} — field settings`} aria-label={`${f.name} settings`}>
                                        <LuEllipsisVertical size="1em" />
                                    </button>
                                    <div className={styles.resizer} onPointerDown={(e) => startResize(e, f)} title="Drag to resize" />
                                </div>
                            )
                        })}
                        {source.fieldsEditable && source.canAddField ? (
                            <button className={styles.addField} onClick={(e) => openMenu('addField', e)} title="Add a field" aria-label="Add a field"><LuPlus size="1.15em" /></button>
                        ) : <div />}
                    </div>

                    <div ref={bodyRef} className={styles.body}>
                        {virt.on && virt.padTop > 0 && <div style={{ height: virt.padTop }} aria-hidden="true" />}
                        {shown.map(renderItem)}
                        {virt.on && virt.padBottom > 0 && <div style={{ height: virt.padBottom }} aria-hidden="true" />}
                    </div>

                    {source.missing && <div className={styles.empty}>That project is gone. Pick another source.</div>}
                    {!source.missing && t.total === 0 && (
                        <div className={styles.empty}>{source.type === 'own' ? 'No records yet — add one below.' : 'Nothing here for this filter.'}</div>
                    )}
                    {!source.missing && t.total > 0 && t.rows.length === 0 && <div className={styles.empty}>No records match the filter.</div>}

                    {source.canAdd && (
                        <div className={`${styles.trow} ${styles.addRow}`}>
                            <div className={`${styles.gutter} ${styles.addMark}`}><LuPlus size="1.1em" /></div>
                            {primary ? (
                                <input className={styles.addInput} value={adding}
                                    placeholder={source.type === 'own' ? `New record — type a ${primary.name.toLowerCase()}, Enter` : 'New task — type a title, Enter'}
                                    aria-label="New record"
                                    onFocus={() => setSel(null)}
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
                    {menu.kind === 'fields' && <FieldsMenu fields={t.ordered} config={config} onConfig={cfg} />}
                    {menu.kind === 'field' && menuField && (
                        <FieldMenu field={menuField} fields={t.ordered} source={source} records={source.records} config={config} onConfig={cfg}
                            onMove={moveField} onClose={closeMenu} />
                    )}
                    {menu.kind === 'addField' && <AddFieldMenu source={source} onAdded={closeMenu} />}
                    {menu.kind === 'calc' && menuField && <CalcMenu field={menuField} config={config} onConfig={cfg} onClose={closeMenu} />}
                </Popover>
            )}
        </div>
    )
}

export default memo(TableView)
