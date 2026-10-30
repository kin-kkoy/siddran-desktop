import { describe, it, expect } from 'vitest'
import { parseMarkdownFile } from './markdownIO'

describe('parseMarkdownFile tags', () => {
  it('tags a hub import as Imported, after the file\'s own tags', () => {
    expect(parseMarkdownFile('---\ntags: work\n---\nbody', 'a.md').tags).toBe('work, Imported')
    expect(parseMarkdownFile('body', 'a.md').tags).toBe('Imported')
  })

  it('keeps only the file\'s own tags when asked (Add to Bag)', () => {
    expect(parseMarkdownFile('---\ntags: work\n---\nbody', 'a.md', { tagImported: false }).tags).toBe('work')
    expect(parseMarkdownFile('body', 'a.md', { tagImported: false }).tags).toBe('')
  })

  it('takes the title from the first heading and moves it out of the body', () => {
    const parsed = parseMarkdownFile('# Trip plan\n\nPack the bags.\n', 'Trip Notes.md', { tagImported: false })
    expect(parsed.title).toBe('Trip plan')
    expect(parsed.body).toBe('Pack the bags.')
  })
})
