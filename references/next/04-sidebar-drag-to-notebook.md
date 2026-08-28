# Drag a note into a notebook from the sidebar

**Done 2026-08-28.** All three open questions answered yes: unfiling works (the loose
notes are their own zone), reordering works but is **scoped to one group** — the
sidebar is an "Everything" view and `reorderNotes` renumbers globally — and collapsed
notebooks open on hover. Needed two new `useDragReorder` options, `ignoreZone` (a
notebook contains the notes it accepts, so its own notes must be able to reorder
inside it) and `scrollContainer` (the hook had no edge-scrolling, as the brief
suspected). Where the note is released tells reorder and re-file apart.

**Area:** Notes · **Size:** medium

## What was seen

> In the Sidebar, I should be able to move/drag a note to be placed in a
> notebook.

## Verified

- The same gesture already exists in NotesHub: dragging a note card onto a
  notebook files it. `pages/Notes/NotesHub.jsx` — look for `fileNote` and the
  `dropSelector` / `onDropZone` options passed to `useDragReorder`.
- `hooks/useDragReorder.js` is pointer-based and already supports drop zones. A
  target only needs `data-drop-zone="<key>"` on it; the hook finds it with
  `elementFromPoint`, so nothing has to stay registered while the list
  re-renders under an in-flight drag.
- Filing is `addNotesToNotebook(notebookId, [noteId])` in `hooks/useNotes.js`.
  Note it **adds without removing** — a note has one `notebook_id`, so moving
  between notebooks needs `removeNoteFromNotebook` first or the old notebook's
  count is wrong. NotesHub's `fileNote` already handles this; read it.
- `components/Layout/Sidebar/SidebarList.jsx` groups notes under their notebook
  and already has both lists in hand.

**Most of this task is wiring, not invention.** The hard parts were solved in
NotesHub; the risk is solving them differently here.

## Not decided

- Whether dragging **out** of a notebook (to unfile) should work too, and what
  the target would be — there is no "Unfiled" row in the sidebar the way there
  is in the hub.
- Whether a note can be dragged to reorder within the sidebar as well, or only
  to re-file. Doing both means telling two gestures apart, which is a real cost.
- Whether dropping onto a **collapsed** notebook should work (it should, but it
  needs a hover-to-expand or it is a target you cannot see the inside of).

## Watch out for

- Do not reach for HTML5 `draggable`. See trap 2 in the README.
- The sidebar scrolls. A drag that needs to reach a notebook currently off
  screen needs edge-scrolling, or the feature only works when everything already
  fits. Check whether `useDragReorder` handles this — it may not.
- Consistency matters more than cleverness here: if the sidebar files notes with
  a different feel from the hub, both will feel wrong.
