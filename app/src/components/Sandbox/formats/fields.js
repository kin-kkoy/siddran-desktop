/**
 * Field types and field edits for a Format's own records (spec §13.4.2).
 *
 * A field is `{ id, name, type, options?, decimals? }`. Ids are stable: a
 * rename never touches records, sorts, filters or groups (R13.21). Values are
 * stored per type:
 *
 *   text, long, url, email   string
 *   number                   number
 *   select                   one option label (string)
 *   multi                    option labels (string[])
 *   date                     'YYYY-MM-DD' (a calendar day)
 *   check                    boolean
 *
 * An empty value is simply absent from `record.values`. Options stay plain
 * labels (as section 5 stored them); a chip's colour comes from its label, so
 * it never shifts when options are reordered.
 *
 * Every edit is pure: it takes a payload and returns the next one, stamping
 * `updated_at` on each record it changes so two copies of a board still merge
 * record by record (desktop/sync/merge.js).
 */

export const FIELD_TYPES = [
    { id: 'text', label: 'Text' },
    { id: 'long', label: 'Long text' },
    { id: 'number', label: 'Number' },
    { id: 'select', label: 'Select' },
    { id: 'multi', label: 'Multi-select' },
    { id: 'date', label: 'Date' },
    { id: 'check', label: 'Checkbox' },
    { id: 'url', label: 'URL' },
    { id: 'email', label: 'Email' },
]
export const fieldTypeLabel = (t) => FIELD_TYPES.find(f => f.id === t)?.label || 'Text'
export const TEXTLIKE = new Set(['text', 'long', 'url', 'email'])
export const hasOptions = (f) => f?.type === 'select' || f?.type === 'multi'

export const MAX_FIELDS = 50
export const MAX_OPTIONS = 100

const nowISO = () => new Date().toISOString()
export const newFieldId = () => `f_${(globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 10)}`

export function isEmptyValue(v) {
    return v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'number' && Number.isNaN(v))
}

// ---- display ----

