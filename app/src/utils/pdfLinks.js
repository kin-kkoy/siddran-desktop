// Shared helpers for PDF attachment links. A PDF is stored in a note as a plain
// markdown link — `[name.pdf](attachments/…/name.pdf)` — so the vault stays
// portable; the editor + reading view route clicks on `.pdf` links to the side
// viewer instead of navigating the webview.

export const isPdfHref = (href) =>
  typeof href === 'string' && /\.pdf(\?|#|$)/i.test(href)

// Human-readable file name from a (possibly URL-encoded) link target.
export const pdfNameFromHref = (href) => {
  const raw = String(href || '').split(/[?#]/)[0].split('/').pop() || 'document.pdf'
  try { return decodeURIComponent(raw) || 'document.pdf' } catch { return raw }
}
