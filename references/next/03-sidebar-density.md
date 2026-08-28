# Tighten the sidebar spacing

**Done 2026-08-28.** All five contributing values reduced (list gap, group margin +
padding, in-group gap, page-block gap + padding, row padding) for about two more rows
per screen. Standalone notes match in-notebook notes — the user chose one density
everywhere. `SidebarOpenNotes.module.css` moved with it. Done alongside
`04-sidebar-drag-to-notebook.md`, since rows are now drag targets too.

**Area:** Notes · **Size:** small

## What was seen

> In the Sidebar, the distance between a notebook to another or a notebook to a
> note or a note to a note, is quite big, shorten the gap.

Three different gaps, and they may not all be the same rule.

## Verified

In `components/Layout/Sidebar/SidebarList.module.css`:

- `:80` `.notebookGroup { margin: 7px 8px }` — notebook to notebook.
- `:88` and `:108` — `gap: 6px` inside a group, and on the notes list.
- `:147` `.notebookNotes { gap: 2px; padding: 4px }` — note to note inside a
  notebook.
- `:51-52` `.noteItem { gap: 8px; padding: 6px 16px }` — the row's own height,
  which is as much of the apparent spacing as the gaps are.

A notebook group also carries a border and its own padding, so the visible
distance between two notebooks is the sum of several values, not one.

## Not decided

- How tight. This is a look, and it is quicker to judge than to describe — do
  one pass, show it, adjust.
- Whether standalone notes (outside any notebook) should match the density of
  notes inside a notebook, or stay looser to keep the two readable as different
  things.

## Watch out for

- Rows are click targets. Going too tight makes them easy to mis-hit,
  particularly since notes in the sidebar will become drag sources if
  `04-sidebar-drag-to-notebook.md` gets built. Keep an eye on both together.
- `SidebarOpenNotes.module.css` is a separate component with its own spacing.
  If both are on screen and only one is tightened it will look like a bug.
