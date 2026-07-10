import { gutter, GutterMarker } from '@codemirror/view'
import { codeFolding, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language'

// Outline folding for headings AND list items. We deliberately do NOT use
// foldGutter/foldKeymap: those route through CodeMirror's `foldable()`, which
// falls back to the markdown language's foldNodeProp and makes EVERY multi-line
// block (paragraphs!) foldable. Instead a custom gutter shows a chevron only on
// heading lines (fold the section down to the next equal/higher heading) and on
// list items that have indented children (fold the nested subtree).
// codeFolding() provides the fold state + collapse decoration; nothing auto-folds.

const HEADING = /^(#{1,6})\s/
// A list item marker: optional leading indent, then a bullet (-, *, +) or an
// ordered marker (1. / 1)). The checkbox `[ ]` is part of the content, not the
// marker, so it doesn't need matching here.
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/

function headingFoldRange(state, lineFrom) {
  const doc = state.doc
  const line = doc.lineAt(lineFrom)
  const m = HEADING.exec(line.text)
  if (!m) return null
  const level = m[1].length
  let endLineNum = doc.lines
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const hm = HEADING.exec(doc.line(n).text)
    if (hm && hm[1].length <= level) { endLineNum = n - 1; break }
  }
  if (endLineNum <= line.number) return null
  const to = doc.line(endLineNum).to
  if (to <= line.to) return null
  return { from: line.to, to }
}

// Fold a list item that owns indented children. Children = following lines
// indented deeper than this item's marker; blank lines inside the subtree are
// tolerated but trailing blanks are excluded from the fold.
export function listFoldRange(state, lineFrom) {
  const doc = state.doc
  const line = doc.lineAt(lineFrom)
  const m = LIST_ITEM.exec(line.text)
  if (!m) return null
  const indent = m[1].length
  let endLineNum = line.number
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const t = doc.line(n).text
    if (!t.trim()) continue // blank line: keep scanning, but don't extend the fold onto it
    const lead = t.length - t.trimStart().length
    if (lead > indent) endLineNum = n // a deeper-indented child line
    else break // sibling or outdent → end of this item's subtree
  }
  if (endLineNum <= line.number) return null // no children → not foldable
  const to = doc.line(endLineNum).to
  if (to <= line.to) return null
  return { from: line.to, to }
}

export function foldRangeAt(state, lineFrom) {
  return headingFoldRange(state, lineFrom) || listFoldRange(state, lineFrom)
}

// Is a fold currently anchored at `pos` (a line's end)? Fold ranges always start at
// their anchor line's `.to`, so this is the cheap (O(log n)) way to know a line is
// folded without reconstructing its full range. Used by the per-line chevron passes.
function foldedAtLineEnd(state, pos) {
  let folded = false
  foldedRanges(state).between(pos, pos + 1, (from) => { if (from === pos) folded = true })
  return folded
}

// Cheap fold status for a LIST line's inline chevron — `{ foldable, folded }` —
// WITHOUT walking the whole subtree. Foldability is decided entirely by the first
// non-blank line below (exactly where listFoldRange's scan would `break`): a deeper
// indent ⇒ has children ⇒ foldable. This is the hot path (runs per visible list line
// on every scroll recompute), so it must stay O(1); the full range is only computed
// on an actual fold click.
export function listFoldState(state, lineFrom) {
  const doc = state.doc
  const line = doc.lineAt(lineFrom)
  const m = LIST_ITEM.exec(line.text)
  if (!m) return { foldable: false, folded: false }
  const indent = m[1].length
  let foldable = false
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const t = doc.line(n).text
    if (!t.trim()) continue // blank line: keep looking for the first real line
    foldable = (t.length - t.trimStart().length) > indent
    break // the first non-blank line settles it
  }
  if (!foldable) return { foldable: false, folded: false }
  return { foldable: true, folded: foldedAtLineEnd(state, line.to) }
}

