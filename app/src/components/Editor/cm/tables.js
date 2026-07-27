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

import { StateField, EditorState } from '@codemirror/state'
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
  // pointerdown (not mousedown) + preventDefault keeps focus off CM and out of any
  // active cell input, so the button fires without ending the edit session oddly.
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClick() })
  return b
}

class TableWidget extends WidgetType {
  // `from` = the table's start offset in the document; part of eq() so the widget
  // re-renders (with a current `from`) when an edit above shifts the table.
  constructor(md, from) { super(); this.md = md; this.from = from }
  eq(other) { return other.md === this.md && other.from === this.from }
  // Tell CodeMirror to stay out of the widget entirely — our own handlers do all the
  // work. Without this, keystrokes in a cell input still reached CM's keymap and acted
  // at the document caret (backspace/enter hitting the wrong line).
  ignoreEvent() { return true }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    // The whole widget is a non-editable island as far as CM is concerned. Form
    // controls (the cell <input> and the +/- buttons) inside it still work — the
    // browser handles them — but their keystrokes never reach CodeMirror.
    wrap.contentEditable = 'false'

    const table = renderTableDOM(this.md)
    wrap.appendChild(table)
    if (!parseTable(this.md)) return wrap // malformed — no editing affordances

    // ── editing session ──────────────────────────────────────────────
    // Cell edits accumulate in `working` (a local copy of the markdown) and update
    // the DOM in place, WITHOUT touching the document — so the widget isn't recreated
    // mid-edit and you can move between cells freely. The whole session is written
    // back to the document in one transaction when focus leaves the table.
    let working = this.md
    let active = null // { cell, line, col, input }
    const self = this

    const cellRaw = (line, col) => {
      const g = parseTable(working)
      if (!g) return ''
      return line === 0 ? (g.headers[col] ?? '') : (g.rows[line - 2]?.[col] ?? '')
    }
    const renderRendered = (cell, line, col) => {
      cell.textContent = ''
      renderInlineInto(cell, cellRaw(line, col))
      cell.classList.remove('cm-cell-editing')
    }
    const commitActive = () => {
      if (!active) return
      const { cell, line, col, input } = active
      // Cells can't hold a literal newline in markdown; store multi-line content as
      // <br> (GFM/portable) — the reading view (remarkBr) renders it identically.
      working = setCell(working, line, col, input.value.replace(/\n/g, '<br>'))
      active = null
      renderRendered(cell, line, col)
    }
    const endSession = () => {
      commitActive()
      if (working !== self.md) {
        view.dispatch({ changes: { from: self.from, to: self.from + self.md.length, insert: working } })
      }
      view.focus()
    }
    const applyStructural = (newMd) => {
      // +/- controls: fold in any active edit, then dispatch the structural change.
      commitActive()
      working = newMd
      endSession()
    }

    const startEdit = (cell, line, col) => {
      if (active && active.cell === cell) return
      commitActive()
      const input = document.createElement('textarea')
      input.className = 'cm-cell-input'
      input.rows = 1
      input.value = cellRaw(line, col).replace(/<br\s*\/?>/gi, '\n') // <br> shows as real lines while editing
      cell.textContent = ''
      cell.appendChild(input)
      cell.classList.add('cm-cell-editing')
      const autosize = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px` }
      input.addEventListener('input', autosize)
      input.focus()
      const end = input.value.length // caret at end, not select-all (typing edits, not replaces)
      input.setSelectionRange(end, end)
      autosize()
      active = { cell, line, col, input }
      input.addEventListener('keydown', (e) => {
        e.stopPropagation() // keep CM from acting on keys while a cell is being edited
        // Enter inserts a newline in the cell (textarea default). Commit happens when
        // focus leaves the table, on Tab (next cell), or clicking away.
        if (e.key === 'Escape') { e.preventDefault(); const a = active; active = null; renderRendered(a.cell, a.line, a.col) }
        else if (e.key === 'Tab') { e.preventDefault(); focusSibling(cell, e.shiftKey ? -1 : 1) }
      })
    }

    const cellsInOrder = () => Array.from(table.querySelectorAll('th, td'))
    const focusSibling = (cell, dir) => {
      const cells = cellsInOrder()
      const i = cells.indexOf(cell)
      const next = cells[i + dir]
      if (next) startEdit(next, Number(next.dataset.line), Number(next.dataset.col))
      else endSession()
    }

    // One handler for the whole widget: never let a click place a CM caret in the
    // table (that was the "caret before/after the table" corruption). Clicks on a
    // cell open its editor; clicks on an open input are left alone.
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cm-table-btn') || e.target.tagName === 'INPUT') return
      e.preventDefault()
      const cell = e.target.closest?.('th, td')
      if (cell && cell.dataset.line != null) startEdit(cell, Number(cell.dataset.line), Number(cell.dataset.col))
    })

    // Focus left the whole table → commit the session to the document.
    wrap.addEventListener('focusout', () => {
      setTimeout(() => { if (active && !wrap.contains(document.activeElement)) endSession() }, 0)
    })

    const grid = parseTable(this.md)
    const rowCtl = document.createElement('div')
    rowCtl.className = 'cm-table-rowctl'
    rowCtl.appendChild(mkBtn('+', 'Add row', () => applyStructural(insertRow(working, parseTable(working).rows.length - 1))))
    if (grid.rows.length > 0) rowCtl.appendChild(mkBtn('−', 'Delete last row', () => applyStructural(removeRow(working, parseTable(working).rows.length - 1))))
    wrap.appendChild(rowCtl)

    const colCtl = document.createElement('div')
    colCtl.className = 'cm-table-colctl'
    colCtl.appendChild(mkBtn('+', 'Add column', () => applyStructural(insertColumn(working, parseTable(working).headers.length - 1))))
    if (grid.headers.length > 1) colCtl.appendChild(mkBtn('−', 'Delete last column', () => applyStructural(removeColumn(working, parseTable(working).headers.length - 1))))
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

// Typing at a rendered table's edge (the caret can rest just before/after an atomic
// table) would otherwise be swallowed into the table by GFM — the first char becomes
// a new row, and following text gets pulled in. This filter catches a pure insertion
// landing on a table's line range and redirects it to a SEPARATED line (a blank line
// above or below), so the text lands as normal prose instead of corrupting the table.
// It ignores deletions and our own table-rewrite dispatches (those are replacements,
// not point insertions).
export const tableTypingGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  const field = tr.startState.field(liveTables, false)
  if (!field || !field.tables.length) return tr
  const doc = tr.startState.doc
  const blocks = field.tables.map((t) => ({ from: doc.lineAt(t.from).from, to: doc.lineAt(t.to).to }))

  let redirect = null
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (redirect || fromA !== toA || inserted.length === 0) return // pure insertions only
    const text = inserted.toString()
    for (const b of blocks) {
      if (fromA < b.from || fromA > b.to) continue
      if (fromA <= b.from) redirect = { from: b.from, insert: `${text}\n\n`, caret: b.from + text.length }
      else redirect = { from: b.to, insert: `\n\n${text}`, caret: b.to + 2 + text.length }
      return
    }
  })
  if (!redirect) return tr
  return { changes: { from: redirect.from, insert: redirect.insert }, selection: { anchor: redirect.caret } }
})

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
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    // Atomic: the caret can't land inside (or at the raw edges of) a rendered table,
    // so you can't accidentally type into the table's line and corrupt it. Editing
    // happens only through the widget's cell inputs / +- controls.
    EditorView.atomicRanges.of((view) => view.state.field(liveTables).deco),
  ],
})
