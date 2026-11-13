import { useMemo } from 'react'
import { useTasksApi } from '../../../contexts/TasksApiContext'
import { sourceFor } from './dataSource'

/**
 * The data source for a widget (dataSource.js), rebuilt only when its payload
 * or — for a linked widget — the tasks change. Moving the widget changes its
 * x/y, not its payload, so a drag doesn't rebuild the rows.
 */
export function useFormatSource(item, commit) {
    const ctx = useTasksApi()
    const payload = item.payload
    const linked = payload?.source?.type === 'tasks' || payload?.source?.type === 'project'
    // Own records don't depend on the tasks at all.
    const tasks = linked ? ctx.tasks : null
    const bundles = linked ? ctx.bundles : null
    const api = linked ? ctx.api : null
    return useMemo(
        () => sourceFor(payload, commit, { tasks: tasks || [], bundles: bundles || [], api: api || {} }),
        [payload, commit, tasks, bundles, api],
    )
}
