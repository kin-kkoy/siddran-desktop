// Live-preview tables — rendered AND editable in place. A block-level StateField
// (block decorations must come from a StateField, not a ViewPlugin) replaces each
// well-formed GFM table with a rendered <table> widget. Unlike the inline marks, the
// table does NOT reveal its raw `| --- |` markdown when the caret is near it — that
// read as janky. Instead you edit it in place:
//   • click a cell        → that one cell becomes editable (its raw text), commit on
//                            blur/Enter; the rest of the table stays rendered.
//   • hover the table      → +/- controls on the bottom (rows) and right (columns).
// Every edit is applied by dispatching a replacement of the table's source range with
// markdown rebuilt by the pure ops in tableModel.js.
//
// A table that doesn't parse cleanly is left as normal source (no widget), so it's
// always still editable as raw text — the escape hatch.

import { StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { renderTableDOM } from './tableRender'
import { renderInlineInto } from './inlineRender'
import { parseTable, setCell, insertRow, removeRow, insertColumn, removeColumn } from './tableModel'

function mkBtn(label, title, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-table-btn'
  b.textContent = label
  b.title = title
  b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onClick() })
  return b
}

class TableWidget extends WidgetType {
  // `from` = the table's start offset in the document; part of eq() so the widget
  // re-renders (with a current `from`) when an edit above shifts the table.
  constructor(md, from) { super(); this.md = md; this.from = from }
  eq(other) { return other.md === this.md && other.from === this.from }
  ignoreEvent() { return false } // we handle mousedown ourselves

  // Replace the table's source range with rebuilt markdown.
  apply(view, newMd) {
    if (newMd && newMd !== this.md) {
      view.dispatch({ changes: { from: this.from, to: this.from + this.md.length, insert: newMd } })
      view.focus()
    }
  }

  editCell(view, cell, grid) {
    const line = Number(cell.dataset.line)
    const col = Number(cell.dataset.col)
    const raw = line === 0 ? (grid.headers[col] ?? '') : (grid.rows[line - 2]?.[col] ?? '')

    cell.textContent = raw
    cell.contentEditable = 'true'
    cell.classList.add('cm-cell-editing')
    cell.focus()
    const sel = window.getSelection?.()
    if (sel) { const r = document.createRange(); r.selectNodeContents(cell); sel.removeAllRanges(); sel.addRange(r) }

    let done = false
    const revert = () => {
      cell.contentEditable = 'false'
      cell.classList.remove('cm-cell-editing')
      cell.textContent = ''
      renderInlineInto(cell, raw)
    }
    const commit = () => {
      if (done) return
      done = true
      const next = setCell(this.md, line, col, cell.textContent || '')
      if (next !== this.md) this.apply(view, next) // dispatch → whole table re-renders
      else revert()
    }
    cell.addEventListener('blur', commit, { once: true })
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); cell.blur() }
      else if (e.key === 'Escape') { e.preventDefault(); done = true; revert() }
    })
  }

  toDOM(view) {
    const grid = parseTable(this.md)
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const table = renderTableDOM(this.md)
    wrap.appendChild(table)
    if (!grid) return wrap // malformed — no editing affordances

    table.addEventListener('mousedown', (e) => {
      const cell = e.target.closest?.('th, td')
      if (!cell || cell.dataset.line == null || cell.isContentEditable) return
      e.preventDefault()
      this.editCell(view, cell, grid)
    })

    // Row controls (bottom edge): add a row / delete the last row.
    const rowCtl = document.createElement('div')
    rowCtl.className = 'cm-table-rowctl'
    rowCtl.appendChild(mkBtn('+', 'Add row', () => this.apply(view, insertRow(this.md, grid.rows.length - 1))))
    if (grid.rows.length > 0) {
      rowCtl.appendChild(mkBtn('−', 'Delete last row', () => this.apply(view, removeRow(this.md, grid.rows.length - 1))))
    }
    wrap.appendChild(rowCtl)

    // Column controls (right edge): add a column / delete the last column.
    const colCtl = document.createElement('div')
    colCtl.className = 'cm-table-colctl'
    colCtl.appendChild(mkBtn('+', 'Add column', () => this.apply(view, insertColumn(this.md, grid.headers.length - 1))))
    if (grid.headers.length > 1) {
      colCtl.appendChild(mkBtn('−', 'Delete last column', () => this.apply(view, removeColumn(this.md, grid.headers.length - 1))))
    }
    wrap.appendChild(colCtl)

    return wrap
  }
}

// Walk the tree once and collect every table's [from,to]. Only called on doc changes.
const SKIP_SUBTREE = new Set([
  'Paragraph', 'FencedCode', 'CodeBlock', 'CommentBlock', 'HTMLBlock', 'LinkReference',
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
])
function scanTables(state) {
  const tables = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') { tables.push({ from: node.from, to: node.to }); return false }
      if (SKIP_SUBTREE.has(node.name)) return false
      return undefined
    },
  })
  return tables
}

// Build the widget set from cached table ranges. Well-formed tables become a rendered
// widget (always — no caret-reveal); a table that doesn't parse is left as source.
function decoFrom(state, tables) {
  const doc = state.doc
  const widgets = []
  for (const t of tables) {
    if (t.from > doc.length || t.to > doc.length) continue
    const md = doc.sliceString(t.from, t.to)
    if (!parseTable(md)) continue // malformed → leave editable as raw source
    const from = doc.lineAt(t.from).from
    const to = doc.lineAt(t.to).to
    widgets.push(Decoration.replace({ widget: new TableWidget(md, from), block: true }).range(from, to))
  }
  return Decoration.set(widgets, true)
}

// Exported for unit testing.
export function buildTableDeco(state) {
  return decoFrom(state, scanTables(state))
}

export const liveTables = StateField.define({
  create(state) {
    const tables = scanTables(state)
    return { tables, deco: decoFrom(state, tables) }
  },
  update(value, tr) {
    // Table rendering no longer depends on the selection (always rendered), so only
    // a document change can change anything.
    if (tr.docChanged) {
      const tables = scanTables(tr.state)
      return { tables, deco: decoFrom(tr.state, tables) }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})
