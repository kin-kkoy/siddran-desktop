import { visit, SKIP } from 'unist-util-visit'

// `==text==` → a custom `highlight` mdast node (rendered as <mark> by the
// markdownToHtml handler). Text-regex transformer, mirroring remarkSpoiler's
// legacy pass.
// Tight delimiters (non-space just inside each `==`) so prose like `a == b == c`
// isn't mis-highlighted; matches the editor's Lezer Highlight rule.
const RE = /==(?=\S)([^=]+?)(?<=\S)==/g

export function remarkHighlight() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      const matches = [...value.matchAll(RE)]
      if (matches.length === 0) return
      const out = []
      let cursor = 0
      for (const m of matches) {
        const start = m.index
        const end = start + m[0].length
        if (start > cursor) out.push({ type: 'text', value: value.slice(cursor, start) })
        out.push({ type: 'highlight', children: [{ type: 'text', value: m[1] }] })
        cursor = end
      }
      if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
