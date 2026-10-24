// The desktop's half of the live channel to `siddran mcp` (see
// src-tauri/src/presence.rs): tell it what is on screen, hear what it wants shown.
// Outside Tauri (tests, a plain browser) these are quiet no-ops.

const inv = () => (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

export async function publishPresence(root, state) {
  const i = inv()
  if (!i || !root) return
  try { await i('presence_write', { root, state: JSON.stringify(state) }) } catch { /* runtime dir unavailable — the AI just sees "not running" */ }
}

export async function clearPresence(root) {
  const i = inv()
  if (!i || !root) return
  try { await i('presence_clear', { root }) } catch { /* nothing to clear */ }
}

// Resolves to an unsubscribe.
export async function listenRequests(root, onRequest) {
  const i = inv()
  const listen = typeof window !== 'undefined' && window.__TAURI__?.event?.listen
  if (!i || !listen || !root) return () => {}
  const un = await listen('siddran-request', (e) => onRequest(e.payload || {}))
  try { await i('presence_listen', { root }) } catch (e) { un(); throw e }
  return () => { un(); i('presence_unlisten').catch(() => {}) }
}
