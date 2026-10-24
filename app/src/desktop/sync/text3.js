// Three-way merge for a note body. Pure, line-based, no dependencies.
//
// The case it exists for: you are typing in a note while something else — the
// CLI, an AI through `siddran mcp`, a text editor — changes the same file. Both
// sides started from `base`; we want both sides' edits, not whichever saved last.
//
// Line granularity is the deliberate trade. Edits to different lines (the usual
// case: you write at the top, the AI appends a section) merge cleanly. Edits to
// the SAME lines are a real conflict, and `ours` wins them — `ours` is the person
// at the keyboard, whose text is on screen and who would see it vanish. The
// caller gets `conflict: true` so it can say so rather than drop theirs silently.

// Longest-common-subsequence diff of two line arrays, as hunks over `a`:
// { start, end, lines } = "replace a[start, end) with lines". Common prefix and
// suffix are trimmed first — edits are nearly always local, so the quadratic part
// only ever sees the few lines that actually changed.
export function diffLines(a, b) {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf)
  if (!A.length && !B.length) return []
  // Past this size a full table costs more than it is worth; one replace hunk is
  // still a correct diff, just a coarser one.
  if (!A.length || !B.length || A.length * B.length > 4e6) return [{ start: pre, end: pre + A.length, lines: B }]

  const n = A.length, m = B.length, w = m + 1
  const L = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
  }
  const hunks = []
  let i = 0, j = 0, cur = null
  const flush = () => { if (cur) { hunks.push(cur); cur = null } }
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; continue }
    if (!cur) cur = { start: pre + i, end: pre + i, lines: [] }
    if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) { cur.lines.push(B[j]); j++ }
    else { cur.end = pre + i + 1; i++ }
  }
  flush()
  return hunks
}

const sameLines = (x, y) => x.length === y.length && x.every((v, k) => v === y[k])

export function merge3(base, ours, theirs) {
  if (ours === theirs) return { text: ours, conflict: false }
  if (ours === base) return { text: theirs, conflict: false }
  if (theirs === base) return { text: ours, conflict: false }

  const b = base.split('\n')
  const ho = diffLines(b, ours.split('\n')).map((h) => ({ ...h, side: 'o' }))
  const ht = diffLines(b, theirs.split('\n')).map((h) => ({ ...h, side: 't' }))
  const all = [...ho, ...ht].sort((x, y) => x.start - y.start || x.end - y.end)

  // Group hunks that cover the same base lines. Two pure insertions at the same
  // spot overlap too — the order between them would be a guess. Hunks that merely
  // touch (you edit line 5, the AI inserts after it) do not: both apply.
  const groups = []
  for (const h of all) {
    const g = groups[groups.length - 1]
    if (g && (h.start < g.end || (h.start === h.end && g.start === g.end && h.start === g.start))) {
      g.end = Math.max(g.end, h.end); g.hunks.push(h)
    } else groups.push({ start: h.start, end: h.end, hunks: [h] })
  }

  const out = []
  let pos = 0, conflict = false
  for (const g of groups) {
    out.push(...b.slice(pos, g.start))
    const sides = new Set(g.hunks.map((h) => h.side))
    if (sides.size === 1) {
      // One side only (possibly several adjacent hunks): apply them in order.
      let p = g.start
      for (const h of g.hunks) { out.push(...b.slice(p, h.start), ...h.lines); p = h.end }
      out.push(...b.slice(p, g.end))
    } else {
      // Both sides touched this region. Rebuild each side's version of it.
      const render = (side) => {
        const r = []; let p = g.start
        for (const h of g.hunks.filter((x) => x.side === side)) { r.push(...b.slice(p, h.start), ...h.lines); p = h.end }
        r.push(...b.slice(p, g.end)); return r
      }
      const o = render('o'), t = render('t')
      if (!sameLines(o, t)) conflict = true
      out.push(...o)
    }
    pos = g.end
  }
  out.push(...b.slice(pos))
  return { text: out.join('\n'), conflict }
}
