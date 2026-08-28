// Live-preview diagrams. A fenced block tagged `siddran-diagram` is replaced by
// the picture it describes, so a note shows the drawing rather than the JSON
// that encodes it.
//
// Same shape as cm/tables.js, and for the same reasons: block decorations must
// come from a StateField, the widget is an `contentEditable=false` island, and
// the range is atomic so the caret cannot land inside and corrupt the payload.
// It differs from tables in one deliberate way — a table is edited in place,
// cell by cell, but a diagram is edited in an overlay that reuses the Sandbox
// canvas. Nothing about the block is editable here; clicking it opens that.
//
// A block that does not parse is left as ordinary source with no widget, which
// is the escape hatch: whatever went wrong, the text is still there and still
// editable by hand. `tableRender.js` takes the same position.

import { StateField, EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { parseDiagram, DIAGRAM_LANG } from '../../../utils/diagramBlock'
import { diagramToSvg } from '../../../utils/diagramSvg'

// ── scanning ─────────────────────────────────────────────────────────────────

// The info string of a fenced block, lowercased — `siddran-diagram` for ours.
function fenceLang(state, node) {
  const info = node.node.getChild('CodeInfo')
  if (!info) return ''
  return state.doc.sliceString(info.from, info.to).trim().toLowerCase()
}

// Content lines only, fences stripped. Mirrors codeCopy.js's extractCode — an
// unclosed fence at the end of the document has one CodeMark, not two.
function fenceBody(state, node) {
  const doc = state.doc
  const open = doc.lineAt(node.from)
  const marks = node.node.getChildren('CodeMark')
  const last = marks.length ? marks[marks.length - 1] : null
  const closeLine = last ? doc.lineAt(last.from) : doc.lineAt(node.to)
  const hasClose = marks.length >= 2 && closeLine.number > open.number
  const firstLn = open.number + 1
  const lastLn = hasClose ? closeLine.number - 1 : closeLine.number
  if (lastLn < firstLn) return ''
  return doc.sliceString(doc.line(firstLn).from, doc.line(lastLn).to)
}

function scanDiagrams(state) {
  const found = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      if (fenceLang(state, node) !== DIAGRAM_LANG) return
      const body = fenceBody(state, node)
      const doc = parseDiagram(body)
      // Unparseable → no widget, so the raw block stays visible and editable.
      if (!doc) return
      found.push({ from: node.from, to: node.to, body, doc })
      return false
    },
  })
  return found
}

// ── widget ───────────────────────────────────────────────────────────────────

class DiagramWidget extends WidgetType {
  // `from` is part of eq() for the same reason tables.js includes it: an edit
  // above shifts the block, and the widget's own dispatches are relative to it.
  constructor(body, from) { super(); this.body = body; this.from = from }

  eq(other) { return other.body === this.body && other.from === this.from }

  // FALSE, unlike the table widget's. A table attaches its own listeners inside
  // toDOM and wants CM to keep out; this widget is handled by the
  // `domEventHandlers` below, and those never see an event the widget has told
  // CodeMirror to ignore. cm/codeCopy.js's button returns false for the same
  // reason. The click cannot move the caret regardless: the range is atomic, and
  // the handler preventDefaults.
  ignoreEvent() { return false }

  toDOM() {
    const outer = document.createElement('div')
    outer.className = 'cm-diagram-block'
    outer.contentEditable = 'false'
    outer.setAttribute('data-diagram-from', String(this.from))

    const doc = parseDiagram(this.body)
    const svg = doc ? diagramToSvg(doc.items) : null

    if (svg) {
      outer.appendChild(svg)
    } else {
      // Parsed but empty — a diagram that exists and has nothing in it yet.
      // Say so, rather than leaving a blank gap that looks like a bug.
      const empty = document.createElement('div')
      empty.className = 'cm-diagram-empty'
      empty.textContent = 'Empty diagram — click to edit'
      outer.appendChild(empty)
    }

    const hint = document.createElement('div')
    hint.className = 'cm-diagram-hint'
    hint.textContent = 'Click to edit'
    outer.appendChild(hint)

    return outer
  }
}

