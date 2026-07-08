import { useState, useEffect, useCallback } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";

// Calendar-scoped daily data: ALL recurring dailies (non-paginated — so every recurring row
// plots, not just useTasks' first page) plus their per-day completions. useCalendar expands the
// recurring rows into virtual per-day instances and marks each done if a completion row exists.
//
// Gated on `isAuthed && calendarActive` (same as useCalendarEvents/useCalendarTasks) so non-calendar
// pages fire NO extra requests. Completions are tiny rows; we fetch the user's whole set once and
// derive in memory (zero refetch on month/view navigation), matching the other calendar hooks.
export function useCalendarDailies(authFetch, API, isAuthed) {

    const [recurringDailies, setRecurringDailies] = useState([])
    const [completions, setCompletions] = useState([]) // [{ daily_task_id, date:'YYYY-MM-DD' }]
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!isAuthed) return

        let cancelled = false
        const load = async () => {
            try {
                const [rdRes, cRes] = await Promise.all([
                    authFetch(`${API}/daily-tasks?recurring=1`),
                    authFetch(`${API}/daily-tasks/completions`),
                ])
                if (!cancelled && rdRes.ok) setRecurringDailies((await rdRes.json()).dailyTasks || [])
                if (!cancelled && cRes.ok) setCompletions((await cRes.json()).completions || [])
            } catch (error) {
                logger.error('Error fetching calendar dailies:', error)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        load()
        return () => { cancelled = true }
    }, [isAuthed, authFetch, API])

    // NOTE: ephemeral ("today's") dailies are NOT fetched here — the calendar derives them from the
    // shared useTasks.dailyTasks store (single source) so TasksHub add/delete/edit reflect live, and
    // edits go through useTasks (setDailyTime / toggleDailyTaskCompletion). See App.jsx.

    // Upsert a recurring daily into the calendar's set (it's owned/edited via useTasks' separate
    // store) so create/convert/edit plot immediately without a refetch. Recurring rows only —
    // replaces an existing entry so title/time/pattern edits stay in sync.
    const addRecurring = useCallback((row) => {
        if (!row || row.recurrence == null) return
        setRecurringDailies(prev => {
            const i = prev.findIndex(r => r.id === row.id)
            if (i === -1) return [row, ...prev]
            const next = prev.slice(); next[i] = row; return next
        })
    }, [])

    // Drop a daily from the calendar's recurring set (it was un-recurred → now a one-off).
    const removeRecurring = useCallback((id) => {
        setRecurringDailies(prev => prev.filter(r => r.id !== id))
    }, [])

    const keyOf = (c) => `${c.daily_task_id}|${c.date}`

    // Toggle a recurring daily's completion on one date. Optimistic add/remove with revert.
    const toggleCompletion = useCallback(async (dailyTaskId, dateISO, done) => {
        const key = `${dailyTaskId}|${dateISO}`
        const add = () => setCompletions(prev => prev.some(c => keyOf(c) === key) ? prev : [...prev, { daily_task_id: dailyTaskId, date: dateISO }])
        const remove = () => setCompletions(prev => prev.filter(c => keyOf(c) !== key))

        done ? add() : remove()

        try {
            const res = await authFetch(`${API}/daily-tasks/${dailyTaskId}/completions`, {
                method: 'POST',
                body: JSON.stringify({ date: dateISO, done }),
            })
            if (!res.ok) throw new Error('Failed to toggle completion')
        } catch (error) {
            logger.error('Error toggling daily completion:', error)
            done ? remove() : add() // revert
            toast.error('Could not update that check-off.')
        }
    }, [authFetch, API])

    return { recurringDailies, completions, toggleCompletion, addRecurring, removeRecurring, loading }
}
