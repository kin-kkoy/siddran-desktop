/**
 * Kanban and Matrix: records as cards in cells keyed by select fields (spec
 * §13.6, §13.7). Both are views of the same records — no view-only fields
 * (R13.49); a card drag changes only the mapped fields and the record's
 * `order` (layout.js, shared with the Table's row order). All pure.
 *
 * View settings, every key optional (absent = the default named here):
 *
 *   payload.kanban = {
 *     columnBy:   fieldId,            // a select field; default Status, else the first select
 *     laneBy:     fieldId,            // swimlanes by a second select field; default none
 *     filters, match, sorts,          // as the Table's (query.js); view-scoped
 *     cardFields: [fieldId],          // up to 3 shown on a card; default the first few
 *     size:       'compact' | 'default' | 'detailed',
 *     colorBy:    fieldId,            // a select field colours the card's edge; default none
 *     wip:        { [optionKey]: n }, // a column's limit (a warning, never a block)
 *     collapsed:  [optionKey],        // folded columns
 *     lanesCollapsed: [optionKey],
 *     hideEmpty:  boolean,            // hide the "No <field>" column
 *   }
 *   payload.matrix = {
 *     rowBy, colBy: fieldId,          // two select fields; default the first two
 *     filters, match, sorts, cardFields (up to 2), colorBy,
 *     cells: { [rowKey]: { [colKey]: { label?, hue? } } },  // quadrant names and colours (R13.52)
 *   }
 *
 * An option key is the option's label; NONE ('') is "no value". Renaming an
 * option renames its keys here too (fields.js renameOption).
 */
import { isEmptyValue, cellText, formatDay } from './fields'

export const NONE = ''
export const MATRIX_MAX = 6
export const KANBAN_FIELDS_MAX = 3
export const MATRIX_FIELDS_MAX = 2

export const selectFields = (fields = []) => fields.filter(f => f.type === 'select')

/** The value a record holds for a select field, as a key (NONE when empty or not an option). */
export function keyOf(field, rec) {
    const v = rec?.values?.[field?.id]
    return typeof v === 'string' && v && (field.options || []).includes(v) ? v : NONE
}

/** What a key writes back: an option, or undefined to clear the field. */
export const valueOf = (key) => (key === NONE ? undefined : key)

// ---- which fields a view uses ----

export function kanbanSetup(fields, cfg = {}) {
    const sel = selectFields(fields)
    const column = sel.find(f => f.id === cfg.columnBy) || sel.find(f => f.id === 'status') || sel[0] || null
    const lane = (cfg.laneBy && cfg.laneBy !== column?.id && sel.find(f => f.id === cfg.laneBy)) || null
    const colorBy = (cfg.colorBy && sel.find(f => f.id === cfg.colorBy)) || null
    return { column, lane, colorBy }
}

export function matrixSetup(fields, cfg = {}) {
    const sel = selectFields(fields)
    const row = sel.find(f => f.id === cfg.rowBy) || sel[0] || null
    const col = sel.find(f => f.id === cfg.colBy && f.id !== row?.id) || sel.find(f => f !== row) || null
    const colorBy = (cfg.colorBy && sel.find(f => f.id === cfg.colorBy)) || null
    return { row, col, colorBy }
}

/** The fields a card shows under its title: the ones chosen, else the first few that aren't already the title or the layout. */
export function cardFields(fields, cfg = {}, { exclude = [], max = KANBAN_FIELDS_MAX } = {}) {
    const skip = new Set(exclude.filter(Boolean))
    if (Array.isArray(cfg.cardFields)) return cfg.cardFields.map(id => fields.find(f => f.id === id)).filter(f => f && !skip.has(f.id)).slice(0, max)
    return fields.filter(f => !skip.has(f.id) && f.type !== 'long' && f.type !== 'files').slice(0, max)
}

/** The record's title field: `title`, else the first text-like field. */
export const primaryField = (fields) => fields.find(f => f.id === 'title') || fields.find(f => f.type === 'text') || null

// ---- cells ----

/** Kanban columns: one per option in its order, then "No <field>" unless hidden. */
export function kanbanColumns(column, cfg = {}) {
    if (!column) return []
    const out = (column.options || []).map(o => ({ key: o, label: o }))
    if (!cfg.hideEmpty) out.push({ key: NONE, label: `No ${column.name}` })
    return out
}

