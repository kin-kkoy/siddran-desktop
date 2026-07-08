// Single source of truth for parsing the inside of a `[[ … ]]` wikilink, shared by
// the editor (cm/wikilinks.js live preview) and the reading view (remarkWikilinks).
// Keeping one parser means a `[[task:id|alias]]` link can't classify differently in
// the two views. Pure (no CodeMirror/remark deps) so either side can import it.
//
//   [[Note Title]]            → { kind:'note', target:'Note Title', ... }
//   [[Note#heading]]          → target is the part before '#'
//   [[task:42|Do it]]         → { kind:'task', id:'42', label:'Do it', ... }
//   [[sandbox:7]] / [[bundle:3]] likewise.
//
// Returns: { kind, id?, target?, label, pipe, head }
//   pipe  = index of '|' in `inner` (-1 if none) — the editor uses it to hide `head|`
//   head  = the part before the '|' (trimmed) — the reading view falls back to it for
//           a typed link's display text when there's no alias.
export function parseTypedLink(inner) {
  const pipe = inner.indexOf('|')
  const head = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
  const label = pipe >= 0 ? inner.slice(pipe + 1).trim() : ''
  const typed = /^(task|sandbox|bundle):(.+)$/i.exec(head)
  if (typed) return { kind: typed[1].toLowerCase(), id: typed[2].trim(), label, pipe, head }
  return { kind: 'note', target: head.split('#')[0].trim(), label, pipe, head }
}
