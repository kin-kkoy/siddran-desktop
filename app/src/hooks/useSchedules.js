import { useState, useEffect, useCallback } from "react";
import { toast } from "../utils/toast";
import logger from "../utils/logger";

// Named "schedules" — groups of blocks stamped from the Schedule Designer. Lists them and exposes
// create / delete / rename / recolour. The events cache (useCalendarEvents) is synced separately in
// App (this hook owns the schedules list; App reflects the block-level changes). Gated on calendarActive.
export function useSchedules(authFetch, API, isAuthed) {
    const [schedules, setSchedules] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!isAuthed) return
        let cancelled = false
        ;(async () => {
            try {
                const res = await authFetch(`${API}/schedules`)
                if (res.ok && !cancelled) setSchedules((await res.json()).schedules || [])
            } catch (error) {
                logger.error('Error fetching schedules:', error)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [isAuthed, authFetch, API])

    // Create a named schedule + its stamped blocks (one transaction). Returns { schedule, events } | null.
    const createSchedule = useCallback(async ({ name, color, events, template }) => {
        try {
            const res = await authFetch(`${API}/schedules`, { method: 'POST', body: JSON.stringify({ name, color, events, template }) })
            if (!res.ok) throw new Error('create failed')
            const data = await res.json()
            setSchedules(prev => [data.schedule, ...prev])
            return data
        } catch (error) {
            logger.error('Error creating schedule:', error)
            toast.error('Could not apply that schedule.')
            return null
        }
    }, [authFetch, API])

    // Edit in place: replace a schedule's blocks + update name/colour/template. Returns { schedule, events } | null.
    const restampSchedule = useCallback(async (id, { name, color, events, template }) => {
        try {
            const res = await authFetch(`${API}/schedules/${id}/restamp`, { method: 'PUT', body: JSON.stringify({ name, color, events, template }) })
            if (!res.ok) throw new Error('restamp failed')
            const data = await res.json()
            setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...data.schedule } : s))
            return data
        } catch (error) {
            logger.error('Error updating schedule:', error)
            toast.error('Could not update that schedule.')
            return null
        }
    }, [authFetch, API])

    const deleteSchedule = useCallback(async (id) => {
        let snapshot = null
        setSchedules(prev => { snapshot = prev; return prev.filter(s => s.id !== id) })
        try {
            const res = await authFetch(`${API}/schedules/${id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('delete failed')
            return true
        } catch (error) {
            logger.error('Error deleting schedule:', error)
            if (snapshot) setSchedules(snapshot)
            toast.error('Could not delete that schedule.')
            return false
        }
    }, [authFetch, API])

    const updateSchedule = useCallback(async (id, patch) => {
        let snap = null
        setSchedules(prev => { snap = prev.find(s => s.id === id) ?? null; return prev.map(s => s.id === id ? { ...s, ...patch } : s) })
        try {
            const res = await authFetch(`${API}/schedules/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
            if (!res.ok) throw new Error('update failed')
            return true
        } catch (error) {
            logger.error('Error updating schedule:', error)
            if (snap) setSchedules(prev => prev.map(s => s.id === id ? snap : s))
            toast.error('Could not update that schedule.')
            return false
        }
    }, [authFetch, API])

    return { schedules, loading, createSchedule, restampSchedule, deleteSchedule, updateSchedule }
}
