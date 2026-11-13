import { describe, it, expect } from 'vitest'
import {
    dayNum, dayStr, timelineSetup, spanOf, unitStart, nextUnit, axisRange, ticks, weekends, weekday,
    movePatch, resizePatch, schedulePatch, unschedulePatch, fitZoom, cleanLinks, routeLink, arrowHead, ZOOMS,
} from './timeline'
import { formatPayload, removeRecord } from './formats'

const title = { id: 'title', name: 'Title', type: 'text' }
const start = { id: 'start', name: 'Start', type: 'date' }
const end = { id: 'end', name: 'End', type: 'date' }
const due = { id: 'due', name: 'Due', type: 'date' }
const status = { id: 'status', name: 'Status', type: 'select', options: ['A', 'B'] }
const setup = { start, end }
const rec = (values) => ({ id: 'r', values })

describe('days', () => {
    it('round-trips and counts whole days across a DST change and a leap day', () => {
        expect(dayStr(dayNum('2026-03-29'))).toBe('2026-03-29')
        expect(dayNum('2026-03-30') - dayNum('2026-03-29')).toBe(1)
        expect(dayNum('2028-03-01') - dayNum('2028-02-28')).toBe(2)
        expect(dayNum('nope')).toBe(null)
        expect(weekday(dayNum('2026-11-13'))).toBe(5)   // a Friday
    })
})

describe('which fields', () => {
    it('Start / End by name, else the first date and none', () => {
        expect(timelineSetup([title, due, end, start])).toMatchObject({ start, end })
        expect(timelineSetup([title, due])).toMatchObject({ start: due, end: null })
        expect(timelineSetup([title, start, due])).toMatchObject({ start, end: due })
        expect(timelineSetup([title, start, end], { endBy: 'none' }).end).toBe(null)
        expect(timelineSetup([title, start, end], { startBy: 'end', endBy: 'start' })).toMatchObject({ start: end, end: start })
        expect(timelineSetup([title, status], { groupBy: 'status' })).toMatchObject({ start: null, group: status })
    })
    it('a new Timeline has Start and End', () => {
        const p = formatPayload('timeline')
        expect(timelineSetup(p.fields)).toMatchObject({ start: { id: 'start' }, end: { id: 'end' } })
    })
})

describe('spans', () => {
    it('a bar, a milestone, the right way round, or unscheduled', () => {
        expect(spanOf(rec({ start: '2026-01-01', end: '2026-01-03' }), setup)).toEqual({ s: dayNum('2026-01-01'), e: dayNum('2026-01-03'), milestone: false })
        expect(spanOf(rec({ start: '2026-01-01' }), setup).milestone).toBe(true)
        expect(spanOf(rec({ end: '2026-01-05' }), setup)).toEqual({ s: dayNum('2026-01-05'), e: dayNum('2026-01-05'), milestone: true })
        expect(spanOf(rec({ start: '2026-01-09', end: '2026-01-02' }), setup).s).toBe(dayNum('2026-01-02'))
        expect(spanOf(rec({}), setup)).toBe(null)
    })
})

