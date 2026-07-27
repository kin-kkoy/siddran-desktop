import { describe, it, expect } from 'vitest'
import { mergeRows, mergeVault } from './merge.js'

const row = (id, title, updated_at = '2026-07-01T00:00:00.000Z', extra = {}) =>
  ({ id, title, is_completed: false, updated_at, ...extra })

const ids = (rows) => rows.map((r) => String(r.id)).sort()
const byId = (rows, id) => rows.find((r) => String(r.id) === String(id))

describe('mergeRows — the decision table', () => {
  const base = [row('a', 'A'), row('b', 'B'), row('c', 'C')]

  it('unchanged on both sides keeps the row', () => {
    const { rows } = mergeRows(base, base, base)
    expect(ids(rows)).toEqual(['a', 'b', 'c'])
  })

  it('changed locally only takes local', () => {
    const local = [row('a', 'A-local', '2026-07-02T00:00:00.000Z'), ...base.slice(1)]
    const { rows } = mergeRows(base, local, base)
    expect(byId(rows, 'a').title).toBe('A-local')
  })

  it('changed remotely only takes remote', () => {
    const remote = [row('a', 'A-remote', '2026-07-02T00:00:00.000Z'), ...base.slice(1)]
    const { rows } = mergeRows(base, base, remote)
    expect(byId(rows, 'a').title).toBe('A-remote')
  })

  it('changed on both sides keeps the newer updated_at and reports a conflict', () => {
    const local = [row('a', 'A-local', '2026-07-02T00:00:00.000Z'), ...base.slice(1)]
    const remote = [row('a', 'A-remote', '2026-07-03T00:00:00.000Z'), ...base.slice(1)]
    const { rows, conflicts } = mergeRows(base, local, remote)
    expect(byId(rows, 'a').title).toBe('A-remote')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].discarded.title).toBe('A-local')
  })

  it('deleted locally, untouched remotely stays deleted', () => {
    const local = base.filter((r) => r.id !== 'a')
    const { rows } = mergeRows(base, local, base)
    expect(ids(rows)).toEqual(['b', 'c'])
  })

  it('deleted remotely, untouched locally stays deleted', () => {
    const remote = base.filter((r) => r.id !== 'a')
    const { rows } = mergeRows(base, base, remote)
    expect(ids(rows)).toEqual(['b', 'c'])
  })

  it('deleted on one side but edited on the other keeps the edit', () => {
    const local = base.filter((r) => r.id !== 'a')
    const remote = [row('a', 'A-edited', '2026-07-05T00:00:00.000Z'), ...base.slice(1)]
    const { rows } = mergeRows(base, local, remote)
    expect(byId(rows, 'a').title).toBe('A-edited')
  })

  it('deleted on both sides stays deleted', () => {
    const gone = base.filter((r) => r.id !== 'a')
    const { rows } = mergeRows(base, gone, gone)
    expect(ids(rows)).toEqual(['b', 'c'])
  })

  it('created on one side only is kept', () => {
    const local = [...base, row('new-local', 'N')]
    const { rows } = mergeRows(base, local, base)
    expect(ids(rows)).toContain('new-local')
  })

  it('created on both sides is kept as two rows (uuids differ)', () => {
    const local = [...base, row('new-l', 'from phone')]
    const remote = [...base, row('new-r', 'from laptop')]
    const { rows } = mergeRows(base, local, remote)
    expect(ids(rows)).toEqual(['a', 'b', 'c', 'new-l', 'new-r'])
  })
})

describe('convergence — the property that stops sync ping-ponging', () => {
  // If two devices merge the same three snapshots and disagree, each will push a
  // result the other then "fixes", forever. Order must not matter.
  const base = [row('a', 'A'), row('b', 'B')]
  const local = [row('a', 'A-local', '2026-07-02T00:00:00.000Z'), row('b', 'B'), row('x', 'X')]
  const remote = [row('a', 'A-remote', '2026-07-03T00:00:00.000Z'), row('y', 'Y')]

  it('is symmetric: swapping local and remote gives the same result', () => {
    const forward = mergeRows(base, local, remote).rows
    const backward = mergeRows(base, remote, local).rows
    expect(ids(forward)).toEqual(ids(backward))
    expect(byId(forward, 'a')).toEqual(byId(backward, 'a'))
  })

  it('is symmetric even when updated_at ties', () => {
    const t = '2026-07-02T00:00:00.000Z'
    const l = [row('a', 'A-local', t)]
    const r = [row('a', 'A-remote', t)]
    const forward = mergeRows([row('a', 'A')], l, r).rows
    const backward = mergeRows([row('a', 'A')], r, l).rows
    expect(forward).toEqual(backward) // deterministic tie-break, not "prefer local"
  })

  it('is idempotent: merging the result again changes nothing', () => {
    const once = mergeRows(base, local, remote).rows
    const twice = mergeRows(once, once, once).rows
    expect(ids(twice)).toEqual(ids(once))
  })

  it('a merged result pushed back does not resurrect deletions', () => {
    const deletedLocally = [row('b', 'B')]
    const merged = mergeRows(base, deletedLocally, base).rows
    expect(ids(merged)).toEqual(['b'])
    // next sync: merged becomes the new base on both sides
    const again = mergeRows(merged, merged, merged).rows
    expect(ids(again)).toEqual(['b'])
  })

  it('key order in a row does not affect equality', () => {
    const b = [{ id: 'a', title: 'A', updated_at: 't' }]
    const l = [{ updated_at: 't', title: 'A', id: 'a' }] // same row, keys reordered
    const { rows, conflicts } = mergeRows(b, l, b)
    expect(conflicts).toHaveLength(0)
    expect(rows).toHaveLength(1)
  })
})

