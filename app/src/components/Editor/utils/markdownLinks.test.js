import { describe, it, expect } from 'vitest'
import { markdownToHtml } from './markdownToHtml.js'

// The reading view used to hand the webview a live <a href>, and clicking one
// replaced the whole app — unsaved editor state included, with no way back.
// These pin the invariant that made that impossible: no anchor the renderer
// produces carries an href, and each one says where it actually goes.
describe('links never keep a live href', () => {
  const render = (md) => markdownToHtml(md)
  // A real href attribute — not `data-href`, which is how the target is carried.
  const LIVE_HREF = /\shref=/

  it('strips href from a web link and marks it external', () => {
    const html = render('[docs](https://example.com/page)')
    expect(html).not.toMatch(LIVE_HREF)
    expect(html).toContain('rv-link-external')
    expect(html).toContain('data-href="https://example.com/page"')
  })

  it('strips href from an autolink too', () => {
    expect(render('<https://example.com>')).not.toMatch(LIVE_HREF)
  })

  it('treats mailto as external', () => {
    const html = render('[mail](mailto:someone@example.com)')
    expect(html).toContain('rv-link-external')
    expect(html).not.toMatch(LIVE_HREF)
  })

  it('keeps a local attachment going to the side viewer', () => {
    const html = render('[paper.pdf](attachments/Note/paper.pdf)')
    expect(html).toContain('rv-link-pdf')
    expect(html).not.toContain('rv-link-external')
  })

  // A remote PDF is an attachment, not web browsing — the side viewer handles it.
  // Getting this order wrong sends it to the browser instead.
  it('keeps a REMOTE pdf as an attachment, not an external link', () => {
    const html = render('[spec](https://example.com/spec.pdf)')
    expect(html).toContain('rv-link-pdf')
    expect(html).not.toContain('rv-link-external')
  })

  // A remote HTML page is web browsing, which the side viewer deliberately
  // doesn't do — so this one goes the other way.
  it('sends a remote html page to the browser, not the viewer', () => {
    const html = render('[page](https://example.com/page.html)')
    expect(html).toContain('rv-link-external')
    expect(html).not.toContain('rv-link-html"')
  })

  it('renders a bare relative path inert rather than navigating', () => {
    const html = render('[somewhere](/register)')
    expect(html).toContain('rv-link-inert')
    expect(html).not.toMatch(LIVE_HREF)
  })
})
