import { visit, SKIP } from 'unist-util-visit'

// `#tag` (at start or after whitespace, starting with a letter) → a custom
// `hashtag` mdast node carrying the tag name. Rendered as a clickable pill.
const RE = /(^|\s)(#[A-Za-z][\w/-]*)/g

export function remarkHashtag() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value
      const matches = [...value.matchAll(RE)]
      if (matches.length === 0) return
      const out = []
      let cursor = 0
      for (const m of matches) {
        const lead = m[1]
        const token = m[2] // includes the leading '#'
        const start = m.index + lead.length
        const end = start + token.length
        if (start > cursor) out.push({ type: 'text', value: value.slice(cursor, start) })
        out.push({ type: 'hashtag', tag: token.slice(1), children: [{ type: 'text', value: token }] })
        cursor = end
      }
      if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) })
      parent.children.splice(index, 1, ...out)
      return [SKIP, index + out.length]
    })
  }
}
