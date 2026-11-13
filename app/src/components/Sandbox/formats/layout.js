/**
 * A Table's layout: column order, row order, cell styles, and the range a
 * selection covers. All pure.
 *
 * Column order is a view setting (`payload.table.fieldOrder`), so it works the
 * same for own records and linked tasks and never rewrites the fields. Row
 * order is the records' own: each may carry `order` (a number). A move sets
 * only the moved record's `order`, so two copies of a board still merge record
 * by record (records without one keep their place in the array).
 *
 * Styles (`payload.table.styles`) are like a text box's: { fontFamily, bold,
 * italic, underline, strike, color, bg, scale, textAlign }, kept per column,
 * per row and per cell. A cell's look is column < row < cell.
 */
import { cellText } from './fields'

// ---- columns ----

/** Fields in the view's order; any not named keep their place after those that are. */
export function orderFields(fields, order) {
    if (!order?.length) return fields
    const rank = new Map(order.map((id, i) => [id, i]))
    return fields.map((f, i) => [f, rank.has(f.id) ? rank.get(f.id) : order.length + i]).sort((a, b) => a[1] - b[1]).map(([f]) => f)
}

/** The full column order after moving `id` to `index` (an index into `ordered`). */
export function moveColumn(ordered, id, index) {
    const ids = ordered.map(f => f.id)
    const from = ids.indexOf(id)
    if (from < 0) return ids
    ids.splice(from, 1)
    ids.splice(Math.max(0, Math.min(ids.length, index)), 0, id)
    return ids
}

// ---- rows ----

const effOrder = (r, i) => (typeof r.order === 'number' ? r.order : i)

/** Records in their own order (`order`, else array position). */
export function orderRecords(records) {
    if (!records.some(r => typeof r.order === 'number')) return records
    return records.map((r, i) => [r, effOrder(r, i)]).sort((a, b) => a[1] - b[1] || 0).map(([r]) => r)
}

/**
 * Move record `id` to just before `beforeId` (null = to the end). Records
 * without an `order` first get their array position as one (`order` only;
 * their values and stamps are untouched), then the moved one takes the
 * midpoint of its new neighbours.
 */
export function moveRecord(payload, id, beforeId, { at = new Date().toISOString() } = {}) {
    if (id === beforeId) return payload
    let records = payload.records || []
    if (records.some(r => typeof r.order !== 'number')) records = records.map((r, i) => (typeof r.order === 'number' ? r : { ...r, order: i }))
    const seq = orderRecords(records).filter(r => r.id !== id)
    const at_ = beforeId == null ? seq.length : seq.findIndex(r => r.id === beforeId)
    if (at_ < 0) return payload
    const prev = seq[at_ - 1], next = seq[at_]
    const order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : 0
    return { ...payload, records: records.map(r => (r.id === id ? { ...r, order, updated_at: at } : r)) }
}

// ---- styles ----

export const STYLE_KEYS = ['fontFamily', 'bold', 'italic', 'underline', 'strike', 'color', 'bg', 'scale', 'textAlign']
const cellKey = (rid, fid) => `${rid}|${fid}`

/** A cell's own look: column, then row, then cell. */
export function cellStyle(styles, rid, fid) {
    if (!styles) return null
    const c = styles.col?.[fid], r = styles.row?.[rid], x = styles.cell?.[cellKey(rid, fid)]
    if (!c && !r && !x) return null
    return { ...c, ...r, ...x }
}

const merge = (base, patch) => {
    const out = { ...base }
    for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === false) delete out[k]; else out[k] = v
    }
    return Object.keys(out).length ? out : undefined
}
const put = (map = {}, key, patch) => {
    const next = { ...map }
    const v = merge(map[key], patch)
    if (v) next[key] = v; else delete next[key]
    return next
}

/**
 * Apply `patch` (null/false clears a key; `null` patch clears all) to a target:
 * { cols: [fid] } | { rows: [rid] } | { cells: [[rid, fid]] }.
 * A whole column or row also drops the cell styles inside it for the keys it
 * sets, so the new look shows everywhere it was asked for.
 */
export function applyStyle(styles = {}, target, patch) {
    const clearAll = patch == null
    const p = clearAll ? Object.fromEntries(STYLE_KEYS.map(k => [k, null])) : patch
    let out = { ...styles }
    const scrub = (pred) => {
        if (!out.cell) return
        const cell = { ...out.cell }
        for (const k of Object.keys(cell)) {
            if (!pred(k)) continue
            const v = merge(cell[k], Object.fromEntries(Object.keys(p).map(x => [x, null])))
            if (v) cell[k] = v; else delete cell[k]
        }
        out.cell = cell
    }
    if (target.cols) {
        for (const fid of target.cols) out.col = put(out.col, fid, p)
        const set = new Set(target.cols)
        scrub(k => set.has(k.slice(k.indexOf('|') + 1)))
    } else if (target.rows) {
        for (const rid of target.rows) out.row = put(out.row, rid, p)
        const set = new Set(target.rows)
        scrub(k => set.has(k.slice(0, k.indexOf('|'))))
    } else if (target.cells) {
        for (const [rid, fid] of target.cells) out.cell = put(out.cell, cellKey(rid, fid), p)
    }
    for (const k of ['col', 'row', 'cell']) if (out[k] && !Object.keys(out[k]).length) delete out[k]
    return out
}

/** Styles naming a removed record or field go with it. */
export function pruneStyles(styles, { rid, fid } = {}) {
    if (!styles) return styles
    const out = { ...styles }
    if (rid != null && out.row?.[rid]) { out.row = { ...out.row }; delete out.row[rid] }
    if (fid != null && out.col?.[fid]) { out.col = { ...out.col }; delete out.col[fid] }
    if (out.cell) out.cell = Object.fromEntries(Object.entries(out.cell).filter(([k]) => {
        const [r, f] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]
        return r !== rid && f !== fid
    }))
    return out
}

// ---- selection ----

/**
 * A selection is { mode: 'cells'|'rows'|'cols'|'all', a, b } with a/b =
 * { ri, ci } indexes into the visible rows and columns. The range it covers:
 */
export function selRange(sel, nRows, nCols) {
    if (!sel || !nRows && sel.mode !== 'cols' || !nCols) return null
    const clampR = (i) => Math.max(0, Math.min(nRows - 1, i)), clampC = (i) => Math.max(0, Math.min(nCols - 1, i))
    let r0 = Math.min(sel.a.ri, sel.b.ri), r1 = Math.max(sel.a.ri, sel.b.ri)
    let c0 = Math.min(sel.a.ci, sel.b.ci), c1 = Math.max(sel.a.ci, sel.b.ci)
    if (sel.mode === 'rows' || sel.mode === 'all') { c0 = 0; c1 = nCols - 1 }
    if (sel.mode === 'cols' || sel.mode === 'all') { r0 = 0; r1 = nRows - 1 }
    return { r0: clampR(r0), r1: clampR(r1), c0: clampC(c0), c1: clampC(c1) }
}

/** The range as tab-separated text (a header line first), as spreadsheets copy it. */
export function rangeToTSV(rows, fields, range, { header = false } = {}) {
    if (!range) return ''
    const cols = fields.slice(range.c0, range.c1 + 1)
    const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ')
    const lines = rows.slice(range.r0, range.r1 + 1).map(r => cols.map(f => clean(f.type === 'number' && typeof r.values?.[f.id] === 'number' ? r.values[f.id] : cellText(f, r.values?.[f.id]))).join('\t'))
    return (header ? [cols.map(f => clean(f.name)).join('\t'), ...lines] : lines).join('\n')
}
