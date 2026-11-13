/**
 * Formats — structured widgets on the board (spec §5.13, §13.1–13.2): a
 * Table, Kanban, Timeline or Matrix is a *view* of one dataset.
 *
 * Stored as `type: 'shape', payload.kind: 'format'` (never a new item type —
 * an older build sends unknown types to the stroke renderer; an unknown kind
 * just draws nothing). Everything a widget needs lives in its payload, so the
 * board file carries it, the CLI round-trips it and undo works as for any
 * other item (decided: a widget's own records live INSIDE the board file).
 *
 * payload = {
 *   kind: 'format',
 *   view: 'table' | 'kanban' | 'timeline' | 'matrix',   // how it's shown
 *   title: string,
 *   source: { type: 'own' }                              // records below
 *         | { type: 'tasks', show: 'open'|'all'|'done' }  // the Bag's tasks
 *         | { type: 'project', projectId, show },         // one project's tasks
 *   fields:  [{ id, name, type, options?, decimals? }],   // types: fields.js
 *   records: [{ id, values: { [fieldId]: value }, updated_at }],
 *   table:   { filters, match, sorts, groupBy, hidden, widths, calcs, wrap },  // the Table view's settings (query.js)
 * }
 *
 * `fields` and `records` are only used by an own-records widget; a linked one
 * keeps them (switching back to own records gets them back). Each record
 * carries `updated_at` so two copies of a board merge record by record
 * (desktop/sync/merge.js `mergeSandboxItems`).
 */

export const FORMAT_KIND = 'format'
export const isFormat = (it) => it?.type === 'shape' && it.payload?.kind === FORMAT_KIND

/** The views a widget can show. Sections 6–7 give each its own view; until then all render as a plain list. */
export const VIEWS = [
    { id: 'table', label: 'Table' },
    { id: 'kanban', label: 'Kanban' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'matrix', label: 'Matrix' },
]
export const viewLabel = (id) => VIEWS.find(v => v.id === id)?.label || 'Table'

export const STATUS_OPTIONS = ['To do', 'Doing', 'Done']

/** The fields a new own-records widget starts with. Ids are stable names, not random, so a fresh board reads well in the file and to the CLI. */
export function defaultFields() {
    return [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'status', name: 'Status', type: 'select', options: [...STATUS_OPTIONS] },
        { id: 'due', name: 'Due', type: 'date' },
    ]
}

export const FORMAT_SIZE = { w: 420, h: 320 }

export function formatPayload(view = 'table', title) {
    return {
        kind: FORMAT_KIND, view, title: title || viewLabel(view),
        source: { type: 'own' },
        fields: defaultFields(),
        records: [],
    }
}

/** Next default title for `view`: "Table", "Table 2", … */
export function nextFormatTitle(items, view = 'table') {
    const base = viewLabel(view)
    const taken = new Set(items.filter(isFormat).map(i => i.payload?.title))
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base} ${n}`)) n++
    return `${base} ${n}`
}

const nowISO = () => new Date().toISOString()
export const newRecordId = () => `r_${(globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 12)}`

// ---- record edits (pure: each returns the next payload) ----

export function addRecord(payload, values = {}, { id = newRecordId(), at = nowISO() } = {}) {
    const rec = { id, values: { ...values }, updated_at: at }
    return { payload: { ...payload, records: [...(payload.records || []), rec] }, record: rec }
}

export function updateRecord(payload, id, patch, { at = nowISO() } = {}) {
    return {
        ...payload,
        records: (payload.records || []).map(r => r.id === id ? { ...r, values: { ...r.values, ...patch }, updated_at: at } : r),
    }
}

export function removeRecord(payload, id) {
    return { ...payload, records: (payload.records || []).filter(r => r.id !== id) }
}

/** The text a record is known by — its title field, else its first text value. */
export function recordTitle(rec, fields = []) {
    const v = rec?.values || {}
    if (typeof v.title === 'string' && v.title) return v.title
    const t = fields.find(f => f.type === 'text' && typeof v[f.id] === 'string' && v[f.id])
    return t ? v[t.id] : ''
}
