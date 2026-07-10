// Shared inline-formatting helpers for the note editor. Used by both the dock
// buttons (EditorDock.jsx) and the keyboard shortcuts (formattingKeymap below),
// so the two stay in lockstep — a button and its shortcut wrap identically.

// Wrap the current selection with `before`/`after` markers and re-select the
// inner text so the user can keep typing over it (or toggle again). With an empty
// selection it inserts the markers and drops the caret between them.
export function wrapSelection(view, before, after = before) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: to + before.length },
  })
  view.focus()
}

// Ctrl/Cmd shortcuts for the popular inline formats. `Mod` = Ctrl on Linux/Windows,
// Cmd on macOS. Each mirrors the matching dock button:
//   Bold **  ·  Italic *  ·  Underline <u></u>  ·  Hidden/Spoiler ||  ·  Highlight ==
// These are inert in read mode (the editor is EditorState.readOnly there).
export const formattingKeymap = [
  { key: 'Mod-b', run: (v) => { wrapSelection(v, '**'); return true } },
  { key: 'Mod-i', run: (v) => { wrapSelection(v, '*'); return true } },
  { key: 'Mod-u', run: (v) => { wrapSelection(v, '<u>', '</u>'); return true } },
  { key: 'Mod-h', run: (v) => { wrapSelection(v, '||'); return true } },
  { key: 'Mod-=', run: (v) => { wrapSelection(v, '=='); return true } },
]
