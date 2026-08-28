# Move focus between panes in split view

**DONE 2026-08-27.** Binding is **Ctrl+1 = left, Ctrl+2 = right** — direct rather
than cycling, because there are only ever two sides, so pressing the same key
twice is idempotent instead of bouncing you back. Ctrl+Alt+←/→ was rejected: most
Linux desktops grab it for workspace switching before the app ever sees it.

"Focus" resolved to **the caret where there is one**. CodeMirror keeps the
selection in the `EditorView`, so `view.focus()` alone returns you to where you
were on that side — no caret bookkeeping was needed. A PDF / HTML / sandbox /
picker pane has no caret, so its container is focused instead and
`onFocusCapture` moves the ring. With one column the handler returns *without*
`preventDefault`, leaving the combo free.

**Known limit, by design:** the binding does not fire from inside a rendered
table cell — `cm/tables.js:146` calls `stopPropagation()` so the cell editor can
own its keys. Not worth fighting.

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
