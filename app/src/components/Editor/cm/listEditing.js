import { ChangeSet, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// WYSIWYG-style list editing for the raw-markdown CM6 editor. Markdown lists are
// just text here, so without help the user would hand-type every marker. These
// commands add the WYSIWYG feel:
//   Enter      → continue the list (next number / bullet / fresh checkbox);
//                Enter on an empty item exits the list.
//   Tab        → indent (nest) the item under the preceding sibling, aligning to
//                its content column so the reading-view parser nests it; a nested
//                ordered level restarts at 1. Capped at MAX_DEPTH levels.
//   Shift-Tab  → outdent the item to its parent's level.
// Ordered runs are renumbered after any structural change. Each command commits a
// SINGLE transaction (structural change ∘ renumber) so it's one undo step.
//
// Each command returns false when it doesn't apply (not on a list item), letting
// the default keymap handle Enter/Tab normally.

const MAX_DEPTH = 3 // nesting levels; top-level list items are depth 1

// Parse a list-item line into its parts, or null if the line isn't a list item.
function parseItem(text) {
  const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s*)?(.*)$/.exec(text)
  if (!m) return null
  const indent = m[1], marker = m[2], spaces = m[3], checkbox = m[4] || '', content = m[5]
  const ordered = /\d/.test(marker)
  return {
    indent: indent.length,
    marker,                                  // '-', '*', '+', or '1.', '12)'
    ordered,
    delim: ordered ? marker.slice(-1) : marker, // '.'/')' for ordered, else the bullet char
    contentCol: indent.length + marker.length + spaces.length, // child-indent target for nesting
    prefixLen: indent.length + marker.length + spaces.length + checkbox.length,
    hasCheckbox: checkbox.length > 0,
    spaces,
    content,
  }
}

const isBlank = (t) => t.trim() === ''

// Renumber every ordered-list run in the document so markers read 1, 2, 3 … per
// level. Cosmetic in the editor (the reading view's <ol> renumbers regardless),
// but keeps the live-preview source tidy. Returns ChangeSpec[] in `doc` coords.
function renumberOrdered(doc) {
  const changes = []
  let counters = {} // indent length → next number at that level
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const t = line.text
    if (isBlank(t)) { counters = {}; continue } // blank line breaks all runs (tight lists)
    const it = parseItem(t)
    if (!it) { counters = {}; continue }
    for (const k of Object.keys(counters)) if (+k > it.indent) delete counters[k] // left those sublists
    if (!it.ordered) { delete counters[it.indent]; continue } // a bullet resets this level
    const next = (counters[it.indent] || 0) + 1
    counters[it.indent] = next
    const want = next + it.delim
    if (it.marker !== want) {
      const from = line.from + it.indent
      changes.push({ from, to: from + it.marker.length, insert: want })
    }
  }
  return changes
}

// Commit `structural` (ChangeSpec[] in current-doc coords) plus a renumber pass as
// one transaction. `caretInIntermediate` is the caret position in the document
// *after* the structural change (before renumber); it's mapped through renumber.
function commit(view, structural, caretInIntermediate) {
  const { state } = view
  const structCS = ChangeSet.of(structural, state.doc.length)
  const interDoc = structCS.apply(state.doc)
  const renumCS = ChangeSet.of(renumberOrdered(interDoc), interDoc.length)
  const composed = structCS.compose(renumCS)
  const caret = renumCS.mapPos(caretInIntermediate)
  view.dispatch({
    changes: composed,
    selection: EditorSelection.cursor(caret),
    userEvent: 'input',
    scrollIntoView: true,
  })
  return true
}

// Nesting depth (1-based) of the list item on `lineNum`, by counting ancestors
// (preceding list items at strictly decreasing indent).
function itemDepth(doc, lineNum, indent) {
  let depth = 1, cur = indent
  for (let n = lineNum - 1; n >= 1; n--) {
    const t = doc.line(n).text
    if (isBlank(t)) break
    const it = parseItem(t)
    if (!it) break
    if (it.indent < cur) { depth++; cur = it.indent; if (cur === 0) break }
  }
  return depth
}

// A caret command guard: only act on a single empty selection (caret).
function caret(view) {
  const sel = view.state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return null
  return sel.main.head
}

function enterList(view) {
  const pos = caret(view)
  if (pos == null) return false
  const { state } = view
  const doc = state.doc
  const line = doc.lineAt(pos)
  const item = parseItem(line.text)
  if (!item) return false
  if (pos < line.from + item.prefixLen) return false // caret inside the marker → plain newline

  // Empty item → step OUT of the list, in place (no new line). Indented items
  // outdent one level per Enter; a top-level item is cleared (marker removed).
  if (item.content.trim() === '') {
    if (item.indent > 0) {
      const o = computeOutdent(doc, line, item, pos)
      return commit(view, o.changes, o.caret)
    }
    return commit(view, [{ from: line.from, to: line.to, insert: '' }], line.from)
  }

  // Non-empty → split, starting a new item with the next marker.
  const nextMarker = item.ordered ? (parseInt(item.marker, 10) + 1) + item.delim : item.marker
  const prefix = ' '.repeat(item.indent) + nextMarker + item.spaces + (item.hasCheckbox ? '[ ] ' : '')
  const insert = '\n' + prefix
  return commit(view, [{ from: pos, to: pos, insert }], pos + insert.length)
}

