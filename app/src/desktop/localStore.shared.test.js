// The Bag is shared: Siddran-CLI, an AI through `siddran mcp`, a text editor can
// write it while the app is open. Each test here is a way the app used to lose
// someone's change — its own or the other writer's.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemFs } from './fs/memFs.js'
import { openBagStore, closeBagStore, localFetch, flushNow, ingestExternal, onExternalChange } from './localStore.js'

const BAG = '/bag'
const j = (r) => r.json()
const put = (u, b) => localFetch(u, { method: 'PUT', body: JSON.stringify(b) })
const post = (u, b) => localFetch(u, { method: 'POST', body: JSON.stringify(b) })

const md = (id, title, body) => `---\nid: ${id}\ntitle: ${title}\ntags: \nfavorite: false\ncolor: \ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n${body}`
const task = (id, title, extra = {}) => ({ id, title, description: '', priority: 'normal', due_date: null, due_all_day: false, remind_at: null, is_completed: false, order: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...extra })
const tasksFile = (tasks) => JSON.stringify({ tasks, dailies: [], completions: [], projects: [] }, null, 2)

const seed = () => ({
  [`${BAG}/notes/Alpha.md`]: md(1001, 'Alpha', 'line one\nline two\nline three'),
  [`${BAG}/tasks.siddran`]: tasksFile([task('t1', 'Write report'), task('t2', 'Call bank')]),
})

let fs
beforeEach(async () => {
  await closeBagStore()
  fs = createMemFs(seed())
  await openBagStore(fs, BAG)
})

const notes = async () => (await j(await localFetch('/notes'))).notes
const tasks = async () => (await j(await localFetch('/tasks'))).tasks

describe('a note created elsewhere', () => {
  it('survives the app saving its own edit (it used to be pruned as an orphan)', async () => {
    await fs.writeText(`${BAG}/notes/From CLI.md`, md(1500, 'From CLI', 'hello'))
    await put('/notes/1001', { body: 'edited in the app' })
    await flushNow()
    expect(await fs.exists(`${BAG}/notes/From CLI.md`)).toBe(true)
  })

  it('appears once the watcher reports it', async () => {
    await fs.writeText(`${BAG}/notes/From CLI.md`, md(1500, 'From CLI', 'hello'))
    const change = await ingestExternal([`${BAG}/notes/From CLI.md`])
    expect(change.notes).toBe(true)
    expect((await notes()).map((n) => n.title).sort()).toEqual(['Alpha', 'From CLI'])
  })

  it('gets an id written into it if it arrived without one', async () => {
    await fs.writeText(`${BAG}/notes/Plain.md`, 'just text, no frontmatter')
    await ingestExternal([`${BAG}/notes/Plain.md`])
    await flushNow()
    const text = await fs.readText(`${BAG}/notes/Plain.md`)
    expect(text).toMatch(/^---\nid: \d+\ntitle: Plain\n/)
    expect(text.endsWith('just text, no frontmatter')).toBe(true)
  })

  it('a copied file with a duplicate id becomes a second note, not a move', async () => {
    await fs.writeText(`${BAG}/notes/Alpha copy.md`, md(1001, 'Alpha copy', 'copied'))
    await ingestExternal([`${BAG}/notes/Alpha copy.md`])
    const ns = await notes()
    expect(ns).toHaveLength(2)
    expect(new Set(ns.map((n) => n.id)).size).toBe(2)
  })
})

describe('a note edited in two places at once', () => {
  it('keeps both edits when they touch different lines', async () => {
    await put('/notes/1001', { body: 'LINE ONE\nline two\nline three' })                                   // the app
    await fs.writeText(`${BAG}/notes/Alpha.md`, md(1001, 'Alpha', 'line one\nline two\nline three\nadded by AI'))  // the AI
    await flushNow()
    expect(await fs.readText(`${BAG}/notes/Alpha.md`)).toContain('LINE ONE\nline two\nline three\nadded by AI')
  })

  it('merges at ingest too, when the app has an unflushed edit', async () => {
    await put('/notes/1001', { body: 'LINE ONE\nline two\nline three' })
    await fs.writeText(`${BAG}/notes/Alpha.md`, md(1001, 'Alpha', 'line one\nline two\nline three\nadded by AI'))
    await ingestExternal([`${BAG}/notes/Alpha.md`])
    expect((await notes())[0].body).toBe('LINE ONE\nline two\nline three\nadded by AI')
  })

  it('takes the outside edit wholesale when the app had none', async () => {
    await fs.writeText(`${BAG}/notes/Alpha.md`, md(1001, 'Alpha', 'rewritten'))
    await ingestExternal([`${BAG}/notes/Alpha.md`])
    expect((await notes())[0].body).toBe('rewritten')
  })

  it('reports a same-line conflict instead of dropping it silently', async () => {
    const seen = []
    const off = onExternalChange((c) => seen.push(c))
    await put('/notes/1001', { body: 'mine\nline two\nline three' })
    await fs.writeText(`${BAG}/notes/Alpha.md`, md(1001, 'Alpha', 'theirs\nline two\nline three'))
    await ingestExternal([`${BAG}/notes/Alpha.md`])
    off()
    expect((await notes())[0].body).toBe('mine\nline two\nline three')
    expect(seen[0].conflicts).toHaveLength(1)
  })
})

