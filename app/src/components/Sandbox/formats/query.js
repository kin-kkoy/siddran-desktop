/**
 * What a Table shows of its records: filter, sort, group and column
 * calculations (spec §13.4.4–13.4.5). All pure, so they work the same over
 * own records and linked tasks.
 *
 * The settings are the view's, not the data's (spec: view-scoped). They live
 * in `payload.table`, every key optional:
 *
 *   {
 *     filters: [{ id, field, op, value }],   // conditions (see OPS)
 *     match:   'all' | 'any',                 // AND / OR; default all
 *     sorts:   [{ field, dir: 'asc'|'desc' }],// multi-key; empties last
 *     groupBy: fieldId,                       // one level
 *     hidden:  [fieldId],                     // columns not shown
 *     widths:  { [fieldId]: px },             // at the default text size
 *     calcs:   { [fieldId]: calcId },         // footer calculations
 *     wrap:    boolean,                       // wrap long cell text
 *   }
 *
 * A widget linked to tasks keeps its settings here too (the tasks have no
 * room for them), keyed by the task fields' ids.
 */
import { isEmptyValue, cellText, TEXTLIKE, formatNumber } from './fields'

export const tableConfig = (payload) => payload?.table || {}

// ---- filters ----

const TEXT_OPS = [
    ['contains', 'contains'], ['not_contains', 'doesn’t contain'], ['is', 'is'], ['is_not', 'is not'],
]
const EMPTY_OPS = [['empty', 'is empty', false], ['not_empty', 'is not empty', false]]
export const OPS = {
    text: [...TEXT_OPS, ...EMPTY_OPS],
    number: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['lt', '<'], ['gte', '≥'], ['lte', '≤'], ...EMPTY_OPS],
    select: [['is', 'is'], ['is_not', 'is not'], ...EMPTY_OPS],
    multi: [['has', 'has'], ['has_not', 'doesn’t have'], ...EMPTY_OPS],
    date: [['is', 'is'], ['before', 'is before'], ['after', 'is after'], ['today', 'is today', false], ['overdue', 'is past', false], ['next7', 'is in the next 7 days', false], ...EMPTY_OPS],
    check: [['checked', 'is checked', false], ['unchecked', 'is not checked', false]],
}
const opKind = (type) => TEXTLIKE.has(type) || !OPS[type] ? 'text' : type
/** [{ id, label, needsValue }] for a field type. */
export const opsFor = (type) => OPS[opKind(type)].map(([id, label, needs = true]) => ({ id, label, needsValue: needs }))
export const defaultOp = (type) => opsFor(type)[0].id

const pad = (n) => String(n).padStart(2, '0')
export const todayDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number)
    return todayDay(new Date(y, m - 1, d + n))
}

/**
 * Does `rec` pass one condition? A condition naming a missing field, an
 * unknown operator or no value yet passes — half-built filters hide nothing.
 */
export function matches(rec, cond, field, today = todayDay()) {
    if (!field) return true
    const op = opsFor(field.type).find(o => o.id === cond.op)
    if (!op) return true
    const v = rec.values?.[field.id]
    const want = cond.value
    if (op.needsValue && isEmptyValue(want)) return true
    if (cond.op === 'empty') return isEmptyValue(v)
    if (cond.op === 'not_empty') return !isEmptyValue(v)
    switch (opKind(field.type)) {
        case 'text': {
            const a = cellText(field, v).toLowerCase(), b = String(want).toLowerCase().trim()
            if (cond.op === 'contains') return a.includes(b)
            if (cond.op === 'not_contains') return !a.includes(b)
            if (cond.op === 'is') return a.trim() === b
            return a.trim() !== b
        }
        case 'number': {
            const b = Number(want)
            if (Number.isNaN(b)) return true
            if (typeof v !== 'number') return cond.op === 'ne'
            return { eq: v === b, ne: v !== b, gt: v > b, lt: v < b, gte: v >= b, lte: v <= b }[cond.op]
        }
        case 'select': return cond.op === 'is' ? v === want : v !== want
        case 'multi': {
            const has = Array.isArray(v) && v.includes(want)
            return cond.op === 'has' ? has : !has
        }
        case 'date': {
            const day = typeof v === 'string' ? v : ''
            switch (cond.op) {
                case 'is': return day === want
                case 'before': return !!day && day < want
                case 'after': return !!day && day > want
                case 'today': return day === today
                case 'overdue': return !!day && day < today
                case 'next7': return !!day && day >= today && day <= addDays(today, 7)
                default: return true
            }
        }
        case 'check': return cond.op === 'checked' ? !!v : !v
        default: return true
    }
}

