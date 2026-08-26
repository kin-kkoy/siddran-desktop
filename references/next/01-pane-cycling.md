# Move focus between panes in split view

**Area:** Notes · **Size:** small

## What was seen

> There should be a way or a method for being able move between different
> panes/panels like when I'm in split view. Currently Ctrl+Tab moves across tabs
> in the note editor but I need a different way for moving/cycling between the
> opposite side when I'm in split view.

Ctrl+Tab is taken and works correctly — it cycles note *tabs*. What is missing
is a way to jump focus to the other **side** without reaching for the mouse.

## Verified

- `contexts/NoteSplitContext.jsx:12` already holds `focusedSide` (`'left'` |
  `'right'`), so the state to drive this exists; nothing needs inventing.
- `contexts/NoteTabsContext.jsx` owns the Ctrl+Tab handling. Whatever binding is
  chosen must not collide with it.
- The right column can hold three different things — a split note, a sandbox, or
  an attachment — see `SidePaneContext.jsx` and `SandboxViewContext.jsx`.
  "The other pane" is not always a note.

## Not decided

- **Which binding.** Ctrl+\ and Ctrl+Alt+←/→ are both plausible. Ctrl+1/Ctrl+2
  (jump to a side rather than cycle) is a third option and is arguably better
  than cycling when there are only ever two. Ask.
- **What "focus" means here.** Moving `focusedSide` is not the same as putting
  the caret in that editor. If the right side holds a PDF or an HTML page there
  is no caret at all. Decide whether the binding is "focus the pane" or "focus
  the editor in that pane, if it has one".
- Whether it should do anything when split view is off — probably nothing, but
  silently doing nothing is worth confirming.

## Watch out for

- Whatever is bound must survive being pressed while the caret is inside
  CodeMirror. CM6 takes a lot of keys; check `components/Editor/cm/` for how
  existing bindings get through, rather than binding on `window` and hoping.
