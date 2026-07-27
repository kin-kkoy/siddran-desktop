// Tests the pure parse (the DOM build needs `document`, exercised in the browser).
import { describe, it, expect } from 'vitest'
import { parseInline } from './inlineRender.js'

const types = (nodes) => nodes.map((n) => n.type)

describe('parseInline', () => {
  it('plain text is a single text node', () => {
    expect(parseInline('just words')).toEqual([{ type: 'text', value: 'just words' }])
  })

  it('empty string parses to nothing', () => {
    expect(parseInline('')).toEqual([])
  })

  it('bold', () => {
    const n = parseInline('a **b** c')
    expect(types(n)).toEqual(['text', 'strong', 'text'])
    expect(n[1].children).toEqual([{ type: 'text', value: 'b' }])
  })

  it('italic with either delimiter', () => {
    expect(parseInline('*x*')[0].type).toBe('em')
    expect(parseInline('_x_')[0].type).toBe('em')
  })

  it('bold beats italic at the same position', () => {
    const n = parseInline('**bold**')
    expect(n).toHaveLength(1)
    expect(n[0].type).toBe('strong')
  })

  it('double underscore is bold, single is italic', () => {
    expect(parseInline('__b__')[0].type).toBe('strong')
    expect(parseInline('_i_')[0].type).toBe('em')
  })

  it('inline code is literal (no inner parsing)', () => {
    const n = parseInline('`**not bold**`')
    expect(n).toEqual([{ type: 'code', value: '**not bold**' }])
  })

  it('strikethrough, highlight, underline', () => {
    expect(parseInline('~~s~~')[0].type).toBe('del')
    expect(parseInline('==h==')[0].type).toBe('mark')
    expect(parseInline('<u>u</u>')[0].type).toBe('u')
  })

  it('link splits into href + text', () => {
    const n = parseInline('see [docs](https://x.dev/a)')
    expect(types(n)).toEqual(['text', 'link'])
    expect(n[1]).toMatchObject({ type: 'link', href: 'https://x.dev/a', text: 'docs' })
  })

  it('nests marks (bold containing italic)', () => {
    const n = parseInline('**a _b_ c**')
    expect(n[0].type).toBe('strong')
    expect(types(n[0].children)).toEqual(['text', 'em', 'text'])
  })

  it('nests a mark inside link text', () => {
    const n = parseInline('[**bold**](u)')
    expect(n[0].type).toBe('link')
    // link text is kept raw in `text` (rendered as text); this documents that.
    expect(n[0].text).toBe('**bold**')
  })

  it('leaves unknown constructs as text', () => {
    const n = parseInline('[[wikilink]] and ||spoiler||')
    expect(n.every((x) => x.type === 'text' || x.type === 'link')).toBe(true)
    // no strong/em/etc. spuriously created
    expect(types(n)).not.toContain('strong')
  })

  it('handles several marks in one string', () => {
    const n = parseInline('**b** and *i* and `c`')
    expect(types(n)).toEqual(['strong', 'text', 'em', 'text', 'code'])
  })
})
