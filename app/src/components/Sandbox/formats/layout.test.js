import { describe, it, expect } from 'vitest'
import { orderFields, moveColumn, orderRecords, moveRecord, cellStyle, applyStyle, pruneStyles, selRange, rangeToTSV } from './layout'
import { removeRecord, updateRecords, formatPayload } from './formats'
import { removeField } from './fields'
import { tableRows } from './query'

const F = [{ id: 'a', name: 'A', type: 'text' }, { id: 'b', name: 'B', type: 'number' }, { id: 'c', name: 'C', type: 'text' }]
const R = [{ id: 'r1', values: { a: 'x', b: 1 } }, { id: 'r2', values: { a: 'y', b: 2 } }, { id: 'r3', values: { a: 'z\tq', b: 3 } }]
const ids = (xs) => xs.map(x => x.id)

describe('column order', () => {
  it('orders by the view, unknown fields after', () => {
    expect(ids(orderFields(F, ['c', 'a']))).toEqual(['c', 'a', 'b'])
    expect(orderFields(F, undefined)).toBe(F)
  })
  it('moves a column', () => {
    expect(moveColumn(F, 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveColumn(F, 'c', 0)).toEqual(['c', 'a', 'b'])
  })
  it('the table shows columns in that order', () => {
    expect(ids(tableRows({ fields: F, records: R }, { fieldOrder: ['b'] }).fields)).toEqual(['b', 'a', 'c'])
  })
})

describe('row order', () => {
  it('moves a record, setting only its own stamp', () => {
    const p = { records: R.map(r => ({ ...r, updated_at: 'old' })) }
    const out = moveRecord(p, 'r3', 'r1', { at: 'T' })
    expect(ids(orderRecords(out.records))).toEqual(['r3', 'r1', 'r2'])
    expect(out.records.find(r => r.id === 'r3').updated_at).toBe('T')
    expect(out.records.find(r => r.id === 'r1').updated_at).toBe('old')
    const end = moveRecord(out, 'r3', null)
    expect(ids(orderRecords(end.records))).toEqual(['r1', 'r2', 'r3'])
    const mid = moveRecord(end, 'r1', 'r3')
    expect(ids(orderRecords(mid.records))).toEqual(['r2', 'r1', 'r3'])
  })
  it('records without an order keep array order', () => {
    expect(orderRecords(R)).toBe(R)
  })
  it('updates several records in one change', () => {
    const out = updateRecords({ records: R }, [{ id: 'r1', patch: { a: undefined } }, { id: 'r3', patch: { b: 9 } }], { at: 'T' })
    expect(out.records.map(r => r.values.b)).toEqual([1, 2, 9])
    expect(out.records[0].values.a).toBeUndefined()
    expect(out.records[1].updated_at).toBeUndefined()
  })
})

describe('styles', () => {
  it('cell over row over column', () => {
    let s = applyStyle({}, { cols: ['a'] }, { bold: true, color: '#f00' })
    s = applyStyle(s, { rows: ['r1'] }, { color: '#0f0' })
    s = applyStyle(s, { cells: [['r1', 'a']] }, { italic: true })
    expect(cellStyle(s, 'r1', 'a')).toEqual({ bold: true, color: '#0f0', italic: true })
    expect(cellStyle(s, 'r2', 'a')).toEqual({ bold: true, color: '#f00' })
    expect(cellStyle(s, 'r2', 'b')).toBeNull()
  })
  it('a column style overrides cell styles of the same keys inside it', () => {
    let s = applyStyle({}, { cells: [['r1', 'a']] }, { bold: true, italic: true })
    s = applyStyle(s, { cols: ['a'] }, { bold: false })
    expect(cellStyle(s, 'r1', 'a')).toEqual({ italic: true })
  })
  it('null clears everything', () => {
    const s = applyStyle(applyStyle({}, { cells: [['r1', 'a']] }, { bold: true }), { cells: [['r1', 'a']] }, null)
    expect(s).toEqual({})
  })
  it('styles go with their record or field', () => {
    let s = applyStyle({}, { cells: [['r1', 'a'], ['r2', 'a']] }, { bold: true })
    s = applyStyle(s, { rows: ['r1'] }, { bold: true })
    expect(Object.keys(pruneStyles(s, { rid: 'r1' }).cell)).toEqual(['r2|a'])
    const p = { ...formatPayload(), records: R, table: { styles: s } }
    expect(removeRecord(p, 'r1').table.styles.row).toEqual({})
    const q = { ...formatPayload(), table: { styles: applyStyle({}, { cols: ['due'] }, { bold: true }), fieldOrder: ['due', 'title'] } }
    const out = removeField(q, 'due')
    expect(out.table.styles.col).toEqual({})
    expect(out.table.fieldOrder).toEqual(['title'])
  })
})

describe('selection', () => {
  it('covers cells, whole rows, whole columns', () => {
    const a = { ri: 2, ci: 0 }, b = { ri: 0, ci: 1 }
    expect(selRange({ mode: 'cells', a, b }, 3, 3)).toEqual({ r0: 0, r1: 2, c0: 0, c1: 1 })
    expect(selRange({ mode: 'rows', a, b }, 3, 3)).toEqual({ r0: 0, r1: 2, c0: 0, c1: 2 })
    expect(selRange({ mode: 'cols', a: { ri: 0, ci: 1 }, b: { ri: 0, ci: 1 } }, 3, 3)).toEqual({ r0: 0, r1: 2, c0: 1, c1: 1 })
    expect(selRange({ mode: 'cells', a, b: a }, 0, 3)).toBeNull()
  })
  it('copies a range as tab-separated text', () => {
    expect(rangeToTSV(R, F, { r0: 1, r1: 2, c0: 0, c1: 1 }, { header: true })).toBe('A\tB\ny\t2\nz q\t3')
  })
})
