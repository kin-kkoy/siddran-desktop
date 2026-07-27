// Sync endpoint + token, stored device-locally in localStorage.
//
// Deliberately NOT in SettingsContext: those settings are written into the Bag
// (settings.siddran), and the sync token is a device credential that shouldn't live
// in a vault file. It's also per-device by nature — a phone and a laptop may point at
// the same endpoint but hold their own copy.

const CONFIG_KEY = 'siddran_sync_config'
const LAST_KEY = 'siddran_sync_last'

export function readSyncConfig() {
  try {
    const o = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    return { endpoint: o.endpoint || '', token: o.token || '' }
  } catch { return { endpoint: '', token: '' } }
}

export function writeSyncConfig({ endpoint, token }) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ endpoint, token })) } catch { /* ignore */ }
}

export function readLastSync() {
  try { return localStorage.getItem(LAST_KEY) || null } catch { return null }
}

export function writeLastSync(iso) {
  try { localStorage.setItem(LAST_KEY, iso) } catch { /* ignore */ }
}
