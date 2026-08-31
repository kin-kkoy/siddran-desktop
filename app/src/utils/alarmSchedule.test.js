import { describe, it, expect } from 'vitest'
import { dueTriggers, partitionDue, dailyFireTime } from './alarmSchedule'
import { isoDate } from '../components/Calendar/calendarDates'

// A local timestamp, built from parts so the tests mean the same thing in every
// time zone — the whole point of the module under test.
const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)
const iso = (...a) => local(...a).toISOString()

describe('dailyFireTime', () => {
  it('resolves HH:MM against the given local day', () => {
    expect(dailyFireTime({ time: '07:30' }, local(2026, 3, 14))).toBe(local(2026, 3, 14, 7, 30).getTime())
  })

  it('is null without a time', () => {
    expect(dailyFireTime({ time: null }, local(2026, 3, 14))).toBeNull()
    expect(dailyFireTime({}, local(2026, 3, 14))).toBeNull()
  })

  it('handles local midnight without slipping a day', () => {
    const at = dailyFireTime({ time: '00:00' }, local(2026, 3, 14))
    expect(isoDate(new Date(at))).toBe('2026-03-14')
  })
})

describe('dueTriggers — tasks', () => {
  const now = local(2026, 3, 14, 12, 0).getTime()

  it('makes a deadline an alarm and a remind_at a reminder', () => {
    const out = dueTriggers({
      tasks: [{ id: 'a', title: 'Essay', due_date: iso(2026, 3, 14, 17, 0), remind_at: iso(2026, 3, 14, 9, 0) }],
      now,
    })
    expect(out.map(t => t.tier).sort()).toEqual(['alarm', 'reminder'])
    expect(out.find(t => t.tier === 'alarm').key).toContain(':due:')
    expect(out.find(t => t.tier === 'reminder').key).toContain(':rem:')
  })

  it('fires a remind_at with no deadline at all', () => {
    const out = dueTriggers({ tasks: [{ id: 'a', title: 'Call', due_date: null, remind_at: iso(2026, 3, 14, 9, 0) }], now })
    expect(out).toHaveLength(1)
    expect(out[0].tier).toBe('reminder')
  })

  it('ignores completed tasks and unparseable dates', () => {
    expect(dueTriggers({ tasks: [{ id: 'a', due_date: iso(2026, 3, 14), is_completed: true }], now })).toEqual([])
    expect(dueTriggers({ tasks: [{ id: 'a', due_date: 'not a date' }], now })).toEqual([])
  })

  it('re-arms when the deadline moves, because the time is in the key', () => {
    const one = dueTriggers({ tasks: [{ id: 'a', due_date: iso(2026, 3, 14, 17, 0) }], now })[0].key
    const two = dueTriggers({ tasks: [{ id: 'a', due_date: iso(2026, 3, 15, 17, 0) }], now })[0].key
    expect(one).not.toBe(two)
  })
})

describe('dueTriggers — dailies', () => {
  const saturday = local(2026, 3, 14, 12, 0)   // 2026-03-14 is a Saturday
  const monday = local(2026, 3, 16, 12, 0)
  const now = saturday.getTime()

  const daily = (over) => ({ id: 'd1', title: 'Stretch', time: '08:00', recurrence: 'every-day', ...over })

  it('fires every-day', () => {
    expect(dueTriggers({ dailies: [daily()], now })).toHaveLength(1)
  })

  it('honours weekdays and weekends', () => {
    expect(dueTriggers({ dailies: [daily({ recurrence: 'weekdays' })], now })).toHaveLength(0)
    expect(dueTriggers({ dailies: [daily({ recurrence: 'weekends' })], now })).toHaveLength(1)
    expect(dueTriggers({ dailies: [daily({ recurrence: 'weekdays' })], now: monday.getTime() })).toHaveLength(1)
  })

  it('honours a JSON day mask', () => {
    const satOnly = JSON.stringify({ mask: [false, false, false, false, false, false, true] })
    expect(dueTriggers({ dailies: [daily({ recurrence: satOnly })], now })).toHaveLength(1)
    expect(dueTriggers({ dailies: [daily({ recurrence: satOnly })], now: monday.getTime() })).toHaveLength(0)
  })

  it('never fires without a time', () => {
    expect(dueTriggers({ dailies: [daily({ time: null })], now })).toEqual([])
  })

  it("is suppressed by today's completion, but not by yesterday's", () => {
    const done = [{ daily_task_id: 'd1', date: '2026-03-14' }]
    expect(dueTriggers({ dailies: [daily()], completions: done, now })).toHaveLength(0)
    const stale = [{ daily_task_id: 'd1', date: '2026-03-13' }]
    expect(dueTriggers({ dailies: [daily()], completions: stale, now })).toHaveLength(1)
  })

  it('treats a one-off daily by is_completed and expiry', () => {
    const one = daily({ recurrence: null, expires_at: iso(2026, 3, 14, 23, 59) })
    expect(dueTriggers({ dailies: [one], now })).toHaveLength(1)
    expect(dueTriggers({ dailies: [{ ...one, is_completed: true }], now })).toHaveLength(0)
    expect(dueTriggers({ dailies: [{ ...one, expires_at: iso(2026, 3, 13) }], now })).toHaveLength(0)
  })
})

describe('partitionDue', () => {
  const now = local(2026, 3, 14, 12, 0).getTime()
  const min = 60 * 1000
  const trig = (key, at) => ({ key, at, tier: 'alarm' })

  it('rings what just passed and silently marks what is long gone', () => {
    const { ring, stale } = partitionDue(
      [trig('fresh', now - 5 * min), trig('ancient', now - 40 * 60 * min), trig('future', now + min)],
      { now },
    )
    expect(ring.map(t => t.key)).toEqual(['fresh'])
    expect(stale.map(t => t.key)).toEqual(['ancient'])
  })

  it('skips anything already in the ledger', () => {
    const { ring, stale } = partitionDue([trig('a', now - min)], { now, fired: (k) => k === 'a' })
    expect(ring).toEqual([])
    expect(stale).toEqual([])
  })

  it('rings oldest first', () => {
    const { ring } = partitionDue([trig('b', now - min), trig('a', now - 5 * min)], { now })
    expect(ring.map(t => t.key)).toEqual(['a', 'b'])
  })
})

describe('all-day deadlines', () => {
  const now = local(2026, 3, 14, 12, 0).getTime()
  // Stored the way utils/deadline.js writes them: local midnight on the day.
  const allDay = { id: 'a', title: 'Essay', due_date: iso(2026, 3, 14, 0, 0), due_all_day: true }

  it('rings at the configured hour, not at 23:59', () => {
    const [t] = dueTriggers({ tasks: [allDay], now, allDayTime: '09:00' })
    expect(t.at).toBe(local(2026, 3, 14, 9, 0).getTime())
  })

  it('honours a different configured hour', () => {
    const [t] = dueTriggers({ tasks: [allDay], now, allDayTime: '18:30' })
    expect(t.at).toBe(local(2026, 3, 14, 18, 30).getTime())
  })

  it('leaves a timed deadline exactly where it was set', () => {
    const timed = { id: 'b', due_date: iso(2026, 3, 14, 23, 59), due_all_day: false }
    const [t] = dueTriggers({ tasks: [timed], now, allDayTime: '09:00' })
    expect(t.at).toBe(local(2026, 3, 14, 23, 59).getTime())
  })
})
