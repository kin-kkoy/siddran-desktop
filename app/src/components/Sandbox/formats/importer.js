/**
 * Getting rows into a Table: text pasted from a spreadsheet (tab-separated),
 * or a CSV / TSV file (spec §13.4.3, R13.25). All pure — the preview dialog
 * shows a plan, and applying it is one change to the widget (one undo step).
 *
 *   parseDelimited(text)            → rows of cells (quotes, "" escapes, CRLF)
 *   planImport(rows, fields, opts)  → { header, columns: [{ name, target, type }], body }
 *   applyImport(payload, plan, …)   → the next payload
 *
 * A column maps to an existing field (by header name, else by position), to a
 * new field (its type guessed from the values), or is skipped. Values are read
 * per type (numbers with thousands separators, yes/no, dates, options —
 * missing options are added). At most 500 rows × 30 columns per import.
 */
import { addField, ensureOptions, parseNumber, parseDay, newFieldId, MAX_FIELDS } from './fields'
import { newRecordId } from './formats'

export const MAX_IMPORT_ROWS = 500
export const MAX_IMPORT_COLS = 30

/** Tab-separated if any line has a tab; else commas, or semicolons if those outnumber them. */
export function detectDelimiter(text) {
    const head = String(text).split(/\r?\n/).slice(0, 10).join('\n')
    if (head.includes('\t')) return '\t'
    const commas = (head.match(/,/g) || []).length, semis = (head.match(/;/g) || []).length
    return semis > commas ? ';' : ','
}

