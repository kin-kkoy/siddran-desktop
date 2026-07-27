// Pure GFM-table parser: markdown source -> a structured model. No DOM, so it's
// unit-tested directly. The live-preview widget (tableRender.js) and any future
// interactive editor both build on this.
//
// Scope (Phase 1): standard pipe tables with a header row, a delimiter row, and
// zero or more body rows. Outer pipes are optional (GFM allows both). Escaped pipes
// (`\|`) inside a cell are NOT yet handled — a known limitation, noted for P2.

// Split one table row into trimmed cell strings, tolerating optional outer pipes.
// A cell may contain a literal pipe escaped as `\|` (GFM) — needed for ||spoilers||
// and [[wikilink|alias]] inside cells — so we split on UNESCAPED pipes only and
// unescape afterwards.
function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue } // escaped pipe
    if (ch === '|') { cells.push(cur); cur = ''; continue }
    cur += ch
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

// Escape pipes (and strip newlines) when writing a cell back out.
const escapeCell = (v) => String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

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

// ── Editing operations ─────────────────────────────────────────────
// These parse the table into a grid, mutate it, and serialize back to canonical GFM
// markdown. Serializing normalises spacing (`| a | b |`) but preserves alignment.
// All pure — the widget dispatches the returned string as a CM change.

const ALIGN_DELIM = { left: ':--', right: '--:', center: ':-:' }
const delimFor = (a) => ALIGN_DELIM[a] || '---'
const rowLine = (cells) => `| ${cells.map(escapeCell).join(' | ')} |`

// Serialize a {headers, aligns, rows} grid back to GFM markdown (no trailing newline).
export function serializeTable(grid) {
  const cols = grid.headers.length
  const lines = [
    rowLine(grid.headers),
    rowLine(grid.aligns.slice(0, cols).map(delimFor)),
    ...grid.rows.map((r) => rowLine(padRow(r, cols))),
  ]
  return lines.join('\n')
}

const padRow = (row, cols) => {
  const out = row.slice(0, cols)
  while (out.length < cols) out.push('')
  return out
}

// Map a source line index (0 = header, 2+ = body) to the grid + a setter target.
function editGrid(md, mutate) {
  const grid = parseTable(md)
  if (!grid) return md
  mutate(grid)
  if (!grid.aligns) grid.aligns = grid.headers.map(() => null)
  return serializeTable(grid)
}

// Replace one cell's text. `line`: 0 = header, 2+ = body row. Returns new markdown.
export function setCell(md, line, col, text) {
  return editGrid(md, (g) => {
    // Newlines can't live in a cell (callers convert them to <br> first); pipes CAN,
    // and are escaped on serialize — so ||spoilers|| and [[link|alias]] survive.
    const clean = String(text).replace(/[\r\n]/g, ' ').trim()
    if (line === 0) { if (col < g.headers.length) g.headers[col] = clean }
    else { const r = g.rows[line - 2]; if (r && col < r.length) r[col] = clean }
  })
}

// Insert an empty body row. `afterBodyIndex` = -1 → top of body; else after that row.
export function insertRow(md, afterBodyIndex) {
  return editGrid(md, (g) => {
    const blank = g.headers.map(() => '')
    const at = Math.max(0, Math.min(g.rows.length, afterBodyIndex + 1))
    g.rows.splice(at, 0, blank)
  })
}

export function removeRow(md, bodyIndex) {
  return editGrid(md, (g) => {
    if (g.rows.length > 0 && bodyIndex >= 0 && bodyIndex < g.rows.length) g.rows.splice(bodyIndex, 1)
  })
}

// Insert an empty column. `afterCol` = -1 → leftmost; else after that column.
export function insertColumn(md, afterCol) {
  return editGrid(md, (g) => {
    const at = Math.max(0, Math.min(g.headers.length, afterCol + 1))
    g.headers.splice(at, 0, '')
    g.aligns.splice(at, 0, null)
    g.rows.forEach((r) => r.splice(at, 0, ''))
  })
}

export function removeColumn(md, col) {
  return editGrid(md, (g) => {
    if (g.headers.length <= 1) return // keep at least one column
    if (col < 0 || col >= g.headers.length) return
    g.headers.splice(col, 1)
    g.aligns.splice(col, 1)
    g.rows.forEach((r) => r.splice(col, 1))
  })
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
