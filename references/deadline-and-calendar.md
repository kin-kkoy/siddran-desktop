# Deadline picker & Calendar — status + pending work

_Last updated: 2026-07-09 (Siddran-Desktop)_

This documents two things you asked about:
1. Whether the **Calendar** feature works in the desktop build like it does on the web.
2. Two **task-deadline** improvements (time optional; wider time field).

---

## 1. Calendar — ✅ works exactly like the web version

I traced every endpoint the Calendar's hooks call and confirmed the desktop
local store (`src/desktop/localStore.js`) implements all of them, and that the
data is persisted to disk. So functionally it's the same as the web app — **the
only real difference is there's no server and no cross-device sync** (everything
lives in your Bag folder).

### Endpoints the Calendar uses → all handled locally
| Hook | Endpoint(s) | Local handler |
|---|---|---|
| `useCalendarEvents` | `GET/POST /events`, `PUT/DELETE /events/:id` | `handleEvents` (full CRUD, `from`/`to` range filter) |
| `useSchedules` | `GET/POST /schedules`, `PUT/DELETE /schedules/:id`, `PUT /schedules/:id/restamp` | `handleSchedules` (creates the stamped events via `makeScheduleEvents`, restamp clears + regenerates) |
| `useCalendarTasks` | `GET /tasks?dated=1`, `GET /tasks?undated=1`, `GET/PUT /tasks/:id` | `handleTasks` (`dated`/`undated` query params) |
| `useCalendarDailies` | `GET /daily-tasks?recurring=1`, `GET/POST /daily-tasks/:id/completions`, `GET /daily-tasks/completions` | `handleDailies` (recurring filter + per-day completions) |

### Persistence
- Events + schedules are written to **`<bag>/calendar.siddran`** (JSON) on flush,
  and read back on `hydrate()` when the Bag opens.
- Tasks / dailies / completions live in **`<bag>/tasks.siddran`**.

### What this means
- Month / Week / Day views, Plan mode, the Schedule Designer, drag-scheduling,
  task/daily overlays, and recurrence all work off the local store.

### ⚠️ Two task-overlay sync bugs — found & FIXED (2026-07-09)
The Calendar's **task** overlay used to keep its *own* fetched copy of tasks
(`useCalendarTasks`) separate from the app-wide `useTasks` store. That copy drifted:
1. **A newly-created task never appeared on the calendar** — it went into `useTasks`
   but was never injected into the calendar's separate copy.
2. **Dragging a task from the Unscheduled drawer could leave a duplicate** — the
   drawer→grid schedule appended to the calendar's copy while the shared store had
   its own version, so the task rendered twice (and could pile up).

**Fix:** `useCalendarTasks` now **derives** dated/undated tasks from the shared
`useTasks` store (single source of truth — the same pattern the dailies already
used), and scheduling/retiming/unscheduling go through `updateTask` +
`patchTaskInCache`. Tasks now appear live and can't duplicate. (Any duplicates you
saw were client-side only — they clear on next launch.)

---

## 2. Task deadline — pending / done

### 2a. AM/PM was getting cut off — ✅ FIXED
The old native `datetime-local` field was cramped in the form row, so it clipped
the "M" in "AM/PM". It's been replaced by a custom **`DateTimePicker`**
(`src/components/Common/DateTimePicker.jsx`), and its **time input now sits on its
own full-width row** inside the popup, so AM/PM is never clipped. Used in both the
task **create** form (`AddTaskCard`) and the **edit** modal (`TaskDetailsModal`).

### 2b. Make the TIME optional (blank by default) — ⬜ NOT YET IMPLEMENTED
> Desired: a deadline can be **date-only** (no time), with the time blank by
> default; picking a day should not force a time.

**Current behaviour:** the deadline is always a full date **and** time. When you
pick a day with no time set yet, the picker defaults the time to **09:00**. (The
web app has the same limitation — `datetime-local` always carries a time.)

**Why it's not a one-liner (needs a decision):** `due_date` is stored as a full
ISO **timestamp**, and the Calendar renders tasks by that timestamp. A "date-only"
deadline has to be encoded *somehow* in a timestamp, and the meaning of "no time"
matters:

- **Start of day (00:00)** vs **End of day (23:59)** — a deadline usually means
  "by the end of that day", so **23:59 local** is the sensible default.
- **Timezone** — storing UTC midnight (`new Date("2026-07-10")`) shifts the day in
  non-UTC zones. Any date-only value must be built from **local** parts (like the
  picker already does) and converted with `new Date(local).toISOString()`, not
  parsed from a bare `YYYY-MM-DD`.
- **Round-trip display** — to show "Jul 10" (no time) after reload, we need to
  remember that the time was *unset*, not just that it happens to be 23:59.

**Recommended approach (when you implement it):**
1. In `DateTimePicker`, track a `hasTime` flag. Value stays the
   `YYYY-MM-DDTHH:MM` string, but:
   - **Picking a day** sets the date and leaves time **blank** (`hasTime = false`);
     internally store the time as **`23:59`** so the timestamp = end of that day.
   - **A "＋ Add time" affordance** (or focusing the time input) flips `hasTime`
     on; a small **✕ on the time row** clears it back to date-only.
   - Trigger/label shows **"Jul 10, 2026"** when date-only, **"Jul 10, 2026 · 2:30 PM"**
     when a time is set.
2. To persist the date-only vs timed distinction across reloads without a schema
   change, treat a `23:59` (or `:00`) time as "date-only" for display, **or** add a
   tiny sidecar/flag. Simplest: **treat exactly `23:59` as date-only** for the
   badge — good enough and no storage change. (If you want it exact, add an
   `all_day`-style boolean to the task, mirroring how calendar events already have
   `all_day`.)
3. Nothing downstream changes: `addTask`/`editBody` still do
   `dueDate ? new Date(dueDate).toISOString() : null`, and the Calendar keeps
   reading `due_date`.

**Files to touch:** `src/components/Common/DateTimePicker.jsx` (+ its CSS). No
backend/localStore change needed unless you go with the explicit `all_day` flag.

---

### TL;DR
- **Calendar:** works like web, persisted to `calendar.siddran`, no sync. Nothing to do.
- **AM/PM cut-off:** fixed (new picker, full-width time row).
- **Optional time:** still to build — it's a small UI change but needs the
  "no time ⇒ end of day, remembered as date-only" decision above.
