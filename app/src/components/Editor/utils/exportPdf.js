import { markdownToHtml } from './markdownToHtml'

// Export a note to PDF the dependency-free, can't-really-break way: render the note
// to the SAME HTML the reading view uses, drop it into an isolated, hidden IFRAME
// with a self-contained light document stylesheet, then trigger the browser's
// native print dialog (the user picks "Save as PDF"). An iframe (rather than a
// popup window) works inside the desktop webview, where window.open is blocked.
// No jsPDF/html2canvas, so nothing to mis-render. Images are awaited (with a
// timeout) so they land in the PDF.

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// Self-contained light-theme document styles (the app is dark; a printed/exported
// page should read as a normal light document). Mirrors the reading view's layout
// but with print-friendly colours, and reveals spoilers (it's the user's own note).
export const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
    font-size: 12pt; line-height: 1.6; color: #1a1a1a; background: #fff; margin: 0; padding: 24px 28px; max-width: 820px; }
  .doc-title { font-size: 1.9em; font-weight: 700; margin: 0 0 0.6em; line-height: 1.2; }
  .doc-body h1,.doc-body h2,.doc-body h3,.doc-body h4,.doc-body h5,.doc-body h6 { font-weight: 700; line-height: 1.3; margin: 1.3em 0 0.5em; }
  .doc-body h1 { font-size: 1.6em; } .doc-body h2 { font-size: 1.4em; } .doc-body h3 { font-size: 1.2em; }
  .doc-body h4 { font-size: 1.08em; } .doc-body h5 { font-size: 1em; } .doc-body h6 { font-size: 0.92em; color: #666; }
  .doc-body p { margin: 0.6em 0; }
  .doc-body a { color: #1d4ed8; text-decoration: none; }
  .doc-body ul,.doc-body ol { margin: 0.5em 0; padding-left: 1.6em; }
  .doc-body li { margin: 0.2em 0; }
  .doc-body li::marker { color: #1d4ed8; }
  .doc-body blockquote { margin: 0.8em 0; padding: 0.2em 0 0.2em 14px; border-left: 3px solid #ccc; color: #444; }
  .doc-body code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.88em;
    background: #f1f1f4; border-radius: 4px; padding: 1px 5px; color: #b8860b; }
  .doc-body pre { background: #f6f6f8; border: 1px solid #e2e2e8; border-radius: 8px; padding: 12px 14px; overflow: auto; page-break-inside: avoid; }
  .doc-body pre code { background: none; padding: 0; color: #1a1a1a; font-size: 10.5pt; }
  .doc-body img { max-width: 100%; border-radius: 6px; display: block; margin: 0.5em 0; page-break-inside: avoid; }
  .doc-body hr { border: none; border-top: 1px solid #ddd; margin: 1.2em 0; }
  .doc-body table { border-collapse: collapse; margin: 0.8em 0; }
  .doc-body th,.doc-body td { border: 1px solid #ccc; padding: 6px 12px; }
  .doc-body th { background: #f1f1f4; font-weight: 600; }
  .doc-body mark { background: #fff3a3; color: inherit; border-radius: 3px; padding: 0 2px; }
  .doc-body u { text-decoration: underline; }
  .rv-hashtag { color: #7c3aed; background: rgba(124,58,237,0.12); border-radius: 20px; padding: 1px 8px; font-size: 0.88em; }
  .rv-spoiler { background: #eee; border-radius: 3px; padding: 0 2px; }
  .rv-link { color: #1d4ed8; }
  .rv-callout { border-left: 3px solid #5a9cf0; background: #eef4fe; border-radius: 6px; padding: 10px 14px; margin: 0.8em 0; page-break-inside: avoid; }
  .rv-callout > p:first-child { font-weight: 600; margin-top: 0; }
  .rv-callout-warning,.rv-callout-question,.rv-callout-caution { border-left-color: #d9a441; background: #fdf6e9; }
  .rv-callout-danger,.rv-callout-error,.rv-callout-bug,.rv-callout-failure { border-left-color: #e05c5c; background: #fdeeee; }
  .rv-callout-tip,.rv-callout-success,.rv-callout-hint,.rv-callout-done { border-left-color: #52c47a; background: #eef9f1; }
`

export function printNoteToPdf(note) {
  if (!note) return

  const title = note.title || 'Untitled'
  const bodyHtml = markdownToHtml(note.body || '') // already try/catch-guarded
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${PRINT_CSS}</style></head><body>` +
    `<h1 class="doc-title">${escapeHtml(title)}</h1><div class="doc-body">${bodyHtml}</div></body></html>`

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const win = iframe.contentWindow
  const doc = win.document
  doc.open(); doc.write(html); doc.close()

  let cleaned = false
  const cleanup = () => { if (cleaned) return; cleaned = true; setTimeout(() => iframe.remove(), 500) }

  // Wait for images to load (so they appear in the PDF), but never hang on a broken
  // or slow one — print after at most 4s regardless.
  const imgs = Array.from(doc.images)
  const loaded = Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise(res => { img.onload = res; img.onerror = res })))
  Promise.race([loaded, new Promise(res => setTimeout(res, 4000))]).then(() => {
    win.focus()
    win.onafterprint = cleanup
    win.print()
    setTimeout(cleanup, 60000) // fallback if onafterprint never fires
  })
}
