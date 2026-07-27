// Tiny subsequence fuzzy matcher for the command palette. Pure and dependency-free
// so it can be unit-tested. Not a full fzf — just enough ranking to feel right on a
// list of a few dozen commands.
//
// A query matches a string if its characters appear in order (not necessarily
// adjacent). Score rewards (i.e. lowers): earlier matches, contiguous runs, and
// word-boundary hits (start of string, or after a space / ':' / '-'). Lower is
// better, and a score CAN go negative — a strong match should out-rank a weak one,
// so we must not clamp. `null` (not a number) is the "no match" sentinel.

const isBoundary = (ch) => ch === ' ' || ch === ':' || ch === '-' || ch === '/'

// Returns a numeric score (lower is better; may be negative) or null if `query` is
// not a subsequence of `text`.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let ti = 0
  let score = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) { found = j; break }
    }
    if (found === -1) return null
    score += found                              // earlier is better
    if (found === prevMatch + 1) score -= 3     // contiguous run bonus
    if (found === 0 || isBoundary(t[found - 1])) score -= 4 // word-boundary bonus
    prevMatch = found
    ti = found + 1
  }
  return score
}

/**
 * Rank commands by how well `query` matches their title (and keywords, at a penalty).
 * @param {string} query
 * @param {Array<{title:string, keywords?:string}>} commands
 * @returns {Array} the matching commands, best first; original order preserved for ties.
 */
export function rankCommands(query, commands) {
  if (!query.trim()) return commands
  const scored = []
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i]
    const titleScore = fuzzyScore(query, c.title)
    // keywords are a fallback match, ranked worse than any title match
    const kwScore = c.keywords ? fuzzyScore(query, c.keywords) : null
    let score = null
    if (titleScore !== null) score = titleScore
    else if (kwScore !== null) score = kwScore + 1000 // always worse than any title hit
    if (score !== null) scored.push({ c, score, i })
  }
  scored.sort((a, b) => (a.score - b.score) || (a.i - b.i))
  return scored.map((s) => s.c)
}
