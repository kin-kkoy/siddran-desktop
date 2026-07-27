import { describe, it, expect } from 'vitest'
import { parseTable, cellSourceOffset, serializeTable, setCell, insertRow, removeRow, insertColumn, removeColumn } from './tableModel.js'

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

describe('table editing ops', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'

  it('serialize round-trips a parsed grid (canonical spacing)', () => {
    expect(serializeTable(parseTable(md))).toBe(md)
  })

  it('serialize preserves alignment', () => {
    const src = '| A | B | C |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |'
    expect(serializeTable(parseTable(src))).toBe(src)
  })

  it('setCell edits a header cell', () => {
    expect(parseTable(setCell(md, 0, 1, 'Beta')).headers).toEqual(['A', 'Beta'])
  })

  it('setCell edits a body cell (line 2+)', () => {
    expect(parseTable(setCell(md, 3, 0, 'x')).rows).toEqual([['1', '2'], ['x', '4']])
  })

  it('setCell strips newlines but KEEPS pipes (escaped on serialize)', () => {
    expect(parseTable(setCell(md, 2, 0, 'a|b\nc')).rows[0][0]).toBe('a|b c')
  })

  it('insertRow adds an empty row after the given body index', () => {
    expect(parseTable(insertRow(md, 0)).rows).toEqual([['1', '2'], ['', ''], ['3', '4']])
  })

  it('insertRow with -1 adds at the top of the body', () => {
    expect(parseTable(insertRow(md, -1)).rows[0]).toEqual(['', ''])
  })

  it('removeRow deletes a body row', () => {
    expect(parseTable(removeRow(md, 0)).rows).toEqual([['3', '4']])
  })

  it('insertColumn adds an empty column after the given index', () => {
    const g = parseTable(insertColumn(md, 0))
    expect(g.headers).toEqual(['A', '', 'B'])
    expect(g.rows[0]).toEqual(['1', '', '2'])
  })

  it('removeColumn drops a column across header + body', () => {
    const g = parseTable(removeColumn(md, 1))
    expect(g.headers).toEqual(['A'])
    expect(g.rows).toEqual([['1'], ['3']])
  })

  it('removeColumn refuses to drop the last column', () => {
    const one = '| A |\n| --- |\n| 1 |'
    expect(removeColumn(one, 0)).toBe(one)
  })

  it('ops on a non-table return the input unchanged', () => {
    expect(setCell('nope', 0, 0, 'x')).toBe('nope')
  })

  // Escaped pipes let a cell hold ||spoilers|| and [[link|alias]] — without them the
  // pipe would be read as a cell delimiter and split the row.
  it('parses an escaped pipe as cell content, not a delimiter', () => {
    const t = parseTable('| A | B |\n| --- | --- |\n| a \\| b | c |')
    expect(t.rows[0]).toEqual(['a | b', 'c'])
  })

  it('round-trips a cell containing pipes', () => {
    const withSpoiler = setCell('| A | B |\n| --- | --- |\n| x | y |', 2, 0, '||secret||')
    expect(withSpoiler).toContain('\\|\\|secret\\|\\|')       // escaped on disk
    expect(parseTable(withSpoiler).rows[0][0]).toBe('||secret||') // unescaped on read
  })

  it('round-trips a wikilink alias in a cell', () => {
    const md = setCell('| A |\n| --- |\n| x |', 2, 0, '[[Note|alias]]')
    expect(parseTable(md).rows[0][0]).toBe('[[Note|alias]]')
  })

  it('still strips newlines from a cell value', () => {
    const md = setCell('| A |\n| --- |\n| x |', 2, 0, 'a\nb')
    expect(parseTable(md).rows[0][0]).toBe('a b')
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