export function filterRecords(records, fields, config = {}, today = todayDay()) {
    const conds = (config.filters || []).filter(c => fields.some(f => f.id === c.field))
    if (!conds.length) return records
    const byId = new Map(fields.map(f => [f.id, f]))
    const any = config.match === 'any'
    return records.filter(r => {
        const hits = conds.map(c => matches(r, c, byId.get(c.field), today))
        return any ? hits.some(Boolean) : hits.every(Boolean)
    })
}

/** How many filters actually do something (have a value, or need none). */
export function activeFilterCount(config = {}, fields = []) {
    return (config.filters || []).filter(c => {
        const f = fields.find(x => x.id === c.field)
        const op = f && opsFor(f.type).find(o => o.id === c.op)
        return op && (!op.needsValue || !isEmptyValue(c.value))
    }).length
}

// ---- sorting ----

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Compare two non-empty values of `field`. Options sort in their own order. */
export function compareValues(field, a, b) {
    switch (field.type) {
        case 'number': return a - b
        case 'check': return (a ? 1 : 0) - (b ? 1 : 0)
        case 'date': return a < b ? -1 : a > b ? 1 : 0
        case 'select':
        case 'multi': {
            const opts = field.options || []
            const rank = (v) => { const x = Array.isArray(v) ? v[0] : v; const i = opts.indexOf(x); return i < 0 ? opts.length : i }
            const d = rank(a) - rank(b)
            return d || collator.compare(cellText(field, a), cellText(field, b))
        }
        default: return collator.compare(cellText(field, a), cellText(field, b))
    }
}

/** Multi-key, stable sort. Empty values go last whichever way a key runs. */
export function sortRecords(records, fields, sorts = []) {
    const keys = sorts.map(s => ({ field: fields.find(f => f.id === s.field), dir: s.dir === 'desc' ? -1 : 1 })).filter(k => k.field)
    if (!keys.length) return records
    return records.map((r, i) => [r, i]).sort(([a, ia], [b, ib]) => {
        for (const { field, dir } of keys) {
            const va = a.values?.[field.id], vb = b.values?.[field.id]
            const ea = isEmptyValue(va) && field.type !== 'check', eb = isEmptyValue(vb) && field.type !== 'check'
            if (ea !== eb) return ea ? 1 : -1
            if (ea) continue
            const d = compareValues(field, va, vb)
            if (d) return d * dir
        }
        return ia - ib
    }).map(([r]) => r)
}

// ---- grouping ----

/**
 * Records in groups by one field: [{ key, label, value, records }]. Options
 * come in their own order; a multi-select record is in each of its options'
 * groups; records with no value come last as "No <field>".
 */