export function formatNumber(v, decimals) {
    if (typeof v !== 'number' || Number.isNaN(v)) return ''
    const d = Number.isInteger(decimals) ? Math.max(0, Math.min(6, decimals)) : undefined
    return v.toLocaleString(undefined, d == null ? { maximumFractionDigits: 6 } : { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function formatDay(v, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
    const [y, m, d] = String(v).split('-').map(Number)
    if (!y || !m || !d) return String(v ?? '')
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

/** A value as plain text — for display, search and converting to text. */
export function cellText(field, v) {
    if (isEmptyValue(v)) return ''
    switch (field?.type) {
        case 'number': return formatNumber(v, field.decimals)
        case 'date': return formatDay(v)
        case 'check': return v ? 'Yes' : ''
        case 'multi': return Array.isArray(v) ? v.join(', ') : String(v)
        default: return Array.isArray(v) ? v.join(', ') : String(v)
    }
}

/** A stable hue (0–359) for an option label, so its chip keeps its colour. */
export function optionHue(label) {
    let h = 0
    for (const ch of String(label)) h = (h * 31 + ch.codePointAt(0)) >>> 0
    return (h * 47) % 360
}

// ---- reading what someone typed ----

export function parseNumber(s) {
    if (typeof s === 'number') return Number.isNaN(s) ? undefined : s
    const t = String(s ?? '').trim().replace(/[\s,]/g, '')
    if (!t) return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
}

const pad = (n) => String(n).padStart(2, '0')
/** 'YYYY-MM-DD' from a day string or anything Date can read; undefined if none. */
export function parseDay(s) {
    const t = String(s ?? '').trim()
    if (!t) return undefined
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? undefined : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A value of one type as another (changing a field's type). undefined = empty. */
export function convertValue(v, from, to) {
    if (isEmptyValue(v)) return undefined
    // Plain digits, not the locale's display form ("1200", never "1,200" or "1.200").
    const text = from === 'number' && typeof v === 'number' ? String(v) : cellText({ type: from }, v)
    switch (to) {
        case 'number': return from === 'check' ? (v ? 1 : undefined) : parseNumber(Array.isArray(v) ? v[0] : v)
        case 'check': return from === 'number' ? v !== 0 : !/^(no|false|0|off)$/i.test(text.trim())
        case 'date': return from === 'date' ? v : parseDay(Array.isArray(v) ? v[0] : v)
        case 'select': return (Array.isArray(v) ? String(v[0] ?? '') : text).trim() || undefined
        case 'multi': {
            const list = Array.isArray(v) ? v : text.split(',')
            const out = [...new Set(list.map(s => String(s).trim()).filter(Boolean))]
            return out.length ? out : undefined
        }
        default: return text || undefined   // text, long, url, email
    }
}

/** A value as a field of `field.type` stores it (what a cell editor commits). */
export function coerceValue(field, v) {
    switch (field?.type) {
        case 'number': return parseNumber(v)
        case 'check': return v ? true : undefined
        case 'date': return parseDay(v)
        case 'multi': { const a = (Array.isArray(v) ? v : []).filter(Boolean); return a.length ? a : undefined }
        case 'select': return v ? String(v) : undefined
        default: { const s = String(v ?? ''); return s.trim() ? s : undefined }
    }
}

// ---- field edits (pure; each returns the next payload) ----

/** Write each record's value for `fieldId` through `fn(oldValue)`; stamps only records that changed. */
function mapValues(records = [], fieldId, fn, at) {
    return records.map(r => {
        const old = r.values?.[fieldId]
        const nv = fn(old)
        if (JSON.stringify(nv) === JSON.stringify(old)) return r
        const values = { ...r.values }
        if (nv === undefined) delete values[fieldId]; else values[fieldId] = nv
        return { ...r, values, updated_at: at }
    })
}

/** Add a field. Returns { payload, field }, or { error } at the limit. */
export function addField(payload, def = {}, { id = newFieldId() } = {}) {
    const fields = payload.fields || []
    if (fields.length >= MAX_FIELDS) return { error: `A table holds at most ${MAX_FIELDS} fields.` }
    const type = FIELD_TYPES.some(t => t.id === def.type) ? def.type : 'text'
    const taken = new Set(fields.map(f => f.name))
    let name = (def.name || fieldTypeLabel(type)).trim() || 'Field'
    if (taken.has(name)) { let n = 2; while (taken.has(`${name} ${n}`)) n++; name = `${name} ${n}` }
    const field = { id, name, type }
    if (hasOptions(field)) field.options = [...(def.options || [])]
    return { payload: { ...payload, fields: [...fields, field] }, field }
}

/**
 * Change a field: name, options, decimals — or its type, which converts every
 * record's value (and, for select/multi, gathers the options the values use).
 */
export function updateField(payload, id, patch, { at = nowISO() } = {}) {
    const fields = payload.fields || []
    const old = fields.find(f => f.id === id)
    if (!old) return payload
    let next = { ...old, ...patch }
    let records = payload.records || []
    if (patch.type && patch.type !== old.type) {
        records = mapValues(records, id, (v) => convertValue(v, old.type, patch.type), at)
        if (hasOptions(next)) {
            const opts = [...(old.options || [])]
            for (const r of records) {
                const v = r.values?.[id]
                for (const o of Array.isArray(v) ? v : v != null ? [v] : []) if (!opts.includes(o)) opts.push(o)
            }
            next.options = opts.slice(0, MAX_OPTIONS)
        } else delete next.options
        if (next.type !== 'number') delete next.decimals
    }
    if (typeof next.name === 'string') next.name = next.name.trim() || old.name
    const out = { ...payload, fields: fields.map(f => f.id === id ? next : f), records }
    // A view setting that no longer fits the new type goes (a filter's operator, a calculation).
    return patch.type && patch.type !== old.type ? pruneConfig(out, id, { type: true }) : out
}

/** Rename an option; every cell holding it follows (spec §13.4.2). */
export function renameOption(payload, fieldId, from, to, { at = nowISO() } = {}) {
    const name = String(to ?? '').trim()
    const field = (payload.fields || []).find(f => f.id === fieldId)
    if (!field || !name || name === from || !(field.options || []).includes(from)) return payload
    if (field.options.includes(name)) return payload
    const swap = (o) => o === from ? name : o
    return {
        ...payload,
        fields: payload.fields.map(f => f.id === fieldId ? { ...f, options: f.options.map(swap) } : f),
        records: mapValues(payload.records, fieldId, (v) => Array.isArray(v) ? v.map(swap) : v === from ? name : v, at),
    }
}

/** Add an option to a select field (no-op if present or at the limit). */
export function addOption(payload, fieldId, label) {
    const name = String(label ?? '').trim()
    return {
        ...payload,
        fields: (payload.fields || []).map(f => {
            if (f.id !== fieldId || !name) return f
            const opts = f.options || []
            return opts.includes(name) || opts.length >= MAX_OPTIONS ? f : { ...f, options: [...opts, name] }
        }),
    }
}

/** Add any option a record patch uses that its select field doesn't have yet (typing a new option into a cell). */
export function ensureOptions(payload, patch = {}) {
    let out = payload
    for (const f of payload.fields || []) {
        if (!hasOptions(f) || !(f.id in patch)) continue
        const v = patch[f.id]
        for (const o of Array.isArray(v) ? v : v != null ? [v] : []) out = addOption(out, f.id, o)
    }
    return out
}

/** Remove an option; cells holding it are cleared. */
export function removeOption(payload, fieldId, label, { at = nowISO() } = {}) {
    return {
        ...payload,
        fields: (payload.fields || []).map(f => f.id === fieldId ? { ...f, options: (f.options || []).filter(o => o !== label) } : f),
        records: mapValues(payload.records, fieldId, (v) => {
            if (Array.isArray(v)) { const a = v.filter(o => o !== label); return a.length ? a : undefined }
            return v === label ? undefined : v
        }, at),
    }
}

/** Move a field to `index` in the field order. */
export function moveField(payload, id, index) {
    const fields = [...(payload.fields || [])]
    const from = fields.findIndex(f => f.id === id)
    if (from < 0) return payload
    const [f] = fields.splice(from, 1)
    fields.splice(Math.max(0, Math.min(fields.length, index)), 0, f)
    return { ...payload, fields }
}

/** How many records hold a value for `fieldId` (the delete warning, R13.22). */
export const filledCount = (payload, fieldId) => (payload.records || []).filter(r => !isEmptyValue(r.values?.[fieldId])).length

/** Remove a field, its values and every view setting that names it. Undoable like any edit. */
export function removeField(payload, id, { at = nowISO() } = {}) {
    if ((payload.fields || []).length <= 1) return payload   // a table keeps at least one field
    const out = {
        ...payload,
        fields: payload.fields.filter(f => f.id !== id),
        records: mapValues(payload.records, id, () => undefined, at),
    }
    return pruneConfig(out, id)
}

/**
 * Drop view settings (payload.table, see query.js) that name `fieldId` — all
 * of them when the field is gone, or only the type-specific ones (filters,
 * calculations) when its type changed.
 */
function pruneConfig(payload, fieldId, { type = false } = {}) {
    const c = payload.table
    if (!c) return payload
    const next = { ...c }
    if (c.filters) next.filters = c.filters.filter(f => f.field !== fieldId)
    if (c.calcs && fieldId in c.calcs) { next.calcs = { ...c.calcs }; delete next.calcs[fieldId] }
    if (!type) {
        if (c.sorts) next.sorts = c.sorts.filter(s => s.field !== fieldId)
        if (c.groupBy === fieldId) delete next.groupBy
        if (c.hidden) next.hidden = c.hidden.filter(h => h !== fieldId)
        if (c.widths && fieldId in c.widths) { next.widths = { ...c.widths }; delete next.widths[fieldId] }
    }
    return { ...payload, table: next }
}
