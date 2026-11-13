import { describe, it, expect } from 'vitest'
import { parse, computeFormulas, checkFormula, renameRefs } from './formula'
import { updateField, addField } from './fields'
import { tableRows, calculate, sortRecords } from './query'
import { formatPayload } from './formats'

const calc = (expr, values = {}, extra = []) => {
  const fields = [{ id: 'a', name: 'A', type: 'number' }, { id: 'b', name: 'B', type: 'number' }, ...extra, { id: 'f', name: 'F', type: 'formula', expr }]
  const { records, errors } = computeFormulas(fields, [{ id: 'r', values }])
  return errors.get('r')?.f?.code ?? records[0].values.f
}

describe('formula arithmetic', () => {
  it('does the basics with the usual precedence', () => {
    expect(calc('1 + 2 * 3')).toBe(7)
    expect(calc('(1 + 2) * 3')).toBe(9)
    expect(calc('3/4 + 0.25')).toBe(1)
    expect(calc('.5 * 4')).toBe(2)
    expect(calc('10 − 4 × 2 ÷ 4')).toBe(8)
    expect(calc('-2^2')).toBe(-4)          // like a calculator: the square, then the minus
    expect(calc('2^3^2')).toBe(512)        // right to left
    expect(calc('0.1 + 0.2')).toBe(0.3)
    expect(calc('50%')).toBe(0.5)
  })
  it('squares, cubes and roots', () => {
    expect(calc('3²')).toBe(9)
    expect(calc('2³')).toBe(8)
    expect(calc('√16 + 1')).toBe(5)
    expect(calc('sqrt(2)^2')).toBeCloseTo(2)
    expect(calc('cbrt(27)')).toBe(3)
    expect(calc('round(2/3, 2)')).toBe(0.67)
    expect(calc('max(1, 5, 3) - min(4, 2)')).toBe(3)
    expect(calc('abs(-3) + floor(2.7) + ceil(0.2)')).toBe(6)
    expect(calc('round(pi, 3)')).toBe(3.142)
  })
  it('uses the row\'s fields by name', () => {
    expect(calc('{A} * {B}', { a: 4, b: 2.5 })).toBe(10)
    expect(calc('{a} + {B}', { a: 1, b: 1 })).toBe(2)          // names ignore case
    expect(calc('{A} * {B}', { a: 4 })).toBeUndefined()        // an empty value leaves the result empty
    expect(calc('{A} + {T}', { a: 1, t: '2.5' }, [{ id: 't', name: 'T', type: 'text' }])).toBe(3.5)
    expect(calc('{A} + {C}', { a: 1, c: true }, [{ id: 'c', name: 'C', type: 'check' }])).toBe(2)
  })
  it('errors are values, not crashes', () => {
    expect(calc('1/0')).toBe('#DIV/0')
    expect(calc('{A} + {T}', { a: 1, t: 'x' }, [{ id: 't', name: 'T', type: 'text' }])).toBe('#VALUE')
    expect(calc('{Nope}')).toBe('#NAME')
    expect(calc('sqrt(-1)')).toBe('#ERROR')
    expect(calc('1 +')).toBe('#ERROR')
    expect(() => parse('2 $ 3')).toThrow(/isn't something/)
    expect(() => parse('foo(1)')).toThrow(/Unknown function/)
  })
  it('formulas can use formulas, but not in a circle', () => {
    const fields = [{ id: 'a', name: 'A', type: 'number' }, { id: 'x', name: 'X', type: 'formula', expr: '{A} * 2' }, { id: 'y', name: 'Y', type: 'formula', expr: '{X} + 1' }]
    expect(computeFormulas(fields, [{ id: 'r', values: { a: 3 } }]).records[0].values).toMatchObject({ x: 6, y: 7 })
    const loop = [{ id: 'p', name: 'P', type: 'formula', expr: '{Q} + 1' }, { id: 'q', name: 'Q', type: 'formula', expr: '{P} + 1' }]
    expect(computeFormulas(loop, [{ id: 'r', values: {} }]).errors.get('r').p.code).toBe('#CYCLE')
  })
  it('checks an expression while you write it', () => {
    const fields = [{ id: 'a', name: 'Price', type: 'number' }, { id: 'f', name: 'Total', type: 'formula' }]
    expect(checkFormula('{Price} * 2', fields, 'f')).toBe('')
    expect(checkFormula('{Cost} * 2', fields, 'f')).toMatch(/No field named/)
    expect(checkFormula('{Total} + 1', fields, 'f')).toMatch(/own column/)
  })
})

describe('formula columns in a table', () => {
  const fields = [{ id: 'p', name: 'Price', type: 'number' }, { id: 'q', name: 'Qty', type: 'number' }, { id: 't', name: 'Total', type: 'formula', expr: '{Price} * {Qty}' }]
  const records = [{ id: '1', values: { p: 2, q: 10 } }, { id: '2', values: { p: 5, q: 3 } }]
  it('sort, filter and total like numbers', () => {
    const t = tableRows({ fields, records }, { sorts: [{ field: 't', dir: 'asc' }], filters: [{ field: 't', op: 'gt', value: '10' }] })
    expect(t.rows.map(r => [r.id, r.values.t])).toEqual([['2', 15], ['1', 20]])
    expect(calculate(t.rows, fields[2], 'sum')).toBe('35')
    expect(sortRecords(t.rows, fields, [{ field: 't', dir: 'desc' }]).map(r => r.id)).toEqual(['1', '2'])
  })
  it('renaming a field rewrites the formulas that use it', () => {
    const p = { ...formatPayload(), fields, records }
    const out = updateField(p, 'p', { name: 'Cost' })
    expect(out.fields[2].expr).toBe('{Cost} * {Qty}')
    expect(renameRefs('{ price }+1', 'Price', 'Cost')).toBe('{Cost}+1')
  })
  it('turning a formula into a number keeps what it showed; into a formula clears stored values', () => {
    const p = { ...formatPayload(), fields, records }
    const num = updateField(p, 't', { type: 'number' }, { at: 'T' })
    expect(num.records.map(r => r.values.t)).toEqual([20, 15])
    expect(num.fields[2].expr).toBeUndefined()
    const back = updateField(num, 't', { type: 'formula' }, { at: 'T' })
    expect(back.records.map(r => r.values.t)).toEqual([undefined, undefined])
    expect(back.fields[2].expr).toBe('')
    expect(addField(formatPayload(), { type: 'formula' }, { id: 'z' }).field).toEqual({ id: 'z', name: 'Formula', type: 'formula', expr: '' })
  })
})
