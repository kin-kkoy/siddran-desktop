import { StateField, StateEffect } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

// In-note search highlights (edit mode). A StateField holds the match ranges + the
// active index and renders them as mark decorations; ranges are mapped through edits
// so highlights track the text as you type. The read-mode equivalent is a DOM
// text-walker in CodeMirrorEditor (arbitrary matches have no data-line to target).
//
// Mirrors the comments highlight approach in cm/comments.js.

export const setSearchMatchesEffect = StateEffect.define() // { ranges: [{from,to}], active }
export const setActiveSearchEffect = StateEffect.define()  // number (active index)
export const clearSearchEffect = StateEffect.define()

function buildDeco(ranges, active) {
  if (!ranges.length) return Decoration.none
  const marks = ranges.map((r, i) =>
    Decoration.mark({
      class: i === active ? 'cm-search-hit cm-search-hit-active' : 'cm-search-hit',
    }).range(r.from, r.to),
  )
  return Decoration.set(marks, true) // true = sort for us
}

export const searchField = StateField.define({
  create() { return { ranges: [], active: -1, deco: Decoration.none } },
  update(value, tr) {
    let { ranges, active } = value
    if (tr.docChanged && ranges.length) {
      ranges = ranges
        .map((r) => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }))
        .filter((r) => r.to > r.from)
    }
    for (const e of tr.effects) {
      if (e.is(setSearchMatchesEffect)) { ranges = e.value.ranges; active = e.value.active ?? -1 }
      else if (e.is(setActiveSearchEffect)) { active = e.value }
      else if (e.is(clearSearchEffect)) { ranges = []; active = -1 }
    }
    return { ranges, active, deco: buildDeco(ranges, active) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

export const searchExtension = [searchField]
