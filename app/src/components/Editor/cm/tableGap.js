// Option C, editor half: the source keeps the standard blank line after a table (so
// the .md file stays portable), but here that blank line is visually collapsed so
// text hugs the table while writing — UNLESS the caret is on it, in which case it's
// revealed at full height so you can edit there (the same reveal idea the rest of the
// editor uses). Viewport-scoped ViewPlugin: O(visible lines) per keystroke/caret move.

import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

const collapsedLine = Decoration.line({ class: 'cm-collapsed-gap' })

// Is the given document position inside a Table node?
function inTable(tree, pos) {
  for (let n = tree.resolve(pos, -1); n; n = n.parent) {
    if (n.name === 'Table') return true
  }
  return false
}

function build(view) {
  const { state } = view
  const doc = state.doc
  const sel = state.selection
  const tree = syntaxTree(state)
  const deco = []
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      if (line.number > 1 && line.text.trim() === '') {
        const caretHere = sel.ranges.some((r) => r.from <= line.to && r.to >= line.from)
        // Collapse only a blank line whose previous line is the last line of a table,
        // and only when the caret isn't sitting on it.
        if (!caretHere && inTable(tree, doc.line(line.number - 1).to)) {
          deco.push(collapsedLine.range(line.from))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(deco)
}

export const collapseTableGap = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = build(view) }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
