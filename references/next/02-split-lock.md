# A lock for the split / side pane

**Area:** Notes · **Size:** medium

## What was seen

> I also would like to have split views have a "lock" icon, which is off by
> default. An unlocked panel on the right simply persists as I move across
> different tabs. A locked panel will only show the split view or the side panel
> whenever I'm in that note, so as to retain as much context as possible and to
> really fully be "Continue where I left off".

So: **unlocked (default)** is today's behaviour — the right pane follows you
around. **Locked** binds the right pane to the note it was opened from, so it
appears when you are in that note and not otherwise.

## Verified

- `contexts/NoteSplitContext.jsx:10-12` — `enabled`, `splitTarget`,
  `focusedSide`. There is no per-note association today; the pane is global.
- `contexts/SidePaneContext.jsx:21` — `file` is a single `{ path, name }`, also
  global. Locking has to cover **both** contexts or the feature will be half
  there depending on what is in the pane.
- The right column's occupant is already persisted across launches by the
  session-restore work — a locked pane's association will need persisting the
  same way, or the lock is forgotten on quit and "continue where I left off"
  breaks exactly when it matters most.

## Not decided

- **Where the lock lives visually.** Per-pane icon in the pane's own header is
  the obvious answer, but confirm.
- **What happens when you lock, then navigate away, then open a different note
  that also has a locked pane.** Two locked notes are the interesting case.
- **What happens on unlock** — does the pane stay open where you are, or close?
- Whether a locked pane should still be replaceable by opening something else
  while you are in that note (probably yes, and it re-binds).

## Watch out for

- Storage must be **Bag-scoped**. Everything else here is (`sidebarState.js`,
  `sessionRouteCache.js` — copy their key shape). A note id from another Bag is
  meaningless and will silently point at nothing.
- Restoring a pane has bitten before: `SidePaneContext` shows a confirm modal
  when the column is already occupied, and restore must bypass it. There is
  already a path for that — find it before adding a second one.
- Validating a stored note id against `notes` before the notes have loaded will
  drop it every launch. See trap 1 in the README.
