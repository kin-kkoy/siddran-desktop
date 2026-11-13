// Three-way merge for the vault's row collections. Pure — no I/O, no network —
// so it can be exercised entirely from tests. See ../../../references/sync-design.md.
//
// Inputs are three snapshots of the same collection:
//   base   — what we last successfully synced (stored locally)
//   local  — what's on this device now
//   remote — what the server just handed us
//
// `base` is load-bearing, not an optimisation: a deleted row simply disappears
// from the array, so without base a delete is indistinguishable from a row this
// device has never seen — and deletions would resurrect on every sync.
//
// Both devices must independently reach the SAME merged result, or they'll ping-pong
// forever. That's why every tie-break here is deterministic and symmetric rather
// than "prefer local".
import { merge3 } from './text3'

// Stable stringify: key order must not affect equality or the tie-break.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
}

const same = (a, b) => stable(a) === stable(b)

// Last-write-wins on updated_at, falling back to a content comparison so the result
// is identical no matter which side is called "local".
function newer(a, b) {
  const ta = a?.updated_at ?? '', tb = b?.updated_at ?? ''
  if (ta !== tb) return ta > tb ? a : b
  const sa = stable(a), sb = stable(b)
  if (sa === sb) return a
  return sa > sb ? a : b
}

/**
 * Merge one collection of rows.
 * @param {object} opts
 * @param {(row:any)=>string} opts.key      identity of a row
 * @param {(l:any,r:any)=>any} [opts.both]  override for the both-sides-edited case
 * @returns {{rows: any[], conflicts: Array<{key:string, kept:any, discarded:any}>}}
 */
export function mergeRows(base = [], local = [], remote = [], opts = {}) {
  const key = opts.key || ((r) => String(r.id))
  const both = opts.both || newer
  const index = (rows) => new Map((rows || []).map((r) => [key(r), r]))
  const B = index(base), L = index(local), R = index(remote)

  const rows = []
  const conflicts = []
  for (const k of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
    const b = B.get(k), l = L.get(k), r = R.get(k)

    // Not in base → created since the last sync, on one side or both.
    if (!b) {
      if (l && r) {
        if (!same(l, r)) {
          const kept = both(l, r)
          conflicts.push({ key: k, kept, discarded: kept === l ? r : l })
          rows.push(kept)
        } else rows.push(l)
      } else rows.push(l || r)
      continue
    }

    const lGone = !l, rGone = !r
    const lEdit = !lGone && !same(l, b)
    const rEdit = !rGone && !same(r, b)

    if (lGone && rGone) continue                 // deleted on both
    if (lGone) { if (rEdit) rows.push(r); continue }  // delete loses to an edit
    if (rGone) { if (lEdit) rows.push(l); continue }
    if (!lEdit && !rEdit) { rows.push(b); continue }
    if (lEdit && !rEdit) { rows.push(l); continue }
    if (!lEdit && rEdit) { rows.push(r); continue }

    const kept = both(l, r)                      // edited on both → LWW
    conflicts.push({ key: k, kept, discarded: kept === l ? r : l })
    rows.push(kept)
  }
  return { rows, conflicts }
}

// completions have no id of their own and no updated_at — (daily_task_id, date) is
// their whole identity, and presence *is* the value. They can be created or removed
// but never "edited", so the both-sides-edited branch is unreachable for them.
const completionKey = (c) => `${String(c.daily_task_id)}|${c.date}`

// Projects carry a nested `tasks` array whose rows are independently editable, so a
// project is merged as a row *and* its subtasks are merged as their own collection.
function mergeProjects(base, local, remote) {
  const merged = mergeRows(base, local, remote)
  const byId = (rows) => new Map((rows || []).map((p) => [String(p.id), p]))
  const B = byId(base), L = byId(local), R = byId(remote)

  const conflicts = [...merged.conflicts]
  const rows = merged.rows.map((p) => {
    const k = String(p.id)
    const sub = mergeRows(B.get(k)?.tasks, L.get(k)?.tasks, R.get(k)?.tasks)
    conflicts.push(...sub.conflicts.map((c) => ({ ...c, key: `project:${k}/${c.key}` })))
    return { ...p, tasks: sub.rows }
  })
  return { rows, conflicts }
}

const EMPTY = { tasks: { tasks: [], dailies: [], completions: [], projects: [] }, calendar: { events: [], schedules: [] } }
const at = (snap, file, coll) => snap?.[file]?.[coll] ?? []

