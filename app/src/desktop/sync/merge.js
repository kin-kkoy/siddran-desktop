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