/** Swimlanes: one per option, then "No <field>"; a single unnamed lane when there are none. */
export function kanbanLanes(lane) {
    if (!lane) return [{ key: '*', label: '' }]
    return [...(lane.options || []).map(o => ({ key: o, label: o })), { key: NONE, label: `No ${lane.name}` }]
}

export const cellKey = (a, b) => `${a}\u0001${b}`

/**
 * Records into cells, keeping their order. Kanban: lane × column (lane '*'
 * when there are no lanes). A record whose column is hidden (the "No value"
 * column turned off) lands in no cell.
 */
export function kanbanCells(records, { column, lane }, columns) {
    const cols = new Set(columns.map(c => c.key))
    const cells = new Map()
    for (const r of records) {
        const c = keyOf(column, r)
        if (!cols.has(c)) continue
        const k = cellKey(lane ? keyOf(lane, r) : '*', c)
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(r)
    }
    return cells
}

/**
 * The Matrix's rows and columns (the first six options of each, R13.7) and
 * its cells. A record missing either value, or holding an option past the
 * sixth, waits in the "not placed" tray.
 */
export function matrixLayout(records, { row, col }) {
    const rows = (row?.options || []).slice(0, MATRIX_MAX)
    const cols = (col?.options || []).slice(0, MATRIX_MAX)
    const rs = new Set(rows), cs = new Set(cols)
    const cells = new Map(), tray = []
    for (const r of records) {
        const a = row ? keyOf(row, r) : NONE, b = col ? keyOf(col, r) : NONE
        if (!rs.has(a) || !cs.has(b)) { tray.push(r); continue }
        const k = cellKey(a, b)
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k).push(r)
    }
    return { rows, cols, cells, tray }
}

// ---- a card dropped ----

/** The record patch for a card moved from one cell to another: only the fields that change (R13.45). */
export function dropPatch(rec, moves) {
    const patch = {}
    for (const [field, key] of moves) {
        if (!field) continue
        if (keyOf(field, rec) !== key) patch[field.id] = valueOf(key)
    }
    return patch
}

/**
 * Where a dropped card goes in the records' own order (layout.js
 * moveRecord's `beforeId`): before the card it was dropped on, or before the
 * record that follows it. Dropped on a cell's empty space: after the cell's
 * last card. `undefined` = keep its place (an empty cell).
 *
 * `seq` = every record id in order; `cell` = the ids shown in the target cell.
 */
export function dropBefore(seq, cell, id, over, place) {
    const rest = seq.filter(x => x !== id)
    const after = (x) => { const i = rest.indexOf(x); return i < 0 ? undefined : rest[i + 1] ?? null }
    if (over && over !== id) return place === 'after' ? after(over) : over
    const others = cell.filter(x => x !== id)
    if (!others.length) return undefined
    return after(others[others.length - 1])
}

// ---- view settings that follow a field or an option ----

/** An option renamed: its keys in Kanban and Matrix settings follow (collapsed columns, limits, quadrant names). */
export function renameOptionKeys(payload, fieldId, from, to) {
    let out = payload
    const k = payload.kanban
    if (k && (k.columnBy === fieldId || k.laneBy === fieldId || !k.columnBy)) {
        const swap = (a) => (a || []).map(x => (x === from ? to : x))
        const next = { ...k }
        if (k.collapsed) next.collapsed = swap(k.collapsed)
        if (k.lanesCollapsed) next.lanesCollapsed = swap(k.lanesCollapsed)
        if (k.wip && from in k.wip) { next.wip = { ...k.wip, [to]: k.wip[from] }; delete next.wip[from] }
        out = { ...out, kanban: next }
    }
    const m = payload.matrix
    if (m?.cells) {
        const cells = {}
        for (const [rk, row] of Object.entries(m.cells)) {
            const r2 = {}
            for (const [ck, v] of Object.entries(row || {})) r2[ck === from ? to : ck] = v
            cells[rk === from ? to : rk] = r2
        }
        out = { ...out, matrix: { ...m, cells } }
    }
    return out
}

// ---- what a card shows ----

/** A short text for a value on a card (dates short, checkboxes as their name). */
export function cardText(field, v) {
    if (isEmptyValue(v)) return ''
    if (field.type === 'date') return formatDay(v, { month: 'short', day: 'numeric' })
    if (field.type === 'check') return field.name
    if (field.type === 'files') return `${v.length} file${v.length === 1 ? '' : 's'}`
    return cellText(field, v)
}
