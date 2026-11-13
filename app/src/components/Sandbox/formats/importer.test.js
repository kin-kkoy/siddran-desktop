import { describe, it, expect } from 'vitest'
import { parseDelimited, detectDelimiter, guessType, readCell, planImport, applyImport } from './importer'
import { formatPayload } from './formats'

const seq = (pre) => { let n = 0; return () => `${pre}${++n}` }

describe('reading pasted / CSV text', () => {
  it('parses tabs, commas, quotes and CRLF', () => {
    expect(detectDelimiter('a\tb\nc\td')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(parseDelimited('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseDelimited('name,note\n"Smith, J","said ""hi""\nthen left"\n')).toEqual([['name', 'note'], ['Smith, J', 'said "hi"\nthen left']])
    expect(parseDelimited('\uFEFFx,y\n1,2\n\n')).toEqual([['x', 'y'], ['1', '2']])
  })
  it('guesses a new column\'s type', () => {
    expect(guessType(['1', '2,500', '3.5'])).toBe('number')
    expect(guessType(['2026-01-02', '2026-3-4'])).toBe('date')
    expect(guessType(['yes', 'no', 'Yes'])).toBe('check')
    expect(guessType(['High', 'Low', 'High', 'Low', 'High'])).toBe('select')
    expect(guessType(['Dune', 'Emma', 'Ulysses'])).toBe('text')
    expect(guessType(['https://a.b', 'http://c.d'])).toBe('url')
  })
  it('reads a cell by type', () => {
    expect(readCell('number', '1,200')).toBe(1200)
    expect(readCell('check', 'x')).toBe(true)
    expect(readCell('check', 'no')).toBeUndefined()
    expect(readCell('date', '13/11/2026')).toBe('2026-11-13')
    expect(readCell('multi', 'a, b; a')).toEqual(['a', 'b'])
    expect(readCell('formula', '5')).toBeUndefined()
  })
})

describe('planning and applying an import', () => {
  const fields = formatPayload().fields   // Title, Status, Due
  it('matches headers by name and makes new fields for the rest', () => {
    const plan = planImport(parseDelimited('title\tPoints\tstatus\nDune\t5\tDone\nEmma\t3\tTo do'), fields)
    expect(plan.header).toBe(true)
    expect(plan.columns.map(c => [c.name, c.target, c.type])).toEqual([['title', 'title', 'text'], ['Points', 'new', 'number'], ['status', 'status', 'select']])
    const ids = { field: seq('F'), record: seq('R') }
    const out = applyImport(formatPayload(), plan, { ids, at: 'T' })
    expect(out).toMatchObject({ added: 2, updated: 0, newFields: 1 })
    expect(out.payload.fields.at(-1)).toEqual({ id: 'F1', name: 'Points', type: 'number' })
    expect(out.payload.records).toEqual([
      { id: 'R1', values: { title: 'Dune', F1: 5, status: 'Done' }, updated_at: 'T' },
      { id: 'R2', values: { title: 'Emma', F1: 3, status: 'To do' }, updated_at: 'T' },
    ])
  })
  it('without a header, columns land from the selected one; new options are added', () => {
    const plan = planImport([['Blocked', '2026-12-01'], ['Doing', '']], fields, { startCol: 1 })
    expect(plan.header).toBe(false)
    expect(plan.columns.map(c => c.target)).toEqual(['status', 'due'])
    const base = { ...formatPayload(), records: [{ id: 'a', values: { title: 'A', status: 'To do', due: '2026-01-01' } }, { id: 'b', values: { title: 'B' } }] }
    const out = applyImport(base, plan, { mode: 'fill', fill: { rows: ['a', 'b'] }, at: 'T', ids: { record: seq('R') } })
    expect(out).toMatchObject({ added: 0, updated: 2 })
    expect(out.payload.records[0].values).toEqual({ title: 'A', status: 'Blocked', due: '2026-12-01' })
    expect(out.payload.records[1].values).toEqual({ title: 'B', status: 'Doing' })
    expect(out.payload.fields[1].options).toContain('Blocked')
  })
  it('fill runs past the end by adding records', () => {
    const plan = planImport([['X'], ['Y']], fields, { header: false })
    const base = { ...formatPayload(), records: [{ id: 'a', values: { title: 'A' } }] }
    const out = applyImport(base, plan, { mode: 'fill', fill: { rows: ['a'] }, ids: { record: seq('R') } })
    expect(out.payload.records.map(r => r.values.title)).toEqual(['X', 'Y'])
    expect(out).toMatchObject({ added: 1, updated: 1 })
  })
  it('caps an import at 500 rows and 30 columns', () => {
    const big = Array.from({ length: 700 }, (_, i) => Array.from({ length: 40 }, (_, j) => `${i}-${j}`))
    const plan = planImport(big, fields, { header: false })
    expect(plan.body).toHaveLength(500)
    expect(plan.columns).toHaveLength(30)
    expect(plan.truncated).toBe(true)
  })
  it('skipped columns and formula fields are left alone', () => {
    const f2 = [...fields, { id: 'fx', name: 'Total', type: 'formula', expr: '1' }]
    const plan = planImport([['Title', 'Total'], ['A', '9']], f2)
    expect(plan.columns[1].target).toBe('new')   // never into a formula
    plan.columns[1].target = 'skip'
    const out = applyImport({ ...formatPayload(), fields: f2 }, plan, { ids: { record: seq('R') } })
    expect(out.payload.records[0].values).toEqual({ title: 'A' })
    expect(out.newFields).toBe(0)
  })
})
