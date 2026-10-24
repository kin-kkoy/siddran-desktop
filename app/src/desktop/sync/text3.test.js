import { describe, it, expect } from 'vitest'
import { merge3, diffLines } from './text3.js'

const L = (...xs) => xs.join('\n')

describe('diffLines', () => {
  it('finds a single changed line', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'X', 'c'])).toEqual([{ start: 1, end: 2, lines: ['X'] }])
  })
  it('finds an insertion and a deletion', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { start: 1, end: 2, lines: [] },
      { start: 3, end: 3, lines: ['d'] },
    ])
  })
  it('returns nothing for identical input', () => {
    expect(diffLines(['a'], ['a'])).toEqual([])
  })
})

describe('merge3', () => {
  const base = L('# Title', '', 'one', 'two', 'three')

  it('takes the only side that changed', () => {
    expect(merge3(base, base, L(base, 'four'))).toEqual({ text: L(base, 'four'), conflict: false })
    expect(merge3(base, L(base, 'four'), base)).toEqual({ text: L(base, 'four'), conflict: false })
  })

  it('keeps both when edits are on different lines', () => {
    const ours = L('# Title', '', 'ONE', 'two', 'three')        // you, at the top
    const theirs = L('# Title', '', 'one', 'two', 'three', '', '## Added by AI', 'text')
    expect(merge3(base, ours, theirs)).toEqual({ text: L('# Title', '', 'ONE', 'two', 'three', '', '## Added by AI', 'text'), conflict: false })
  })

  it('applies an insertion right after a line the other side edited', () => {
    const ours = L('# Title', '', 'one', 'TWO', 'three')
    const theirs = L('# Title', '', 'one', 'two', 'inserted', 'three')
    expect(merge3(base, ours, theirs).text).toBe(L('# Title', '', 'one', 'TWO', 'inserted', 'three'))
  })

  it('treats the same edit on both sides as agreement, not conflict', () => {
    const both = L('# Title', '', 'one', 'TWO', 'three')
    expect(merge3(base, both, both)).toEqual({ text: both, conflict: false })
    const ours = L('# Title', '', 'one', 'TWO', 'three', 'x')
    const theirs = L('# Title', 'y', '', 'one', 'TWO', 'three')
    expect(merge3(base, ours, theirs)).toEqual({ text: L('# Title', 'y', '', 'one', 'TWO', 'three', 'x'), conflict: false })
  })

  it('keeps ours on a real conflict, and says so', () => {
    const ours = L('# Title', '', 'one', 'mine', 'three')
    const theirs = L('# Title', '', 'one', 'theirs', 'three')
    expect(merge3(base, ours, theirs)).toEqual({ text: ours, conflict: true })
  })

  it('handles a delete on one side and an unrelated edit on the other', () => {
    const ours = L('# Title', '', 'two', 'three')               // deleted "one"
    const theirs = L('# Title', '', 'one', 'two', 'THREE')
    expect(merge3(base, ours, theirs)).toEqual({ text: L('# Title', '', 'two', 'THREE'), conflict: false })
  })

  it('treats two insertions at the same point as a conflict', () => {
    const ours = L(base, 'mine')
    const theirs = L(base, 'theirs')
    expect(merge3(base, ours, theirs)).toEqual({ text: ours, conflict: true })
  })

  it('merges from an empty base', () => {
    expect(merge3('', 'a', '')).toEqual({ text: 'a', conflict: false })
    expect(merge3('', '', 'b')).toEqual({ text: 'b', conflict: false })
  })
})
