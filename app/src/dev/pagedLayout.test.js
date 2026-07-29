// Paged write layout — the parts that can run without a DOM.
//
// Measurement, priming and the gap rendering need a real browser and are checked
// by hand. What IS testable is that the extension set constructs and that the
// page set survives edits: a `provide` callback runs synchronously inside
// StateField.define, and a missing import takes the module down at import time.
// Both of those shipped once during development and both are caught below.

import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { pagedLayout, pageHeight, breakMode, setPagesEffect, pagesField } from './pagedLayout'

describe('pagedLayout', () => {
  it('builds its extension set without touching the DOM', () => {
    expect(() => pagedLayout(620)).not.toThrow()
  })

  it('creates a state (catches TDZ in StateField.provide)', () => {
    const state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [pagedLayout(620)] })
    expect(state.doc.lines).toBe(3)
  })

  it('carries page height and break mode through their facets', () => {
    const s = EditorState.create({ doc: 'x', extensions: [pagedLayout(480, 'keep')] })
    expect(s.facet(pageHeight)).toBe(480)
    expect(s.facet(breakMode)).toBe('keep')
  })

  it('defaults to the app settings defaults', () => {
    const s = EditorState.create({ doc: 'x', extensions: [pagedLayout()] })
    expect(s.facet(pageHeight)).toBe(620)
    expect(s.facet(breakMode)).toBe('continue')
  })

  it('starts with no pages until the first measure pass', () => {
    const s = EditorState.create({ doc: 'a\nb', extensions: [pagedLayout(620)] })
    expect(s.field(pagesField)).toEqual([])
  })

  it('maps stored break positions through an edit', () => {
    // Breaks are document offsets. Unmapped, every gap below the caret would
    // point at the wrong text between the edit and the next recompute.
    const state = EditorState.create({ doc: 'aaa\nbbb\nccc\nddd', extensions: [pagedLayout(620)] })
    const seeded = state.update({
      effects: setPagesEffect.of([{ from: 0, pad: 0 }, { from: 8, pad: 100 }]),
    }).state
    expect(seeded.doc.sliceString(8, 11)).toBe('ccc')

    const after = seeded.update({ changes: { from: 0, insert: 'XXXXX' } }).state
    const moved = after.field(pagesField)[1]
    expect(moved.from).toBe(13)
    expect(after.doc.sliceString(moved.from, moved.from + 3)).toBe('ccc')
    expect(moved.pad).toBe(100) // padding survives the remap
  })

  it('replaces the whole set on setPagesEffect', () => {
    const state = EditorState.create({ doc: 'a\nb\nc', extensions: [pagedLayout(620)] })
    const next = state.update({
      effects: setPagesEffect.of([{ from: 0, pad: 0 }, { from: 2, pad: 40 }]),
    }).state
    expect(next.field(pagesField)).toHaveLength(2)
  })

  it('leaves the document text untouched', () => {
    // Gaps are decorations. If a break ever edited the document, the note on
    // disk would grow padding characters.
    const state = EditorState.create({ doc: 'a\nb\nc', extensions: [pagedLayout(620)] })
    const next = state.update({
      effects: setPagesEffect.of([{ from: 0, pad: 0 }, { from: 2, pad: 40 }]),
    }).state
    expect(next.doc.toString()).toBe('a\nb\nc')
  })
})
