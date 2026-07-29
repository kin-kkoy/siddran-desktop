// TEMPORARY — spike support, delete with app/src/dev/.
//
// The spike itself is DOM behaviour and can't be unit tested here (no jsdom).
// The generator is pure logic, and determinism is load-bearing: if two runs
// produced different text, the timing numbers from the two full-render
// mechanisms wouldn't be comparable and the whole measurement would be void.

import { describe, it, expect } from 'vitest'
import { generateNote, generateComments } from './bookSpikeDoc'

describe('generateNote', () => {
  it('reaches the requested line count', () => {
    for (const target of [1500, 5000]) {
      const lines = generateNote(target).split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(target)
      // Blocks are emitted whole, so overshoot is expected — but a big overshoot
      // would mean a runaway block, not a rounding tail.
      expect(lines.length).toBeLessThan(target + 40)
    }
  })

  it('is deterministic for a given seed', () => {
    expect(generateNote(1500)).toBe(generateNote(1500))
    expect(generateNote(1500, 7)).toBe(generateNote(1500, 7))
  })

  it('varies with the seed', () => {
    expect(generateNote(1500, 1)).not.toBe(generateNote(1500, 2))
  })

  it('includes every decoration source the spike needs to exercise', () => {
    const doc = generateNote(1500)
    expect(doc).toMatch(/^# /m)          // headings
    expect(doc).toMatch(/^## /m)
    expect(doc).toMatch(/^- /m)          // bullets
    expect(doc).toMatch(/^- \[[ x]\] /m) // task checkboxes
    expect(doc).toMatch(/^\| .* \|$/m)   // tables
    expect(doc).toMatch(/```js/)         // fenced code
    expect(doc).toMatch(/\[\[.+?\]\]/)   // wikilinks
    expect(doc).toMatch(/\*\*.+?\*\*/)   // inline marks
    expect(doc).toMatch(/==.+?==/)
    expect(doc).toMatch(/^> /m)          // blockquote
  })

  it('emits closed code fences', () => {
    const fences = generateNote(5000).match(/^```/gm) || []
    expect(fences.length % 2).toBe(0)
  })
})

describe('generateComments', () => {
  it('produces in-range, non-empty, ordered anchors', () => {
    const doc = generateNote(1500)
    const anchors = generateComments(doc, 24)
    expect(anchors.length).toBeGreaterThan(0)
    let prev = -1
    for (const a of anchors) {
      expect(a.from).toBeGreaterThanOrEqual(0)
      expect(a.to).toBeGreaterThan(a.from)
      expect(a.to).toBeLessThanOrEqual(doc.length)
      expect(a.from).toBeGreaterThan(prev)
      prev = a.from
    }
  })

  it('never spans a line boundary', () => {
    const doc = generateNote(1500)
    for (const a of generateComments(doc, 24)) {
      expect(doc.slice(a.from, a.to)).not.toContain('\n')
    }
  })

  it('returns nothing rather than garbage for a tiny document', () => {
    expect(generateComments('short', 24)).toEqual([])
  })
})
