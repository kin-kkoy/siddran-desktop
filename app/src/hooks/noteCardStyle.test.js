import { describe, it, expect } from 'vitest'
import {
  resolveCardStyle, cardClassNames, tiltFor, newLaunchSeed,
  EXPOSURES, ANCHORS, TILTS, TURNS, CARD_DEFAULTS,
} from './noteCardStyle'

const styles = {
  xMin: 'xMin', xSm: 'xSm', xWide: 'xWide', xTab: 'xTab',
  atTl: 'atTl', atTr: 'atTr', atBl: 'atBl', atBr: 'atBr',
  leanNone: 'leanNone', leanLeft: 'leanLeft', leanRight: 'leanRight',
  turnsTop: 'turnsTop', turnsUnder: 'turnsUnder',
}

describe('resolveCardStyle', () => {
  it('falls back to the shipped default on empty settings', () => {
    const s = resolveCardStyle({}, 1)
    expect(s.exposure).toBe(CARD_DEFAULTS.exposure)
    expect(s.anchor).toBe(CARD_DEFAULTS.anchor)
    expect(s.tilt).toBe(CARD_DEFAULTS.tilt)
    expect(s.turns).toBe(CARD_DEFAULTS.turns)
    expect(s.vary).toBe(false)
    expect(s.salt).toBe(0)
  })

  it('rejects a junk value rather than passing it through to a class lookup', () => {
    const s = resolveCardStyle({ noteCardAnchor: 'sideways', noteCardTilt: 42 }, 1)
    expect(s.anchor).toBe(CARD_DEFAULTS.anchor)
    expect(s.tilt).toBe(CARD_DEFAULTS.tilt)
  })

  it('honours every axis when set', () => {
    const s = resolveCardStyle({
      noteCardExposure: 'wide', noteCardAnchor: 'top-right',
      noteCardTilt: 'right', noteCardTurns: 'top',
    }, 1)
    expect(s).toMatchObject({ exposure: 'wide', anchor: 'top-right', tilt: 'right', turns: 'top' })
  })

  it('surprise "tilt" re-rolls the lean but never the geometry', () => {
    const base = { noteCardExposure: 'wide', noteCardAnchor: 'top-right', noteCardSurprise: 'tilt' }
    for (const seed of [1, 2, 3, 99, 12345]) {
      const s = resolveCardStyle(base, seed)
      expect(s.exposure).toBe('wide')
      expect(s.anchor).toBe('top-right')
      expect(TILTS).toContain(s.tilt)
      expect(TURNS).toContain(s.turns)
    }
  })

  it('surprise "all" re-rolls the geometry too, and only ever to real values', () => {
    for (const seed of [1, 2, 3, 99, 12345, 777777]) {
      const s = resolveCardStyle({ noteCardSurprise: 'all' }, seed)
      expect(EXPOSURES).toContain(s.exposure)
      expect(ANCHORS).toContain(s.anchor)
      expect(TILTS).toContain(s.tilt)
      expect(TURNS).toContain(s.turns)
    }
  })

  it('is stable for one seed and does move between seeds', () => {
    const a = resolveCardStyle({ noteCardSurprise: 'all' }, 4242)
    expect(resolveCardStyle({ noteCardSurprise: 'all' }, 4242)).toEqual(a)
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(
      s => JSON.stringify(resolveCardStyle({ noteCardSurprise: 'all' }, s))))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('either vary toggle turns variation on; only the launch one salts it', () => {
    expect(resolveCardStyle({ noteCardVary: true }, 7)).toMatchObject({ vary: true, salt: 0 })
    expect(resolveCardStyle({ noteCardVaryEachLaunch: true }, 7)).toMatchObject({ vary: true, salt: 7 })
  })
})

describe('cardClassNames', () => {
  it('emits one class per axis', () => {
    const out = cardClassNames(resolveCardStyle({}, 1), styles)
    expect(out.split(' ')).toEqual(['xMin', 'atBl', 'leanLeft', 'turnsUnder'])
  })
})

describe('tiltFor', () => {
  it('is stable for the same note and salt', () => {
    expect(tiltFor('note-1', 0, 'left')).toBe(tiltFor('note-1', 0, 'left'))
  })

  it('follows the chosen direction — never leans the other way', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      expect(tiltFor(id, 0, 'left')).toBeLessThan(0)
      expect(tiltFor(id, 0, 'right')).toBeGreaterThan(0)
    }
  })

  it('stays inside 0.5°–1.9°', () => {
    for (let i = 0; i < 200; i++) {
      const deg = Math.abs(tiltFor('note-' + i, 0, 'left'))
      expect(deg).toBeGreaterThanOrEqual(0.5)
      expect(deg).toBeLessThanOrEqual(1.9)
    }
  })

  it('gives different notes different angles', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => tiltFor('n' + i, 0, 'left')))
    expect(seen.size).toBeGreaterThan(3)
  })

  it('a new salt re-angles the whole stack', () => {
    const before = Array.from({ length: 20 }, (_, i) => tiltFor('n' + i, 0, 'left'))
    const after = Array.from({ length: 20 }, (_, i) => tiltFor('n' + i, 991, 'left'))
    expect(after).not.toEqual(before)
  })

  it('is flat when there is no direction to follow', () => {
    expect(tiltFor('note-1', 0, 'none')).toBe(0)
  })
})

describe('newLaunchSeed', () => {
  it('is a usable unsigned 32-bit integer', () => {
    for (let i = 0; i < 50; i++) {
      const s = newLaunchSeed()
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(0xffffffff)
    }
  })
})
