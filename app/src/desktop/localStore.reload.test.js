// Reloading a Bag re-reads the folder the app is already holding in memory.
//
// The point is the case the app cannot otherwise see: something changed the files
// from outside — a note renamed in a file manager, a .md edited by hand, a sync
// tool — while the app went on believing its own picture of the folder.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemFs } from './fs/memFs.js'
import { openBagStore, closeBagStore, reloadBagStore, localFetch, flushNow } from './localStore.js'

const BAG = '/bag'
const j = (r) => r.json()
const put = (u, b) => localFetch(u, { method: 'PUT', body: JSON.stringify(b) })

const note = (title, body) => `---\nid: ${title.length}00\ntitle: ${title}\ntags: \nfavorite: false\ncolor: \ncreated: x\nupdated: x\n---\n${body}`

const seed = () => ({
  [`${BAG}/notes/Alpha.md`]: note('Alpha', 'first'),
})

let fs
beforeEach(async () => {
  await closeBagStore()
  fs = createMemFs(seed())
  await openBagStore(fs, BAG)
})

const titles = async () => (await j(await localFetch('/notes'))).notes.map((n) => n.title).sort()

describe('reloadBagStore', () => {
  it('picks up a note added on disk after the Bag was opened', async () => {
    expect(await titles()).toEqual(['Alpha'])
    await fs.writeText(`${BAG}/notes/Beta.md`, note('Beta', 'second'))
    // Still invisible: the app owns its picture of the folder until told otherwise.
    expect(await titles()).toEqual(['Alpha'])
    expect(await reloadBagStore()).toBe(true)
    expect(await titles()).toEqual(['Alpha', 'Beta'])
  })

  it('picks up an edit made to a note file by hand', async () => {
    await fs.writeText(`${BAG}/notes/Alpha.md`, note('Alpha', 'edited outside'))
    await reloadBagStore()
    const notes = (await j(await localFetch('/notes'))).notes
    expect(notes[0].body.trim()).toBe('edited outside')
  })

  it('sees a note renamed outside the app under its new name', async () => {
    const body = await fs.readText(`${BAG}/notes/Alpha.md`)
    await fs.remove(`${BAG}/notes/Alpha.md`)
    await fs.writeText(`${BAG}/notes/Renamed.md`, body.replace('title: Alpha', 'title: Renamed'))
    await reloadBagStore()
    expect(await titles()).toEqual(['Renamed'])
  })

  // The edit you just made is yours and newer, so it reaches disk before disk is
  // read back. Losing it to a reload would be far worse than a stale read.
  it('does not discard a pending in-memory edit', async () => {
    const id = (await j(await localFetch('/notes'))).notes[0].id
    await put(`/notes/${id}`, { body: 'typed but not yet flushed' })
    await reloadBagStore()
    const notes = (await j(await localFetch('/notes'))).notes
    expect(notes[0].body.trim()).toBe('typed but not yet flushed')
    expect(await fs.readText(`${BAG}/notes/Alpha.md`)).toContain('typed but not yet flushed')
  })

  it('is a no-op with no Bag open', async () => {
    await closeBagStore()
    expect(await reloadBagStore()).toBe(false)
  })

  // A reload must leave nothing pending — a stale dirty flag would write the
  // picture we just threw away back over the files we just read.
  it('leaves nothing dirty behind', async () => {
    await fs.writeText(`${BAG}/notes/Beta.md`, note('Beta', 'second'))
    await reloadBagStore()
    await fs.remove(`${BAG}/notes/Beta.md`)
    await flushNow()   // nothing is dirty, so this must not rewrite Beta
    expect(await fs.exists(`${BAG}/notes/Beta.md`)).toBe(false)
  })
})
