import { useState, useEffect, useCallback } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";

// Task overlay for the Calendar. The app-wide useTasks hook is cursor-paginated (~20 rows), so
// a task dated outside the first page would never plot. This hook instead fetches ALL dated
// tasks ONCE (like useCalendarEvents fetches all blocks) and derives every month/view in
// memory — so switching Day/Week/Month or paging months never refetches. It owns optimistic
// retime/schedule, and the page also patches the app-level useTasks cache so TasksHub stays
// in sync (see Calendar.jsx).
export function useCalendarTasks(authFetch, API, isAuthed) {

    const [tasks, setTasks] = useState([])
    const [undated, setUndated] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!isAuthed) return

        let cancelled = false
        const fetchTasks = async () => {
            try {
                const res = await authFetch(`${API}/tasks?dated=1`)
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    setTasks(data.tasks || [])
                }
            } catch (error) {
                logger.error('Error fetching calendar tasks:', error)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        fetchTasks()
        return () => { cancelled = true }
    }, [isAuthed, authFetch, API])

    // Undated tasks (for the Day view's "unscheduled" drawer) — range-independent, fetched once.
    useEffect(() => {
        if (!isAuthed) return
        let cancelled = false
        const fetchUndated = async () => {
            try {
                const res = await authFetch(`${API}/tasks?undated=1`)
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    setUndated(data.tasks || [])
                }
            } catch (error) {
                logger.error('Error fetching unscheduled tasks:', error)
            }
        }
        fetchUndated()
        return () => { cancelled = true }
    }, [isAuthed, authFetch, API])

    // Drag-retime: rewrite due_date. Takes an object patch ({ due_date }) to match the
    // updateTask/updateEvent convention used by useCalendar.retime. Optimistic with revert.
    const retimeTask = useCallback(async (id, { due_date }) => {
        let snapshot = null
        setTasks(prev => {
            snapshot = prev.find(t => t.id === id) ?? null
            return prev.map(t => t.id === id ? { ...t, due_date } : t)
        })

        try {
            const res = await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ due_date })
            })
            if (!res.ok) throw new Error('Failed to retime task')
        } catch (error) {
            logger.error('Error retiming task:', error)
            if (snapshot) setTasks(prev => prev.map(t => t.id === id ? snapshot : t))
            toast.error('Could not move that task.')
        }
    }, [authFetch, API])

    // Schedule an undated task onto a day (drag from the drawer). Optimistically moves it from
    // the undated list into the dated list, then persists due_date; reverts on failure.
    const scheduleTask = useCallback(async (id, due_date) => {
        let moved = null
        setUndated(prev => {
            moved = prev.find(t => t.id === id) ?? null
            return prev.filter(t => t.id !== id)
        })
        if (moved) setTasks(prev => [...prev, { ...moved, due_date }])

        try {
            const res = await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ due_date })
            })
            if (!res.ok) throw new Error('Failed to schedule task')
        } catch (error) {
            logger.error('Error scheduling task:', error)
            setTasks(prev => prev.filter(t => t.id !== id))
            if (moved) setUndated(prev => [moved, ...prev])
            toast.error('Could not schedule that task.')
        }
    }, [authFetch, API])

    // Unschedule a dated task (drag it onto the drawer): clear due_date, moving it from the dated
    // list into the undated list. Mirror of scheduleTask; optimistic with revert.
    const unscheduleTask = useCallback(async (id) => {
        let moved = null
        setTasks(prev => {
            moved = prev.find(t => t.id === id) ?? null
            return prev.filter(t => t.id !== id)
        })
        if (moved) setUndated(prev => [{ ...moved, due_date: null }, ...prev])

        try {
            const res = await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ due_date: null })
            })
            if (!res.ok) throw new Error('Failed to unschedule task')
        } catch (error) {
            logger.error('Error unscheduling task:', error)
            if (moved) {
                setUndated(prev => prev.filter(t => t.id !== id))
                setTasks(prev => [...prev, moved])
            }
            toast.error('Could not unschedule that task.')
        }
    }, [authFetch, API])

    const toggleTask = useCallback(async (id, isCompleted) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, is_completed: isCompleted } : t))
        try {
            await authFetch(`${API}/tasks/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_completed: isCompleted })
            })
        } catch (error) {
            logger.error('Error toggling task:', error)
            setTasks(prev => prev.map(t => t.id === id ? { ...t, is_completed: !isCompleted } : t))
        }
    }, [authFetch, API])

    return { tasks, undated, loading, retimeTask, toggleTask, scheduleTask, unscheduleTask }
}
