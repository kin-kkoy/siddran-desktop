import { describe, it, expect, beforeEach } from 'vitest'
import {
  sectionOf, detailOf, idOf, hubFor, sectionTarget,
  readSession, writeSession, emptySession, sessionKeyFor,
  armRestore, clearRestore, takeRestoreTarget, peekRestore,
  paneFor, setPaneFor, MAX_REMEMBERED_PANES,
} from './sessionRouteCache.js'

// Node env — no localStorage. A Map-backed stub is enough for these.
beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  clearRestore()
})

describe('sectionOf', () => {
  it('maps hubs and detail routes to their section', () => {
    expect(sectionOf('/')).toBe('notes')
    expect(sectionOf('/notes')).toBe('notes')
    expect(sectionOf('/notes/abc')).toBe('notes')
    expect(sectionOf('/tasks')).toBe('tasks')
    expect(sectionOf('/sandboxes')).toBe('sandboxes')
    expect(sectionOf('/sandboxes/3')).toBe('sandboxes')
    expect(sectionOf('/calendar')).toBe('calendar')
  })

  it('refuses routes that must never be restored into', () => {
    expect(sectionOf('/dev/paged-editor')).toBeNull()
    expect(sectionOf('/nonsense')).toBeNull()
    expect(sectionOf('')).toBeNull()
    expect(sectionOf(undefined)).toBeNull()
  })
})

describe('detailOf', () => {
  it('recognises only real detail routes', () => {
    expect(detailOf('/notes/abc')).toBe('/notes/abc')
    expect(detailOf('/sandboxes/3')).toBe('/sandboxes/3')
    expect(detailOf('/notes')).toBeNull()
    expect(detailOf('/sandboxes')).toBeNull()
    expect(detailOf('/tasks')).toBeNull()
    expect(detailOf('/calendar')).toBeNull()
  })

  it('strips anything past the id so nested routes still resolve', () => {
    expect(detailOf('/notes/abc/extra')).toBe('/notes/abc')
  })

  it('extracts the id for existence checks', () => {
    expect(idOf('/notes/abc')).toBe('abc')
    expect(idOf('/sandboxes/3')).toBe('3')
    expect(idOf('/notes')).toBeNull()
  })
})

describe('sectionTarget', () => {
  const session = {
    ...emptySession(),
    sections: {
      notes: { detail: '/notes/abc' },
      sandboxes: { detail: '/sandboxes/3' },
      tasks: { detail: null },
      calendar: { detail: null },
    },
  }

  it('returns you to the remembered note when coming from elsewhere', () => {
    expect(sectionTarget(session, 'notes', '/calendar')).toBe('/notes/abc')
    expect(sectionTarget(session, 'sandboxes', '/tasks')).toBe('/sandboxes/3')
  })

  it('goes to the hub when you are already inside that section', () => {
    expect(sectionTarget(session, 'notes', '/notes/abc')).toBe('/notes')
    expect(sectionTarget(session, 'notes', '/notes')).toBe('/notes')
    expect(sectionTarget(session, 'sandboxes', '/sandboxes/3')).toBe('/sandboxes')
  })

  it('falls back to the hub when nothing is remembered', () => {
    expect(sectionTarget(emptySession(), 'notes', '/calendar')).toBe('/notes')
    expect(sectionTarget(null, 'tasks', '/calendar')).toBe('/tasks')
  })

  it('hubFor never invents a /notes/ prefix', () => {
    expect(hubFor('notes')).toBe('/notes')
    expect(hubFor('calendar')).toBe('/calendar')
  })
})

describe('readSession / writeSession', () => {
  it('round-trips and is scoped per Bag', () => {
    const s = emptySession()
    s.lastSection = 'notes'
    s.sections.notes.detail = '/notes/abc'
    writeSession('/bags/A', s)

    expect(readSession('/bags/A').sections.notes.detail).toBe('/notes/abc')
    // A different Bag must not see Bag A's note ids.
    expect(readSession('/bags/B').sections.notes.detail).toBeNull()
    expect(sessionKeyFor('/bags/A')).not.toBe(sessionKeyFor('/bags/B'))
  })

  it('returns the empty shape on missing or corrupt data', () => {
    expect(readSession('/bags/missing')).toEqual(emptySession())
    localStorage.setItem(sessionKeyFor('/bags/bad'), '{not json')
    expect(readSession('/bags/bad')).toEqual(emptySession())
  })

  it('rejects a stored hub masquerading as a detail route', () => {
    localStorage.setItem(sessionKeyFor('/bags/A'), JSON.stringify({
      v: 1, lastSection: 'notes',
      sections: { notes: { detail: '/notes' } },
    }))
    // '/notes' is a hub — restoring it as a "detail" would defeat the fallback.
    expect(readSession('/bags/A').sections.notes.detail).toBeNull()
  })

  it('drops a pane recorded as explicitly empty', () => {
    localStorage.setItem(sessionKeyFor('/bags/A'), JSON.stringify({
      v: 1, lastSection: 'notes', sections: {}, panes: { '7': { kind: 'none' } },
    }))
    expect(paneFor(readSession('/bags/A'), '7')).toBeNull()
  })
})

