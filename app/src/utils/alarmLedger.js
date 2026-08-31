// What has already gone off, so nothing rings twice.
//
// Bag-scoped localStorage, same shape as hooks/kanbanBoard.js. Device-local on
// purpose: two machines sharing a Bag must each alarm for themselves, and a
// "fired" flag written onto the task row would sync and let one machine silence
// the other. Writing it to the Bag would also mean a clock tick dirties the
// store, which flushes, which the scheduler's next poll then reads back — a
// thing observing what it causes.
//
// The ledger is APPEND-ONLY. Nothing is ever removed because a task "wasn't
// found": on first render the task list is [] and that must not be able to
// destroy anything. The only removal is by age.
import { getBagPath } from '../desktop/localStore'

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const keyFor = (bagPath) => `siddran_alarms_fired:${bagPath || getBagPath() || 'default'}`

export function readLedger(bagPath) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(bagPath)) || 'null')
    if (!raw || typeof raw !== 'object') return {}
    const cutoff = Date.now() - MAX_AGE_MS
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      if (Number.isFinite(v) && v > cutoff) out[k] = v
    }
    return out
  } catch { return {} }
}

export function writeLedger(ledger, bagPath) {
  try { localStorage.setItem(keyFor(bagPath), JSON.stringify(ledger)) }
  catch { /* a ledger is a convenience; a full disk must not stop the alarm */ }
}

export function markFired(ledger, key, at = Date.now()) {
  return { ...ledger, [key]: at }
}
