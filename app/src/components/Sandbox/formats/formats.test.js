import { describe, it, expect, vi } from 'vitest'
import { formatPayload, isFormat, addRecord, updateRecord, removeRecord, nextFormatTitle, recordTitle } from './formats'
import { ownSource, taskSource, taskToRecord, recordPatchToTask, sourceFor } from './dataSource'

const AT = { at: '2026-11-13T00:00:00.000Z' }

describe('format payload and records', () => {
  it('a new widget is a shape kind with its own empty dataset', () => {
    const p = formatPayload('table')
    expect(p).toMatchObject({ kind: 'format', view: 'table', title: 'Table', source: { type: 'own' }, records: [] })
    expect(p.fields.map((f) => f.id)).toEqual(['title', 'status', 'due'])
    expect(isFormat({ type: 'shape', payload: p })).toBe(true)
    expect(isFormat({ type: 'shape', payload: { kind: 'frame' } })).toBe(false)
  })

  it('adds, edits and removes records, stamping each change', () => {
    let p = formatPayload()
    const r = addRecord(p, { title: 'One' }, { id: 'r1', ...AT })
    p = r.payload
    expect(p.records).toEqual([{ id: 'r1', values: { title: 'One' }, updated_at: AT.at }])
    p = updateRecord(p, 'r1', { status: 'Done' }, { at: 'later' })
    expect(p.records[0]).toEqual({ id: 'r1', values: { title: 'One', status: 'Done' }, updated_at: 'later' })
    expect(removeRecord(p, 'r1').records).toEqual([])
  })

  it('numbers new titles', () => {
    const items = [{ type: 'shape', payload: { kind: 'format', title: 'Table' } }, { type: 'shape', payload: { kind: 'format', title: 'Table 2' } }]
    expect(nextFormatTitle([], 'kanban')).toBe('Kanban')
    expect(nextFormatTitle(items, 'table')).toBe('Table 3')
  })

  it('a record is known by its title', () => {
    expect(recordTitle({ values: { title: 'X' } })).toBe('X')
    expect(recordTitle({ values: { name: 'Y' } }, [{ id: 'name', type: 'text' }])).toBe('Y')
  })
})

describe('data sources — one interface', () => {
  it('own records write the widget through commit', () => {
    const commit = vi.fn()
    const src = ownSource(formatPayload(), commit)
    expect(src).toMatchObject({ type: 'own', canAdd: true, canRemove: true, records: [] })
    const id = src.add({ title: 'New' })
    const next = commit.mock.calls[0][0](formatPayload())   // applied to the payload at commit time
    expect(next.records[0]).toMatchObject({ id, values: { title: 'New' } })
    src.update(id, { status: 'Done' })
    expect(commit.mock.calls[1][0](next).records[0].values.status).toBe('Done')
  })

  const tasks = [
    { id: 1, title: 'Open one', is_completed: false, priority: 'high', due_date: null },
    { id: 2, title: 'Done one', is_completed: true, priority: 'low', due_date: '2026-11-20T00:00:00.000Z', due_all_day: true },
  ]

  it('linked tasks show as records, filtered', () => {
    const open = taskSource({ type: 'tasks', show: 'open' }, { tasks })
    expect(open.records).toEqual([{ id: '1', values: { title: 'Open one', status: 'To do', priority: 'high', due: '' } }])
    expect(open.canRemove).toBe(false)
    expect(taskSource({ type: 'tasks', show: 'all' }, { tasks }).records).toHaveLength(2)
    expect(taskSource({ type: 'tasks', show: 'done' }, { tasks }).records[0].values.status).toBe('Done')
  })

  it('edits to a linked record go to the tasks store, never to the board', () => {
    const api = { updateTask: vi.fn(), toggleTaskCompletion: vi.fn(), addTask: vi.fn() }
    const src = taskSource({ type: 'tasks', show: 'all' }, { tasks, api })
    src.update('1', { status: 'Done' })
    expect(api.toggleTaskCompletion).toHaveBeenCalledWith(1, true)
    src.update('1', { title: 'Renamed', priority: 'low' })
    expect(api.updateTask).toHaveBeenCalledWith(1, { title: 'Renamed', priority: 'low' })
    src.add({ title: '  Fresh  ' })
    expect(api.addTask).toHaveBeenCalledWith('Fresh', '', 'normal', '')
  })

  it('a project source reads and edits that project\'s tasks', () => {
    const api = { batchUpdateBundleTasks: vi.fn(), toggleBundleTaskCompletion: vi.fn(), addBundleTasks: vi.fn() }
    const bundles = [{ id: 'p1', title: 'Launch', tasks: [{ id: 't1', title: 'Write', is_completed: false, priority: 'normal' }] }]
    const src = taskSource({ type: 'project', projectId: 'p1', show: 'open' }, { bundles, api })
    expect(src.label).toBe('Launch')
    expect(src.fields.map((f) => f.id)).toEqual(['title', 'status', 'priority'])
    expect(src.records[0].values).toEqual({ title: 'Write', status: 'To do', priority: 'normal' })
    src.update('t1', { status: 'Done' })
    expect(api.toggleBundleTaskCompletion).toHaveBeenCalledWith('p1', 't1', true)
    src.update('t1', { title: 'Write it' })
    expect(api.batchUpdateBundleTasks).toHaveBeenCalledWith('p1', [{ id: 't1', title: 'Write it' }])
    expect(taskSource({ type: 'project', projectId: 'gone' }, { bundles }).missing).toBe(true)
  })

  it('maps due dates both ways as a calendar day', () => {
    // A day picked in a widget comes back as the same day, in any time zone.
    const due = recordPatchToTask({ due: '2026-11-20' })
    expect(taskToRecord({ id: 3, title: 'x', ...due }).values.due).toBe('2026-11-20')
    expect(recordPatchToTask({ due: '' })).toEqual({ due_date: null, due_all_day: false })
    expect(recordPatchToTask({ due: '2026-12-01' }).due_all_day).toBe(true)
  })

  it('sourceFor picks by payload.source', () => {
    expect(sourceFor(formatPayload(), () => {}, {}).type).toBe('own')
    expect(sourceFor({ ...formatPayload(), source: { type: 'tasks' } }, () => {}, { tasks }).type).toBe('tasks')
  })
})
