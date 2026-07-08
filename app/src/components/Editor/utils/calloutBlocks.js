// One shared notion of a "callout block", mirroring the editor's line rule in
// cm/livePreview.js (Blockquote case): a `> [!type]` line starts a fresh callout,
// following `>` lines are its body, and a non-`>` (lazy-continuation) line ends it.
//
// CommonMark on its own would (a) merge two adjacent `> [!type]` blockquotes into
// one and (b) let a lazy non-`>` line get absorbed into the preceding blockquote —
// both happen during parsing, before any remark transformer can intervene. So we
// normalize the SOURCE first: insert a blank line at exactly the boundaries the
// editor splits on, which makes CommonMark's own blockquote parser produce one
// blockquote per callout with no absorbed lazy lines. rehypeCallouts then tags
// each resulting blockquote. Result: editor and reading view segment identically.

const CALLOUT_HEAD = /^\s*>\s*\[!\w+\]/
const QUOTE_LINE = /^\s*>/

// Same segmentation as normalizeCalloutSource (below), but also returns a line map
// so callers can translate a line in the NORMALIZED text back to its line in the
// ORIGINAL source. `map[outputLineIndex] = originalLineIndex` (both 0-based), or -1
// for a blank line we inserted (which has no original line). The reading view needs
// this so it can tag headings/list items with their TRUE editor line number for
// fold persistence — without it, every line below a callout is off by the number of
// inserted blanks. `map` is null on the fast path (no callouts → identity mapping).
export function normalizeCalloutWithMap(md) {
  if (!md || md.indexOf('[!') === -1) return { text: md, map: null } // fast path: no callouts present
  const lines = md.split('\n')
  const out = []
  const map = []
  let inCallout = false // currently inside a callout block?
  const prevBlank = () => out.length === 0 || out[out.length - 1].trim() === ''
  const push = (line, src) => { out.push(line); map.push(src) }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (CALLOUT_HEAD.test(line)) {
      // A head always begins a fresh block: split it from any preceding non-blank
      // line (another callout, a plain quote, or a paragraph) so they don't merge.
      if (!prevBlank()) push('', -1)
      inCallout = true
      push(line, i)
      continue
    }
    if (inCallout) {
      if (QUOTE_LINE.test(line)) {
        push(line, i) // `>` continuation → still this callout's body
        continue
      }
      // Lazy / non-`>` line ends the callout. Force a paragraph break (unless the
      // line is itself blank, which already ends it) so it isn't absorbed.
      if (line.trim() !== '' && !prevBlank()) push('', -1)
      inCallout = false
      push(line, i)
      continue
    }
    push(line, i)
  }
  return { text: out.join('\n'), map }
}

export function normalizeCalloutSource(md) {
  return normalizeCalloutWithMap(md).text
}
