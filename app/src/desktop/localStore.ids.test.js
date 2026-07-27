// Guards the mixed-id contract: rows written before the uuid switch keep integer
// ids and must stay reachable, while every row created from now on gets a uuid.
// Both kinds have to survive lookup, update, delete, foreign keys, and a disk
// round-trip — a regression here silently breaks either old data or sync.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemFs } from './fs/memFs.js'
import { openBagStore, localFetch, closeBagStore } from './localStore.js'

const BAG = '/bag'

// Seed with LEGACY integer ids, mirroring the shape of the real vault on disk.
const seed = () => ({
  [`${BAG}/tasks.siddran`]: JSON.stringify({
    tasks: [{ id: 1625, title: 'Legacy task', description: '', priority: 'high', due_date: null, is_completed: false, created_at: 'x', updated_at: 'x' }],
    dailies: [{ id: 1700, title: 'Legacy daily', priority: 'normal', is_completed: false, created_at: 'x', updated_at: 'x', expires_at: null, recurrence: 'every-day', time: null }],
    completions: [],
    projects: [{ id: 1800, title: 'Legacy project', priority: 'normal', is_completed: false, color: null, created_at: 'x', updated_at: 'x', tasks: [{ id: 1801, project_id: 1800, title: 'Legacy subtask', priority: 'normal', is_completed: false, created_at: 'x', updated_at: 'x' }] }],
  }),
  [`${BAG}/calendar.siddran`]: JSON.stringify({
    events: [{ id: 1900, title: 'Legacy event', start_at: '2026-07-01T10:00:00Z', end_at: null, all_day: false, color: null, ref_type: null, ref_id: null, schedule_id: 1950, created_at: 'x', updated_at: 'x' }],
    schedules: [{ id: 1950, name: 'Legacy schedule', color: null, template: null, created_at: 'x' }],
  }),
  [`${BAG}/settings.siddran`]: JSON.stringify({ settings: {} }),
})

const j = (r) => r.json()
const post = (u, b) => localFetch(u, { method: 'POST', body: JSON.stringify(b) })
const put = (u, b) => localFetch(u, { method: 'PUT', body: JSON.stringify(b) })
const del = (u, b) => localFetch(u, { method: 'DELETE', ...(b ? { body: JSON.stringify(b) } : {}) })

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

beforeEach(async () => {
  await closeBagStore()
  await openBagStore(createMemFs(seed()), BAG)
})

describe('legacy integer ids keep working (no regression)', () => {
  it('reads, updates and deletes a legacy task', async () => {
    expect((await j(await localFetch('/tasks/1625'))).title).toBe('Legacy task')
    expect((await j(await put('/tasks/1625', { title: 'Renamed' }))).title).toBe('Renamed')
    expect((await del('/tasks/1625')).ok).toBe(true)
    expect((await localFetch('/tasks/1625')).status).toBe(404)
  })

  it('updates a legacy event and schedule', async () => {
    expect((await j(await put('/events/1900', { title: 'E2' }))).title).toBe('E2')
    expect((await put('/schedules/1950', { name: 'S2' })).ok).toBe(true)
  })

  it('handles legacy daily completions (foreign key by id)', async () => {
    const r = await j(await post('/daily-tasks/1700/completions', { date: '2026-07-01', done: true }))
    expect(r.done).toBe(true)
    const list = await j(await localFetch('/daily-tasks/completions?from=2026-07-01&to=2026-07-01'))
    expect(list.completions).toHaveLength(1)
    expect(list.completions[0].daily_task_id).toBe(1700)
  })

  it('handles legacy project subtask updates', async () => {
    const r = await j(await put('/projects/1800/tasks/1801', { is_completed: true }))
    expect(r.is_completed).toBe(true)
  })

  it('batch-completes and batch-deletes legacy dailies', async () => {
    expect((await localFetch('/daily-tasks/batch-complete', { method: 'PATCH', body: JSON.stringify({ tasks: [{ id: 1700, is_completed: true }] }) })).ok).toBe(true)
    expect((await del('/daily-tasks/batch-delete', { tasks: [{ id: 1700 }] })).ok).toBe(true)
  })
})

