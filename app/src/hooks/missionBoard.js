// Where the papers sit on the Mission Board.
//
// The sibling of kanbanBoard.js, and the same reasoning: a position on a
// bulletin board is an arrangement, not data about the task, so it lives here —
// device-local and Bag-scoped — rather than on the record.
//
// Two modes, and the difference is the whole point of the lock button:
//
//   unlocked — the board is re-scattered once per app LAUNCH and held in a
//              module singleton for the rest of the session, so wandering off to
//              Notes and back doesn't reshuffle the wall. Drags move papers for
//              the session and are forgotten on quit.
//   locked   — the arrangement is written down and comes back exactly as you
//              left it. Papers still drag; every drag persists.
//
// x/y are PERCENTAGES of the board, so resizing the window keeps the layout.
import { getBagPath } from '../desktop/localStore'

export const TASK_KEY = (id) => `task:${id}`
export const DAILY_KEY = (id) => `daily:${id}`
export const BUNDLE_KEY = (id) => `bundle:${id}`

const placeKey = (bagPath) => `siddran_board_place:${bagPath || getBagPath() || 'default'}`
const lockKey = (bagPath) => `siddran_board_locked:${bagPath || getBagPath() || 'default'}`

// Scatter bounds, in percent. Papers are positioned by their centre, so these
// keep a whole card inside the board rather than just its midpoint.
const X_MIN = 14, X_MAX = 86
const Y_MIN = 14, Y_MAX = 86
const TILT = 7            // degrees either side of straight
// Papers are boxes, not dots, so separation is tested per axis. A 214px sheet on
// a typical board is roughly 18% of its width, which is why these are not equal:
// a circular radius that cleared them horizontally left far too much air above
// and below, and one that looked right vertically let titles overlap.
const GAP_X = 18
const GAP_Y = 14
const TRIES = 30

export function readLocked(bagPath) {
  try { return localStorage.getItem(lockKey(bagPath)) === 'true' } catch { return false }
}

export function writeLocked(locked, bagPath) {
  try { localStorage.setItem(lockKey(bagPath), String(!!locked)) }
  catch { /* an arrangement is a convenience, never fatal */ }
}

export function readPlacements(bagPath) {
  try {
    const raw = JSON.parse(localStorage.getItem(placeKey(bagPath)) || 'null')
    if (!raw || typeof raw !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y)) {
        out[k] = {
          x: clamp(v.x, X_MIN, X_MAX),
          y: clamp(v.y, Y_MIN, Y_MAX),
          tilt: Number.isFinite(v.tilt) ? v.tilt : 0,
          z: Number.isFinite(v.z) ? v.z : 1,
        }
      }
    }
    return out
  } catch { return {} }
}

export function writePlacements(placements, bagPath) {
  try { localStorage.setItem(placeKey(bagPath), JSON.stringify(placements)) }
  catch { /* as above */ }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// How badly a spot collides with what is already up: 0 is clear, higher is worse.
// Two papers only really conflict when they overlap on BOTH axes.
function crowding(taken, x, y) {
  let worst = 0
  for (const p of taken) {
    const ox = Math.max(0, GAP_X - Math.abs(p.x - x)) / GAP_X
    const oy = Math.max(0, GAP_Y - Math.abs(p.y - y)) / GAP_Y
    const overlap = Math.min(ox, oy)
    if (overlap > worst) worst = overlap
  }
  return worst
}

// One paper's spot. Tries a number of times to land clear of what is already
// pinned up and keeps the best attempt — a board where nothing ever overlaps
// looks like a spreadsheet, so a little is fine and raise-on-click handles it,
// but a sheet whose title is buried is just broken.
function scatterOne(taken, rand) {
  let best = null
  let bestScore = Infinity
  for (let i = 0; i < TRIES; i++) {
    const x = X_MIN + rand() * (X_MAX - X_MIN)
    const y = Y_MIN + rand() * (Y_MAX - Y_MIN)
    const score = crowding(taken, x, y)
    if (score < bestScore) { bestScore = score; best = { x, y } }
    if (score === 0) break
  }
  return best
}

// A whole board's worth of positions for `keys`, in the order given.
export function scatter(keys, rand = Math.random) {
  const taken = []
  const out = {}
  // A shuffled z-order, so the stacking looks tossed rather than sorted.
  const order = keys.map((_, i) => i + 1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  keys.forEach((key, i) => {
    const spot = scatterOne(taken, rand)
    taken.push(spot)
    out[key] = { x: spot.x, y: spot.y, tilt: (rand() * 2 - 1) * TILT, z: order[i] }
  })
  return out
}

// Fill in a spot for anything new without disturbing what is already placed —
// a task added while you are looking at the board should land somewhere sensible,
// not shuffle the wall.
export function withNewKeys(placements, keys, rand = Math.random) {
  const missing = keys.filter((k) => !placements[k])
  if (!missing.length) return placements
  const taken = Object.values(placements)
  const out = { ...placements }
  let z = Math.max(0, ...taken.map((p) => p.z || 0))
  for (const key of missing) {
    const spot = scatterOne(taken, rand)
    taken.push(spot)
    out[key] = { x: spot.x, y: spot.y, tilt: (rand() * 2 - 1) * TILT, z: ++z }
  }
  return out
}

export function moveTo(placements, key, x, y) {
  const prev = placements[key] || { tilt: 0, z: 1 }
  return { ...placements, [key]: { ...prev, x: clamp(x, X_MIN, X_MAX), y: clamp(y, Y_MIN, Y_MAX) } }
}

export function raise(placements, key) {
  const top = Math.max(0, ...Object.values(placements).map((p) => p.z || 0))
  const prev = placements[key]
  if (!prev || prev.z === top) return placements
  return { ...placements, [key]: { ...prev, z: top + 1 } }
}

// Drop everything we no longer have a paper for, so deleted tasks don't linger.
// Only ever called with a live key list that came from a real response — the
// caller gates on that, because pruning against an unloaded [] would wipe a
// locked arrangement.
export function prunePlacements(placements, liveKeys) {
  const live = new Set(liveKeys)
  const out = {}
  for (const [k, v] of Object.entries(placements || {})) if (live.has(k)) out[k] = v
  return out
}
