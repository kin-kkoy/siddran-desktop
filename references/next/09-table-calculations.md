# Totals for a range of table cells

**Area:** Notes · **Size:** medium · **DECLINED 2026-08-28 — do not build**

> "Let's not implement #3 then." — the user, after reading the analysis below.

Kept because the analysis is the reason it was declined, and because the cheap
80% alternative at the bottom is the thing to reach for if it ever comes back.

## What was seen

> A possible feature would be similar to a spreadsheet: the user selects a range
> of cells/rows, the editor recognizes the numeric values, and the row after the
> selected range could suggest a total.

And, explicitly:

> I'm not sure whether this is desirable or whether it would work well within the
> current note editor. Therefore, do not treat this as a firm implementation
> requirement yet. […] If table calculations are implemented, I think they should
> probably be strictly scoped to tables rather than trying to infer totals from
> arbitrary normal text.

**Do not build this without asking again.** The user asked for the single-line
calculator first (done — see `TODO.md`) and wants to judge that before deciding
whether tables are worth it.

## Verified

- `components/Editor/cm/tableModel.js` already has the whole model layer:
  `parseTable`, `serializeTable`, `setCell`, `insertRow`, `removeRow`,
  `insertColumn`, `removeColumn`, `cellSourceOffset` — with tests in
  `tableModel.test.js`. A column sum is a fold over `parseTable(md)`, not new
  parsing.
- `components/Editor/cm/tables.js` owns the live table widget and its keymap;
  `tableRender.js` builds the rendered DOM. A selection-driven affordance would
  live with them.
- `components/Editor/cm/calc.js` (new, from the single-line feature) already
  exports `evaluateExpression` and `formatResult`. The float-rounding problem is
  solved there — a column of `100.11`s hits exactly the same issue — so a table
  total should reuse `formatResult` rather than re-round.

## Not decided

- **What "selects a range" means here.** The table is a display-only widget
  (`tableRender.js:15` sets `contenteditable="false"`; editing goes through the
  source). There is no cell-selection model today, so this feature needs one
  invented before it can be triggered. That is most of the cost, and it is the
  main reason to be unsure the idea fits.
- Whether the total is **suggested** (consistent with the single-line rule that
  the editor never rewrites the note on its own) or written into the table.
- Whether a total row, once written, stays live when a cell above it changes —
  a formula — or is a one-time value. A live formula is a spreadsheet, which the
  user's own design principle argues against.

## If it ever comes back: the cheap 80%

No selection model at all. Recognise a row whose first cell reads `Total` (or
similar) and offer the column sum as ghost text, reusing `cm/calc.js`'s
`formatResult` and the ghost-text extension that already exists. About a day,
almost no new interaction surface, and it sidesteps the entire reason this was
declined.

## Watch out for

- Alignment markers (`---:`) are part of the model; a total row appended by hand
  must not break `serializeTable`'s round-trip. The tests in `tableModel.test.js`
  are the guard.
- A "column of numbers" is not a safe assumption: currency symbols, blanks, and
  `**215.11**` (bold, as in the user's own example) all appear in real tables.
  Decide what a non-numeric cell does before writing the fold.
