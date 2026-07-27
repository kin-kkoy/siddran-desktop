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

// Toggle a line-start prefix (list marker, checkbox, blockquote) on the caret's line.
export function toggleLinePrefix(view, prefix) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  if (line.text.startsWith(prefix)) {
    view.dispatch({ changes: { from: line.from, to: line.from + prefix.length, insert: '' } })
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } })
  }
  view.focus()
}

// Cycle the caret line's heading level: none → # → ## → … → ###### → none.
export function cycleHeading(view) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const m = /^(#{1,6})\s/.exec(line.text)
  if (!m) {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: '# ' } })
  } else if (m[1].length >= 6) {
    view.dispatch({ changes: { from: line.from, to: line.from + m[0].length, insert: '' } })
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from + m[1].length, insert: m[1] + '#' } })
  }
  view.focus()
}

// Insert a horizontal rule on a fresh line after the caret line.
export function insertHR(view) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const insert = (line.text.length ? '\n' : '') + '---\n'
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } })
  view.focus()
}

// Insert a [text](url) link, selecting the placeholder so it can be typed over.
export function insertLink(view) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const insert = `[${selected || 'text'}](url)`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + 1, head: from + 1 + (selected.length || 4) },
  })
  view.focus()
}

// Open a [[wikilink at the caret. `prefix` scopes it: '' note, 'task:', 'sandbox:'.
export function insertWikilink(view, prefix = '') {
  const pos = view.state.selection.main.head
  const insert = `[[${prefix}`
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
  })
  view.focus()
}

// Insert a starter GFM table on fresh lines after the caret line, selecting the
// first header cell so the user can type straight over it. The live-preview table
// widget (once built) renders this the moment the caret leaves the block.
export function insertTable(view) {
  const { from } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const lead = line.text.length ? '\n' : ''
  const table = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n'
  const insert = lead + table
  // caret onto "Column 1" (select it): after lead + '| '
  const cellStart = line.to + lead.length + 2
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: cellStart, head: cellStart + 'Column 1'.length },
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