describe('completions — composite key, no updated_at', () => {
  const c = (daily_task_id, date) => ({ daily_task_id, date })
  const key = (x) => `${String(x.daily_task_id)}|${x.date}`

  it('unions completions created on both devices', () => {
    const base = [c('d1', '2026-07-01')]
    const local = [...base, c('d1', '2026-07-02')]
    const remote = [...base, c('d2', '2026-07-01')]
    const { rows } = mergeRows(base, local, remote, { key })
    expect(rows.map(key).sort()).toEqual(['d1|2026-07-01', 'd1|2026-07-02', 'd2|2026-07-01'])
  })

  it('an un-checked completion stays removed', () => {
    const base = [c('d1', '2026-07-01')]
    const { rows } = mergeRows(base, [], base, { key })
    expect(rows).toHaveLength(0)
  })

  it('same daily on different dates are distinct rows', () => {
    const { rows } = mergeRows([], [c('d1', '2026-07-01')], [c('d1', '2026-07-02')], { key })
    expect(rows).toHaveLength(2)
  })
})

describe('mergeVault', () => {
  const vault = (over = {}) => ({
    tasks: { tasks: [], dailies: [], completions: [], projects: [], ...over.tasks },
    calendar: { events: [], schedules: [], ...over.calendar },
  })

  it('merges every collection independently', () => {
    const base = vault()
    const local = vault({ tasks: { tasks: [row('t1', 'task')] } })
    const remote = vault({ calendar: { events: [row('e1', 'event')] } })
    const { merged } = mergeVault(base, local, remote)
    expect(ids(merged.tasks.tasks)).toEqual(['t1'])
    expect(ids(merged.calendar.events)).toEqual(['e1'])
  })

  it('merges project subtasks, not just the project row', () => {
    const proj = (subs, updated_at = '2026-07-01T00:00:00.000Z') =>
      [{ id: 'p1', title: 'P', updated_at, tasks: subs }]
    const base = vault({ tasks: { projects: proj([row('s1', 'sub1')]) } })
    const local = vault({ tasks: { projects: proj([row('s1', 'sub1'), row('s2', 'added here')]) } })
    const remote = vault({ tasks: { projects: proj([row('s1', 'sub1'), row('s3', 'added there')]) } })

    const { merged } = mergeVault(base, local, remote)
    expect(ids(merged.tasks.projects[0].tasks)).toEqual(['s1', 's2', 's3'])
  })

  it('tags conflicts with the collection they came from', () => {
    const base = vault({ tasks: { tasks: [row('t1', 'orig')] } })
    const local = vault({ tasks: { tasks: [row('t1', 'mine', '2026-07-02T00:00:00.000Z')] } })
    const remote = vault({ tasks: { tasks: [row('t1', 'theirs', '2026-07-03T00:00:00.000Z')] } })
    const { conflicts } = mergeVault(base, local, remote)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].collection).toBe('tasks')
    expect(conflicts[0].kept.title).toBe('theirs')
  })

  it('treats a missing/empty base as first-ever sync (union, no deletions)', () => {
    const local = vault({ tasks: { tasks: [row('t1', 'local only')] } })
    const remote = vault({ tasks: { tasks: [row('t2', 'remote only')] } })
    const { merged } = mergeVault(undefined, local, remote)
    expect(ids(merged.tasks.tasks)).toEqual(['t1', 't2'])
  })

  it('vault-level merge is symmetric', () => {
    const base = vault({ tasks: { tasks: [row('a', 'A')] } })
    const local = vault({ tasks: { tasks: [row('a', 'A2', '2026-07-02T00:00:00.000Z'), row('l', 'L')] } })
    const remote = vault({ tasks: { tasks: [row('r', 'R')] } })
    const f = mergeVault(base, local, remote).merged
    const b = mergeVault(base, remote, local).merged
    expect(ids(f.tasks.tasks)).toEqual(ids(b.tasks.tasks))
  })
})
