import { describe, it, expect, beforeEach } from 'vitest'
import { createMemFs } from '../fs/memFs.js'
import { openBagStore, closeBagStore, localFetch, flushNow, readVaultFile } from '../localStore.js'
import { syncNow, BASE_FILE, SyncError } from './client.js'

// ── a stand-in for the Worker, with the same etag/If-Match semantics ──────────
function fakeServer({ token = 'tok' } = {}) {
  const state = { body: null, etag: null, seq: 0, puts: 0, gets: 0 }
  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  })
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const auth = init.headers?.authorization
    if (auth !== `Bearer ${token}`) return res(401, null)

    if (url.endsWith('/v1/vault/meta')) return res(200, { etag: state.etag, updated_at: null })

    if (method === 'GET') {
      state.gets++
      if (!state.body) return res(404, null)
      return res(200, JSON.parse(state.body), { etag: state.etag })
    }
    if (method === 'PUT') {
      state.puts++
      const ifMatch = init.headers?.['if-match']
      if (!ifMatch) return res(428, { error: 'If-Match required' })
      if (state.body && ifMatch === '*') return res(412, { error: 'exists' })
      if (state.body && ifMatch !== state.etag) return res(412, { error: 'mismatch' })
      state.body = init.body
      state.etag = `"e${++state.seq}"`
      return res(200, { ok: true }, { etag: state.etag })
    }
    return res(405, null)
  }
  return { fetchImpl, state, snapshot: () => (state.body ? JSON.parse(state.body) : null) }
}

// ── two independent devices sharing one server ───────────────────────────────
const BAG = '/bag'
const emptyVault = () => ({
  [`${BAG}/tasks.siddran`]: JSON.stringify({ tasks: [], dailies: [], completions: [], projects: [] }),
  [`${BAG}/calendar.siddran`]: JSON.stringify({ events: [], schedules: [] }),
})

function device() { return createMemFs(emptyVault()) }
const use = async (fs) => { await closeBagStore(); await openBagStore(fs, BAG) }

const addTask = async (title) =>
  (await (await localFetch('/tasks', { method: 'POST', body: JSON.stringify({ title }) })).json())
const listTasks = async () => (await (await localFetch('/tasks')).json()).tasks
const titles = async () => (await listTasks()).map((t) => t.title).sort()

let server
beforeEach(() => { server = fakeServer() })
const opts = () => ({ endpoint: 'https://x.workers.dev', token: 'tok', fetchImpl: server.fetchImpl })

describe('syncNow — first contact', () => {
  it('uploads the whole vault when the remote is empty (404)', async () => {
    const A = device(); await use(A)
    await addTask('only local')
    const r = await syncNow(opts())
    expect(r.firstPush).toBe(true)
    expect(server.snapshot().tasks.tasks).toHaveLength(1)
  })

  it('writes a base snapshot after a successful sync', async () => {
    const A = device(); await use(A)
    await addTask('t')
    expect(await readVaultFile(BASE_FILE)).toBeNull()
    await syncNow(opts())
    const base = await readVaultFile(BASE_FILE)
    expect(base.tasks.tasks).toHaveLength(1)
  })

  it('pulls into an empty device', async () => {
    const A = device(); await use(A); await addTask('from A'); await syncNow(opts())
    const B = device(); await use(B)
    expect(await titles()).toEqual([])
    await syncNow(opts())
    expect(await titles()).toEqual(['from A'])
  })
})

