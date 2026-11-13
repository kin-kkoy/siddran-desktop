/**
 * One data interface for every Format view (decided: a widget either links to
 * Siddran tasks or holds its own records — one adapter, one set of views).
 *
 * A source is:
 *   {
 *     type, label,            // 'own' | 'tasks' | 'project', and how to name it
 *     fields, records,        // records = [{ id, values: { [fieldId]: v } }]
 *     editable: Set(fieldId), // which values the views may change
 *     canAdd, canRemove,
 *     add(values), update(id, patch), remove(id),
 *     fieldsEditable,         // own records only: the field verbs below work
 *     fields: addField(def) → id, updateField(id, patch), removeField(id),
 *             moveField(id, index), addOption / renameOption / removeOption,
 *   }
 * Views read `fields`/`records` and call the three verbs; they never know
 * where the data lives.
 *
 * Own records write the board item (one undo step each, saved with the board).
 * Linked tasks go through the app's tasks store (hooks/useTasks.js), which
 * writes through desktop/localStore.js and its live sync — never
 * tasks.siddran directly. Linked rows can't be deleted from a board: that
 * would delete real tasks from a widget, too easy to do by accident.
 */
import { addRecord, updateRecord, updateRecords, removeRecord, newRecordId } from './formats'
import { moveRecord } from './layout'
import * as F from './fields'
import { fromPickerValue, toPickerValue } from '../../../utils/deadline'

export const TASK_STATUS = ['To do', 'Done']
export const PRIORITIES = ['low', 'normal', 'high']

export const TASK_FIELDS = [
    { id: 'title', name: 'Title', type: 'text' },
    { id: 'status', name: 'Status', type: 'select', options: TASK_STATUS },
    { id: 'priority', name: 'Priority', type: 'select', options: PRIORITIES },
    { id: 'due', name: 'Due', type: 'date' },
]
const PROJECT_FIELDS = TASK_FIELDS.filter(f => f.id !== 'due')   // project tasks have no due date

const SHOWS = { open: (t) => !t.is_completed, done: (t) => !!t.is_completed, all: () => true }

/** A task as a record. `due` is the local calendar day (YYYY-MM-DD) or ''. */
export function taskToRecord(t) {
    return {
        id: String(t.id),
        values: {
            title: t.title || '',
            status: t.is_completed ? 'Done' : 'To do',
            priority: t.priority || 'normal',
            due: t.due_date ? toPickerValue(t.due_date, t.due_all_day).slice(0, 10) : '',
        },
    }
}

/** A record patch as a task update (useTasks.updateTask's fields). */
export function recordPatchToTask(patch) {
    const out = {}
    if ('title' in patch) out.title = String(patch.title ?? '')
    if ('status' in patch) out.is_completed = patch.status === 'Done'
    if ('priority' in patch && PRIORITIES.includes(patch.priority)) out.priority = patch.priority
    if ('due' in patch) Object.assign(out, fromPickerValue(patch.due || ''))   // '' clears it
    return out
}

/**
 * Own records, stored in the widget. `commit(fn)` writes the item with
 * `fn(currentPayload)` — applied to the payload as it is at commit time, so two
 * quick edits never build on the same stale copy.
 */
export function ownSource(payload, commit) {
    const fields = payload.fields || []
    return {
        type: 'own', label: 'Own records',
        fields, records: payload.records || [],
        editable: new Set(fields.filter(f => f.type !== 'formula').map(f => f.id)),   // a formula's cells are computed (R13.31)
        canAdd: true, canRemove: true,
        add: (values) => { const id = newRecordId(); commit(p => addRecord(p, values, { id }).payload); return id },
        // A new option typed into a cell joins its field in the same undo step.
        update: (id, patch) => commit(p => F.ensureOptions(updateRecord(p, id, patch), patch)),
        remove: (id) => commit(p => removeRecord(p, id)),
        updateMany: (list) => { if (list.length) commit(p => list.reduce((q, x) => F.ensureOptions(q, x.patch), updateRecords(p, list))) },
        apply: (fn) => commit(fn),   // a whole-payload change in one step (an import)
        canReorder: true,
        moveRecord: (id, beforeId) => commit(p => moveRecord(p, id, beforeId)),
        fieldsEditable: true,
        canAddField: fields.length < F.MAX_FIELDS,
        addField: (def) => {
            const id = F.newFieldId()
            commit(p => { const r = F.addField(p, def, { id }); return r.error ? p : r.payload })
            return id
        },
        updateField: (id, patch) => commit(p => F.updateField(p, id, patch)),
        removeField: (id) => commit(p => F.removeField(p, id)),
        moveField: (id, index) => commit(p => F.moveField(p, id, index)),
        addOption: (fieldId, label) => commit(p => F.addOption(p, fieldId, label)),
        renameOption: (fieldId, from, to) => commit(p => F.renameOption(p, fieldId, from, to)),
        removeOption: (fieldId, label) => commit(p => F.removeOption(p, fieldId, label)),
    }
}