// Cheap fold status for a HEADING line's gutter chevron — `{ foldable, folded }` —
// without scanning forward to the next equal/higher heading. A heading is foldable
// iff it isn't the last line and the immediately-following line isn't an equal/higher
// heading (i.e. there's at least one line of content to fold), which mirrors exactly
// when headingFoldRange returns non-null.
export function headingFoldState(state, lineFrom) {
  const doc = state.doc
  const line = doc.lineAt(lineFrom)
  const m = HEADING.exec(line.text)
  if (!m || line.number >= doc.lines) return { foldable: false, folded: false }
  const level = m[1].length
  const nhm = HEADING.exec(doc.line(line.number + 1).text)
  if (nhm && nhm[1].length <= level) return { foldable: false, folded: false }
  return { foldable: true, folded: foldedAtLineEnd(state, line.to) }
}

export function rangeFolded(state, range) {
  let folded = false
  foldedRanges(state).between(range.from, range.from + 1, (from, to) => {
    if (from === range.from && to >= range.to) folded = true
  })
  return folded
}

// The set of folded heading/list lines as 1-based line numbers. A fold range
// starts at `line.to` of its anchor line, so `lineAt(from)` is that anchor line.
// This is what we persist (per-note) so folds can be restored across remounts and
// shared with the reading view, which keys the same lines via `data-line`.
export function foldedLineSet(state) {
  const lines = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines
}

// Reconcile the view's folds to exactly `lineNumbers`: fold any desired line not
// yet folded, unfold any current fold whose line isn't desired. One dispatch.
// Used for first restore on mount (no current folds → just folds the list) and to
// re-sync the editor after folds were toggled in the reading view.
export function applyFolds(view, lineNumbers) {
  const state = view.state
  const want = new Set(lineNumbers)
  const effects = []
  const haveLines = new Set()

  // Unfold any current fold whose anchor line is no longer wanted.
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const lineNo = state.doc.lineAt(from).number
    haveLines.add(lineNo)
    if (!want.has(lineNo)) effects.push(unfoldEffect.of({ from, to }))
  })

  // Fold any wanted line not already folded (skip out-of-range / non-foldable).
  for (const lineNo of want) {
    if (haveLines.has(lineNo) || lineNo < 1 || lineNo > state.doc.lines) continue
    const range = foldRangeAt(state, state.doc.line(lineNo).from)
    if (range) effects.push(foldEffect.of(range))
  }

  if (effects.length) view.dispatch({ effects })
}

export const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'

class ChevronMarker extends GutterMarker {
  constructor(folded, headingLevel) { super(); this.folded = folded; this.hl = headingLevel }
  eq(o) { return o.folded === this.folded && o.hl === this.hl }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-fold-chevron' + (this.folded ? ' is-folded' : '') + (this.hl ? ' cm-fold-h' + this.hl : '')
    s.innerHTML = CHEVRON_SVG
    return s
  }
}

export const headingFold = [
  codeFolding(),
  gutter({
    class: 'cm-foldGutter',
    lineMarker(view, line) {
      const text = view.state.doc.lineAt(line.from).text
      if (LIST_ITEM.test(text)) return null
      // O(1) foldable/folded check — the full range (a forward scan) is only needed
      // by the mousedown handler below, not per-line on every viewport change.
      const st = headingFoldState(view.state, line.from)
      if (!st.foldable) return null
      const hm = HEADING.exec(text)
      return new ChevronMarker(st.folded, hm ? hm[1].length : 0)
    },
    initialSpacer() { return new ChevronMarker(false, 0) },
    domEventHandlers: {
      mousedown(view, line) {
        const range = foldRangeAt(view.state, line.from)
        if (!range) return false
        const folded = rangeFolded(view.state, range)
        view.dispatch({ effects: folded ? unfoldEffect.of(range) : foldEffect.of(range) })
        return true
      },
    },
  }),
]