export function groupRecords(records, field) {
    if (!field) return [{ key: '*', label: '', records }]
    const groups = new Map()
    const put = (key, label, value, r) => {
        if (!groups.has(key)) groups.set(key, { key, label, value, records: [] })
        groups.get(key).records.push(r)
    }
    if (field.type === 'select' || field.type === 'multi') for (const o of field.options || []) groups.set(`v:${o}`, { key: `v:${o}`, label: o, value: o, records: [] })
    if (field.type === 'check') {
        groups.set('v:true', { key: 'v:true', label: 'Checked', value: true, records: [] })
        groups.set('v:false', { key: 'v:false', label: 'Not checked', value: false, records: [] })
    }
    for (const r of records) {
        const v = r.values?.[field.id]
        if (field.type === 'check') { put(`v:${!!v}`, v ? 'Checked' : 'Not checked', !!v, r); continue }
        if (isEmptyValue(v)) { put('empty', `No ${field.name}`, undefined, r); continue }
        if (field.type === 'multi' && Array.isArray(v)) { for (const o of v) put(`v:${o}`, o, o, r); continue }
        put(`v:${typeof v === 'string' ? v : JSON.stringify(v)}`, cellText(field, v), v, r)
    }
    let out = [...groups.values()]
    // Free values (text, numbers, dates) in sorted order; options keep theirs.
    if (!['select', 'multi', 'check'].includes(field.type)) {
        out.sort((a, b) => a.key === 'empty' ? 1 : b.key === 'empty' ? -1 : compareValues(field, a.value, b.value))
    } else {
        const empty = out.filter(g => g.key === 'empty')
        out = [...out.filter(g => g.key !== 'empty'), ...empty]
    }
    // Options nobody uses still show as empty groups (somewhere to see the option), but not when there are many.
    return out.filter(g => g.records.length || out.length <= 12)
}

// ---- calculations ----

const NUM_CALCS = [['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max'], ['median', 'Median']]
const COUNT_CALCS = [['filled', 'Filled'], ['empty', 'Empty'], ['count', 'Count all']]
/** [{ id, label }] the footer offers for a field type (R13.28). */
export function calcsFor(type) {
    const list = type === 'number' ? [...NUM_CALCS, ...COUNT_CALCS]
        : type === 'check' ? [['checked', 'Checked'], ['pct', '% checked'], ['count', 'Count all']]
            : type === 'date' ? [['earliest', 'Earliest'], ['latest', 'Latest'], ...COUNT_CALCS]
                : COUNT_CALCS
    return list.map(([id, label]) => ({ id, label }))
}

/** The footer value for `calc` over `records` — a display string, or '' if it doesn't apply. */
export function calculate(records, field, calc) {
    if (!field || !calcsFor(field.type).some(c => c.id === calc)) return ''
    const vals = records.map(r => r.values?.[field.id])
    const filled = vals.filter(v => !isEmptyValue(v))
    switch (calc) {
        case 'count': return String(records.length)
        case 'filled': return String(filled.length)
        case 'empty': return String(records.length - filled.length)
        case 'checked': return String(filled.length)
        case 'pct': return records.length ? `${Math.round((filled.length / records.length) * 100)}%` : '–'
        case 'earliest': case 'latest': {
            const days = filled.filter(v => typeof v === 'string').sort()
            if (!days.length) return '–'
            return cellText(field, calc === 'earliest' ? days[0] : days[days.length - 1])
        }
        default: {
            const nums = filled.filter(v => typeof v === 'number')
            if (!nums.length) return '–'
            let n
            if (calc === 'sum') n = nums.reduce((a, b) => a + b, 0)
            else if (calc === 'avg') n = nums.reduce((a, b) => a + b, 0) / nums.length
            else if (calc === 'min') n = Math.min(...nums)
            else if (calc === 'max') n = Math.max(...nums)
            else {
                const s = [...nums].sort((a, b) => a - b), m = s.length >> 1
                n = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
            }
            const d = Number.isInteger(field.decimals) ? field.decimals : (calc === 'avg' || calc === 'median') && !Number.isInteger(n) ? 2 : undefined
            return formatNumber(n, d)
        }
    }
}

/** Everything a Table shows, in one pass: the visible fields and the grouped, filtered, sorted rows. */
export function tableRows(source, config = {}, { today = todayDay(), keep } = {}) {
    const fields = source.fields
    const hidden = new Set(config.hidden || [])
    const shown = fields.filter(f => !hidden.has(f.id))
    // `keep`: records just added here stay visible even if the filter would hide them.
    let rows = filterRecords(source.records, fields, config, today)
    if (keep?.size) {
        const inRows = new Set(rows.map(r => r.id))
        rows = source.records.filter(r => inRows.has(r.id) || keep.has(r.id))
    }
    rows = sortRecords(rows, fields, config.sorts)
    const groupField = fields.find(f => f.id === config.groupBy)
    return { fields: shown, rows, total: source.records.length, groupField, groups: groupRecords(rows, groupField) }
}
