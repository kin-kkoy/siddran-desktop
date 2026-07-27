// Pure GFM-table parser: markdown source -> a structured model. No DOM, so it's
// unit-tested directly. The live-preview widget (tableRender.js) and any future
// interactive editor both build on this.
//
// Scope (Phase 1): standard pipe tables with a header row, a delimiter row, and
// zero or more body rows. Outer pipes are optional (GFM allows both). Escaped pipes
// (`\|`) inside a cell are NOT yet handled — a known limitation, noted for P2.

// Split one table row into trimmed cell strings, tolerating optional outer pipes.
function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

// A delimiter cell is dashes with optional leading/trailing colons: --- :-- --: :-:
function alignOf(cell) {
  const s = cell.trim()
  if (!/^:?-+:?$/.test(s)) return undefined // not a valid delimiter cell
  const left = s.startsWith(':'), right = s.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null // aligned by default
}

/**
 * Parse GFM table markdown into { headers, aligns, rows } or null if it isn't a
 * well-formed table (needs at least a header row + a valid delimiter row).
 */
export function parseTable(md) {
  const lines = String(md).split('\n').map((l) => l.replace(/\r$/, '')).filter((l, i, a) => {
    // keep interior lines; drop only leading/trailing blank lines
    if (l.trim() !== '') return true
    return i !== 0 && i !== a.length - 1 ? true : false
  })
  // re-trim leading/trailing blanks that survived the filter edge cases
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()

  if (lines.length < 2) return null

  const headers = splitRow(lines[0])
  const delimCells = splitRow(lines[1])
  const aligns = delimCells.map(alignOf)
  // every delimiter cell must be valid, and column counts must line up
  if (aligns.some((a) => a === undefined)) return null
  if (delimCells.length !== headers.length) return null

  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l)
    // pad/truncate to the header width so the grid is rectangular
    const out = cells.slice(0, headers.length)
    while (out.length < headers.length) out.push('')
    return out
  })

  return { headers, aligns, rows }
}

// Char offset within the table markdown `md` of the START of the cell content at the
// given source LINE index (0 = header, 1 = delimiter, 2+ = body rows) and column.
// Used to drop the caret into the exact cell whose rendered cell was clicked.
// Returns null if the line/column is out of range.
export function cellSourceOffset(md, lineIndex, col) {
  const lines = String(md).split('\n')
  if (lineIndex < 0 || lineIndex >= lines.length || col < 0) return null
  let base = 0
  for (let i = 0; i < lineIndex; i++) base += lines[i].length + 1 // + '\n'
  const line = lines[lineIndex]
  let i = line[0] === '|' ? 1 : 0 // skip a leading outer pipe
  let c = 0
  while (i <= line.length) {
    if (c === col) {
      while (i < line.length && line[i] === ' ') i++ // land on the first non-space
      return base + i
    }
    const p = line.indexOf('|', i)
    if (p === -1) return null // fewer columns than requested
    i = p + 1
    c++
  }
  return null
}
