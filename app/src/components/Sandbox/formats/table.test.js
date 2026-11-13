import { describe, it, expect, vi } from 'vitest'
import { formatPayload } from './formats'
import { ownSource, taskSource } from './dataSource'
import {
  addField, updateField, removeField, renameOption, addOption, removeOption, moveField, filledCount,
  convertValue, coerceValue, cellText, parseDay, parseNumber, optionHue, MAX_FIELDS,
} from './fields'
import { filterRecords, sortRecords, groupRecords, calculate, calcsFor, opsFor, matches, activeFilterCount, tableRows } from './query'

const AT = { at: 'T' }
const rec = (id, values) => ({ id, values, updated_at: 'old' })

describe('field edits', () => {
  it('adds a field with a unique name and stable id, and stops at the limit', () => {
    let p = formatPayload()
    const r = addField(p, { name: 'Status', type: 'number' }, { id: 'f1' })
    expect(r.field).toEqual({ id: 'f1', name: 'Status 2', type: 'number' })
    p = r.payload
    expect(addField(p, { type: 'multi' }, { id: 'f2' }).field).toEqual({ id: 'f2', name: 'Multi-select', type: 'multi', options: [] })
    const full = { ...p, fields: Array.from({ length: MAX_FIELDS }, (_, i) => ({ id: `x${i}`, name: `x${i}`, type: 'text' })) }
    expect(addField(full, {}).error).toMatch(/50/)
  })

  it('changing type converts every value and gathers options', () => {
    const p = { ...formatPayload(), fields: [{ id: 'n', name: 'N', type: 'text' }], records: [rec('a', { n: '1,200' }), rec('b', { n: 'x' }), rec('c', {})] }
    const num = updateField(p, 'n', { type: 'number' }, AT)
    expect(num.records.map(r => r.values.n)).toEqual([1200, undefined, undefined])
    expect(num.records[0].updated_at).toBe('T')
    expect(num.records[2].updated_at).toBe('old')   // untouched records keep their stamp
    const sel = updateField({ ...p, records: [rec('a', { n: 'High' }), rec('b', { n: 'Low' }), rec('c', { n: 'High' })] }, 'n', { type: 'select' }, AT)
    expect(sel.fields[0].options).toEqual(['High', 'Low'])
    const multi = updateField({ ...p, records: [rec('a', { n: 'a, b,a' })] }, 'n', { type: 'multi' }, AT)
    expect(multi.records[0].values.n).toEqual(['a', 'b'])
    expect(multi.fields[0].options).toEqual(['a', 'b'])
  })

  it('a type change drops filters and calculations on that field, keeps sorts', () => {
    const p = { ...formatPayload(), table: { filters: [{ field: 'due', op: 'is', value: 'x' }], calcs: { due: 'earliest' }, sorts: [{ field: 'due', dir: 'asc' }] } }
    const out = updateField(p, 'due', { type: 'text' }, AT)
    expect(out.table).toEqual({ filters: [], calcs: {}, sorts: [{ field: 'due', dir: 'asc' }] })
  })

  it('renames, adds and removes options; cells follow', () => {
    const p = { ...formatPayload(), records: [rec('a', { status: 'Doing' }), rec('b', { status: 'Done' })] }
    const r = renameOption(p, 'status', 'Doing', 'In progress', AT)
    expect(r.fields[1].options).toEqual(['To do', 'In progress', 'Done'])
    expect(r.records.map(x => x.values.status)).toEqual(['In progress', 'Done'])
    expect(renameOption(p, 'status', 'Doing', 'Done')).toBe(p)   // no clash
    expect(addOption(p, 'status', 'Blocked').fields[1].options).toContain('Blocked')
    const gone = removeOption(p, 'status', 'Done', AT)
    expect(gone.records[1].values).toEqual({})
  })

  it('removes a field with its values and every setting naming it', () => {
    const p = { ...formatPayload(), records: [rec('a', { title: 'A', due: '2026-01-01' })], table: { groupBy: 'due', hidden: ['due'], widths: { due: 90 }, sorts: [{ field: 'due' }], filters: [{ field: 'due' }] } }
    expect(filledCount(p, 'due')).toBe(1)
    const out = removeField(p, 'due', AT)
    expect(out.fields.map(f => f.id)).toEqual(['title', 'status'])
    expect(out.records[0].values).toEqual({ title: 'A' })
    expect(out.table).toEqual({ hidden: [], widths: {}, sorts: [], filters: [] })
    expect(removeField({ fields: [{ id: 'only' }], records: [] }, 'only').fields).toHaveLength(1)
  })

  it('moves a field', () => {
    expect(moveField(formatPayload(), 'due', 0).fields.map(f => f.id)).toEqual(['due', 'title', 'status'])
  })
})

