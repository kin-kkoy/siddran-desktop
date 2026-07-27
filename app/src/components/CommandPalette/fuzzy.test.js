import { describe, it, expect } from 'vitest'
import { fuzzyScore, rankCommands } from './fuzzy.js'

describe('fuzzyScore', () => {
  it('matches a subsequence', () => {
    expect(fuzzyScore('tbl', 'Insert table')).not.toBeNull()
    expect(fuzzyScore('it', 'Italic')).not.toBeNull()
  })
  it('rejects a non-subsequence', () => {
    expect(fuzzyScore('zzz', 'Insert table')).toBeNull()
    expect(fuzzyScore('tba', 'Insert table')).toBeNull() // order matters: no 'a' after 'tb'
  })
  it('empty query matches everything with score 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
  it('prefers a prefix / word-boundary match over a scattered one', () => {
    const prefix = fuzzyScore('bo', 'Bold')
    const scattered = fuzzyScore('bo', 'Blockquote') // b...o far apart
    expect(prefix).toBeLessThan(scattered)
  })
  it('rewards contiguous runs', () => {
    const contiguous = fuzzyScore('tab', 'table')
    const gappy = fuzzyScore('tab', 't a b') // spaces break the run
    expect(contiguous).toBeLessThan(gappy)
  })
})

describe('rankCommands', () => {
  const cmds = [
    { id: 'bold', title: 'Bold', keywords: 'strong' },
    { id: 'italic', title: 'Italic' },
    { id: 'table', title: 'Insert table', keywords: 'grid rows' },
    { id: 'quote', title: 'Blockquote', keywords: '' },
  ]

  it('returns all commands (unfiltered) for an empty query', () => {
    expect(rankCommands('', cmds)).toHaveLength(4)
    expect(rankCommands('   ', cmds)).toHaveLength(4)
  })

  it('filters out non-matches', () => {
    const r = rankCommands('table', cmds)
    expect(r.map((c) => c.id)).toEqual(['table'])
  })

  it('ranks a title match above a keywords-only match', () => {
    // "grid" only matches the table command via keywords
    const r = rankCommands('grid', cmds)
    expect(r[0].id).toBe('table')
  })

  it('best title match comes first', () => {
    const r = rankCommands('bo', cmds)
    expect(r[0].id).toBe('bold') // prefix beats "Blockquote"'s scattered b..o
  })

  it('keyword hit still surfaces a command whose title does not match', () => {
    const r = rankCommands('strong', cmds)
    expect(r.map((c) => c.id)).toContain('bold')
  })

  it('preserves registry order for equal scores', () => {
    const items = [
      { id: 'a', title: 'Same' },
      { id: 'b', title: 'Same' },
    ]
    const r = rankCommands('same', items)
    expect(r.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
