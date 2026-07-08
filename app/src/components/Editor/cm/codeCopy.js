import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { toast } from '../../../utils/toast'

// A "Copy" button on each fenced code block in the editor. The button is an
// inline point-widget anchored to the block's first content line and absolutely
// positioned to the top-right by CSS (.cm-code-copy-btn in theme.js), so it never
// disturbs the code layout. Clicks are handled by a delegated mousedown that
// resolves the button back to its enclosing FencedCode node and copies the code.

class CopyButtonWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-code-copy-btn'
    b.textContent = 'Copy'
    b.setAttribute('contenteditable', 'false')
    b.setAttribute('aria-label', 'Copy code')
    return b
  }
  ignoreEvent() { return false }
}

function buildButtons(view) {
  const widgets = []
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return
        const openLine = doc.lineAt(node.from)
        // Anchor on the first content line (just after the opening fence).
        const pos = Math.min(openLine.to + 1, doc.length)
        widgets.push(Decoration.widget({ widget: new CopyButtonWidget(), side: 1 }).range(pos))
      },
    })
  }
  return Decoration.set(widgets, true)
}

// Extract a fenced block's code (content lines only, fences stripped).
function extractCode(state, node) {
  const doc = state.doc
  const open = doc.lineAt(node.from)
  const marks = node.getChildren('CodeMark')
  const last = marks.length ? marks[marks.length - 1] : null
  const closeLine = last ? doc.lineAt(last.from) : doc.lineAt(node.to)
  const hasClose = marks.length >= 2 && closeLine.number > open.number
  const firstLn = open.number + 1
  const lastLn = hasClose ? closeLine.number - 1 : closeLine.number
  if (lastLn < firstLn) return ''
  return doc.sliceString(doc.line(firstLn).from, doc.line(lastLn).to)
}

export const codeCopy = [
  ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = buildButtons(view) }
      update(u) { if (u.docChanged || u.viewportChanged) this.decorations = buildButtons(u.view) }
    },
    { decorations: v => v.decorations },
  ),
  EditorView.domEventHandlers({
    mousedown: (event, view) => {
      const btn = event.target?.closest?.('.cm-code-copy-btn')
      if (!btn) return false
      event.preventDefault()
      const pos = view.posAtDOM(btn)
      let node = syntaxTree(view.state).resolve(pos, 1)
      while (node && node.name !== 'FencedCode') node = node.parent
      if (!node) return true
      const code = extractCode(view.state, node)
      navigator.clipboard.writeText(code)
        .then(() => toast.success('Code copied'))
        .catch(() => toast.error('Copy failed'))
      return true
    },
  }),
]
