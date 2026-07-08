// In-memory replacement for window.localStorage / sessionStorage, installed when
// a visitor enters guest demo mode. The whole point of guest mode is that
// NOTHING persists — so rather than police the ~13 individual localStorage keys
// the app writes (JWT, cinder_settings, the cinder_sandbox_* family, note_folds_*,
// view-mode prefs, calendar prefs…), we swap the storage object itself. Every
// existing `localStorage.getItem/setItem/...` call then transparently reads and
// writes a Map that lives only in the tab's heap and dies on refresh. It is
// impossible to forget a key this way.
//
// Note: this is installed at button-click time, so module-init reads that already
// happened (e.g. sandboxStore's readList(), SettingsProvider's initial cache read)
// are NOT rewound — those are handled separately (sandboxStore.resetForGuest()).
// What this guarantees is that no NEW write from a guest session ever touches disk.

function createMemStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)) },
    removeItem: (k) => { map.delete(String(k)) },
    clear: () => { map.clear() },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  }
}

let installed = false

export function installMemStorage() {
  if (installed || typeof window === 'undefined') return
  try {
    // Defining an own property on `window` shadows the Window.prototype
    // localStorage getter; configurable:true lets restoreRealStorage() delete it
    // to expose the real accessor again.
    Object.defineProperty(window, 'localStorage', {
      value: createMemStorage(), configurable: true, writable: true,
    })
    Object.defineProperty(window, 'sessionStorage', {
      value: createMemStorage(), configurable: true, writable: true,
    })
    installed = true
  } catch (err) {
    // Degraded mode: if a browser refuses the override, guest DATA is still
    // ephemeral (it lives in guestApi, never the network), only some UI prefs
    // might leak to disk. Not worth crashing the demo over.
    console.warn('guest: could not install in-memory storage override', err)
  }
}

export function restoreRealStorage() {
  if (!installed || typeof window === 'undefined') return
  try {
    delete window.localStorage
    delete window.sessionStorage
  } catch { /* leave the shim in place rather than throw */ }
  installed = false
}
