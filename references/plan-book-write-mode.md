# Plan — Book layout in WRITE mode ("Book · flow")

## OUTCOME (2026-07-29) — not shipped; moved to a dev experiment

**Notes ships plain scroll editing. `CodeMirrorEditor.jsx` is byte-identical to
before this work** — nothing paged reached production. Reading-mode Book view
(the two-page spread) is untouched and still ships.

Four designs were built and tried in the real editor:

| Design | Verdict |
|---|---|
| Two-page spread (multicol + full render) | Works, but typing cost scales with document length — ~20ms floor at 5k lines |
| Vertical pages, whole-block breaks | Tables sliced; `bookBreaks: 'continue'` silently ignored |
| Vertical pages + mid-paragraph splits | Correct, but the boundary lurched a beat behind typing |
| Same + incremental repagination | Snappy — but the page/gap model itself was wrong for note-taking |

The last row is the real result: the **performance** problem was solved
(early-exit on unchanged block height, borrowed from LibreOffice Writer's layout
invalidation — see the PIVOT section). What did not work out was the model. Pages
that push text around don't suit a markdown note editor, however fast they are.

**The work now lives in `app/src/dev/`:**
- `/dev/paged-editor` — the real editor stack with word-processor pages layered
  on, for continued experimentation. Engine: `app/src/dev/pagedLayout.js`
  (`SHOW_PAGE_CARDS` / `SHOW_BREAK_RULE` switch between the paper look and a
  dashed boundary rule).
- `/dev/book-spike` — the measurement harness.

Everything below is the record of how it got here. **The measurements are the
valuable part and remain accurate.**

---

Status: **spiked 2026-07-28 — Approach A CONFIRMED VIABLE, not yet built.**
Reading-mode Book view shipped 2026-07-28 (`b1cf301`); this is the remaining
half. Original hand-off below, with measured results folded in.

