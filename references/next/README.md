# Queued work

Briefs for work that has been asked for but not started. One file per task.
Point a session at a single file — they are independent and none of them
depends on another.

**Read this file first, then only the brief you are working on.**

## How to use these

Each brief has the same shape:

- **What was seen** — the user's own observation, kept as close to their words
  as possible. This is the requirement. If the brief and this section disagree,
  this section wins.
- **Verified** — things confirmed by reading the code, with `file:line`. These
  were true on 2026-08-26 and may have drifted; re-check before relying on one.
- **Not decided** — real choices that need the user's answer, not yours. Ask
  before building past them.
- **Watch out for** — traps specific to this task that cost time to rediscover.

**The briefs deliberately do not prescribe a solution.** They say what is wrong,
what exists, and where to start looking. Explore before designing — the file
pointers are a starting point, not a map, and every one of these touches code
that has more context around it than fits here.

## Ground rules for any change here

Verify every change:

```bash
cd app && npm test && npx eslint . && npm run build
cd ../src-tauri && cargo check     # only if Rust changed
```

`npx eslint .` has a **pre-existing baseline of 25 problems (22 errors, 3
warnings)**. Match it exactly. Do not fix the unrelated ones — they are noise
from before this baseline and touching them makes real regressions invisible.

Test Bag: `~/Documents/Siddran-TestBag`. It has ~35 throwaway notes tagged
`dummy`, plus PDF and HTML attachments that **must not be deleted** — several
features can only be tested against them.

## Three traps that have each cost multiple rounds

1. **Validating or pruning against data that has not loaded.** On the first
   render arrays are `[]`, and `loading` is not usable: `useNotes` sets it false
   while the Bag picker is still up, and `localFetch` resolves fast enough that
   `setLoading(true)`/`(false)` batch into one commit, so `loading` is never
   observed as `true`. Gate on a pagination object (`notesPagination`,
   `notebooksPagination`, `bundlesPagination`) — it only exists after a real
   response. This has silently wiped saved state three separate times.

2. **HTML5 drag-and-drop does not fire in this app.** WebKitGTK swallows `drop`
   whenever Tauri's file-drop is enabled, which is why `hooks/useDragReorder.js`
   is pointer-based. It already supports `glue` (the dragged item follows the
   cursor) and `dropSelector`/`onDropZone` (release onto something that is not
   the list). Reuse it rather than reaching for `draggable`.
   The kanban board in `pages/Tasks/TasksHub.jsx` is the one place that *does*
   use HTML5 drag, and there the rule is: never `setState` and never change
   anything that **reflows** during a drag. Both cancel the drag outright.

3. **Do not let something observe a thing it also causes.** A `ResizeObserver`
   on the NotesHub list — whose height depends on the value it was setting —
   locked the entire window up. Measure the viewport, not the thing being sized.

## Known rough edge, do not re-attempt

WebKitGTK's built-in PDF viewer lays out once and never reflows, so the first
page or two render mis-sized until the window is resized. Four fixes have been
tried and reverted: remounting the iframe takes the whole webview down;
wait-for-stable-width does nothing; nudge-after-load corrupts whichever pages
were mid-raster; removing the sidebar auto-collapse was kept for other reasons
but did not fix it. **It is not a timing problem.** Leave it alone unless you
have a genuinely different angle.

## Where else to look

`TODO.md` at the repo root is the historical progress log — what was built and
when. It is not a queue. These briefs are the queue. If one gets done, tick it
here and add a line to `TODO.md`.

## Done

- `01-pane-cycling.md` — done 2026-08-27.
- `02-split-lock.md` — done 2026-08-27.
- `08-diagrams-in-notes.md` — done 2026-08-28.
- `03-sidebar-density.md` — done 2026-08-28.
- `04-sidebar-drag-to-notebook.md` — done 2026-08-28.
- `05-hide-completed-default.md` — done 2026-08-28.
- `06-external-links.md` — done 2026-08-26.
- `07-reveal-in-file-manager.md` — done 2026-08-26.

## Queued from the 2026-08-28 feature brief

- `08-diagrams-in-notes.md` — **done 2026-08-28**. Kept for the design decisions
  and the code-reading at the top, both of which shaped the build.
- `09-table-calculations.md` — **declined 2026-08-28**, kept for the reasoning
  and for the cheaper alternative it names.
- `10-latex-math.md` — the investigation is DONE and the answer is "not
  implemented at all". Kept because that result is worth not re-deriving.

The single-line calculator from the same brief is built — see `TODO.md`.

Both files are kept, marked done at the top, because each records a decision and a
correction worth not rediscovering. Everything else in this directory is still open.
