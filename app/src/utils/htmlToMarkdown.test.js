import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, titleFromHtml } from './htmlToMarkdown.js'

describe('structure', () => {
  it('converts headings, emphasis and lists', () => {
    const md = htmlToMarkdown('<h1>Title</h1><h2>Sub</h2><p>A <b>bold</b> and <i>italic</i> word.</p><ul><li>one</li><li>two</li></ul>')
    expect(md).toContain('# Title')
    expect(md).toContain('## Sub')
    expect(md).toContain('**bold**')
    expect(md).toContain('*italic*')
    expect(md).toContain('- one')
  })

  it('keeps links and images', () => {
    const md = htmlToMarkdown('<p><a href="https://example.com">site</a></p><img src="https://x/y.png" alt="pic">')
    expect(md).toContain('[site](https://example.com)')
    expect(md).toContain('![pic](https://x/y.png)')
  })

  it('converts tables through GFM', () => {
    const md = htmlToMarkdown('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(md).toContain('| A | B |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('keeps code blocks fenced', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1\n</code></pre>')
    expect(md).toContain('```')
    expect(md).toContain('const x = 1')
  })

  it('handles blockquotes and rules', () => {
    const md = htmlToMarkdown('<blockquote><p>quoted</p></blockquote><hr>')
    expect(md).toContain('> quoted')
    expect(md).toContain('---')
  })
})

// The reason sanitising happens before conversion: imported markdown is rendered by
// the note reader, which has no sandbox and no CSP to fall back on.
describe('sanitisation', () => {
  it('drops scripts entirely, content and all', () => {
    const md = htmlToMarkdown('<p>before</p><script>alert(1)</script><p>after</p>')
    expect(md).toContain('before')
    expect(md).toContain('after')
    expect(md).not.toContain('alert')
    expect(md).not.toContain('script')
  })

  it('drops inline event handlers', () => {
    const md = htmlToMarkdown('<p onclick="steal()">text</p>')
    expect(md).toContain('text')
    expect(md).not.toContain('steal')
    expect(md).not.toContain('onclick')
  })

  it('strips javascript: links but keeps the text', () => {
    const md = htmlToMarkdown('<a href="javascript:alert(1)">click me</a>')
    expect(md).not.toContain('javascript:')
    expect(md).toContain('click me')
  })

  it('strips data: URLs in links', () => {
    const md = htmlToMarkdown('<a href="data:text/html,<script>x</script>">x</a>')
    expect(md).not.toContain('data:text/html')
  })

  it('drops iframes, objects and embeds', () => {
    const md = htmlToMarkdown('<iframe src="https://evil.com"></iframe><object data="x"></object><embed src="y">')
    expect(md).not.toContain('evil.com')
    expect(md).not.toContain('iframe')
  })

  it('drops style blocks rather than dumping CSS into the note', () => {
    const md = htmlToMarkdown('<style>body{color:red}</style><p>hi</p>')
    expect(md).not.toContain('color:red')
    expect(md).toContain('hi')
  })
})

describe('robustness', () => {
  it('returns empty for junk instead of throwing', () => {
    for (const junk of [null, undefined, '', '   ', 42, {}]) {
      expect(() => htmlToMarkdown(junk)).not.toThrow()
      expect(htmlToMarkdown(junk)).toBe('')
    }
  })

  it('survives malformed markup', () => {
    expect(() => htmlToMarkdown('<div><p>unclosed<ul><li>x')).not.toThrow()
    expect(htmlToMarkdown('<div><p>unclosed<ul><li>x')).toContain('unclosed')
  })
})

describe('titleFromHtml', () => {
  it('prefers <title>, falls back to the first h1', () => {
    expect(titleFromHtml('<title>Doc</title><h1>Heading</h1>')).toBe('Doc')
    expect(titleFromHtml('<h1>Heading</h1>')).toBe('Heading')
  })

  it('cleans nested markup and whitespace out of the title', () => {
    expect(titleFromHtml('<title>  A <span>nested</span>\n  title </title>')).toBe('A nested title')
  })

  it('returns null when there is nothing usable, so the caller can use the file name', () => {
    expect(titleFromHtml('<p>no title</p>')).toBeNull()
    expect(titleFromHtml('<title>   </title>')).toBeNull()
    expect(titleFromHtml(null)).toBeNull()
  })

  it('caps an absurdly long title', () => {
    expect(titleFromHtml(`<title>${'x'.repeat(400)}</title>`).length).toBe(120)
  })
})