/**
 * The Bag's tasks (`source.type === 'tasks'`) or one project's
 * (`'project'`), through `api` — the tasks store's own mutators.
 */
export function taskSource(source, { tasks = [], bundles = [], api = {} } = {}) {
    const show = SHOWS[source.show] || SHOWS.open
    if (source.type === 'project') {
        const p = bundles.find(b => String(b.id) === String(source.projectId))
        if (!p) {
            return {
                type: 'project', label: 'Project (missing)', missing: true,
                fields: PROJECT_FIELDS, records: [], editable: new Set(),
                canAdd: false, canRemove: false, add: () => {}, update: () => {}, remove: () => {},
            }
        }
        const rows = (p.tasks || []).filter(show)
        return {
            type: 'project', label: p.title || 'Project',
            fields: PROJECT_FIELDS,
            records: rows.map(t => { const r = taskToRecord(t); delete r.values.due; return r }),
            editable: new Set(['title', 'status', 'priority']),
            canAdd: !!api.addBundleTasks, canRemove: false,
            add: (values) => { if (values?.title?.trim()) api.addBundleTasks?.(p.id, [{ title: values.title.trim() }]) },
            update: (id, patch) => {
                const t = (p.tasks || []).find(x => String(x.id) === String(id))
                if (!t) return
                const u = recordPatchToTask(patch)
                if ('is_completed' in u && Object.keys(u).length === 1) { api.toggleBundleTaskCompletion?.(p.id, t.id, u.is_completed); return }
                const row = { id: t.id }
                if ('title' in u) row.title = u.title
                if ('priority' in u) row.priority = u.priority
                if ('is_completed' in u) row.is_completed = u.is_completed
                api.batchUpdateBundleTasks?.(p.id, [row])
            },
            remove: () => {},
        }
    }
    const rows = tasks.filter(t => !t._optimistic || t.title).filter(show)
    return {
        type: 'tasks', label: 'Tasks',
        fields: TASK_FIELDS,
        records: rows.map(taskToRecord),
        editable: new Set(['title', 'status', 'priority', 'due']),
        canAdd: !!api.addTask, canRemove: false,
        add: (values) => { if (values?.title?.trim()) api.addTask?.(values.title.trim(), '', 'normal', '') },
        update: (id, patch) => {
            const t = tasks.find(x => String(x.id) === String(id))
            if (!t || String(t.id).startsWith('temp-')) return
            const u = recordPatchToTask(patch)
            if ('is_completed' in u && Object.keys(u).length === 1 && api.toggleTaskCompletion) { api.toggleTaskCompletion(t.id, u.is_completed); return }
            api.updateTask?.(t.id, u)
        },
        remove: () => {},
    }
}

/** The source a widget's payload asks for. */
export function sourceFor(payload, commit, ctx) {
    const s = payload?.source
    if (s?.type === 'tasks' || s?.type === 'project') return taskSource(s, ctx)
    return ownSource(payload || {}, commit)
}

export function sourceLabel(payload, bundles = []) {
    const s = payload?.source
    if (s?.type === 'tasks') return `Tasks · ${s.show || 'open'}`
    if (s?.type === 'project') {
        const p = bundles.find(b => String(b.id) === String(s.projectId))
        return `${p?.title || 'Project'} · ${s.show || 'open'}`
    }
    return 'Own records'
}
