import { describe, it, expect } from 'vitest'
import {
    kanbanSetup, matrixSetup, kanbanColumns, kanbanLanes, kanbanCells, matrixLayout, cellKey,
    cardFields, dropPatch, dropBefore, renameOptionKeys, keyOf, NONE,
} from './boards'
import { formatPayload } from './formats'
import { ownSource } from './dataSource'
import { moveOption, removeField, updateField } from './fields'

const status = { id: 'status', name: 'Status', type: 'select', options: ['To do', 'Doing', 'Done'] }
const prio = { id: 'prio', name: 'Priority', type: 'select', options: ['Low', 'High'] }
const title = { id: 'title', name: 'Title', type: 'text' }
const due = { id: 'due', name: 'Due', type: 'date' }
const fields = [title, status, prio, due]
const rec = (id, values) => ({ id, values })

describe('which fields lay a view out', () => {
    it('Kanban: Status by default, lanes only when asked and never the column field', () => {
        expect(kanbanSetup(fields).column).toBe(status)
        expect(kanbanSetup(fields).lane).toBe(null)
        expect(kanbanSetup(fields, { columnBy: 'prio', laneBy: 'status' })).toMatchObject({ column: prio, lane: status })
        expect(kanbanSetup(fields, { columnBy: 'prio', laneBy: 'prio' }).lane).toBe(null)
        expect(kanbanSetup([title, due]).column).toBe(null)
        expect(kanbanSetup(fields, { columnBy: 'gone' }).column).toBe(status)
    })
    it('Matrix: two different select fields, the first two by default', () => {
        expect(matrixSetup(fields)).toMatchObject({ row: status, col: prio })
        expect(matrixSetup(fields, { rowBy: 'prio', colBy: 'prio' })).toMatchObject({ row: prio, col: status })
        expect(matrixSetup([title, status]).col).toBe(null)
    })
    it('card fields: chosen ones in order, else the first few that aren\'t the title or the layout', () => {
        expect(cardFields(fields, {}, { exclude: ['title', 'status'] }).map(f => f.id)).toEqual(['prio', 'due'])
        expect(cardFields(fields, { cardFields: ['due', 'gone', 'prio'] }, { exclude: ['title'] }).map(f => f.id)).toEqual(['due', 'prio'])
        expect(cardFields(fields, { cardFields: [] }, {})).toEqual([])
        expect(cardFields(fields, {}, { exclude: ['title'], max: 2 }).length).toBe(2)
    })
})

describe('cells', () => {
    const recs = [rec('a', { status: 'Done', prio: 'High' }), rec('b', { status: 'To do' }), rec('c', {}), rec('d', { status: 'Nope' })]
    it('Kanban columns follow the option order, then "No <field>" unless hidden', () => {
        expect(kanbanColumns(status).map(c => c.key)).toEqual(['To do', 'Doing', 'Done', NONE])
        expect(kanbanColumns(status, { hideEmpty: true }).map(c => c.key)).toEqual(['To do', 'Doing', 'Done'])
        expect(kanbanLanes(null)).toEqual([{ key: '*', label: '' }])
        expect(kanbanLanes(prio).map(l => l.key)).toEqual(['Low', 'High', NONE])
    })
    it('records land in lane × column; a value that isn\'t an option counts as none', () => {
        const cells = kanbanCells(recs, { column: status, lane: null }, kanbanColumns(status))
        expect(cells.get(cellKey('*', 'Done')).map(r => r.id)).toEqual(['a'])
        expect(cells.get(cellKey('*', NONE)).map(r => r.id)).toEqual(['c', 'd'])
        const hidden = kanbanCells(recs, { column: status, lane: null }, kanbanColumns(status, { hideEmpty: true }))
        expect(hidden.get(cellKey('*', NONE))).toBeUndefined()
        const laned = kanbanCells(recs, { column: status, lane: prio }, kanbanColumns(status))
        expect(laned.get(cellKey('High', 'Done')).map(r => r.id)).toEqual(['a'])
        expect(laned.get(cellKey(NONE, 'To do')).map(r => r.id)).toEqual(['b'])
    })
    it('Matrix: placed by both values; anything missing waits in the tray; at most 6×6', () => {
        const m = matrixLayout(recs, { row: status, col: prio })
        expect(m.cells.get(cellKey('Done', 'High')).map(r => r.id)).toEqual(['a'])
        expect(m.tray.map(r => r.id)).toEqual(['b', 'c', 'd'])
        const many = { id: 'm', name: 'M', type: 'select', options: ['1', '2', '3', '4', '5', '6', '7'] }
        const big = matrixLayout([rec('x', { m: '7', prio: 'Low' })], { row: many, col: prio })
        expect(big.rows).toHaveLength(6)
        expect(big.tray.map(r => r.id)).toEqual(['x'])
    })
})

