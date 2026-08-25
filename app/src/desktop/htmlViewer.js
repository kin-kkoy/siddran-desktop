// Bridge to the `siddran-html` URI scheme (src-tauri/src/main.rs).
//
// Attached HTML is served over its own scheme rather than the asset protocol so
// the Rust side can attach a per-request Content-Security-Policy, and so a
// trusted page gets an origin of its OWN — not Siddran's, which is what rendering
// the source inline would have given it.
import { getBagPath } from './localStore'

export const VIEWER_SCHEME = 'siddran-html'

const invoke = () =>
  (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

// Tell Rust which Bag the viewer may read from. Called on every Bag open; passing
// an empty path shuts the protocol off entirely.
export async function setViewerBag(bagPath) {
  const inv = invoke()
  if (!inv) return
  try { await inv('viewer_set_bag', { path: bagPath || '' }) } catch { /* viewer stays closed */ }
}

// Mirror the web-fonts setting into the CSP the protocol emits.
export async function setViewerFonts(allow) {
  const inv = invoke()
  if (!inv) return
  try { await inv('viewer_set_fonts', { allow: !!allow }) } catch { /* keeps the last policy */ }
}

// Bag-relative attachment path → a URL the iframe can load.
//
// Deliberately NOT convertFileSrc: it runs encodeURIComponent over the whole path,
// turning every "/" into "%2F" so the entire path becomes a single URL segment.
// A saved page's `page_files/style.css` then resolves against the ROOT — the
// directory is lost and every local asset 404s, leaving the page unstyled with no
// error. Encoding per segment keeps the separators real, so relative references
// resolve the way the page expects.
export function viewerUrl(relPath) {
  const bag = getBagPath()
  if (!bag || !relPath) return ''
  let rel = relPath
  // Markdown link targets are percent-encoded; the path on disk is not.
  try { rel = relPath.split('/').map(decodeURIComponent).join('/') } catch { /* keep raw */ }
  const abs = `${bag}/${rel}`.replace(/\/+/g, '/')
  const encoded = abs.split('/').map(encodeURIComponent).join('/')
  // Tauri maps custom schemes differently per platform.
  const win = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  const origin = win ? `http://${VIEWER_SCHEME}.localhost` : `${VIEWER_SCHEME}://localhost`
  return `${origin}${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

// Persist what a viewed page saved. The page's storage shim posts its whole map up
// to us; the KEY is decided here, from the file actually open, so a page cannot
// address another page's storage by claiming a different path.
export async function saveViewerStorage(relPath, data) {
  const inv = invoke()
  if (!inv || !relPath) return
  let rel = relPath
  try { rel = relPath.split('/').map(decodeURIComponent).join('/') } catch { /* keep raw */ }
  try { await inv('viewer_save_storage', { key: rel, data }) } catch { /* page keeps working */ }
}

// Hosts this page may load styles/images/fonts/scripts from. Per file; `connect-src`
// stays closed regardless, so an approved page can render itself but cannot open a
// channel to send anything back.
export async function setViewerAllowedHosts(relPath, hosts) {
  const inv = invoke()
  if (!inv || !relPath) return
  let rel = relPath
  try { rel = relPath.split('/').map(decodeURIComponent).join('/') } catch { /* keep raw */ }
  try { await inv('viewer_set_allowed_hosts', { key: rel, hosts: hosts || [] }) } catch { /* policy unchanged */ }
}

// Let the asset protocol read this Bag. Must land BEFORE anything resolves an
// asset URL: without it every inline image and PDF renders blank, with nothing in
// the UI to explain why.
export async function allowBagAssets(bagPath) {
  const inv = invoke()
  if (!inv || !bagPath) return true
  try { await inv('bag_allow_asset', { path: bagPath }); return true } catch { return false }
}

// Flush pending vault writes before the window actually closes. Rust holds the
// close, emits `siddran:flush-and-close`, and waits for us to call back — without
// this, anything inside the store's 1.5s write debounce dies with the webview.
export function installCloseFlush(flush) {
  const listen = typeof window !== 'undefined' && window.__TAURI__?.event?.listen
  const inv = invoke()
  if (!listen || !inv) return () => {}
  let un = null
  listen('siddran:flush-and-close', async () => {
    try {
      // Editors hold the newest text; hand it to the store before draining it.
      const detail = { waits: [] }
      window.dispatchEvent(new CustomEvent('siddran:flush-editors', { detail }))
      await Promise.all(detail.waits)
    } catch { /* fall through to the store flush regardless */ }
    try { await flush() } catch { /* close regardless — a failed flush must not trap the app */ }
    try { await inv('app_close') } catch { /* the Rust-side timeout closes us anyway */ }
  }).then((f) => { un = f })
  return () => { if (un) un() }
}