export function parseDelimited(text, delim = detectDelimiter(text)) {
    const s = String(text ?? '').replace(/^\uFEFF/, '')
    const rows = []
    let row = [], cell = '', i = 0, quoted = false
    while (i < s.length) {
        const ch = s[i]
        if (quoted) {
            if (ch === '"') {
                if (s[i + 1] === '"') { cell += '"'; i += 2; continue }
                quoted = false; i++; continue
            }
            cell += ch; i++; continue
        }
        if (ch === '"' && cell === '') { quoted = true; i++; continue }
        if (ch === delim) { row.push(cell); cell = ''; i++; continue }
        if (ch === '\r' && s[i + 1] === '\n') i++
        if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
        cell += ch; i++
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
    // Trailing blank lines (a spreadsheet copy ends with one).
    while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop()
    return rows
}

const YES = /^(yes|y|true|x|✓|✔|1|on|done|checked)$/i
const NO = /^(no|n|false|0|off|)$/i

/** A field type for a new column, from its values. */
export function guessType(values) {
    const v = values.map(x => String(x ?? '').trim()).filter(Boolean)
    if (!v.length) return 'text'
    if (v.every(x => parseNumber(x) !== undefined)) return 'number'
    if (v.every(x => /^\d{4}-\d{1,2}-\d{1,2}/.test(x) || /^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/.test(x))) return 'date'
    if (v.every(x => YES.test(x) || NO.test(x))) return 'check'
    if (v.every(x => /^https?:\/\//i.test(x))) return 'url'
    if (v.every(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return 'email'
    const distinct = new Set(v.map(x => x.toLowerCase()))
    if (v.length >= 4 && distinct.size <= Math.max(2, Math.min(8, v.length / 2)) && v.every(x => x.length <= 40)) return 'select'
    if (v.some(x => x.length > 120 || x.includes('\n'))) return 'long'
    return 'text'
}

/** A pasted / imported cell as a field of `type` stores it; undefined = empty. */
export function readCell(type, raw) {
    const t = String(raw ?? '').trim()
    if (!t) return undefined
    switch (type) {
        case 'number': return parseNumber(t)
        case 'check': return YES.test(t) ? true : undefined
        case 'date': {
            const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(t)   // day/month/year
            if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return parseDay(`${y}-${m[2]}-${m[1]}`) }
            return parseDay(t)
        }
        case 'multi': { const a = [...new Set(t.split(/[,;]/).map(x => x.trim()).filter(Boolean))]; return a.length ? a : undefined }
        case 'formula': case 'files': return undefined
        case 'long': return String(raw)
        default: return t
    }
}

/**
 * What an import will do. `fields` are the table's columns in view order.
 *   header: does the first row name the columns? (default: guessed — true
 *           when any first-row cell matches a field name, or the first row is
 *           all text above a row with numbers)
 *   startCol: for headerless data, the field index the first column lands in.
 * Returns { header, columns: [{ name, target: fieldId | 'new' | 'skip', type }],
 * body: rows, truncated }.
 */
export function planImport(rows, fields, { header, startCol = 0, editable } = {}) {
    let data = rows.slice(0, MAX_IMPORT_ROWS + 1)
    const width = Math.min(MAX_IMPORT_COLS, Math.max(0, ...data.map(r => r.length)))
    const truncated = rows.length > MAX_IMPORT_ROWS + 1 || rows.some(r => r.length > MAX_IMPORT_COLS)
    data = data.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''))
    const byName = new Map(fields.map(f => [f.name.trim().toLowerCase(), f]))
    const first = data[0] || []
    if (header == null) {
        const named = first.some(c => byName.has(c.trim().toLowerCase()))
        const textOverNumbers = data.length > 1 && first.every(c => c.trim() && parseNumber(c) === undefined) && data[1].some(c => parseNumber(c) !== undefined)
        header = named || textOverNumbers
    }
    const body = header ? data.slice(1, MAX_IMPORT_ROWS + 1) : data.slice(0, MAX_IMPORT_ROWS)
    const can = (f) => f && f.type !== 'formula' && (!editable || editable.has(f.id))
    const used = new Set()
    const columns = Array.from({ length: width }, (_, i) => {
        const name = header ? first[i].trim() || `Column ${i + 1}` : `Column ${i + 1}`
        let f = header ? byName.get(name.toLowerCase()) : fields[startCol + i]
        if (f && (!can(f) || used.has(f.id))) f = null
        if (f) { used.add(f.id); return { name, target: f.id, type: f.type } }
        return { name, target: 'new', type: guessType(body.map(r => r[i])) }
    })
    return { header, columns, body, truncated }
}

/**
 * Apply a plan to a widget's payload. mode 'append' adds every row as a new
 * record; 'fill' writes over existing records from `fill.rows` (record ids in
 * view order, starting at the selected one) and appends any rows left over.
 * Returns { payload, added, updated, newFields, error? }.
 */
export function applyImport(payload, plan, { mode = 'append', fill = null, at = new Date().toISOString(), ids } = {}) {
    let p = payload
    const fieldOf = []
    let newFields = 0
    for (const col of plan.columns) {
        if (col.target === 'skip') { fieldOf.push(null); continue }
        if (col.target === 'new') {
            if ((p.fields || []).length >= MAX_FIELDS) { fieldOf.push(null); continue }
            const r = addField(p, { name: col.name, type: col.type }, { id: ids?.field?.() || newFieldId() })
            p = r.payload; fieldOf.push(r.field); newFields++
            continue
        }
        fieldOf.push((p.fields || []).find(f => f.id === col.target) || null)
    }
    const valuesOf = (row) => {
        const v = {}
        row.forEach((raw, i) => {
            const f = fieldOf[i]
            if (!f) return
            const x = readCell(f.type, raw)
            if (x !== undefined) v[f.id] = x
        })
        return v
    }
    const records = [...(p.records || [])]
    let added = 0, updated = 0
    const changed = []
    plan.body.forEach((row, k) => {
        const values = valuesOf(row)
        const targetId = mode === 'fill' ? fill?.rows?.[k] : null
        const idx = targetId ? records.findIndex(r => r.id === targetId) : -1
        if (idx >= 0) {
            const cleared = Object.fromEntries(fieldOf.filter(Boolean).map(f => [f.id, undefined]))
            const merged = { ...records[idx].values, ...cleared, ...values }
            for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
            records[idx] = { ...records[idx], values: merged, updated_at: at }
            changed.push(merged)
            updated++
        } else {
            if (!Object.keys(values).length) return
            records.push({ id: ids?.record?.() || newRecordId(), values, updated_at: at })
            changed.push(values)
            added++
        }
    })
    p = { ...p, records }
    // Options the values use that their fields don't have yet.
    for (const v of changed) p = ensureOptions(p, v)
    return { payload: p, added, updated, newFields }
}
