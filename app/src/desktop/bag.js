// Bag ("vault") plumbing for the desktop build. A Bag is just a folder the user
// picks. This module owns choosing that folder and remembering recent ones.
//
// Folder-picking needs Tauri's native dialog (only present in the desktop shell);
// in a plain browser it degrades to the File System Access API or a prompt so the
// flow stays testable during dev. Recent Bags live in the webview's localStorage,
// which persists per-app in both Tauri and the browser.

const RECENTS_KEY = 'siddran_recent_bags'
const MAX_RECENTS = 8

export function isTauri() {
  return typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

// Last path segment → the Bag's display name.
export function bagNameFromPath(path) {
  if (!path) return 'Bag'
  const parts = String(path).replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || 'Bag'
}

function pickString(res) {
  if (typeof res === 'string') return res
  if (Array.isArray(res) && typeof res[0] === 'string') return res[0]
  return null
}

async function chooseFolder(title) {
  // Desktop: native folder dialog via tauri-plugin-dialog. Prefer the core
  // `invoke` (always present with withGlobalTauri) over the JS plugin global.
  if (isTauri()) {
    const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke
    if (invoke) {
      try {
        const res = await invoke('plugin:dialog|open', { options: { directory: true, multiple: false, title } })
        return pickString(res)
      } catch { /* fall through */ }
    }
    if (window.__TAURI__?.dialog?.open) {
      return pickString(await window.__TAURI__.dialog.open({ directory: true, multiple: false, title }))
    }
  }
  // Browser dev fallbacks so the flow works without the desktop shell.
  if (typeof window !== 'undefined' && window.showDirectoryPicker) {
    try {
      const handle = await window.showDirectoryPicker()
      return handle?.name ? `/(browser)/${handle.name}` : null
    } catch { return null }
  }
  const name = typeof window !== 'undefined'
    ? window.prompt(`${title}\n(dev fallback — enter a folder name)`, 'My Bag')
    : null
  return name ? `/(dev)/${name.trim()}` : null
}

export async function pickExistingBag() {
  const path = await chooseFolder('Open a Bag')
  return path ? { name: bagNameFromPath(path), path } : null
}

export async function createBag() {
  const path = await chooseFolder('Choose a folder for your new Bag')
  return path ? { name: bagNameFromPath(path), path, isNew: true } : null
}

export function getRecentBags() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export function addRecentBag(bag) {
  try {
    const list = getRecentBags().filter((b) => b.path !== bag.path)
    list.unshift({ name: bag.name, path: bag.path })
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)))
  } catch { /* non-fatal */ }
}

export function getLastBag() {
  return getRecentBags()[0] || null
}
