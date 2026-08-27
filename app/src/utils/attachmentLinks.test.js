import { describe, it, expect } from 'vitest'
import {
  hrefKind, isPdfHref, isHtmlHref, isRemoteHref, isViewableHtmlHref,
  isAttachmentHref, isExternalHref, nameFromHref, canonicalAttachmentPath,
  ATTACHMENT_KINDS,
} from './attachmentLinks.js'

describe('hrefKind', () => {
  it('recognises pdf and html, including query and hash suffixes', () => {
    expect(hrefKind('attachments/Note/a.pdf')).toBe(ATTACHMENT_KINDS.PDF)
    expect(hrefKind('a.pdf?v=2')).toBe(ATTACHMENT_KINDS.PDF)
    expect(hrefKind('a.pdf#page=3')).toBe(ATTACHMENT_KINDS.PDF)
    expect(hrefKind('page.html')).toBe(ATTACHMENT_KINDS.HTML)
    expect(hrefKind('page.htm')).toBe(ATTACHMENT_KINDS.HTML)
    expect(hrefKind('_bundles/abc/index.html#top')).toBe(ATTACHMENT_KINDS.HTML)
  })

  it('is case-insensitive', () => {
    expect(hrefKind('A.PDF')).toBe(ATTACHMENT_KINDS.PDF)
    expect(hrefKind('PAGE.HTML')).toBe(ATTACHMENT_KINDS.HTML)
  })

  it('returns null for everything else', () => {
    expect(hrefKind('note.md')).toBeNull()
    expect(hrefKind('image.png')).toBeNull()
    expect(hrefKind('')).toBeNull()
    expect(hrefKind(null)).toBeNull()
    expect(hrefKind(undefined)).toBeNull()
    expect(hrefKind(42)).toBeNull()
  })

  it('does not match an extension appearing mid-path', () => {
    expect(hrefKind('my.pdf.notes/file.md')).toBeNull()
    expect(hrefKind('folder.html/thing.png')).toBeNull()
  })
})

describe('remote vs local', () => {
  it('spots remote links', () => {
    expect(isRemoteHref('https://example.com/a.pdf')).toBe(true)
    expect(isRemoteHref('http://example.com/a.pdf')).toBe(true)
    expect(isRemoteHref('//cdn.example.com/a.html')).toBe(true)
    expect(isRemoteHref('attachments/a.pdf')).toBe(false)
    expect(isRemoteHref('/abs/a.pdf')).toBe(false)
  })

  // Siddran deliberately doesn't browse the web: a remote page is not an attachment.
  it('refuses remote HTML but keeps remote PDF behaviour unchanged', () => {
    expect(isHtmlHref('https://example.com/page.html')).toBe(true)
    expect(isViewableHtmlHref('https://example.com/page.html')).toBe(false)
    expect(isViewableHtmlHref('attachments/page.html')).toBe(true)

    expect(isAttachmentHref('https://example.com/page.html')).toBe(false)
    expect(isAttachmentHref('https://example.com/a.pdf')).toBe(true)
    expect(isAttachmentHref('attachments/a.pdf')).toBe(true)
  })
})

describe('isPdfHref parity with the removed utils/pdfLinks', () => {
  it('still behaves exactly as before for pdf links', () => {
    expect(isPdfHref('attachments/Note/a.pdf')).toBe(true)
    expect(isPdfHref('a.pdf?x=1')).toBe(true)
    expect(isPdfHref('a.PDF')).toBe(true)
    expect(isPdfHref('page.html')).toBe(false)
    expect(isPdfHref(null)).toBe(false)
  })
})

describe('nameFromHref', () => {
  it('decodes the final segment', () => {
    expect(nameFromHref('attachments/My%20Note/a%20file.pdf')).toBe('a file.pdf')
    expect(nameFromHref('attachments/x/page.html')).toBe('page.html')
  })

  it('strips query and hash', () => {
    expect(nameFromHref('a.pdf?v=2#page=3')).toBe('a.pdf')
  })

  it('falls back per kind', () => {
    expect(nameFromHref('')).toBe('file')
    expect(nameFromHref('attachments/')).toBe('file')
  })

  it('survives a malformed percent-escape rather than throwing', () => {
    expect(() => nameFromHref('attachments/100%.pdf')).not.toThrow()
    expect(nameFromHref('attachments/100%.pdf')).toBe('100%.pdf')
  })
})


describe('canonicalAttachmentPath', () => {
  // The bug this exists for: attaching gave a raw path, clicking the link gave an
  // encoded one, so one file was trusted under two separate keys.
  it('collapses the encoded and raw spellings of one file', () => {
    const encoded = 'attachments/Start%20Here/be7d1466-codebase-map.html'
    const raw = 'attachments/Start Here/be7d1466-codebase-map.html'
    expect(canonicalAttachmentPath(encoded)).toBe(canonicalAttachmentPath(raw))
    expect(canonicalAttachmentPath(encoded)).toBe(raw)
  })

  it('is idempotent', () => {
    const p = 'attachments/Start Here/a.html'
    expect(canonicalAttachmentPath(canonicalAttachmentPath(p))).toBe(p)
  })

  it('handles parens and other escaped characters', () => {
    expect(canonicalAttachmentPath('attachments/My%20Note%20%281%29/a.html'))
      .toBe('attachments/My Note (1)/a.html')
  })

  it('leaves a malformed escape alone instead of throwing', () => {
    expect(() => canonicalAttachmentPath('attachments/100%/a.html')).not.toThrow()
    expect(canonicalAttachmentPath('attachments/100%/a.html')).toBe('attachments/100%/a.html')
  })

  it('tolerates junk', () => {
    expect(canonicalAttachmentPath(null)).toBe('')
    expect(canonicalAttachmentPath('')).toBe('')
  })
})

describe('isExternalHref', () => {
  it('accepts web addresses and mail', () => {
    expect(isExternalHref('https://example.com/a')).toBe(true)
    expect(isExternalHref('http://example.com')).toBe(true)
    expect(isExternalHref('//example.com/a')).toBe(true)
    expect(isExternalHref('mailto:someone@example.com')).toBe(true)
    expect(isExternalHref('  https://example.com  ')).toBe(true)
  })

  // An allowlist, not a blocklist: the platform opener will happily act on a
  // file: URL or a .desktop launcher, so anything unrecognised stays inert.
  it('refuses anything that is not web browsing or mail', () => {
    expect(isExternalHref('file:///etc/passwd')).toBe(false)
    expect(isExternalHref('javascript:alert(1)')).toBe(false)
    expect(isExternalHref('attachments/a.pdf')).toBe(false)
    expect(isExternalHref('/register')).toBe(false)
    expect(isExternalHref('')).toBe(false)
    expect(isExternalHref(null)).toBe(false)
  })
})