> **Read [Spike results](#spike-results-2026-07-28) first.** They answer the
> questions this document was written to ask, and correct two of its
> assumptions.

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

### A. Disable virtualisation for book mode — ✅ CHOSEN, measured viable
Force CM to render the whole document, then apply columns to `.cm-content`.

- CM6 has no public "render everything" switch, but a very large
  `EditorView.viewportMargin`-style padding, or a custom extension that widens the
  viewport to the whole doc, can approximate it.
  — **Correction:** there is no `viewportMargin` facet in CM6 at all (that was
  CM5). The only lever is `viewState.printing`. See the spike results.
- **Pro:** keeps ONE editor — live preview, decorations, tables, comments all keep working.
- **Con:** performance on long notes (the very thing virtualisation exists for). Needs a
  real measurement on the user's biggest note before committing.
- **Check first:** does `.cm-content { column-count: 2; height: <pageH> }` even lay out
  correctly once all lines are rendered? Prototype this in isolation before building.
  — **Answered: yes**, but only once `min-height` is defeated and the height is
  set from a stylesheet. Details below.

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
4. Reuse the existing settings (`noteLayout`, `bookPageHeight`, `bookTurn`,
   **`bookBreaks`** — the doc originally omitted this one) — no new settings
   needed; write mode should honour the same ones.
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

## Spike results (2026-07-28)

Measured on Chromium 150 / Linux, page height 620px, via `/dev/book-spike`.
Documents: synthetic 1,500 and 5,000 lines, plus a real 599-line note.

### Q1 — Making CM render everything

There is **no `viewportMargin` facet in CM6**. The only lever is
`viewState.printing` (`@codemirror/view/dist/index.js:6321`), which swaps
`visiblePixelRange` for `fullPixelRange` — and `fullPixelRange` measures
**`contentDOM`'s border box** (`dom = view.contentDOM`, `:6273`).

That creates the central tension: multicol needs a *definite, short* height to
fragment, but a short content box means `printing` reports a one-page viewport.
Three mechanisms were tried:

| Mechanism | Result |
|---|---|
| 1. `printing` alone | **FAIL** — 1% rendered (`0–1652` of `134623`) |
| 2. `printing` + `box-sizing: content-box` + huge `padding-bottom` | **✅ PASS** — 100%, no measure-loop warning |
| 3. `viewState.pixelViewport` override | PASS, but private API |

**Use mechanism 2.** Multicol fragments against the *content* box (the page
height) while `getBoundingClientRect` — and therefore `fullPixelRange` — sees the
*border* box (page height + padding). Pure CSS, **no private API**, so the
maintenance cost originally feared for Approach A does not apply.

### Two CSS traps that will silently break this

Both cost a full debugging round in the spike. Neither is obvious.

1. **`min-height` beats `height`.** CM's base theme sets
   `.cm-content { min-height: 100% }` (`:6785`), which resolves against the
   scroller — and since the editor auto-sizes to content, that is the *whole
   document height*. An explicit `height: 620px` is silently ignored, giving one
   79,310px column. Must set `min-height: 0`, and pin `.cm-editor` /
   `.cm-scroller` so the percentage has no tall basis.
2. **CM clears inline `height` on `.cm-content` every redraw** (`:2986` sets it,
   `:2996` clears it). An inline style survives until the first update, then the
   layout silently reverts. **The page height must come from a stylesheet rule
   with `!important`.**

Also: `.cm-scroller` must stay `overflow: visible`. Overflow columns sit to the
*right* of the scroller box and the transform pages by sliding them in — if the
scroller clips, every spread past the first is blank. Clipping is the outer
viewport's job, exactly as in `ReadingView`.

The fold gutter must be hidden in book mode: CM's base theme makes `.cm-scroller`
a flex row with `.cm-gutters` a sibling of `.cm-content` (`:6774`, `:6892`), so a
single vertical strip cannot track two columns. `livePreview`'s inline chevrons
cover the loss.

### Q2 — Paging maths: ✅ transfers unchanged

`ReadingView`'s formula works verbatim on `.cm-content`:
`clientWidth + columnGap` = one spread's step, `scrollWidth / step` = spread
count. Measured `scrollWidth 80313` vs `clientWidth 1171` → 66 spreads. **No new
paging logic needed.**

### Q4 — Keystroke cost

Timed as dispatch + forced reflow, paced one per frame. (Timing *across* rAF
waits measures the frame clock, not the work — it can never report below 33.3ms.)

| Document | start | middle | end |
|---|---|---|---|
| Real note (599 lines) | **12.8ms** | **8.2ms** | **8.5ms** |
| Synthetic 1,500 | 38.3ms | 29.2ms | 20.4ms |
| Synthetic 5,000 | 129.8ms | 103.5ms | 69.3ms |

Mount cost: 89ms / 217ms / 633ms.

### Cost attribution — the finding that decides the build

Same 5,000-line document, layers removed one at a time:

| Variant | start | end |
|---|---|---|
| A full stack + 2 columns | 124.5ms | 69.8ms |
| B full stack + **1 column** | 121.6ms | 65.3ms |
| C **no decorations** + 2 columns | 20.5ms | 20.6ms |
| D minimal + 2 columns | 13.2ms | 13.5ms |

| Layer | Cost | Share |
|---|---|---|
| **Decoration pass (A−C)** | **104ms** | **84%** |
| Full-render base (D) | 13.2ms | 11% |
| Markdown parsing (C−D) | 7.3ms | 6% |
| Multicol re-layout (A−B) | **2.9ms** | 2% |

**Multi-column layout is essentially free.** The cost is the decoration pass, so
scoping it is the correct mitigation.

Note the gradient: A and B are strongly position-dependent (typing at the start
costs ~2× typing at the end); C and D are flat. **Position-dependence lives
entirely in the decoration layer.** Likely cause: `TableWidget.eq()` in
`cm/tables.js` compares `md` **and** `from`, so an edit near the top shifts every
downstream table's offset and invalidates every table widget in the document.
(Hypothesis from reading the code — fits the shape, not yet separately measured.)

**Mitigation, therefore two things:**
1. Scope `livePreview` **and** `collapseTableGap` to the visible spread rather
   than `view.visibleRanges` — under full render that *is* the whole document.
2. Stop `liveTables` invalidating every widget on an upstream edit.

### The scaling limit — read this before the story

Even with perfect decoration scoping, the floor at 5,000 lines is **C = 20.5ms**:
the irreducible cost of having every line in the DOM. It grows with document
length, and full render is what buys column layout.

A ~100k-word novel is roughly 2,000–5,000 *source* lines once paragraphs wrap, so
it lands near that floor — usable, not silky. Beyond that it degrades. The
structural fix would be rendering a bounded window of spreads, but that conflicts
with multicol, which needs the entire flow to know how many columns exist.
**Chapter-per-note is the practical answer for long-form.**

### Q6 — `scrollIntoView` vs transform paging: ✅ no conflict

`scrollLeft`/`scrollTop` never moved off zero. With `overflow: visible` there is
nothing to scroll, so the transform is uncontested.

### Q5 — Caret across the column break: works, but via the wrong branch

Not a blocker. It does need a code change, and the reason is worth writing down
because it is invisible until you look at `moveVertical` (`cm/verticalMotion.js:36-76`):

```js
let y = forward ? coords.bottom + 1 : coords.top - 1
for (let i = 0; i < 80; i++) {
  const p = pointToPos(view, goalX, y)
  if (p == null) break        // ← walks off the rendered area
  ...
  y += forward ? step : -step
}
```

The walk goes **downward in y**. At the bottom of the left page the next visual
row is at the **top of the right page** — same y, different x — so the walk finds
nothing, breaks, and falls through to the fallback at `:61`: *"same column in the
next document line."*

In a book layout that fallback lands correctly, because the next document line
*is* the visually-next line. So Arrow-Down works — **by luck, through the wrong
branch**. The costs: goal-column tracking (`goalX`) is lost, wrapped lines are
approximated (`tl.from + (head - line.from)`), and it dispatches
`scrollIntoView: true`, which is the last thing wanted against a 1,000,000px
padded element.

**BUILD TASK:** give `moveVertical` a column-aware branch — when the hit-test
walk fails, try the top of the next column at `goalX` before the document-line
fallback. Same for Arrow-Up in reverse (bottom of the previous column).

Note also that hit-testing only resolves **visible** pixels, so any caret logic
must operate on the current spread; positions in off-screen columns cannot be
hit-tested at all.

---

## PIVOT (2026-07-29) — vertical pages, Google-Docs style

The user asked for stacked vertical pages with a real gap between them instead
of the side-by-side spread, for write mode only. **Reading mode keeps the
two-page spread.** This supersedes the two-page write layout below.

### Why it is strictly better

The spread needs multi-column, which is the ONLY reason full render was needed:
multicol displaces later pages horizontally, CM cannot see them, so the whole
document has to be rendered. Vertical pages keep top-to-bottom flow, so:

- CM's virtualisation stays intact — no permanent `printing`, no padding lie
- Typing cost stops scaling with document length (no 20ms floor, no ceiling)
- **Chapter-per-note is no longer required** — the story can be one note
- The fold gutter works again; `moveVertical`'s column-break problem disappears

### Measured: cold estimates are unusable, priming fixes them completely

Page-break positions depend on the height of everything above them, and CM only
*estimates* unrendered lines. Measured error in that estimate: **20–46%**.

| Document | cold: pages est → actual | height error | primed: breaks moved | prime cost |
|---|---|---|---|---|
| Real note (599 lines) | 30 → 44 | 45.9% | **0 / 45** | 200ms |
| Synthetic 1,500 | 81 → 98 | 20.1% | **0 / 97** | 350ms |
| Synthetic 5,000 | 262 → 319 | 21.6% | 1 / 317 | 866ms |

**The fix is a one-off priming pass:** flip `viewState.printing` on, `measure()`,
flip it back off. Every line is measured into the height map; the editor then
returns to normal virtualised rendering with an accurate map. Height error drops
to 0% and breaks stop moving entirely.

So `printing` survives the pivot — but as a **one-shot measurement tool at note
open**, not a permanent mode. That is the whole architectural difference.

### The limitation to design around

CM block widgets attach only **between document lines**. A page can therefore
never break mid-paragraph — and in markdown a paragraph is one soft-wrapped
line, so a tall paragraph moves whole to the next page and leaves the previous
page short.

Consequences:
- **"Keep whole" is effectively mandatory**; `bookBreaks: 'continue'` cannot be
  honoured in write mode (reading mode still can, since it is rendered HTML).
- Page bottoms will be ragged in proportion to paragraph length. Being measured
  before building — see the RAGGEDNESS section in the drift check.

### Implementation sketch

1. **Prime** on entering paged mode / opening a note: `printing = true` →
   `measure()` → `printing = false`. Consider deferring past first paint on
   large notes (866ms at 5k lines is visible).
2. **Compute breaks** by walking line blocks and accumulating height until the
   page height is exceeded; break *before* the offending line. Accumulate
   CONTENT height only (excluding gap spacers) so the calculation cannot feed
   back on itself.
3. **Gap spacers** — block widget decorations of the gap height at each break.
   Must come from a StateField (block decorations that affect vertical layout
   cannot come from a ViewPlugin — same rule `livePreview.js` documents).
   Pattern: ViewPlugin measures → dispatches an effect → StateField holds the
   break set and provides the decorations.
4. **Page cards** — an absolutely positioned layer behind the content drawing a
   bordered surface per page, with the app background showing through the gaps.
5. Reuse `noteLayout`, `bookPageHeight`. `bookTurn` becomes irrelevant in write
   mode (scrolling, not turning).

### Still open

- Sizing the `padding-bottom` to the document rather than a flat 1,000,000px.
  The huge layer is the likely cause of `slow frames 200/200` despite low medians.
- Confirm the `TableWidget.eq()` hypothesis for the position gradient by
  measuring with tables removed specifically (the attribution run removed all
  decorations at once).

---

## Decisions already made (don't relitigate)

- Fixed-height pages, text continues mid-sentence across the edge ("Continue" breaks).
  ~~A "Keep whole" option was prototyped and liked as a toggle, but is **not yet ported**
  to the app — reading mode currently always uses Continue.~~
  **STALE (corrected 2026-07-28):** "Keep whole" *is* shipped in reading mode as
  the `bookBreaks` setting (`'continue' | 'keep'`, `ReadingView.jsx:260`,
  `.keepWhole` in the CSS). Write mode reuses the same key and the same
  `break-inside: avoid` strategy — no new setting.
- Whole-spread paging (1|2 → 3|4), not one page at a time.
- Turn styles: Fade (default) and Instant. A 3D page flip was built, tested, and
  **rejected as distracting** — do not rebuild it.