describe('the axis', () => {
    const n = dayNum('2026-11-13')
    it('unit boundaries', () => {
        expect(dayStr(unitStart('week', n))).toBe('2026-11-09')
        expect(dayStr(unitStart('month', n))).toBe('2026-11-01')
        expect(dayStr(unitStart('quarter', n))).toBe('2026-10-01')
        expect(dayStr(unitStart('year', n))).toBe('2026-01-01')
        expect(dayStr(nextUnit('month', dayNum('2026-12-01')))).toBe('2027-01-01')
        expect(dayStr(nextUnit('quarter', dayNum('2026-10-01')))).toBe('2027-01-01')
    })
    it('covers every bar and today, padded, from an upper-tier boundary', () => {
        const r = axisRange([{ s: dayNum('2026-12-20'), e: dayNum('2027-02-10') }], 'week', n)
        expect(r.d0).toBeLessThanOrEqual(n - 14)
        expect(dayStr(r.d0).endsWith('-01')).toBe(true)
        expect(r.d1).toBeGreaterThanOrEqual(dayNum('2027-02-10') + 14)
        expect(axisRange([], 'day', n).days).toBeGreaterThanOrEqual(42)
    })
    it('ticks are clipped to the range and labelled', () => {
        const t = ticks('month', dayNum('2026-11-10'), dayNum('2027-01-05'))
        expect(t.map(x => x.len)).toEqual([21, 31, 5])
        expect(t[0].n).toBe(dayNum('2026-11-10'))
        expect(ticks('quarter', dayNum('2026-01-01'), dayNum('2026-12-31')).map(x => x.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
        expect(ticks(null, 0, 10)).toEqual([])
        expect(weekends(dayNum('2026-11-09'), dayNum('2026-11-22')).map(dayStr)).toEqual(['2026-11-14', '2026-11-21'])
    })
    it('fit picks the most detailed zoom that fits', () => {
        expect(fitZoom(0, 9, 40)).toBe('day')
        expect(fitZoom(0, 59, 70)).toBe('week')
        expect(fitZoom(0, 3650, 40)).toBe(ZOOMS.at(-1).id)
    })
})

describe('edits', () => {
    const r = rec({ start: '2026-01-10', end: '2026-01-12' })
    it('moves both dates; a milestone keeps no end', () => {
        expect(movePatch(r, setup, 3)).toEqual({ start: '2026-01-13', end: '2026-01-15' })
        expect(movePatch(rec({ start: '2026-01-10' }), setup, -1)).toEqual({ start: '2026-01-09' })
    })
    it('an edge never passes the other (R13.41)', () => {
        expect(resizePatch(r, setup, 'start', dayNum('2026-01-20'))).toEqual({ start: '2026-01-12' })
        expect(resizePatch(r, setup, 'end', dayNum('2026-01-01'))).toEqual({ end: '2026-01-10' })
        expect(resizePatch(r, setup, 'end', dayNum('2026-01-20'))).toEqual({ end: '2026-01-20' })
        expect(resizePatch(rec({ start: '2026-01-10' }), setup, 'end', 0)).toEqual({})
    })
    it('scheduling and unscheduling', () => {
        expect(schedulePatch(setup, dayNum('2026-05-04'), 'week')).toEqual({ start: '2026-05-04', end: '2026-05-10' })
        expect(schedulePatch({ start, end: null }, dayNum('2026-05-04'), 'week')).toEqual({ start: '2026-05-04' })
        expect(unschedulePatch(setup)).toEqual({ start: undefined, end: undefined })
    })
})

describe('dependencies', () => {
    it('drops self-links, repeats and links to records that are gone', () => {
        const ids = new Set(['a', 'b'])
        expect(cleanLinks([{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'a', to: 'a' }, { from: 'a', to: 'x' }], ids)).toEqual([{ from: 'a', to: 'b' }])
    })
    it('routes straight when there is room, around when there isn\'t', () => {
        expect(routeLink(10, 1, 20, 3)).toBe('M10 1H10.6V3H20')
        expect(routeLink(10, 1, 5, 3)).toBe('M10 1H10.6V2.2H4.4V3H5')
    })
    it('an arrowhead is a small triangle ending at the point', () => {
        expect(arrowHead(10, 2, 0)).toBe('M10 2L9.5 2.28L9.5 1.72Z')
        expect(arrowHead(0, 0, Math.PI / 2, 1, 0.5)).toBe('M0 0L-0.5 -1L0.5 -1Z')
    })
    it('a deleted record takes its links with it', () => {
        const p = { records: [{ id: 'a', values: {} }, { id: 'b', values: {} }], timeline: { links: [{ from: 'a', to: 'b' }] } }
        expect(removeRecord(p, 'a').timeline.links).toEqual([])
    })
})