function decoFrom(blocks) {
  return Decoration.set(
    blocks.map(b => Decoration.replace({
      widget: new DiagramWidget(b.body, b.from),
      block: true,
    }).range(b.from, b.to)),
    true,
  )
}

// ── extension ────────────────────────────────────────────────────────────────

export const liveDiagrams = StateField.define({
  create(state) {
    const blocks = scanDiagrams(state)
    return { blocks, deco: decoFrom(blocks) }
  },
  update(value, tr) {
    // Rendering does not depend on the selection — a diagram never reveals its
    // source when the caret is near it, the way an inline mark does. Only a
    // document change can change anything.
    if (!tr.docChanged) return value
    const blocks = scanDiagrams(tr.state)
    return { blocks, deco: decoFrom(blocks) }
  },
  provide: (f) => [
    EditorView.decorations.from(f, v => v.deco),
    // Atomic so the caret cannot sit inside the replaced range and type into the
    // JSON. Editing is only ever through the overlay.
    EditorView.atomicRanges.of(view => view.state.field(liveDiagrams).deco),
  ],
})

// Click a rendered diagram to edit it. mousedown rather than click so the caret
// never lands first and scrolls the block out from under the pointer.
//
// Built per editor instance rather than read from a module-level singleton:
// split view mounts TWO editors, and a shared config would mean whichever
// mounted last owned every diagram click in both panes.
const clickToEdit = (config) => EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const host = event.target?.closest?.('.cm-diagram-block')
    if (!host) return false
    const from = Number(host.getAttribute('data-diagram-from'))
    const field = view.state.field(liveDiagrams, false)
    const block = field?.blocks.find(b => b.from === from)
    if (!block || !config.onEdit) return false
    event.preventDefault()
    config.onEdit({
      doc: block.doc,
      // Write back by replacing the whole fence. The caller hands us the edited
      // document; it never has to know where the block sits.
      replace: (fence) => {
        const current = view.state.field(liveDiagrams, false)
        // Re-find by body: an edit elsewhere in the note may have moved the block
        // since the overlay opened, so a stale `from` would splice at the wrong
        // place. Matching on the payload is stable across those shifts.
        const live = current?.blocks.find(b => b.body === block.body)
        if (!live) return false
        view.dispatch({ changes: { from: live.from, to: live.to, insert: fence } })
        // Focus matters beyond the caret. The editor persists on blur, on unmount
        // and on a 2-minute interval — for typing that is fine, because you are
        // focused in the editor and a blur always comes. Editing in the overlay
        // took focus away BEFORE the change existed, so without this the edit
        // could sit unsaved until the interval fired. Returning focus restores
        // the ordinary save-on-blur path.
        view.focus()
        return true
      },
    })
    return true
  },
})

// Typing immediately above or below a rendered block would otherwise be pulled
// into the fence by the markdown parser and disappear into the JSON. Redirect a
// pure insertion landing on a diagram's line range to a separated line, exactly
// as tableTypingGuard does for tables.
export const diagramTypingGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  const field = tr.startState.field(liveDiagrams, false)
  if (!field || !field.blocks.length) return tr
  const doc = tr.startState.doc
  const ranges = field.blocks.map(b => ({ from: doc.lineAt(b.from).from, to: doc.lineAt(b.to).to }))

  let redirect = null
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (redirect || fromA !== toA || inserted.length === 0) return // pure insertions only
    const text = inserted.toString()
    for (const r of ranges) {
      if (fromA < r.from || fromA > r.to) continue
      if (fromA <= r.from) redirect = { from: r.from, insert: `${text}\n\n`, caret: r.from + text.length }
      else redirect = { from: r.to, insert: `\n\n${text}`, caret: r.to + 2 + text.length }
      return
    }
  })
  if (!redirect) return tr
  return { changes: { from: redirect.from, insert: redirect.insert }, selection: { anchor: redirect.caret } }
})

export function diagrams(config = {}) {
  return [liveDiagrams, clickToEdit(config), diagramTypingGuard]
}
