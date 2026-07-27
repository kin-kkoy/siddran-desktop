// Minimal inline-markdown renderer for live-preview table cells (Phase 2). Parses a
// bounded set of inline marks and builds DOM nodes — never innerHTML, so cell content
// can't inject markup (XSS-safe by construction).
//
// The parse is a pure function (unit-tested); the DOM build is a thin walk over it.
// Nesting works (bold inside a link text, italic inside bold, …) via recursion.
// Scope: bold, italic, inline code, strikethrough, highlight, underline, and links.
// Not handled (shows as raw source): wikilinks, images, spoilers — a known P2 limit.

// Ordered longest-delimiter-first so `**` beats `*` and `__` beats `_` at the same spot.
const RULES = [
  { type: 'br', re: /<br\s*\/?>/i },
  { type: 'code', re: /`([^`]+)`/ },
  { type: 'link', re: /\[([^\]]+)\]\(([^)]+)\)/ },
  { type: 'strong', re: /\*\*([^*]+)\*\*/ },
  { type: 'strong', re: /__([^_]+)__/ },
  { type: 'del', re: /~~([^~]+)~~/ },
  { type: 'mark', re: /==([^=]+)==/ },
  { type: 'u', re: /<u>([\s\S]+?)<\/u>/ },
  { type: 'em', re: /\*([^*]+)\*/ },
  { type: 'em', re: /_([^_]+)_/ },
]

// Parse inline markdown into a node tree:
//   {type:'text', value} | {type:'code', value} | {type:'link', href, text}
//   | {type:'strong'|'em'|'del'|'mark'|'u', children}
export function parseInline(input) {
  const out = []
  let rest = String(input)
  while (rest.length) {
    let best = null
    for (const rule of RULES) {
      const m = rule.re.exec(rest)
      if (m && (best === null || m.index < best.m.index)) best = { rule, m }
    }
    if (!best) { out.push({ type: 'text', value: rest }); break }
    const { rule, m } = best
    if (m.index > 0) out.push({ type: 'text', value: rest.slice(0, m.index) })
    if (rule.type === 'code') out.push({ type: 'code', value: m[1] })
    else if (rule.type === 'link') out.push({ type: 'link', href: m[2], text: m[1] })
    else if (rule.type === 'br') out.push({ type: 'br' }) // void element, no content
    else out.push({ type: rule.type, children: parseInline(m[1]) }) // recurse for nesting
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

function appendNodes(parent, nodes) {
  for (const n of nodes) {
    if (n.type === 'text') {
      parent.appendChild(document.createTextNode(n.value))
    } else if (n.type === 'br') {
      parent.appendChild(document.createElement('br'))
    } else if (n.type === 'code') {
      const c = document.createElement('code')
      c.textContent = n.value
      parent.appendChild(c)
    } else if (n.type === 'link') {
      // Styled like a link (title shows the target), but NOT a live navigation:
      // clicking a cell reveals the table's markdown source for editing instead.
      // Reading mode renders the functional link.
      const a = document.createElement('a')
      a.className = 'cm-live-link'
      a.textContent = n.text
      a.title = n.href
      parent.appendChild(a)
    } else {
      const el = document.createElement(n.type) // strong | em | del | mark | u
      appendNodes(el, n.children)
      parent.appendChild(el)
    }
  }
}

// Render inline markdown into `parent` (a DOM element). Cell text with no marks
// becomes a single text node.
export function renderInlineInto(parent, text) {
  appendNodes(parent, parseInline(text))
}
