import { describe, it, expect } from 'vitest'
import { fromPickerValue, toPickerValue } from './deadline'

const localISO = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()

describe('fromPickerValue', () => {
  it('reads a date-only value as local midnight on that day', () => {
    const out = fromPickerValue('2026-08-31')
    expect(out.due_all_day).toBe(true)
    expect(out.due_date).toBe(localISO(2026, 8, 31, 0, 0))
  })

  it('keeps a chosen time exactly, and does not claim all-day', () => {
    const out = fromPickerValue('2026-08-31T14:30')
    expect(out.due_all_day).toBe(false)
    expect(out.due_date).toBe(localISO(2026, 8, 31, 14, 30))
  })

  it('does not mistake a deliberate midnight for a date-only deadline', () => {
    const out = fromPickerValue('2026-08-31T00:00')
    expect(out.due_all_day).toBe(false)
    expect(toPickerValue(out.due_date, out.due_all_day)).toBe('2026-08-31T00:00')
  })

  it('treats empty or malformed input as no deadline', () => {
    for (const v of ['', null, undefined, 'tomorrow', '2026-13']) {
      expect(fromPickerValue(v)).toEqual({ due_date: null, due_all_day: false })
    }
  })

  it('never shifts the day, whatever the local offset', () => {
    // A bare 'YYYY-MM-DD' parsed by Date() would be UTC midnight and land on the
    // 30th for anyone west of Greenwich. Built from parts, it cannot.
    const d = new Date(fromPickerValue('2026-08-31').due_date)
    expect(d.getDate()).toBe(31)
    expect(d.getMonth()).toBe(7)
  })
})

describe('toPickerValue', () => {
  it('round-trips a date-only deadline', () => {
    const stored = fromPickerValue('2026-08-31')
    expect(toPickerValue(stored.due_date, stored.due_all_day)).toBe('2026-08-31')
  })

  it('round-trips a timed deadline', () => {
    const stored = fromPickerValue('2026-08-31T14:30')
    expect(toPickerValue(stored.due_date, stored.due_all_day)).toBe('2026-08-31T14:30')
  })

  it('reads a pre-flag midnight row as date-only', () => {
    expect(toPickerValue(localISO(2026, 8, 31, 0, 0), undefined)).toBe('2026-08-31')
    expect(toPickerValue(localISO(2026, 8, 31, 9, 0), undefined)).toBe('2026-08-31T09:00')
  })

  it('lets an explicit flag override the midnight guess', () => {
    expect(toPickerValue(localISO(2026, 8, 31, 0, 0), false)).toBe('2026-08-31T00:00')
  })

  it('is empty for a missing or unparseable timestamp', () => {
    expect(toPickerValue(null, false)).toBe('')
    expect(toPickerValue('nonsense', false)).toBe('')
  })
})
