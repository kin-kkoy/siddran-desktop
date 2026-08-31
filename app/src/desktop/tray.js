// The tray, the OS notification, and hiding instead of quitting.
//
// Same shape as htmlViewer.js / reveal.js: everything goes through
// window.__TAURI__ directly (this app has no @tauri-apps/api package), each call
// is a no-op in a plain browser, and the Rust side owns the capability so the
// webview is granted nothing new.
const invoke = () => (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

export async function setCloseToTray(enabled) {
  const inv = invoke()
  if (!inv) return
  try { await inv('set_close_to_tray', { enabled: !!enabled }) } catch { /* not under Tauri */ }
}

// False on a desktop with no StatusNotifier host — where hiding the window would
// leave no way to get it back, so the setting has to be refused rather than
// silently broken.
export async function trayAvailable() {
  const inv = invoke()
  if (!inv) return false
  try { return !!(await inv('tray_available')) } catch { return false }
}

export async function showMainWindow() {
  const inv = invoke()
  if (!inv) return
  try { await inv('alarm_show_window') } catch { /* nothing to raise */ }
}

export async function notifyOS(title, body) {
  const inv = invoke()
  if (!inv) return
  try { await inv('notify_deadline', { title: String(title || ''), body: String(body || '') }) }
  catch { /* no notification daemon; the modal is the real UI */ }
}

// The mirror of installCloseFlush: when the window hides into the tray the
// process lives on, but the last edit still has to reach disk — a hidden app can
// be killed at any moment.
export function installFlushOnly(flush) {
  const listen = typeof window !== 'undefined' && window.__TAURI__?.event?.listen
  if (!listen) return () => {}
  let un = null
  listen('siddran:flush-only', async () => {
    try {
      const detail = { waits: [] }
      window.dispatchEvent(new CustomEvent('siddran:flush-editors', { detail }))
      await Promise.all(detail.waits)
    } catch { /* flush the store regardless */ }
    try { await flush() } catch { /* nothing more to do */ }
  }).then((f) => { un = f })
  return () => { if (un) un() }
}
