import { visit, SKIP } from 'unist-util-visit'
import { parseTypedLink } from './parseWikilink'

// `[[Note]]` / `[[task:id|label]]` / `[[sandbox:id|label]]` / `[[bundle:id|label]]`
// → a custom `wikilink` mdast node carrying its kind + target/id + display label,
// so the reading view renders them as styled (and clickable) links instead of raw
// `[[ … ]]` text. Uses the SAME parser as the editor (shared parseTypedLink).
const RE = /\[\[([^\]\n]+)\]\]/g

// The reading view needs a non-empty display label, so fall back to the head
// (typed link) or the target (note) when there's no explicit `|alias`.
function classify(inner) {
  const info = parseTypedLink(inner)
  if (info.kind === 'note') return { kind: 'note', target: info.target, label: info.label || info.target }
  return { kind: info.kind, id: info.id, label: info.label || info.head }
}

export function remarkWikilinks() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      const matches = [...value.matchAll(RE)]
      if (!matches.length) return
      const out = []
      let cursor = 0
      for (const m of matches) {
        const start = m.index
        const end = start + m[0].length
        if (start > cursor) out.push({ type: 'text', value: value.slice(cursor, start) })
        const info = classify(m[1])
        out.push({ type: 'wikilink', wl: info, children: [{ type: 'text', value: info.label }] })
        cursor = end
      }
      if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
