import { describe, it, expect } from 'vitest'
import { parseTable } from './tableModel.js'

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