/**
 * Merge a whole vault snapshot. Shape mirrors what the sync endpoint stores:
 *   { tasks: {tasks,dailies,completions,projects}, calendar: {events,schedules} }
 * @returns {{merged: object, conflicts: Array}}
 */
export function mergeVault(base = EMPTY, local = EMPTY, remote = EMPTY) {
  const conflicts = []
  const run = (file, coll, opts) => {
    const r = mergeRows(at(base, file, coll), at(local, file, coll), at(remote, file, coll), opts)
    conflicts.push(...r.conflicts.map((c) => ({ ...c, collection: coll })))
    return r.rows
  }

  const projects = mergeProjects(at(base, 'tasks', 'projects'), at(local, 'tasks', 'projects'), at(remote, 'tasks', 'projects'))
  conflicts.push(...projects.conflicts.map((c) => ({ ...c, collection: 'projects' })))

  return {
    merged: {
      tasks: {
        tasks: run('tasks', 'tasks'),
        dailies: run('tasks', 'dailies'),
        completions: run('tasks', 'completions', { key: completionKey }),
        projects: projects.rows,
      },
      calendar: {
        events: run('calendar', 'events'),
        schedules: run('calendar', 'schedules'),
      },
    },
    conflicts,
  }
}

// ── board items ─────────────────────────────────────────────────────
// A board's items merge row by row (mergeRows). A Format widget (a shape with
// payload.kind 'format') holds a whole dataset in its payload, so whole-item
// last-write-wins would drop one side's records when both edited the same
// widget. For those, the item is merged field by field and its `records` and
// `fields` record by record — two people adding or editing different records
// both keep their work. Only a key (or record) changed on both sides is a
// conflict, settled by the same symmetric rules as everything else here.
const isFormatItem = (it) => it?.type === 'shape' && it?.payload?.kind === 'format'
const LISTS = new Set(['records', 'fields'])
// A Doc's text (payload.body, view 'doc') merges line by line, like a note.
const TEXTS = new Set(['body'])

// One value, three ways. Returns [value, conflicted].
function pick3(b, l, r) {
  if (same(l, r)) return [l, false]
  if (same(l, b)) return [r, false]
  if (same(r, b)) return [l, false]
  return [stable(l) > stable(r) ? l : r, true]   // both changed: deterministic either way round
}

function mergeKeys(b = {}, l = {}, r = {}, lists = new Set(), texts = new Set()) {
  const out = {}
  let conflicted = false
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    let v, c
    if (lists.has(k) && (Array.isArray(l[k]) || Array.isArray(r[k]))) {
      const m = mergeRows(b?.[k], l[k], r[k])
      v = m.rows; c = m.conflicts.length > 0
    } else if (texts.has(k) && typeof l[k] === 'string' && typeof r[k] === 'string') {
      const base = typeof b?.[k] === 'string' ? b[k] : ''
      const m = merge3(base, l[k], r[k])
      // merge3 lets `ours` win a clash; both devices must land on the same text, so pick symmetrically.
      if (m.conflict) { const n = merge3(base, r[k], l[k]); v = m.text > n.text ? m.text : n.text; c = true }
      else { v = m.text; c = false }
    } else {
      // A key gone on one side and untouched on the other is a removal.
      const inL = k in l, inR = k in r, inB = b && k in b
      if (!inL && inB && same(r[k], b[k])) continue
      if (!inR && inB && same(l[k], b[k])) continue
      ;[v, c] = pick3(b?.[k], l[k], r[k])
      if (v === undefined) continue
    }
    out[k] = v
    if (c) conflicted = true
  }
  return [out, conflicted]
}

/** Merge a board's items (see above). Same `{rows, conflicts}` shape as mergeRows. */
export function mergeSandboxItems(base = [], local = [], remote = []) {
  const B = new Map((base || []).map((it) => [String(it.id), it]))
  const clean = new Set()   // formats both sides edited that merged without a clash
  const both = (l, r) => {
    if (!isFormatItem(l) || !isFormatItem(r)) return newer(l, r)
    const b = B.get(String(l.id))
    const [top, c1] = mergeKeys(b, { ...l, payload: undefined }, { ...r, payload: undefined })
    const [payload, c2] = mergeKeys(b?.payload, l.payload, r.payload, LISTS, TEXTS)
    if (!c1 && !c2) clean.add(String(l.id))
    return { ...top, payload }
  }
  const { rows, conflicts } = mergeRows(base, local, remote, { both })
  return { rows, conflicts: conflicts.filter((c) => !clean.has(c.key)) }
}
