import { EditorView, keymap } from '@codemirror/view'
import { EditorSelection, Annotation, Prec } from '@codemirror/state'

// CodeMirror's built-in vertical caret motion (Arrow-Up/Down) maps the caret's
// screen-Y back to a document position through its *estimated* height model
// (heightmap). In this app the editor is virtualized inside a scroll container,
// so off-screen line heights (tall headings, wrapped paragraphs) are estimated
// and the model drifts shorter than the real DOM — making Arrow-Up/Down jump
// many lines. Mouse clicks are unaffected because they use the browser's real
// coordinate hit-testing.
//
// Fix: rebind Arrow-Up/Down (and the Shift-selecting variants) to compute the
// target with that same real hit-testing (caretPositionFromPoint), bypassing the
// faulty height model. A module-level goal column keeps the caret in the same
// visual column across consecutive vertical moves, reset on any other movement.

const verticalMove = Annotation.define()
let goalX = null

// Resolve a viewport (x, y) point to a document position via the browser's
// caret hit-testing — the same path the editor uses for mouse clicks.
function pointToPos(view, x, y) {
  const dom = view.contentDOM.ownerDocument
  let node = null, offset = 0
  if (dom.caretPositionFromPoint) {
    const p = dom.caretPositionFromPoint(x, y)
    if (p) { node = p.offsetNode; offset = p.offset }
  } else if (dom.caretRangeFromPoint) {
    const r = dom.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node || !view.contentDOM.contains(node)) return null
  try { return view.posAtDOM(node, offset) } catch { return null }
}

function moveVertical(view, forward, extend) {
  const main = view.state.selection.main
  const head = main.head
  const coords = view.coordsAtPos(head)
  if (!coords) return false
  if (goalX == null) goalX = coords.left

  const step = Math.max(4, (view.defaultLineHeight || 18) * 0.5)
  let target = null

  // Walk outward from the current line box until we land on a different visual
  // row (different y), not just a different x on the same row. Hit-testing only
  // resolves VISIBLE pixels, so a null result means we walked off the rendered
  // area (the adjacent row is just past the viewport) → stop and fall back below.
  let y = forward ? coords.bottom + 1 : coords.top - 1
  for (let i = 0; i < 80; i++) {
    const p = pointToPos(view, goalX, y)
    if (p == null) break
    if (p !== head) {
      const pc = view.coordsAtPos(p)
      if (pc && (forward ? pc.top > coords.top + 1 : pc.bottom < coords.bottom - 1)) { target = p; break }
    }
    y += forward ? step : -step
  }

  if (target == null) {
    // The adjacent row is off-screen. Move to the SAME column in the next/prev
    // document line and let scrollIntoView reveal it — never leap to the document
    // boundary (the old behaviour, which caused the caret to jump to start/end).
    const doc = view.state.doc
    const line = doc.lineAt(head)
    const n = forward ? line.number + 1 : line.number - 1
    if (n < 1 || n > doc.lines) return true // already at the document edge
    const tl = doc.line(n)
    target = Math.min(tl.from + (head - line.from), tl.to)
  }

  const selection = extend ? EditorSelection.range(main.anchor, target) : EditorSelection.cursor(target)
  view.dispatch({ selection, scrollIntoView: true, annotations: verticalMove.of(true) })
  return true
}

// Drop the goal column whenever the selection moves for any non-vertical reason
// (typing, horizontal arrows, click) so the next Up/Down re-anchors the column.
const goalReset = EditorView.updateListener.of((u) => {
  if (!u.selectionSet) return
  if (!u.transactions.some(tr => tr.annotation(verticalMove))) goalX = null
})

// Clicks suffer the same height-model drift: CM resolves the click point to a
// doc position via posAtCoords (heightmap), landing the caret a line off. After a
// plain single click we re-resolve with the browser's real hit-testing and land a
// clean caret. This also repairs two live-preview list quirks:
//   • clicking a contenteditable=false widget (bullet/checkbox) can make the
//     browser *select* it — left alone, the next keystroke replaces it (a checkbox
//     becomes a bullet). We collapse that stray selection to a caret.
//   • a click on/before a rendered list marker resolves *before* the bullet; we
//     snap it to the item's content start so the caret sits beside the marker.
// Drag-selections (pointer moved), shift-clicks and double/triple clicks are left
// to CM.
const LIST_PREFIX = /^(\s*)(?:[-*+]|\d+[.)])(\s+)(\[[ xX]\]\s*)?/
let downX = 0, downY = 0
const clickFix = EditorView.domEventHandlers({
  mousedown: (event) => { downX = event.clientX; downY = event.clientY; return false },
  click: (event, view) => {
    if (event.button !== 0 || event.detail > 1 || event.shiftKey) return false
    // Pointer moved → it's a drag-select; don't touch the selection.
    if (Math.abs(event.clientX - downX) > 3 || Math.abs(event.clientY - downY) > 3) return false
    const sel = view.state.selection.main
    let pos = pointToPos(view, event.clientX, event.clientY)
    if (pos == null) {
      // Hit-test landed on a contenteditable=false widget (no caret node → posAtDOM
      // throws). If the browser selected that widget (e.g. a checkbox), collapse the
      // stray selection to its end so the caret sits after the marker and the next
      // keystroke can't replace it; otherwise there's nothing to correct.
      if (!sel.empty) view.dispatch({ selection: EditorSelection.cursor(sel.to) })
      return false
    }
    const doc = view.state.doc
    const line = doc.lineAt(pos)
    const m = LIST_PREFIX.exec(line.text)
    if (m) {
      const contentStart = line.from + m[0].length
      if (pos < contentStart) pos = contentStart // snap to beside the marker
    }
    // Set a clean caret unless it's already exactly there: clears a stray
    // widget-selection and corrects heightmap click-drift in one go.
    if (!sel.empty || pos !== sel.head) view.dispatch({ selection: EditorSelection.cursor(pos) })
    return false
  },
})

// Prec.highest so these win over defaultKeymap's Arrow-Up/Down bindings.
export const domVerticalMotion = [
  goalReset,
  clickFix,
  // Prec.high (not highest) so the autocomplete completionKeymap — registered at
  // Prec.highest in cm/wikilinks.js — owns Arrow/Enter while a completion is open.
  Prec.high(keymap.of([
    { key: 'ArrowUp', run: v => moveVertical(v, false, false), shift: v => moveVertical(v, false, true) },
    { key: 'ArrowDown', run: v => moveVertical(v, true, false), shift: v => moveVertical(v, true, true) },
  ])),
]
