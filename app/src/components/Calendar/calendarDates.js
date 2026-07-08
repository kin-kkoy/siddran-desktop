// Shared date helpers for the Calendar feature. Native Date only (per project convention),
// all local-time — we store UTC in the DB but render against the user's local day. Keep this
// pure (no React) so useCalendar, the views, and the page can all import it.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' for a Date, in LOCAL time (not UTC — toISOString would shift the day near midnight).
export function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// 'YYYY-MM-DD' → Date at LOCAL midnight.
export function parseISODate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Any timestamp (ISO string or Date) → its LOCAL 'YYYY-MM-DD'.
export function localDayOf(ts) {
    return isoDate(new Date(ts));
}

export function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

export function startOfDay(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

export function isSameDay(a, b) {
    return isoDate(a) === isoDate(b);
}

export function isTodayISO(iso) {
    return iso === isoDate(new Date());
}

// First cell of a Monday-start month grid containing `monthDate` (back up to the Monday
// on/just before the 1st). Returns a Date at local midnight.
export function monthGridStart(monthDate) {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // days back to Monday (0=Sun → 6)
    return addDays(first, -offset);
}

// The 42 dates (6 weeks) of a Monday-start month grid.
export function monthGridDays(monthDate) {
    const start = monthGridStart(monthDate);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isWeekday(d) {
    const g = d.getDay();
    return g >= 1 && g <= 5;
}

// Monday (local midnight) of the week containing `d`.
export function mondayOf(d) {
    const r = startOfDay(d);
    const offset = (r.getDay() + 6) % 7;
    return addDays(r, -offset);
}

// The 7 dates of the Monday-start week containing `d`.
export function weekDays(d) {
    const start = mondayOf(d);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// Combine a 'YYYY-MM-DD' day + optional 'HH:MM' into a UTC ISO string (local → UTC).
// Returns null for a missing/invalid day rather than throwing on toISOString.
export function toISOFromParts(dayISO, time) {
    if (!dayISO || !/^\d{4}-\d{2}-\d{2}$/.test(dayISO)) return null;
    const [y, m, d] = dayISO.split('-').map(Number);
    let hh = 0, mm = 0;
    if (time && /^\d{1,2}:\d{2}$/.test(time)) {
        [hh, mm] = time.split(':').map(Number);
    }
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// due_date for a task as a NAIVE LOCAL timestamp 'YYYY-MM-DD HH:MM:SS' (no 'time' → midnight).
// tasks.due_date is `TIMESTAMP` (no time zone): writing a UTC ISO 'Z' string makes node-pg read
// it back shifted by the local offset. A naive local string round-trips to the correct local
// day AND time. Midnight (no time) renders as all-day; any other time renders on the grid.
export function taskDueStamp(dayISO, time) {
    return time ? `${dayISO} ${time}:00` : `${dayISO} 00:00:00`;
}

// 'Fri Jun 13' style label for a 'YYYY-MM-DD' day.
export function dayFullLabel(dayISO) {
    const d = parseISODate(dayISO);
    return `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// 'HH:MM' (local) for a timestamp, for prefilling time inputs.
export function timeOf(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Schedule Designer: repeat each plotted block (an event in a representative week) on every matching
// weekday across the inclusive [fromISO, toISO] range → concrete event payloads. weekday + time-of-day
// are extracted from each block; all-day blocks stamp as all-day.
export function stampWeeklyPattern(blocks, fromISO, toISO, exclude = []) {
    const from = parseISODate(fromISO), to = parseISODate(toISO);
    if (!from || !to || from > to) return [];
    const skip = new Set(exclude); // 'YYYY-MM-DD' dates to skip (holidays / breaks)
    const specs = blocks.map(b => {
        const start = new Date(b.start_at);
        return {
            weekday: start.getDay(),
            startTime: b.all_day ? null : timeOf(b.start_at),
            endTime: (!b.all_day && b.end_at) ? timeOf(b.end_at) : null,
            all_day: !!b.all_day,
            title: b.title,
            color: b.color || null,
        };
    });
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
        const wd = d.getDay(), dayISO = isoDate(d);
        if (skip.has(dayISO)) continue;
        for (const s of specs) {
            if (s.weekday !== wd) continue;
            out.push({
                title: s.title,
                start_at: toISOFromParts(dayISO, s.all_day ? null : s.startTime),
                end_at: s.endTime ? toISOFromParts(dayISO, s.endTime) : null,
                all_day: s.all_day,
                color: s.color,
            });
        }
    }
    return out;
}

// Designer templates: extract the reusable weekly pattern from plotted blocks (weekday + times),
// and rebuild plot blocks from a saved pattern onto the week containing refISO (to re-open & re-stamp).
export function patternFromPlot(blocks) {
    return blocks.map(b => {
        const s = new Date(b.start_at);
        return {
            weekday: s.getDay(),
            startTime: b.all_day ? null : timeOf(b.start_at),
            endTime: (!b.all_day && b.end_at) ? timeOf(b.end_at) : null,
            all_day: !!b.all_day,
            title: b.title,
            color: b.color || null,
        };
    });
}

export function plotFromPattern(pattern, refISO) {
    if (!Array.isArray(pattern)) return [];
    const byWeekday = {};
    for (const d of weekDays(parseISODate(refISO))) byWeekday[d.getDay()] = isoDate(d);
    const week0 = isoDate(mondayOf(parseISODate(refISO)));
    return pattern.map((p, i) => {
        const dayISO = byWeekday[p.weekday] ?? week0;
        return {
            id: `tpl-${i}`,
            title: p.title,
            start_at: toISOFromParts(dayISO, p.all_day ? null : p.startTime),
            end_at: (!p.all_day && p.endTime) ? toISOFromParts(dayISO, p.endTime) : null,
            all_day: !!p.all_day,
            color: p.color || null,
            description: null,
        };
    });
}
