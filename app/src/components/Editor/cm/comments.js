import { StateField, StateEffect } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

// CM6 comment anchoring. A StateField holds each thread's [from,to) range and maps
// it live through document edits, so a commented region stays attached as you type
// and collapses (→ orphaned) only when its whole text is deleted. Highlights are
// mark decorations derived from the field. React remains the source of truth for
// thread CONTENT; it seeds/updates this field via `setCommentsEffect` and reads
// remapped offsets back through the editor's update listener.

export const setCommentsEffect = StateEffect.define()      // Array<{id,from,to,resolved}>
export const setActiveCommentEffect = StateEffect.define() // id | null

const CTX = 30 // chars of prefix/suffix context kept for re-anchoring

const mapAnchor = (a, changes) => {
  const from = changes.mapPos(a.from, 1)   // bias inward so edits at the edges
  const to = changes.mapPos(a.to, -1)      // don't grow the highlight
  const orphaned = from >= to
  return { id: a.id, from, to: orphaned ? from : to, resolved: a.resolved, orphaned }
}

export const commentState = StateField.define({
  create: () => ({ anchors: [], activeId: null }),
  update(value, tr) {
    let { anchors, activeId } = value
    if (tr.docChanged) anchors = anchors.map((a) => mapAnchor(a, tr.changes))
    for (const e of tr.effects) {
      if (e.is(setCommentsEffect)) {
        anchors = e.value.map((a) => ({
          id: a.id, from: a.from, to: a.to, resolved: !!a.resolved, orphaned: a.from >= a.to,
        }))
      } else if (e.is(setActiveCommentEffect)) {
        activeId = e.value
      }
    }
    return { anchors, activeId }
  },
  provide: (f) => EditorView.decorations.from(f, buildDeco),
})

function buildDeco(value) {
  const marks = []
  for (const a of value.anchors) {
    if (a.resolved || a.orphaned || a.to <= a.from) continue
    marks.push(
      Decoration.mark({
        class: a.id === value.activeId ? 'cm-comment cm-comment-active' : 'cm-comment',
        attributes: { 'data-comment-id': a.id },
      }).range(a.from, a.to),
    )
  }
  // `true` = sort for us (mark ranges may overlap and arrive unsorted).
  return Decoration.set(marks, true)
}

const clickHandler = (onClickComment) =>
  EditorView.domEventHandlers({
    mousedown: (event) => {
      const el = event.target?.closest?.('.cm-comment')
      if (!el) return false
      const id = el.getAttribute('data-comment-id')
      // Don't preventDefault — let the caret land normally; just surface the click.
      if (id) onClickComment?.(id)
      return false
    },
  })

export function commentsExtension({ onClickComment } = {}) {
  return [commentState, clickHandler(onClickComment)]
}

// ── helpers used by the editor wrapper ──────────────────────────────────────

// Build an anchor payload (quote + surrounding context) for a document range.
export function anchorFromRange(state, from, to) {
  const len = state.doc.length
  return {
    from, to,
    quote: state.sliceDoc(from, to),
    prefix: state.sliceDoc(Math.max(0, from - CTX), from),
    suffix: state.sliceDoc(to, Math.min(len, to + CTX)),
  }
}

// The current selection as an anchor payload, or null when nothing is selected.
export function captureSelectionAnchor(state) {
  const { from, to } = state.selection.main
  if (from === to) return null
  return anchorFromRange(state, from, to)
}

// Read the live anchor set with fresh quote/context — fed back to React so stored
// offsets + quotes track edits, and orphaned threads can be flagged in the panel.
export function readAnchors(state) {
  const v = state.field(commentState, false)
  if (!v) return []
  return v.anchors.map((a) => ({
    id: a.id, orphaned: a.orphaned, ...anchorFromRange(state, a.from, a.orphaned ? a.from : a.to),
  }))
}

// Find where a stored quote sits in `doc` now (used to re-anchor across sessions
// when raw offsets have drifted). Picks the occurrence whose surrounding text best
// matches the saved prefix/suffix, tie-broken toward the old offset.
function findQuote(doc, quote, prefix, suffix, hint) {
  if (!quote) return -1
  const positions = []
  for (let i = doc.indexOf(quote); i !== -1; i = doc.indexOf(quote, i + 1)) positions.push(i)
  if (positions.length === 0) return -1
  if (positions.length === 1) return positions[0]
  let best = positions[0], bestScore = -Infinity
  for (const p of positions) {
    let score = 0
    if (prefix) {
      const before = doc.slice(Math.max(0, p - prefix.length), p)
      if (before.endsWith(prefix)) score += 2
      else if (before.slice(-6) && before.slice(-6) === prefix.slice(-6)) score += 1
    }
    if (suffix) {
      const after = doc.slice(p + quote.length, p + quote.length + suffix.length)
      if (after.startsWith(suffix)) score += 2
      else if (after.slice(0, 6) && after.slice(0, 6) === suffix.slice(0, 6)) score += 1
    }
    if (hint != null) score -= Math.abs(p - hint) / 1e7 // tiny nudge toward the old spot
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best
}

// Turn a stored thread anchor into a concrete {id,from,to,resolved} against the
// current document: trust valid offsets, else re-anchor by quote, else orphan.
export function resolveAnchor(state, c) {
  const doc = state.doc.toString()
  if (c.quote && c.from != null && c.to != null && doc.slice(c.from, c.to) === c.quote) {
    return { id: c.id, from: c.from, to: c.to, resolved: c.resolved }
  }
  if (c.quote) {
    const idx = findQuote(doc, c.quote, c.prefix, c.suffix, c.from)
    if (idx >= 0) return { id: c.id, from: idx, to: idx + c.quote.length, resolved: c.resolved }
  }
  const pos = Math.min(c.from ?? 0, doc.length)
  return { id: c.id, from: pos, to: pos, resolved: c.resolved } // orphaned (from === to)
}
