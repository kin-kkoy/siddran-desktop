import { useMemo } from "react";

// Calendar task overlay, derived from the **shared** task store (`useTasks`) so it
// is a single source of truth — tasks added/edited/deleted/scheduled anywhere
// reflect on the calendar live, with no separate fetch to drift out of sync.
//
// (This used to keep its own fetched copy + optimistic state, which caused two
// bugs: newly-created tasks never appeared on the calendar, and dragging a task
// from the drawer could leave a duplicate because the two copies disagreed.)
//
//   dated   → tasks with a due_date (plotted on the grid)
//   undated → open, dateless tasks (the Day view's "unscheduled" drawer)
//
// Mutations are done by the caller through `updateTask` (which patches the same
// shared store), so no mutation methods live here anymore.
export function useCalendarTasks(allTasks = []) {
    const tasks = useMemo(() => allTasks.filter(t => t.due_date), [allTasks])
    const undated = useMemo(
        () => allTasks.filter(t => !t.due_date && !t.is_completed),
        [allTasks],
    )
    return { tasks, undated, loading: false }
}