describe('launch restore', () => {
  it('arms the remembered detail route and hands it over once', () => {
    const s = emptySession()
    s.lastSection = 'notes'
    s.sections.notes.detail = '/notes/abc'
    writeSession('/bags/A', s)

    armRestore('/bags/A')
    expect(takeRestoreTarget('/bags/A')).toBe('/notes/abc')
    expect(takeRestoreTarget('/bags/A')).toBeNull()   // consumed
  })

  it('falls back to the section hub when only a section is remembered', () => {
    const s = emptySession()
    s.lastSection = 'calendar'
    writeSession('/bags/A', s)
    armRestore('/bags/A')
    expect(takeRestoreTarget('/bags/A')).toBe('/calendar')
  })

  // The bug this guards: the last Bag is missing, the user picks a DIFFERENT Bag
  // from the picker, and openBag (unlike switchBag) never resets the URL.
  it('refuses to apply a restore armed for another Bag', () => {
    const s = emptySession()
    s.lastSection = 'notes'
    s.sections.notes.detail = '/notes/abc'
    writeSession('/bags/A', s)

    armRestore('/bags/A')
    expect(peekRestore('/bags/B')).toBeNull()
    expect(takeRestoreTarget('/bags/B')).toBeNull()
    // Still intact for the Bag it was actually armed for.
    expect(takeRestoreTarget('/bags/A')).toBe('/notes/abc')
  })

  it('arms nothing when the Bag has no history', () => {
    armRestore('/bags/fresh')
    expect(takeRestoreTarget('/bags/fresh')).toBeNull()
  })
})


describe('per-note pane memory', () => {
  const pdf = (n) => ({ kind: 'pdf', pdf: { path: `a${n}.pdf`, name: `a${n}.pdf` } })

  it('remembers a pane per note and round-trips through storage', () => {
    const s = emptySession()
    setPaneFor(s, '1001', pdf(1))
    writeSession('/bags/A', s)
    expect(paneFor(readSession('/bags/A'), '1001').pdf.name).toBe('a1.pdf')
    expect(paneFor(readSession('/bags/A'), '1002')).toBeNull()
  })

  // The whole reason it's a map: opening note B used to wipe what note A had open.
  it('keeps one note\'s pane when another note records nothing', () => {
    const s = emptySession()
    setPaneFor(s, '1001', pdf(1))
    setPaneFor(s, '1002', null)          // arrived at 1002 with nothing open
    expect(paneFor(s, '1001').pdf.name).toBe('a1.pdf')
    expect(paneFor(s, '1002')).toBeNull()
  })

  it('clears a note\'s pane when it is closed', () => {
    const s = emptySession()
    setPaneFor(s, '1001', pdf(1))
    setPaneFor(s, '1001', null)
    expect(paneFor(s, '1001')).toBeNull()
  })

  it('treats numeric and string ids the same', () => {
    const s = emptySession()
    setPaneFor(s, 1001, pdf(1))
    expect(paneFor(s, '1001')).not.toBeNull()
  })

  it('evicts the oldest past the cap', () => {
    const s = emptySession()
    for (let i = 0; i < MAX_REMEMBERED_PANES + 5; i++) setPaneFor(s, String(i), pdf(i))
    expect(Object.keys(s.panes)).toHaveLength(MAX_REMEMBERED_PANES)
    expect(paneFor(s, '0')).toBeNull()                            // oldest gone
    expect(paneFor(s, String(MAX_REMEMBERED_PANES + 4))).not.toBeNull()  // newest kept
  })

  it('re-recording a note refreshes its recency', () => {
    const s = emptySession()
    setPaneFor(s, 'keepme', pdf(0))
    for (let i = 0; i < MAX_REMEMBERED_PANES - 1; i++) setPaneFor(s, String(i), pdf(i))
    setPaneFor(s, 'keepme', pdf(99))     // touched again — should now be newest
    setPaneFor(s, 'extra', pdf(1))
    expect(paneFor(s, 'keepme')).not.toBeNull()
  })

  it('ignores a null noteId rather than creating a junk entry', () => {
    const s = emptySession()
    setPaneFor(s, null, pdf(1))
    expect(Object.keys(s.panes)).toHaveLength(0)
    expect(paneFor(s, null)).toBeNull()
  })

  // The lock rides along on the existing snapshot rather than in a key of its
  // own, so it has to survive normalize() on the way back out.
  it('round-trips the locked flag through storage', () => {
    const s = emptySession()
    setPaneFor(s, '1001', { ...pdf(1), locked: true })
    writeSession('/bags/A', s)
    expect(paneFor(readSession('/bags/A'), '1001').locked).toBe(true)
  })

  it('leaves an unlocked pane unlocked', () => {
    const s = emptySession()
    setPaneFor(s, '1001', pdf(1))
    writeSession('/bags/A', s)
    expect(paneFor(readSession('/bags/A'), '1001').locked).toBeFalsy()
  })

  // A lock was set deliberately; an unlocked pane is passive memory. Visiting
  // twenty other notes must not quietly undo the lock.
  it('evicts unlocked panes before locked ones', () => {
    const s = emptySession()
    setPaneFor(s, 'pinned', { ...pdf(0), locked: true })
    for (let i = 0; i < MAX_REMEMBERED_PANES + 5; i++) setPaneFor(s, String(i), pdf(i))
    expect(Object.keys(s.panes)).toHaveLength(MAX_REMEMBERED_PANES)
    expect(paneFor(s, 'pinned')).not.toBeNull()
    expect(paneFor(s, 'pinned').locked).toBe(true)
  })

  it('evicts locked panes only once nothing else is left to drop', () => {
    const s = emptySession()
    for (let i = 0; i < MAX_REMEMBERED_PANES + 3; i++) {
      setPaneFor(s, String(i), { ...pdf(i), locked: true })
    }
    expect(Object.keys(s.panes)).toHaveLength(MAX_REMEMBERED_PANES)
    expect(paneFor(s, '0')).toBeNull()                                   // oldest lock went
    expect(paneFor(s, String(MAX_REMEMBERED_PANES + 2))).not.toBeNull()  // newest kept
  })
})