describe('new records get uuids and round-trip', () => {
  it('task', async () => {
    const t = await j(await post('/tasks', { title: 'New' }))
    expect(isUuid(t.id)).toBe(true)
    expect((await j(await localFetch(`/tasks/${t.id}`))).title).toBe('New')
    expect((await j(await put(`/tasks/${t.id}`, { priority: 'high' }))).priority).toBe('high')
    expect((await del(`/tasks/${t.id}`)).ok).toBe(true)
    expect((await localFetch(`/tasks/${t.id}`)).status).toBe(404)
  })

  it('event', async () => {
    const e = await j(await post('/events', { title: 'New ev', start_at: '2026-07-02T10:00:00Z' }))
    expect(isUuid(e.id)).toBe(true)
    expect((await j(await put(`/events/${e.id}`, { title: 'Ev2' }))).title).toBe('Ev2')
    expect((await del(`/events/${e.id}`)).ok).toBe(true)
  })

  it('daily + completion foreign key', async () => {
    const rows = await j(await post('/daily-tasks', { tasks: [{ title: 'D', recurrence: 'every-day' }] }))
    const id = rows[0].id
    expect(isUuid(id)).toBe(true)
    const c = await j(await post(`/daily-tasks/${id}/completions`, { date: '2026-07-01', done: true }))
    expect(c.daily_task_id).toBe(id)
    const list = await j(await localFetch('/daily-tasks/completions?from=2026-07-01&to=2026-07-01'))
    expect(list.completions.some((x) => x.daily_task_id === id)).toBe(true)
  })

  it('project + subtask foreign keys', async () => {
    const p = await j(await post('/projects', { title: 'P', tasks: [{ title: 'sub' }] }))
    expect(isUuid(p.id)).toBe(true)
    expect(isUuid(p.tasks[0].id)).toBe(true)
    expect(p.tasks[0].project_id).toBe(p.id)
    const upd = await j(await put(`/projects/${p.id}/tasks/${p.tasks[0].id}`, { is_completed: true }))
    expect(upd.is_completed).toBe(true)
    const added = await j(await post(`/projects/${p.id}/tasks`, { tasks: [{ title: 'sub2' }] }))
    expect(isUuid(added.tasks[1].id)).toBe(true)
    expect((await del(`/projects/${p.id}/tasks`, { tasks: [{ id: added.tasks[1].id }] })).ok).toBe(true)
  })

  it('schedule stamps events carrying its uuid as schedule_id', async () => {
    const r = await j(await post('/schedules', { name: 'S', events: [{ title: 'b', start_at: '2026-07-03T09:00:00Z' }] }))
    expect(isUuid(r.schedule.id)).toBe(true)
    expect(isUuid(r.events[0].id)).toBe(true)
    expect(r.events[0].schedule_id).toBe(r.schedule.id)
    expect(r.schedule.block_count).toBe(1)
    expect((await del(`/schedules/${r.schedule.id}`)).ok).toBe(true)
  })
})

describe('malformed ids on disk cannot poison the id counter', () => {
  // The vault is hand-editable markdown, so `id:` in frontmatter can be anything.
  // A non-numeric value parses to NaN; if NaN reaches Math.max, seq becomes NaN
  // and every id minted afterwards is NaN (serialized as null), silently colliding.
  it('a non-numeric id in note frontmatter still yields usable new ids', async () => {
    await closeBagStore()
    await openBagStore(createMemFs({
      ...seed(),
      [`${BAG}/notes/hand-edited.md`]: '---\nid: abc\ntitle: Hand edited\n---\nbody',
    }), BAG)

    const a = await j(await post('/notes', { title: 'A' }))
    const b = await j(await post('/notes', { title: 'B' }))
    expect(Number.isFinite(a.id)).toBe(true)
    expect(Number.isFinite(b.id)).toBe(true)
    expect(a.id).not.toBe(b.id)
    // and it must still clear the legacy ids already on disk
    expect(a.id).toBeGreaterThan(1950)
  })

  it('survives ids that are null, missing, or Infinity', async () => {
    await closeBagStore()
    await openBagStore(createMemFs({
      ...seed(),
      [`${BAG}/notes/no-id.md`]: '---\ntitle: No id\n---\nbody',
      [`${BAG}/notes/inf.md`]: '---\nid: Infinity\ntitle: Inf\n---\nbody',
    }), BAG)

    const a = await j(await post('/notes', { title: 'A' }))
    expect(Number.isFinite(a.id)).toBe(true)
  })
})

