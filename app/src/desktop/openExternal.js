// Hand a URL to the user's real browser.
//
// The webview must never navigate to it — that replaces the app. There is no
// shared invoke wrapper in this codebase (withGlobalTauri is on, so every caller
// reaches for window.__TAURI__ itself); this follows htmlViewer.js's idiom.
//
// The Rust command re-checks the scheme and refuses anything that isn't
// http/https/mailto. That check is the real one — this is not a place to relax it.
const invoke = () =>
  (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

export async function openExternalUrl(url) {
  const inv = invoke()
  // Outside the desktop shell (dev in a plain browser) there is nothing to hand
  // it to, and letting it through would navigate — so say so instead.
  if (!inv) throw new Error('Links can only be opened from the desktop app')
  await inv('open_external_url', { url })
}

// Ask the user, then open. This is the door every surface uses — the reading view,
// the editor, and the capture-phase link guard — so the prompt is guaranteed and
// there is exactly one place that decides what it says.
//
// The gate (components/Common/ExternalLinkGate) installs the receiver when it
// mounts. Before that, or outside React entirely, this does nothing — which is
// the right failure: doing nothing is strictly better than navigating the app
// away.
export const requestOpenExternal = (url) => { window.__siddranOpenExternal?.(url) }
