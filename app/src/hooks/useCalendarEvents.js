import { useState, useEffect, useCallback } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";

// CRUD for calendar "blocks" (the calendar_events table). Mirrors useTasks: optimistic
// writes with revert-on-failure. A block is standalone (ref_type null) or linked to an
// existing note/task/daily/project/sandbox. Times are ISO strings (UTC); the UI renders local.
//
// Reads fetch the user's whole set on auth (a personal app's event count is small and the
// derivation layer — useCalendar — filters/expands by the visible range in memory). A
// range-scoped refetch can be layered on later if event volume ever warrants it.
export const useCalendarEvents = (authFetch, API, isAuthed) => {

    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!isAuthed) return

        const fetchEvents = async () => {
            try {
                const res = await authFetch(`${API}/events`)
                if (res.ok) {
                    const data = await res.json()
                    setEvents(data.events)
                }
            } catch (error) {
                logger.error('Error fetching calendar events:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchEvents()
    }, [isAuthed, authFetch, API])


    // Create a block. `start_at` is required; pass ref_type/ref_id only for linked blocks.
    const addEvent = useCallback(async ({ title, description, start_at, end_at, all_day, color, ref_type, ref_id }) => {
        if (!title || !title.trim()) {
            toast.warning("A title would be nice, don't you think?")
            return null
        }
        if (!start_at) {
            logger.error('addEvent: start_at is required')
            return null
        }

        const tempId = `temp-${(crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`}`
        const optimistic = {
            id: tempId,
            title: title.trim(),
            description: description ?? null,
            start_at,
            end_at: end_at ?? null,
            all_day: all_day ?? false,
            color: color ?? null,
            ref_type: ref_type ?? null,
            ref_id: ref_type ? (ref_id ?? null) : null,
            created_at: new Date().toISOString(),
            _optimistic: true,
        }

        setEvents(prev => [...prev, optimistic])

        try {
            const res = await authFetch(`${API}/events`, {
                method: 'POST',
                body: JSON.stringify({ title, description, start_at, end_at, all_day, color, ref_type, ref_id })
            })

            if (!res.ok) throw new Error('Failed to create event')

            const created = await res.json()
            setEvents(prev => prev.map(e => e.id === tempId ? created : e))
            return created

        } catch (error) {
            logger.error('Error creating event:', error)
            setEvents(prev => prev.filter(e => e.id !== tempId))
            toast.error('Could not create that block.')
            return null
        }
    }, [authFetch, API])


    // Patch a block (e.g. drag-retime sends { start_at, end_at }). Optimistic with revert.
    const updateEvent = useCallback(async (id, patch) => {
        let snapshot = null
        setEvents(prev => {
            snapshot = prev.find(e => e.id === id) ?? null
            return prev.map(e => e.id === id ? { ...e, ...patch } : e)
        })

        // optimistic-only row not persisted yet — its create will carry the latest state
        if (typeof id === 'string' && id.startsWith('temp-')) return

        try {
            const res = await authFetch(`${API}/events/${id}`, {
                method: 'PUT',
                body: JSON.stringify(patch)
            })

            if (!res.ok) throw new Error('Failed to update event')

            const updated = await res.json()
            setEvents(prev => prev.map(e => e.id === id ? updated : e))

        } catch (error) {
            logger.error('Error updating event:', error)
            if (snapshot) setEvents(prev => prev.map(e => e.id === id ? snapshot : e))
            toast.error('That change did not stick.')
        }
    }, [authFetch, API])


    const deleteEvent = useCallback(async (id) => {
        let removed = null
        setEvents(prev => {
            removed = prev.find(e => e.id === id) ?? null
            return prev.filter(e => e.id !== id)
        })

        if (typeof id === 'string' && id.startsWith('temp-')) return

        try {
            const res = await authFetch(`${API}/events/${id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Failed to delete event')

        } catch (error) {
            logger.error('Error deleting event:', error)
            if (removed) setEvents(prev => [...prev, removed])
            toast.error('Failed to delete block. Restored.')
        }
    }, [authFetch, API])


    // Bulk-append created rows (Schedule Designer apply → POST /schedules returns its events).
    const addEvents = useCallback((list) => {
        if (Array.isArray(list) && list.length) setEvents(prev => [...prev, ...list])
    }, [])
    // Schedule management reflected in the cache (the schedules route did the DB work).
    const removeEventsBySchedule = useCallback((scheduleId) => {
        setEvents(prev => prev.filter(e => e.schedule_id !== scheduleId))
    }, [])
    const recolorEventsBySchedule = useCallback((scheduleId, color) => {
        setEvents(prev => prev.map(e => e.schedule_id === scheduleId ? { ...e, color } : e))
    }, [])

    return {
        events,
        loading,
        addEvent,
        updateEvent,
        deleteEvent,
        addEvents,
        removeEventsBySchedule,
        recolorEventsBySchedule,
    }
}