describe('values', () => {
  it('converts between types', () => {
    expect(convertValue(true, 'check', 'text')).toBe('Yes')
    expect(convertValue('no', 'text', 'check')).toBe(false)
    expect(convertValue(0, 'number', 'check')).toBe(false)
    expect(convertValue(['x', 'y'], 'multi', 'select')).toBe('x')
    expect(convertValue('2026-3-4', 'text', 'date')).toBe('2026-03-04')
    expect(convertValue('', 'text', 'number')).toBeUndefined()
    expect(convertValue(1200.5, 'number', 'text')).toBe('1200.5')   // never the locale's 1,200.5
  })
  it('coerces what an editor commits', () => {
    expect(coerceValue({ type: 'number' }, '3.5')).toBe(3.5)
    expect(coerceValue({ type: 'text' }, '   ')).toBeUndefined()
    expect(coerceValue({ type: 'multi' }, [])).toBeUndefined()
    expect(coerceValue({ type: 'check' }, false)).toBeUndefined()
  })
  it('parses and prints', () => {
    expect(parseNumber('1 000')).toBe(1000)
    expect(parseNumber('abc')).toBeUndefined()
    expect(parseNumber('1,200')).toBe(1200)
    expect(parseNumber('1,234,567.5')).toBe(1234567.5)
    expect(parseNumber('1,5')).toBe(1.5)
    expect(parseNumber('-0,25')).toBe(-0.25)
    expect(parseNumber('3/4')).toBe(0.75)
    expect(parseNumber('1 1/2')).toBe(1.5)
    expect(parseNumber('-1/4')).toBe(-0.25)
    expect(parseNumber('1/0')).toBeUndefined()
    expect(parseNumber('1,2,3')).toBeUndefined()
    expect(parseDay('nope')).toBeUndefined()
    expect(cellText({ type: 'number', decimals: 2 }, 3)).toMatch(/3.00/)
    expect(cellText({ type: 'multi' }, ['a', 'b'])).toBe('a, b')
    expect(optionHue('Done')).toBe(optionHue('Done'))
  })
})

const FIELDS = [
  { id: 'title', name: 'Title', type: 'text' },
  { id: 'status', name: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] },
  { id: 'n', name: 'Points', type: 'number' },
  { id: 'due', name: 'Due', type: 'date' },
  { id: 'tags', name: 'Tags', type: 'multi', options: ['ui', 'api'] },
  { id: 'ok', name: 'OK', type: 'check' },
]
const ROWS = [
  rec('a', { title: 'Alpha', status: 'Done', n: 3, due: '2026-11-10', tags: ['ui'], ok: true }),
  rec('b', { title: 'beta', status: 'To do', n: 10, due: '2026-11-15', tags: ['ui', 'api'] }),
  rec('c', { title: 'Gamma', status: 'Doing' }),
]
const by = (rows) => rows.map(r => r.id)
const TODAY = '2026-11-13'