describe('syncNow — two devices converge', () => {
  it('each device ends up with both rows', async () => {
    const A = device(), B = device()

    await use(A); await addTask('from A'); await syncNow(opts())
    await use(B); await addTask('from B'); await syncNow(opts())
    expect(await titles()).toEqual(['from A', 'from B'])

    await use(A); await syncNow(opts())
    expect(await titles()).toEqual(['from A', 'from B'])
  })

  it('an edit on one device reaches the other', async () => {
    const A = device(), B = device()
    await use(A); const t = await addTask('original'); await syncNow(opts())
    await use(B); await syncNow(opts())

    await use(A)
    await localFetch(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ title: 'edited on A' }) })
    await syncNow(opts())

    await use(B); await syncNow(opts())
    expect(await titles()).toEqual(['edited on A'])
  })

  it('a deletion propagates instead of resurrecting', async () => {
    const A = device(), B = device()
    await use(A); const t = await addTask('doomed'); await syncNow(opts())
    await use(B); await syncNow(opts())
    expect(await titles()).toEqual(['doomed'])

    await use(A)
    await localFetch(`/tasks/${t.id}`, { method: 'DELETE' })
    await syncNow(opts())

    await use(B); await syncNow(opts())
    expect(await titles()).toEqual([])

    // and it stays gone on a second round-trip
    await use(A); await syncNow(opts())
    expect(await titles()).toEqual([])
  })

  it('reports a conflict when both devices edit the same row', async () => {
    const A = device(), B = device()
    await use(A); const t = await addTask('base'); await syncNow(opts())
    await use(B); await syncNow(opts())

    await use(A)
    await localFetch(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ title: 'A wins later' }) })
    await syncNow(opts())

    await use(B)
    await localFetch(`/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ title: 'B edit' }) })
    const r = await syncNow(opts())
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].collection).toBe('tasks')
  })

  it('syncing twice with no changes is a no-op', async () => {
    const A = device(); await use(A); await addTask('t'); await syncNow(opts())
    const before = await titles()
    await syncNow(opts()); await syncNow(opts())
    expect(await titles()).toEqual(before)
  })
})

describe('syncNow — failure handling', () => {
  it('retries when the remote moves between GET and PUT (412)', async () => {
    const A = device(); await use(A); await addTask('a'); await syncNow(opts())

    // Inject one interfering write, then let the retry succeed.
    let interfered = false
    const racy = async (url, init = {}) => {
      const out = await server.fetchImpl(url, init)
      if (!interfered && (init.method || 'GET') === 'GET') {
        interfered = true
        server.state.body = JSON.stringify({ tasks: { tasks: [], dailies: [], completions: [], projects: [] }, calendar: { events: [], schedules: [] } })
        server.state.etag = '"moved"'
      }
      return out
    }
    await addTask('b')
    const r = await syncNow({ ...opts(), fetchImpl: racy })
    expect(r.attempts).toBeGreaterThan(1)
  })

  it('gives up after maxAttempts if the remote never settles', async () => {
    const A = device(); await use(A); await addTask('a')
    await syncNow(opts()) // establish remote state, so If-Match is a real check

    await addTask('b')
    // Move the remote's etag right after every GET, so our PUT is always stale.
    const alwaysMoving = async (url, init = {}) => {
      const out = await server.fetchImpl(url, init)
      if ((init.method || 'GET') === 'GET') server.state.etag = `"drift${server.state.seq++}"`
      return out
    }
    await expect(syncNow({ ...opts(), fetchImpl: alwaysMoving, maxAttempts: 2 }))
      .rejects.toMatchObject({ code: 'conflict-retry' })
  })

  it('surfaces a bad token as unauthorized', async () => {
    const A = device(); await use(A)
    await expect(syncNow({ ...opts(), token: 'wrong' })).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('does not advance base when the push fails', async () => {
    const A = device(); await use(A); await addTask('t')
    const failing = async (url, init = {}) => {
      if ((init.method || 'GET') === 'PUT') return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }
      return server.fetchImpl(url, init)
    }
    await expect(syncNow({ ...opts(), fetchImpl: failing })).rejects.toThrow(SyncError)
    // base must still be absent — otherwise the next sync would read our own
    // un-pushed rows as remote deletions and wipe them.
    expect(await readVaultFile(BASE_FILE)).toBeNull()
  })

  it('refuses to run with no Bag open', async () => {
    await closeBagStore()
    await expect(syncNow(opts())).rejects.toMatchObject({ code: 'no-bag' })
  })

  it('refuses to run unconfigured', async () => {
    const A = device(); await use(A)
    await expect(syncNow({ fetchImpl: server.fetchImpl })).rejects.toMatchObject({ code: 'not-configured' })
  })
})

describe('syncNow — calendar collections', () => {
  it('converges events across devices', async () => {
    const A = device(), B = device()
    const mkEvent = (title) => localFetch('/events', { method: 'POST', body: JSON.stringify({ title, start_at: '2026-07-01T10:00:00Z' }) })

    await use(A); await mkEvent('A event'); await flushNow(); await syncNow(opts())
    await use(B); await mkEvent('B event'); await syncNow(opts())
    const evs = (await (await localFetch('/events')).json()).events
    expect(evs.map((e) => e.title).sort()).toEqual(['A event', 'B event'])
  })
})