describe('on-disk write order is stable (git-mergeable)', () => {
  const read = async (fs, p) => JSON.parse(await fs.readText(p))
  const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle))

  it('writes rows in id order regardless of insertion order', async () => {
    const fs = createMemFs(seed())
    await closeBagStore(); await openBagStore(fs, BAG)
    for (const title of ['zeta', 'alpha', 'mid']) await post('/tasks', { title })
    const { flushNow } = await import('./localStore.js')
    await flushNow()

    const ids = (await read(fs, `${BAG}/tasks.siddran`)).tasks.map((t) => String(t.id))
    expect(ids).toEqual([...ids].sort())
  })

  it('editing a row does not move it in the file', async () => {
    const fs = createMemFs(seed())
    await closeBagStore(); await openBagStore(fs, BAG)
    const a = await j(await post('/tasks', { title: 'AAA' }))
    await post('/tasks', { title: 'BBB' })
    const { flushNow } = await import('./localStore.js')
    await flushNow()
    const before = lineOf(await fs.readText(`${BAG}/tasks.siddran`), a.id)

    await put(`/tasks/${a.id}`, { title: 'AAA edited', priority: 'high' })
    await flushNow()
    const after = lineOf(await fs.readText(`${BAG}/tasks.siddran`), a.id)

    expect(after).toBe(before) // an edit is a local diff, not a move
  })

  it('serialization depends on the set of rows, not the order they arrived', async () => {
    // This is the property that makes a git merge viable: two devices that end up
    // holding the same rows must produce byte-identical files, whatever order the
    // rows were created in. Without sorting, arrival order leaks into the file and
    // every divergent history conflicts.
    const { flushNow } = await import('./localStore.js')
    const rows = [
      { id: 'ccc-uuid', title: 'c', description: '', priority: 'normal', due_date: null, is_completed: false, created_at: 'x', updated_at: 'x' },
      { id: 'aaa-uuid', title: 'a', description: '', priority: 'normal', due_date: null, is_completed: false, created_at: 'x', updated_at: 'x' },
      { id: 'bbb-uuid', title: 'b', description: '', priority: 'normal', due_date: null, is_completed: false, created_at: 'x', updated_at: 'x' },
    ]
    // Identical row SET, different array order on disk — as two diverged clones
    // would have. A no-op PUT just marks the file dirty so it gets rewritten.
    const rewrite = async (order) => {
      const fs = createMemFs({
        [`${BAG}/tasks.siddran`]: JSON.stringify({ tasks: order, dailies: [], completions: [], projects: [] }),
      })
      await closeBagStore(); await openBagStore(fs, BAG)
      await put('/tasks/aaa-uuid', { title: 'a' })
      await flushNow()
      // the no-op PUT stamps updated_at; blank it so we compare structure, not clocks
      return (await fs.readText(`${BAG}/tasks.siddran`)).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>')
    }
    const forward = await rewrite(rows)
    const reverse = await rewrite([...rows].reverse())
    expect(forward).toBe(reverse) // byte-identical → mergeable
  })

  it('sorting on write loses no data and reloads intact', async () => {
    const fs = createMemFs(seed())
    await closeBagStore(); await openBagStore(fs, BAG)
    await post('/tasks', { title: 'extra' })
    await post('/daily-tasks', { tasks: [{ title: 'd1', recurrence: 'every-day' }] })
    const dailies = await j(await localFetch('/daily-tasks'))
    await post(`/daily-tasks/${dailies.dailyTasks[0].id}/completions`, { date: '2026-07-01', done: true })
    const { flushNow } = await import('./localStore.js')
    await flushNow()

    await closeBagStore(); await openBagStore(fs, BAG)
    const tasks = await j(await localFetch('/tasks'))
    const ds = await j(await localFetch('/daily-tasks'))
    const cs = await j(await localFetch('/daily-tasks/completions?from=2026-07-01&to=2026-07-01'))
    expect(tasks.tasks).toHaveLength(2)   // legacy + new
    expect(ds.dailyTasks).toHaveLength(2)
    expect(cs.completions).toHaveLength(1)
    const p = await j(await localFetch('/projects/1800'))
    expect(p.tasks).toHaveLength(1)       // subtasks preserved
  })
})

describe('mixed ids coexist and survive a disk round-trip', () => {
  it('legacy + uuid rows both persist and reload', async () => {
    const fresh = createMemFs(seed())
    await closeBagStore()
    await openBagStore(fresh, BAG)
    const t = await j(await post('/tasks', { title: 'Persisted' }))
    const { flushNow } = await import('./localStore.js')
    await flushNow()

    await closeBagStore()
    await openBagStore(fresh, BAG)
    const all = await j(await localFetch('/tasks'))
    const ids = all.tasks.map((x) => x.id)
    expect(ids).toContain(1625)      // legacy int survived
    expect(ids).toContain(t.id)      // uuid survived
    // and a brand-new int-seq id must not collide with the legacy one
    const t2 = await j(await post('/tasks', { title: 'Another' }))
    expect(isUuid(t2.id)).toBe(true)
  })
})
