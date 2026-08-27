// Shared helpers for attachment links in a note. An attachment is stored as a
// plain markdown link — `[name.pdf](attachments/…/name.pdf)` — so the vault stays
// portable; the editor and reading view route clicks on those links to the side
// viewer instead of letting the webview navigate to the file.
//
// Supersedes utils/pdfLinks.js. Three places used to test for `.pdf`
// independently — the CM6 click handler had its own inline regex — and any new
// kind has to be taught to all of them at once or it works in one surface and
// silently not the other. They all go through hrefKind() now.

export const ATTACHMENT_KINDS = { PDF: 'pdf', HTML: 'html' }

const EXT_PATTERNS = [
  [ATTACHMENT_KINDS.PDF, /\.pdf(\?|#|$)/i],
  [ATTACHMENT_KINDS.HTML, /\.html?(\?|#|$)/i],
]

const DEFAULT_NAME = { [ATTACHMENT_KINDS.PDF]: 'document.pdf', [ATTACHMENT_KINDS.HTML]: 'page.html' }

// A link that points off the machine. Kept separate from hrefKind so each caller
// picks its own policy: PDFs have always allowed remote URLs (the webview's PDF
// viewer handles them), but a remote HTML page is web browsing, which Siddran
// deliberately doesn't do.
export const isRemoteHref = (href) =>
  typeof href === 'string' && /^(https?:)?\/\//i.test(href.trim())

// Which kind of attachment a link target is, or null if it isn't one.
export function hrefKind(href) {
  if (typeof href !== 'string') return null
  for (const [kind, re] of EXT_PATTERNS) if (re.test(href)) return kind
  return null
}

export const isPdfHref = (href) => hrefKind(href) === ATTACHMENT_KINDS.PDF
export const isHtmlHref = (href) => hrefKind(href) === ATTACHMENT_KINDS.HTML

// Local HTML only — a remote page is web browsing, not an attachment.
export const isViewableHtmlHref = (href) => isHtmlHref(href) && !isRemoteHref(href)

// Anything the side pane can display.
export const isAttachmentHref = (href) => {
  const kind = hrefKind(href)
  if (kind === ATTACHMENT_KINDS.HTML) return !isRemoteHref(href)
  return kind !== null
}

// A link that belongs to the outside world rather than to the Bag — web browsing
// or mail. This is the set Siddran hands to the system browser (behind a confirm),
// and it is deliberately an ALLOWLIST: anything unrecognised is treated as inert
// rather than passed to the OS, because the platform opener will happily act on a
// `file:` URL or a .desktop launcher. Rust re-checks the scheme before opening —
// this is the same rule stated on the side that decides what to offer.
export const isExternalHref = (href) =>
  isRemoteHref(href) || (typeof href === 'string' && /^mailto:/i.test(href.trim()))

// Human-readable file name from a (possibly URL-encoded) link target.
export function nameFromHref(href) {
  const kind = hrefKind(href)
  const fallback = DEFAULT_NAME[kind] || 'file'
  const raw = String(href || '').split(/[?#]/)[0].split('/').pop() || fallback
  try { return decodeURIComponent(raw) || fallback } catch { return raw }
}

// One file, one identity.
//
// The same attachment reaches us spelled two ways: `media.js` hands back the raw
// Bag-relative path when you attach it, while the markdown link it writes is
// percent-encoded — so "Start Here" and "Start%20Here" are the same file with
// different names. Anything keyed on the exact string (trust decisions, per-file
// state) must canonicalise first or it will store two entries and treat one as
// unknown.
export function canonicalAttachmentPath(path) {
  if (typeof path !== 'string' || !path) return ''
  return path.split('/').map((seg) => {
    try { return decodeURIComponent(seg) } catch { return seg }
  }).join('/')
}
