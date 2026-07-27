import { describe, it, expect } from 'vitest'
import { parseTable, cellSourceOffset } from './tableModel.js'

describe('parseTable', () => {
  it('parses a standard table with outer pipes', () => {
    const t = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.aligns).toEqual([null, null])
    expect(t.rows).toEqual([['1', '2'], ['3', '4']])
  })

  it('parses without outer pipes', () => {
    const t = parseTable('A | B\n--- | ---\n1 | 2')
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('reads column alignment from the delimiter row', () => {
    const t = parseTable('| L | C | R | D |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |')
    expect(t.aligns).toEqual(['left', 'center', 'right', null])
  })

  it('pads short body rows to the header width', () => {
    const t = parseTable('| A | B | C |\n| --- | --- | --- |\n| 1 |')
    expect(t.rows[0]).toEqual(['1', '', ''])
  })

  it('truncates over-long body rows', () => {
    const t = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 | 3 |')
    expect(t.rows[0]).toEqual(['1', '2'])
  })

  it('handles a header-only table (delimiter, no body)', () => {
    const t = parseTable('| A | B |\n| --- | --- |')
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([])
  })

  it('tolerates surrounding blank lines', () => {
    const t = parseTable('\n| A | B |\n| --- | --- |\n| 1 | 2 |\n')
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('rejects a non-table', () => {
    expect(parseTable('just text')).toBeNull()
    expect(parseTable('| A | B |')).toBeNull()          // no delimiter row
    expect(parseTable('| A | B |\n| x | y |')).toBeNull() // 2nd row not a delimiter
  })

  it('rejects a delimiter/header column-count mismatch', () => {
    expect(parseTable('| A | B | C |\n| --- | --- |')).toBeNull()
  })

  it('keeps the starter table the Insert Table command produces', () => {
    const t = parseTable('| Column 1 | Column 2 |\n| --- | --- |\n|  |  |')
    expect(t.headers).toEqual(['Column 1', 'Column 2'])
    expect(t.rows).toEqual([['', '']])
  })
})

describe('cellSourceOffset', () => {
  const md = '| Column 1 | Column 2 |\n| --- | --- |\n| a | b |'
  const at = (off) => md[off] // char landed on

  it('lands on the first header cell content', () => {
    const off = cellSourceOffset(md, 0, 0)
    expect(md.slice(off, off + 8)).toBe('Column 1')
  })

  it('lands on the second header cell content', () => {
    const off = cellSourceOffset(md, 0, 1)
    expect(md.slice(off, off + 8)).toBe('Column 2')
  })

  it('lands on a body cell content (line 2)', () => {
    expect(at(cellSourceOffset(md, 2, 0))).toBe('a')
    expect(at(cellSourceOffset(md, 2, 1))).toBe('b')
  })

  it('returns an absolute offset that maps back to the right line', () => {
    const off = cellSourceOffset(md, 2, 0)
    // everything before `off` contains both earlier lines
    expect(md.slice(0, off)).toContain('Column 1')
    expect(md.slice(0, off)).toContain('---')
  })

  it('handles an empty cell (lands inside its region)', () => {
    const empty = '| A | B |\n| --- | --- |\n|  |  |'
    const off = cellSourceOffset(empty, 2, 0)
    // between the first and second pipe of "|  |  |"
    const pipe0 = empty.lastIndexOf('\n') + 1
    expect(off).toBeGreaterThan(pipe0)
    expect(off).toBeLessThanOrEqual(empty.indexOf('|', pipe0 + 1))
  })

  it('returns null when out of range', () => {
    expect(cellSourceOffset(md, 0, 9)).toBeNull()
    expect(cellSourceOffset(md, 99, 0)).toBeNull()
    expect(cellSourceOffset(md, -1, 0)).toBeNull()
  })
})
