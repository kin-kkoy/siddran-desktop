# Plan — Book layout in WRITE mode ("Book · flow")

Status: **not started.** Reading-mode Book view shipped 2026-07-28 (`b1cf301`);
this is the remaining half. Written as a hand-off for a fresh session.

---

## What's wanted

The prototype's **"Book · flow"** typing feel, in the real editor:

- Two pages side by side, fixed height, paged a spread at a time (same as reading).
- You type and the text simply flows on — **no re-pagination churn**: no per-keystroke
  re-measure, no transform rewrite, no page-turn animation while typing.
- The spread moves **only** when the caret would leave the screen, and then instantly.
- The one motion that remains is geometric and accepted by the user: inserting a line
  hops the last line of the left page to the top of the right page.

The user explicitly confirmed this feel (prototype: `references/landscape-view-prototype.html`,
"Book · flow" mode) and wants it in write mode, not just reading.

---

## Why it wasn't done with the reading view

The reading view is plain rendered HTML, so CSS multi-column "just works".
**The editor is CodeMirror 6, which virtualises its viewport**: it renders only the
lines it believes are visible, derived from the scroll position and its internal
height map. Multi-column layout breaks every one of those assumptions:

- CM decides visibility from `scrollTop` vs. line offsets. In a columned layout the
  off-screen columns are *horizontally* displaced, not below the fold — CM thinks they
  aren't visible and doesn't render them, so later columns come out empty on a long note.
- The height map assumes a single vertical flow; column layout invalidates it.
- Caret placement / `posAtCoords` / vertical motion are coordinate-based. This project
  already replaces CM's vertical motion with real DOM hit-testing
  (`cm/verticalMotion.js`), which may actually *help* here — worth checking early.

So this is a design problem, not a CSS tweak.

---

## Approaches to evaluate (in rough order of promise)

### A. Disable virtualisation for book mode
Force CM to render the whole document, then apply columns to `.cm-content`.

- CM6 has no public "render everything" switch, but a very large
  `EditorView.viewportMargin`-style padding, or a custom extension that widens the
  viewport to the whole doc, can approximate it.
- **Pro:** keeps ONE editor — live preview, decorations, tables, comments all keep working.
- **Con:** performance on long notes (the very thing virtualisation exists for). Needs a
  real measurement on the user's biggest note before committing.
- **Check first:** does `.cm-content { column-count: 2; height: <pageH> }` even lay out
  correctly once all lines are rendered? Prototype this in isolation before building.

### B. Paged editor — one CM instance per page
Split the document and give each page its own editor.

- **Con:** almost certainly wrong. Cross-page selection, undo history, decorations that
  span pages, and re-splitting as text grows all become nightmares. Listed for completeness.

### C. Overlay: edit in scroll, present in book
Keep CM scrolling underneath; show a paginated *render* on top; swap to the real editor
around the caret.

- **Con:** two sources of truth for layout; the swap will be visible. Probably worse than A.

### D. Accept reading-only (current state)
Book view stays a reading presentation. The user has already said they want more than
this, so treat it as the fallback, not the plan.

---

## Suggested sequence

1. **Spike A in isolation** — a scratch page with a CM6 instance, virtualisation
   widened, `column-count: 2`, fixed height. Answer two questions: does it lay out, and
   how slow is it on a ~5k-line note?
2. If layout works: wire the paging (reuse the reading view's maths — column gap +
   `clientWidth` = step; `scrollWidth` → total spreads).
3. Port the "no churn" rules from the prototype: don't re-measure or re-transform on
   input; follow the caret only when it leaves the visible spread; no animation while typing.
4. Reuse the existing settings (`noteLayout`, `bookPageHeight`, `bookTurn`) — no new
   settings needed; write mode should honour the same ones.
5. Verify against the interactions this editor already has: live-preview decorations,
   the table widget (atomic, its own block), comments, in-note search, fold persistence,
   and `cm/verticalMotion.js`.

---

## Reference material

- `references/landscape-view-prototype.html` — the agreed feel. Open it, choose
  **Write → Book · flow**. That's the target.
- `app/src/components/Editor/ReadingView.jsx` — shipped reading-mode implementation
  (measuring, paging, fade/instant turn, orphans/widows fix).
- `app/src/components/Editor/ReadingView.module.css` — the `.pages` / `.viewport` /
  `.spine` styling to match.
- Settings keys already in place: `noteLayout` (`scroll` | `book`), `bookPageHeight`,
  `bookTurn` (`fade` | `instant`).

## Decisions already made (don't relitigate)

- Fixed-height pages, text continues mid-sentence across the edge ("Continue" breaks).
  A "Keep whole" option was prototyped and liked as a toggle, but is **not yet ported**
  to the app — reading mode currently always uses Continue.
- Whole-spread paging (1|2 → 3|4), not one page at a time.
- Turn styles: Fade (default) and Instant. A 3D page flip was built, tested, and
  **rejected as distracting** — do not rebuild it.
