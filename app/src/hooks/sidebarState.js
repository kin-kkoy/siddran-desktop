// Persisted sidebar UI state — device-local (localStorage), never synced. Mirrors
// the pattern of noteFoldsCache / cinder_cal_day_2col: per-device UI preferences
// that should NOT travel between machines (a phone and a laptop want their own
// expand/collapse state), so this deliberately stays out of settings.siddran.
import { getBagPath } from '../desktop/localStore'

// Which notebook groups are collapsed in the note list — scoped per Bag, since
// notebook ids only mean anything within their Bag.
const nbKey = () => `siddran_sidebar_nb_collapsed:${getBagPath() || 'default'}`

export function readCollapsedNotebooks() {
  try {
    const a = JSON.parse(localStorage.getItem(nbKey()) || '[]')
    return new Set(Array.isArray(a) ? a.map(String) : [])
  } catch { return new Set() }
}

export function writeCollapsedNotebooks(set) {
  try { localStorage.setItem(nbKey(), JSON.stringify([...set])) } catch { /* ignore */ }
}

// Whether the "List of Notes" accordion is expanded on NotesHub — a global UI
// preference (default expanded).
const LIST_OPEN_KEY = 'siddran_sidebar_list_open'

export function readListOpen() {
  try { return localStorage.getItem(LIST_OPEN_KEY) !== 'false' } catch { return true }
}

export function writeListOpen(open) {
  try { localStorage.setItem(LIST_OPEN_KEY, String(open)) } catch { /* ignore */ }
}
