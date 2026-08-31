import { useMemo, useCallback } from "react";
import {
    isoDate, parseISODate, addDays, localDayOf, toISOFromParts, timeOf, taskDueStamp,
    parseRecurrence, recurrenceMatches,
} from "../components/Calendar/calendarDates";

// Pure derivation layer for the Calendar. It NEVER owns state — it reads the source
// collections (calendar_events blocks, tasks, recurring daily tasks) and projects them onto
// the visible date range as a Map<ISO, Item[]>. `retime` dispatches a move back to the right
// source mutation. This keeps the calendar a view over existing data, never a second copy.
//
// Normalized Item shape (what the views render):
//   { key, kind: 'event'|'task'|'daily', id, title, day (ISO), done, color, time,
//     all_day, ref_type, ref_id, source }   // source = the original row, for click-through
//
// Args:
//   events           — calendar_events rows (from useCalendarEvents)
//   tasks            — task rows (from useTasks); plotted by due_date
//   dailyTasks       — daily_tasks rows; only recurring ones (recurrence != null) are expanded
//   dailyCompletions — [{ daily_task_id, date }] (P5); absent for now → recurring dailies show undone
//   range            — { from: Date, to: Date } inclusive window to project onto
//   updateEvent, updateTask — source mutations used by retime

export function useCalendar({
    events = [],
    tasks = [],
    dailyTasks = [],
    dailyCompletions = [],
    ephemeralDailies = [],
    range,
    updateEvent,
    updateTask,
} = {}) {

    // Set of "<daily_task_id>|<ISO>" that are completed, for O(1) lookup.
    const completedSet = useMemo(() => {
        const set = new Set();
        for (const c of dailyCompletions) {
            const day = typeof c.date === 'string' ? c.date.slice(0, 10) : localDayOf(c.date);
            set.add(`${c.daily_task_id}|${day}`);
        }
        return set;
    }, [dailyCompletions]);

    const eventsByDate = useMemo(() => {
        const map = new Map();
        if (!range?.from || !range?.to) return map;

        const fromISO = isoDate(range.from);
        const toISO = isoDate(range.to);
        const push = (dayISO, item) => {
            if (dayISO < fromISO || dayISO > toISO) return;
            if (!map.has(dayISO)) map.set(dayISO, []);
            map.get(dayISO).push(item);
        };

        // 1) Calendar blocks — placed on every local day they span (start_at..end_at inclusive).
        for (const e of events) {
            if (!e.start_at) continue;
            const startDay = parseISODate(localDayOf(e.start_at));
            const endDay = e.end_at ? parseISODate(localDayOf(e.end_at)) : startDay;
            for (let d = startDay; d <= endDay; d = addDays(d, 1)) {
                push(isoDate(d), {
                    key: `event-${e.id}-${isoDate(d)}`,
                    kind: 'event',
                    id: e.id,
                    title: e.title,
                    day: isoDate(d),
                    done: false,
                    color: e.color || null,
                    time: e.all_day ? null : timeOf(e.start_at),
                    all_day: e.all_day,
                    ref_type: e.ref_type || null,
                    ref_id: e.ref_id || null,
                    planState: e._planState || null, // 'new' | 'edited' | null (plan mode)
                    conflict: e._conflict || false,  // designer: overlaps another plotted block
                    source: e,
                });
            }
        }

        // 2) Tasks — plotted on their due_date's local day. A non-midnight time renders the task
        // on the time grid; midnight = all-day (date-level deadline).
        for (const t of tasks) {
            if (!t.due_date) continue;
            const day = localDayOf(t.due_date);
            const due = new Date(t.due_date);
            const mins = due.getHours() * 60 + due.getMinutes();
            push(day, {
                key: `task-${t.id}`,
                kind: 'task',
                id: t.id,
                title: t.title,
                day,
                done: !!t.is_completed,
                color: null,
                // due_all_day is authoritative where it exists; midnight is the
                // older signal, kept for rows written before the flag existed.
                time: (t.due_all_day || mins === 0) ? null : timeOf(t.due_date),
                all_day: t.due_all_day === true || mins === 0,
                planState: t._planState || null,
                source: t,
            });
        }

        // 3) Recurring daily tasks — expanded into virtual per-day instances across the range.
        const recurring = dailyTasks
            .map(dt => ({ dt, rule: parseRecurrence(dt.recurrence) }))
            .filter(x => x.rule);
        if (recurring.length) {
            for (let d = parseISODate(fromISO); isoDate(d) <= toISO; d = addDays(d, 1)) {
                const dayISO = isoDate(d);
                for (const { dt, rule } of recurring) {
                    if (!recurrenceMatches(rule, d)) continue;
                    push(dayISO, {
                        key: `daily-${dt.id}-${dayISO}`,
                        kind: 'daily',
                        id: dt.id,
                        title: dt.title,
                        day: dayISO,
                        done: completedSet.has(`${dt.id}|${dayISO}`),
                        color: null,
                        time: dt.time || null,
                        all_day: !dt.time,
                        source: dt,
                    });
                }
            }
        }

        // Stable order within a day: all-day/daily first, then timed, then by title.
        for (const list of map.values()) {
            list.sort((a, b) => {
                const at = a.time || '', bt = b.time || '';
                if (at !== bt) return at < bt ? -1 : 1;
                return a.title.localeCompare(b.title);
            });
        }

        return map;
    }, [events, tasks, dailyTasks, completedSet, range]);

    // Ephemeral (one-off) dailies, kept SEPARATE from eventsByDate so Week/Month can show just a
    // badge while Day renders them. Plotted on their created day (they have no date; "today"-ish).
    const ephemeralByDate = useMemo(() => {
        const map = new Map();
        if (!range?.from || !range?.to) return map;
        const fromISO = isoDate(range.from), toISO = isoDate(range.to);
        for (const dt of ephemeralDailies) {
            const day = localDayOf(dt.created_at);
            if (day < fromISO || day > toISO) continue;
            if (!map.has(day)) map.set(day, []);
            map.get(day).push({
                key: `eph-${dt.id}`,
                kind: 'daily',
                ephemeral: true,
                id: dt.id,
                title: dt.title,
                day,
                done: !!dt.is_completed,
                color: null,
                time: dt.time || null,
                all_day: !dt.time,
                planState: dt._planState || null,
                source: dt,
            });
        }
        return map;
    }, [ephemeralDailies, range]);

    const itemsAt = useCallback((dayISO) => eventsByDate.get(dayISO) || [], [eventsByDate]);
    const ephemeralAt = useCallback((dayISO) => ephemeralByDate.get(dayISO) || [], [ephemeralByDate]);

    // Move an item to a new local day, optionally to a new time-of-day (`newTime` 'HH:MM',
    // supplied by time-grid drags). Blocks rewrite start/end (duration preserved); tasks
    // rewrite due_date; daily/recurring can't retime (returns false).
    const retime = useCallback((item, newDayISO, newTime = null) => {
        if (!item || !newDayISO) return false;

        // The drop target decides all-day vs timed:
        //   newTime === null      → dropped on the all-day strip → make all-day
        //   newTime === undefined → month drop → keep current all-day/time
        //   newTime === 'HH:MM'   → dropped on a time slot → make timed at that time
        if (item.kind === 'event') {
            const e = item.source;
            const oldStart = new Date(e.start_at);
            let targetAllDay, time;
            if (newTime === null) { targetAllDay = true; time = null; }
            else if (newTime === undefined) { targetAllDay = e.all_day; time = e.all_day ? null : timeOf(e.start_at); }
            else { targetAllDay = false; time = newTime; }

            const newStartISO = toISOFromParts(newDayISO, time);
            if (!newStartISO) return false;
            // No-op guard: same start AND same all-day-ness → don't hit the backend.
            if (new Date(newStartISO).getTime() === oldStart.getTime() && targetAllDay === e.all_day) return false;

            let newEndISO = null;
            if (!targetAllDay && e.end_at) {
                const durationMs = new Date(e.end_at).getTime() - oldStart.getTime();
                newEndISO = new Date(new Date(newStartISO).getTime() + durationMs).toISOString();
            }
            updateEvent?.(e.id, { start_at: newStartISO, end_at: newEndISO, all_day: targetAllDay });
            return true;
        }

        if (item.kind === 'task') {
            const due = item.source.due_date ? new Date(item.source.due_date) : null;
            const existingMins = due ? due.getHours() * 60 + due.getMinutes() : 0;
            let time;
            if (newTime === null) time = null;
            else if (newTime === undefined) time = existingMins ? timeOf(item.source.due_date) : null;
            else time = newTime;
            // No-op guard: same day AND same time-of-day → skip.
            const newMins = time ? (() => { const [h, m] = time.split(':').map(Number); return h * 60 + (m || 0); })() : 0;
            const oldDay = due ? localDayOf(item.source.due_date) : null;
            if (oldDay === newDayISO && existingMins === newMins) return false;
            // Dropping a task onto a time slot gives it a time; dropping it in the
            // all-day row takes it away. Without this the flag and the timestamp
            // drift apart and the alarm rings at the wrong hour.
            updateTask?.(item.source.id, { due_date: taskDueStamp(newDayISO, time), due_all_day: !time });
            return true;
        }

        // daily / recurring — date is governed by the recurrence rule, not draggable.
        return false;
    }, [updateEvent, updateTask]);

    return { eventsByDate, itemsAt, ephemeralAt, retime };
}