describe('notes deleted, renamed and filed elsewhere', () => {
  it('drops a note deleted on disk', async () => {
    await fs.remove(`${BAG}/notes/Alpha.md`)
    await ingestExternal([`${BAG}/notes/Alpha.md`])
    expect(await notes()).toHaveLength(0)
  })

  it('keeps a note deleted on disk that has an unflushed edit here — the edit wins', async () => {
    await put('/notes/1001', { body: 'still typing' })
    await fs.remove(`${BAG}/notes/Alpha.md`)
    await ingestExternal([`${BAG}/notes/Alpha.md`])
    await flushNow()
    expect(await fs.readText(`${BAG}/notes/Alpha.md`)).toContain('still typing')
  })

  it('a rename in a file manager sticks, instead of being "corrected" back', async () => {
    const text = await fs.readText(`${BAG}/notes/Alpha.md`)
    await fs.remove(`${BAG}/notes/Alpha.md`)
    await fs.writeText(`${BAG}/notes/Beta.md`, text)                   // frontmatter still says Alpha
    await ingestExternal([`${BAG}/notes/Alpha.md`, `${BAG}/notes/Beta.md`])
    await flushNow()
    expect((await notes()).map((n) => n.title)).toEqual(['Beta'])
    expect(await fs.exists(`${BAG}/notes/Beta.md`)).toBe(true)
    expect(await fs.exists(`${BAG}/notes/Alpha.md`)).toBe(false)
  })

  it('adopts a notebook folder made elsewhere, with the note inside it', async () => {
    await fs.writeText(`${BAG}/notes/Work/Plan.md`, md(1600, 'Plan', 'x'))
    await ingestExternal([`${BAG}/notes/Work`, `${BAG}/notes/Work/Plan.md`])
    const nbs = (await j(await localFetch('/notebooks'))).notebooks
    expect(nbs.map((n) => n.name)).toEqual(['Work'])
    expect((await notes()).find((n) => n.title === 'Plan').notebook_id).toBe(nbs[0].id)
  })
})

describe('tasks changed in two places at once', () => {
  it('keeps both sides when they edit different tasks', async () => {
    await put('/tasks/t1', { is_completed: true })                                            // the app
    await fs.writeText(`${BAG}/tasks.siddran`, tasksFile([task('t1', 'Write report'), task('t2', 'Call bank', { priority: 'high', updated_at: '2026-02-01T00:00:00.000Z' })]))  // the CLI
    await flushNow()
    const disk = JSON.parse(await fs.readText(`${BAG}/tasks.siddran`)).tasks
    expect(disk.find((t) => t.id === 't1').is_completed).toBe(true)
    expect(disk.find((t) => t.id === 't2').priority).toBe('high')
  })

  it('keeps a task the CLI added while the app added its own', async () => {
    await post('/tasks', { title: 'From app' })
    await fs.writeText(`${BAG}/tasks.siddran`, tasksFile([task('t1', 'Write report'), task('t2', 'Call bank'), task('t3', 'From CLI')]))
    await flushNow()
    const titles = JSON.parse(await fs.readText(`${BAG}/tasks.siddran`)).tasks.map((t) => t.title).sort()
    expect(titles).toEqual(['Call bank', 'From CLI', 'From app', 'Write report'])
  })

  it('honours a delete made elsewhere', async () => {
    await fs.writeText(`${BAG}/tasks.siddran`, tasksFile([task('t1', 'Write report')]))
    const change = await ingestExternal([`${BAG}/tasks.siddran`])
    expect(change.tasks).toBe(true)
    expect((await tasks()).map((t) => t.id)).toEqual(['t1'])
  })
})

describe('own writes and timing', () => {
  it('recognises its own writes when the watcher echoes them back', async () => {
    await put('/tasks/t1', { title: 'Renamed' })
    await put('/notes/1001', { body: 'new' })
    await flushNow()
    const change = await ingestExternal([`${BAG}/tasks.siddran`, `${BAG}/notes/Alpha.md`])
    expect(change).toEqual({ notes: false, tasks: false, calendar: false, settings: false, sandboxes: [] })
  })

  it('an edit made while a flush waits on the lock is not lost', async () => {
    let release
    fs.lock = () => new Promise((r) => { release = () => r(true) })
    fs.unlock = async () => {}
    await put('/tasks/t1', { title: 'first' })
    const flushing = flushNow()
    await new Promise((r) => setTimeout(r, 0))
    await put('/tasks/t2', { title: 'during the flush' })     // lands while flush is parked
    release()
    await flushing
    fs.lock = async () => true
    await flushNow()
    const disk = JSON.parse(await fs.readText(`${BAG}/tasks.siddran`)).tasks
    expect(disk.find((t) => t.id === 't2').title).toBe('during the flush')
  })

  it('takes and releases the lock around a flush', async () => {
    const calls = []
    fs.lock = async (root) => { calls.push(['lock', root]); return true }
    fs.unlock = async (root) => { calls.push(['unlock', root]) }
    await put('/tasks/t1', { title: 'x' })
    await flushNow()
    expect(calls).toEqual([['lock', BAG], ['unlock', BAG]])
  })

  it('still writes (merging) when the lock cannot be had', async () => {
    fs.lock = async () => false
    await put('/tasks/t1', { title: 'written anyway' })
    await flushNow()
    expect(await fs.readText(`${BAG}/tasks.siddran`)).toContain('written anyway')
  })
})
