// Parse ATX headings (`# … ###### …`) from markdown for the document outline.
// Skips fenced code blocks (``` / ~~~) so a "# comment" inside code isn't listed.
// Returns [{ level, text, line }] with 1-based line numbers (matching CM's
// doc.line(n) and the reading view's data-line attributes).
export function parseHeadings(md) {
  if (!md || typeof md !== 'string') return []
  const lines = md.split('\n')
  const out = []
  let fenceChar = null // null = not in a fence; '`' or '~' = inside one
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const ch = fence[1][0]
      if (fenceChar === null) fenceChar = ch
      else if (ch === fenceChar) fenceChar = null
      continue
    }
    if (fenceChar !== null) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i + 1 })
  }
  return out
}
