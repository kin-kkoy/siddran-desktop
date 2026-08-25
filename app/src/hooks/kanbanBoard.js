// Where dailies and bundles sit on the kanban board.
//
// Tasks belong to a column because of their priority — that IS the column. Routine
// cards don't: a bundle in the "High priority" column isn't high priority, it's just
// parked there. So their placement is a view arrangement, not data, and it lives
// here (device-local, Bag-scoped) rather than on the record.
//
// Position is one number per item shared with tasks, so a column can interleave the
// two and still have a single unambiguous order.
import { getBagPath } from '../desktop/localStore'

export const ROUTINES_COL = 'routines'
export const DAILY_KEY = 'daily'
export const bundleKey = (id) => `bundle:${id}`

const keyFor = (bagPath) => `siddran_kanban_place:${bagPath || getBagPath() || 'default'}`

export function readPlacements(bagPath) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(bagPath)) || 'null')
    if (!raw || typeof raw !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object' && typeof v.col === 'string') {
        out[k] = { col: v.col, order: Number.isFinite(v.order) ? v.order : 0 }
      }
    }
    return out
  } catch { return {} }
}

export function writePlacements(placements, bagPath) {
  try { localStorage.setItem(keyFor(bagPath), JSON.stringify(placements)) }
  catch { /* an arrangement is a convenience, never fatal */ }
}

// Unplaced cards live in Routines — the column that exists so they have a home
// before you've decided otherwise.
export function placementFor(placements, key) {
  return placements?.[key] || { col: ROUTINES_COL, order: Number.MAX_SAFE_INTEGER }
}

export function setPlacement(placements, key, col, order) {
  return { ...placements, [key]: { col, order } }
}

// Drop everything we no longer have a card for, so deleted bundles don't linger.
export function prunePlacements(placements, liveKeys) {
  const live = new Set(liveKeys)
  const out = {}
  for (const [k, v] of Object.entries(placements || {})) if (live.has(k)) out[k] = v
  return out
}