describe('a card dropped', () => {
    it('changes only the fields that differ; none clears', () => {
        const r = rec('a', { status: 'Done', prio: 'High' })
        expect(dropPatch(r, [[status, 'To do'], [prio, 'High']])).toEqual({ status: 'To do' })
        expect(dropPatch(r, [[status, NONE], [null, 'x']])).toEqual({ status: undefined })
        expect(dropPatch(r, [[status, 'Done']])).toEqual({})
    })
    it('lands before the card it was dropped on, or before the record after it', () => {
        const seq = ['a', 'b', 'c', 'd']
        expect(dropBefore(seq, ['b', 'c'], 'a', 'c', 'before')).toBe('c')
        expect(dropBefore(seq, ['b', 'c'], 'a', 'c', 'after')).toBe('d')
        expect(dropBefore(seq, ['b', 'd'], 'a', 'd', 'after')).toBe(null)   // the very end
        // empty space: after the cell's last card; an empty cell keeps the order
        expect(dropBefore(seq, ['b'], 'd', null, null)).toBe('c')
        expect(dropBefore(seq, [], 'd', null, null)).toBe(undefined)
        expect(dropBefore(seq, ['d'], 'd', null, null)).toBe(undefined)
    })
    it('own records: field change and order are one commit (one undo step)', () => {
        let payload = formatPayload('kanban')
        const commits = []
        const commit = (fn) => { commits.push(fn); payload = fn(payload) }
        let src = ownSource(payload, commit)
        const a = src.add({ title: 'A', status: 'To do' })
        src = ownSource(payload, commit)
        const b = src.add({ title: 'B', status: 'Done' })
        src = ownSource(payload, commit)
        commits.length = 0
        src.moveTo(b, { status: 'To do' }, a)
        expect(commits).toHaveLength(1)
        const recs = [...payload.records].sort((x, y) => x.order - y.order)
        expect(recs.map(r => r.values.title)).toEqual(['B', 'A'])
        expect(keyOf(status, recs[0])).toBe('To do')
        // a new option dropped into joins the field in the same step
        ownSource(payload, commit).moveTo(a, { status: 'Blocked' })
        expect(payload.fields.find(f => f.id === 'status').options).toContain('Blocked')
    })
})

describe('view settings follow options and fields', () => {
    it('renaming an option renames its keys in Kanban and Matrix settings', () => {
        const p = { kanban: { columnBy: 'status', collapsed: ['Done'], wip: { Done: 3 } }, matrix: { cells: { Done: { High: { label: 'X' } } } } }
        const out = renameOptionKeys(p, 'status', 'Done', 'Shipped')
        expect(out.kanban.collapsed).toEqual(['Shipped'])
        expect(out.kanban.wip).toEqual({ Shipped: 3 })
        expect(out.matrix.cells.Shipped.High.label).toBe('X')
    })
    it('the source\'s rename does both in one step', () => {
        let payload = { ...formatPayload('kanban'), kanban: { wip: { Doing: 2 } } }
        ownSource(payload, (fn) => { payload = fn(payload) }).renameOption('status', 'Doing', 'In progress')
        expect(payload.fields[1].options).toEqual(['To do', 'In progress', 'Done'])
        expect(payload.kanban.wip).toEqual({ 'In progress': 2 })
    })
    it('moving an option (a Kanban column) changes the order every view uses', () => {
        const p = formatPayload('kanban')
        expect(moveOption(p, 'status', 'Done', 'To do').fields[1].options).toEqual(['Done', 'To do', 'Doing'])
        expect(moveOption(p, 'status', 'To do', 'Doing').fields[1].options).toEqual(['Doing', 'To do', 'Done'])
        expect(moveOption(p, 'status', 'Nope', 'Doing')).toEqual(p)
    })
    it('a deleted or retyped field leaves no filter in any view', () => {
        const p = { ...formatPayload('kanban'), kanban: { filters: [{ id: 'f', field: 'due', op: 'today' }], sorts: [{ field: 'due' }] }, matrix: { filters: [{ id: 'g', field: 'due', op: 'today' }] } }
        const gone = removeField(p, 'due')
        expect(gone.kanban.filters).toEqual([])
        expect(gone.kanban.sorts).toEqual([])
        expect(gone.matrix.filters).toEqual([])
        const retyped = updateField(p, 'due', { type: 'text' })
        expect(retyped.kanban.filters).toEqual([])
        expect(retyped.kanban.sorts).toHaveLength(1)
    })
    it('a new Matrix starts with impact × effort and the usual quadrant names', () => {
        const p = formatPayload('matrix')
        expect(p.fields.map(f => f.id)).toEqual(['title', 'impact', 'effort'])
        expect(matrixSetup(p.fields, p.matrix)).toMatchObject({ row: { id: 'impact' }, col: { id: 'effort' } })
        expect(p.matrix.cells.High.Low.label).toBe('Quick wins')
    })
})

describe('card looks', () => {
    it('one card, then every card (which clears what it sets from each card), then clear', async () => {
        const { applyCardStyle, cardLook } = await import('./boards')
        let s = applyCardStyle({}, 'a', { bold: true, color: '#f00' })
        expect(cardLook(s, 'a')).toEqual({ bold: true, color: '#f00' })
        expect(cardLook(s, 'b')).toBe(null)
        s = applyCardStyle(s, null, { color: '#0f0', scale: 1.3 })
        expect(cardLook(s, 'a')).toEqual({ bold: true, color: '#0f0', scale: 1.3 })
        expect(cardLook(s, 'b')).toEqual({ color: '#0f0', scale: 1.3 })
        s = applyCardStyle(s, 'a', null)
        expect(s.card).toBeUndefined()
        expect(applyCardStyle(s, null, null)).toEqual({})
    })
    it('a deleted record takes its card look with it', async () => {
        const { removeRecord } = await import('./formats')
        const p = { records: [{ id: 'a', values: {} }], kanban: { styles: { card: { a: { bold: true } }, all: { scale: 2 } } } }
        expect(removeRecord(p, 'a').kanban.styles).toEqual({ card: {}, all: { scale: 2 } })
    })
})