describe('filters', () => {
  const f = (op, value, field) => ({ field, op, value })
  it('match by type', () => {
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('contains', 'ET', 'title')] }))).toEqual(['b'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('gt', '5', 'n')] }))).toEqual(['b'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('is_not', 'Done', 'status')] }))).toEqual(['b', 'c'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('has', 'api', 'tags')] }))).toEqual(['b'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('overdue', null, 'due')] }, TODAY))).toEqual(['a'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('next7', null, 'due')] }, TODAY))).toEqual(['b'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('empty', null, 'due')] }))).toEqual(['c'])
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('checked', null, 'ok')] }))).toEqual(['a'])
  })
  it('all / any', () => {
    const filters = [f('is', 'Done', 'status'), f('gt', '5', 'n')]
    expect(by(filterRecords(ROWS, FIELDS, { filters }))).toEqual([])
    expect(by(filterRecords(ROWS, FIELDS, { filters, match: 'any' }))).toEqual(['a', 'b'])
  })
  it('a half-built filter hides nothing', () => {
    expect(matches(ROWS[0], f('contains', '', 'title'), FIELDS[0])).toBe(true)
    expect(by(filterRecords(ROWS, FIELDS, { filters: [f('is', 'x', 'gone')] }))).toEqual(['a', 'b', 'c'])
    expect(activeFilterCount({ filters: [f('contains', '', 'title'), f('empty', null, 'due')] }, FIELDS)).toBe(1)
  })
  it('offers operators per type', () => {
    expect(opsFor('url').map(o => o.id)).toContain('contains')
    expect(opsFor('check').every(o => !o.needsValue)).toBe(true)
  })
})

describe('sorts, groups, calculations', () => {
  it('sorts multi-key with empties last either way', () => {
    expect(by(sortRecords(ROWS, FIELDS, [{ field: 'n', dir: 'asc' }]))).toEqual(['a', 'b', 'c'])
    expect(by(sortRecords(ROWS, FIELDS, [{ field: 'n', dir: 'desc' }]))).toEqual(['b', 'a', 'c'])
    expect(by(sortRecords(ROWS, FIELDS, [{ field: 'status', dir: 'asc' }]))).toEqual(['b', 'c', 'a'])   // option order
    expect(by(sortRecords(ROWS, FIELDS, [{ field: 'title', dir: 'desc' }]))).toEqual(['c', 'b', 'a'])  // case-insensitive
  })
  it('groups by options in order, multi in each, empty last', () => {
    const g = groupRecords(ROWS, FIELDS[1])
    expect(g.map(x => [x.label, by(x.records)])).toEqual([['To do', ['b']], ['Doing', ['c']], ['Done', ['a']]])
    const t = groupRecords(ROWS, FIELDS[4])
    expect(t.map(x => [x.label, by(x.records)])).toEqual([['ui', ['a', 'b']], ['api', ['b']], ['No Tags', ['c']]])
    expect(groupRecords(ROWS, FIELDS[3]).map(x => x.label).at(-1)).toBe('No Due')
    expect(groupRecords(ROWS, null)[0].records).toBe(ROWS)
  })
  it('calculates footers', () => {
    expect(calculate(ROWS, FIELDS[2], 'sum')).toBe('13')
    expect(calculate(ROWS, FIELDS[2], 'avg')).toMatch(/6.5/)
    expect(calculate(ROWS, FIELDS[2], 'median')).toMatch(/6.5/)
    expect(calculate(ROWS, FIELDS[2], 'empty')).toBe('1')
    expect(calculate(ROWS, FIELDS[5], 'pct')).toBe('33%')
    expect(calculate(ROWS, FIELDS[0], 'sum')).toBe('')   // not offered for text
    expect(calcsFor('date').map(c => c.id)).toContain('earliest')
  })
  it('tableRows hides columns and keeps just-added records past the filter', () => {
    const source = { fields: FIELDS, records: ROWS }
    const config = { hidden: ['tags'], filters: [{ field: 'status', op: 'is', value: 'Done' }], sorts: [{ field: 'title', dir: 'asc' }] }
    const t = tableRows(source, config)
    expect(t.fields.map(f => f.id)).not.toContain('tags')
    expect(by(t.rows)).toEqual(['a'])
    expect(by(tableRows(source, config, { keep: new Set(['c']) }).rows)).toEqual(['a', 'c'])
  })
})

describe('source field verbs', () => {
  it('own records edit fields through commit; linked tasks cannot', () => {
    const commit = vi.fn()
    const src = ownSource(formatPayload(), commit)
    const id = src.addField({ name: 'Points', type: 'number' })
    expect(commit.mock.calls[0][0](formatPayload()).fields.at(-1)).toEqual({ id, name: 'Points', type: 'number' })
    src.renameOption('status', 'Doing', 'Busy')
    expect(commit.mock.calls[1][0](formatPayload()).fields[1].options).toContain('Busy')
    expect(taskSource({ type: 'tasks' }, { tasks: [] }).fieldsEditable).toBeFalsy()
  })
})