function indentList(view) {
  const pos = caret(view)
  if (pos == null) return false
  const { state } = view
  const doc = state.doc
  const line = doc.lineAt(pos)
  const item = parseItem(line.text)
  if (!item) return false // not a list → let indentWithTab insert indentation

  // Find the item directly above at our own level to nest under it. If the nearest
  // preceding list item is shallower (we're already its first child) or there's no
  // list item above, we can't indent — swallow Tab so no stray tab lands in the list.
  let parent = null
  for (let n = line.number - 1; n >= 1; n--) {
    const t = doc.line(n).text
    if (isBlank(t)) break
    const it = parseItem(t)
    if (!it) break
    if (it.indent < item.indent) break          // a shallower ancestor → no same-level sibling above
    if (it.indent === item.indent) { parent = it; break }
    // deeper line → part of an earlier sibling's subtree; keep scanning
  }
  if (!parent) return true
  if (itemDepth(doc, line.number, item.indent) >= MAX_DEPTH) return true // cap nesting

  // Indent at least one parent-content-column (so the reading-view parser nests it)
  // but use a roomier step so nesting reads as clearly indented in the editor.
  const step = Math.max(4, parent.contentCol - parent.indent)
  const newIndent = ' '.repeat(parent.indent + step)
  const newMarker = item.ordered ? '1' + item.delim : item.marker // nested ordered restarts at 1
  const oldLen = item.indent + item.marker.length
  const insert = newIndent + newMarker
  const caretAt = pos + (insert.length - oldLen)
  return commit(view, [{ from: line.from, to: line.from + oldLen, insert }], caretAt)
}

// Compute the change + caret for outdenting `item` on `line` to its parent's indent.
function computeOutdent(doc, line, item, pos) {
  let parentIndent = 0
  for (let n = line.number - 1; n >= 1; n--) {
    const t = doc.line(n).text
    if (isBlank(t)) break
    const it = parseItem(t)
    if (!it) break
    if (it.indent < item.indent) { parentIndent = it.indent; break }
  }
  const newIndent = ' '.repeat(parentIndent)
  // Only the indentation whitespace changes; renumber fixes the marker number.
  return {
    changes: [{ from: line.from, to: line.from + item.indent, insert: newIndent }],
    caret: pos - (item.indent - parentIndent),
  }
}

function outdentList(view) {
  const pos = caret(view)
  if (pos == null) return false
  const { state } = view
  const doc = state.doc
  const line = doc.lineAt(pos)
  const item = parseItem(line.text)
  if (!item) return false
  if (item.indent === 0) return true // already top level → nothing to outdent, swallow
  const o = computeOutdent(doc, line, item, pos)
  return commit(view, o.changes, o.caret)
}

// Enter on an indented non-list line: carry the indentation on first Enter,
// remove it on second Enter (blank indented line). Returns false for non-indented
// lines so the default keymap handles them.
export function enterIndent(view) {
  const state = view.state
  const { head } = state.selection.main
  if (!state.selection.main.empty) return false
  const line = state.doc.lineAt(head)
  const indent = /^(\s+)/.exec(line.text)?.[1]
  if (!indent) return false
  // Already a list item — let enterList handle it
  if (parseItem(line.text)) return false
  // Blank indented line → strip the indent (exit indentation)
  if (line.text.trim() === '') {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } })
    return true
  }
  // Indented content → carry the indent to the new line
  view.dispatch(state.replaceSelection('\n' + indent), { scrollIntoView: true })
  return true
}

export const listEditingKeymap = [
  { key: 'Enter', run: enterList },
  { key: 'Tab', run: indentList },
  { key: 'Shift-Tab', run: outdentList },
]

// The valid indent for a hand-typed list item: align it to the list item above
// (sibling), allow a single clean nest (one step deeper) if it reached that far,
// but never a stray in-between indent. Tab stays the only way to nest.
function validIndentFor(doc, lineNum, indent) {
  let prev = null
  for (let n = lineNum - 1; n >= 1; n--) {
    const t = doc.line(n).text
    if (!t.trim()) break // blank line ends the list context
    const it = parseItem(t)
    if (it) { prev = it; break } // nearest list item above (skip continuation lines)
  }
  if (!prev) return 0 // no list above → top level
  const step = Math.max(4, prev.contentCol - prev.indent)
  if (indent >= prev.indent + step) return prev.indent + step // a full clean nest
  if (indent > prev.indent) return prev.indent // stray partial nest → snap to sibling
  return indent // sibling or shallower — leave as-is
}

// Live-normalize a hand-typed list item's leading indent (e.g. typing " - x" after
// "- x" no longer silently makes it a child). Runs after the user's own input only;
// our Enter/Tab commands already produce clean indents, so this is a no-op for them.
export const listIndentNormalizer = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return
  if (!u.transactions.some(tr => tr.isUserEvent('input'))) return
  const view = u.view, state = view.state
  const sel = state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return
  const line = state.doc.lineAt(sel.main.head)
  const item = parseItem(line.text)
  // Only act on an indented, fully-formed list marker (a trailing space after it).
  if (!item || item.indent === 0) return
  if (!/^\s+(?:[-*+]|\d+[.)])\s/.test(line.text)) return
  const target = validIndentFor(state.doc, line.number, item.indent)
  if (target === item.indent) return // already a valid level (incl. Tab-made nests) → nothing to do
  for (let n = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent) {
    if (/Code/.test(n.name)) return // never touch indentation inside code blocks
  }
  view.dispatch({ changes: { from: line.from, to: line.from + item.indent, insert: ' '.repeat(target) } })
})
