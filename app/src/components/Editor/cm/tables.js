// Live-preview tables. A block-level StateField (block decorations must come from a
// StateField, not a ViewPlugin — see the note in livePreview.js) that replaces each
// GFM table with a rendered <table> widget WHEN the selection is not on it, and
// reveals the raw markdown source for editing when the caret enters its lines.
//
// This mirrors the caret-reveal behaviour the inline plugin already uses for links,
// extended to a multi-line block. The inline plugin skips the interior of a rendered
// table (see the `Table` guard in livePreview.js), so the two never double-decorate.
//
// PERFORMANCE (matters on big notes): the field caches the table RANGES and only
// re-walks the syntax tree when the document changes. A pure caret move reuses the
// cached ranges and just re-decides which tables are revealed — O(#tables), no tree
// walk. And even the doc-change walk skips descending into nodes that can't contain a
// table (paragraphs, code, headings — the overwhelming majority of nodes), so it's
// O(block structure), not O(every inline node).

import { StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { renderTableDOM } from './tableRender'

class TableWidget extends WidgetType {
  constructor(md) { super(); this.md = md }
  // Re-render only when the source text changes — cheap identity for the diff.
  eq(other) { return other.md === this.md }
  toDOM() { return renderTableDOM(this.md) }
  // Don't swallow events: a click resolves to the block's edge, which lands the
  // caret on a table line, which flips this table back to source for editing.
  ignoreEvent() { return false }
}

// Block nodes that can never contain a GFM table and that dominate the node count.
// Skipping their subtrees keeps the doc-change scan off the inline-node hot path.
// (Containers that CAN hold a table — Blockquote, ListItem, lists — are not listed,
// so the walk still descends into them.)
const SKIP_SUBTREE = new Set([
  'Paragraph', 'FencedCode', 'CodeBlock', 'CommentBlock', 'HTMLBlock', 'LinkReference',
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
])

// Walk the tree once and collect every table's [from,to]. Only called on doc changes.
function scanTables(state) {
  const tables = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') { tables.push({ from: node.from, to: node.to }); return false }
      if (SKIP_SUBTREE.has(node.name)) return false // prune: can't hold a table
      return undefined // descend (Document + container blocks)
    },
  })
  return tables
}

// A table is "rendered" (shown as a widget) when the selection touches none of its
// lines. Shared shape with the inline plugin's guard so the two agree exactly.
function selectionTouchesLines(state, from, to) {
  const doc = state.doc
  const a = doc.lineAt(from).number
  const b = doc.lineAt(to).number
  return state.selection.ranges.some((r) => {
    const rf = doc.lineAt(r.from).number
    const rt = doc.lineAt(r.to).number
    return rf <= b && rt >= a
  })
}

// Build the decoration set from cached table ranges + the current selection. Cheap:
// O(#tables), no tree walk. Runs on every caret move.
function decoFrom(state, tables) {
  const doc = state.doc
  const widgets = []
  for (const t of tables) {
    if (t.from > doc.length || t.to > doc.length) continue // stale guard
    if (selectionTouchesLines(state, t.from, t.to)) continue // caret on it → source
    const md = doc.sliceString(t.from, t.to)
    const from = doc.lineAt(t.from).from // block replace must span whole lines
    const to = doc.lineAt(t.to).to
    widgets.push(Decoration.replace({ widget: new TableWidget(md), block: true }).range(from, to))
  }
  return Decoration.set(widgets, true)
}

// Exported for direct unit testing (no DOM needed — decorations are plain objects).
export function buildTableDeco(state) {
  return decoFrom(state, scanTables(state))
}

export const liveTables = StateField.define({
  create(state) {
    const tables = scanTables(state)
    return { tables, deco: decoFrom(state, tables) }
  },
  update(value, tr) {
    // Doc changed → table structure may have changed; re-walk. Selection changed →
    // reuse cached ranges, just re-decide reveal. Neither → reuse everything.
    if (tr.docChanged) {
      const tables = scanTables(tr.state)
      return { tables, deco: decoFrom(tr.state, tables) }
    }
    if (tr.selection) {
      return { tables: value.tables, deco: decoFrom(tr.state, value.tables) }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})
