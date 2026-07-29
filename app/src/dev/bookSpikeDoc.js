// TEMPORARY — spike support. Delete with app/src/dev/ once the book-write-mode
// spike has answered its questions (see references/plan-book-write-mode.md).
//
// Synthetic note generator for the Book-in-write-mode spike. The point of the
// spike is to measure the DECORATION pass under a widened CM6 viewport, so the
// generated text has to exercise the same decoration sources a real note does:
// headings (line decorations), wrapped paragraphs (lineWrapping), nested bullet
// and task lists (BulletWidget / CheckWidget / --nest-pad line decorations),
// tables (liveTables block widgets + collapseTableGap), fenced code (per-line
// classes), wikilinks, and inline marks.
//
// Deterministic: a seeded PRNG means two runs produce byte-identical text, so
// timing numbers are comparable across runs and across mechanism variants.

// Mulberry32 — small, fast, good enough for content shaping. NOT cryptographic.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = (
  'system note editor viewport column layout render measure spread caret anchor ' +
  'decoration widget fragment boundary paragraph heading marker gutter selection ' +
  'document interval threshold cadence surface pipeline snapshot cursor overlay ' +
  'reflow baseline gradient container sequence estimate persistence traversal'
).split(' ')

const TOPICS = [
  'Viewport behaviour', 'Measurement notes', 'Open questions', 'Layout constraints',
  'Decoration cost', 'Caret handling', 'Paging maths', 'Fallback options',
]

function sentence(r, n) {
  const w = []
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)])
  const s = w.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

// A paragraph long enough to wrap several visual lines at a normal page width —
// wrapping is what makes CM's height estimates diverge, so it matters here.
function paragraph(r) {
  const parts = []
  const n = 3 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const s = sentence(r, 8 + Math.floor(r() * 14))
    // Sprinkle inline marks and wikilinks at a realistic-ish density.
    const roll = r()
    if (roll < 0.18) parts.push(s.replace(/^(\w+)/, '**$1**'))
    else if (roll < 0.3) parts.push(s.replace(/^(\w+)/, '*$1*'))
    else if (roll < 0.4) parts.push(s.replace(/^(\w+)/, '`$1`'))
    else if (roll < 0.5) parts.push(s.replace(/^(\w+)/, '==$1=='))
    else if (roll < 0.62) parts.push(`${s} See [[${TOPICS[Math.floor(r() * TOPICS.length)]}]].`)
    else parts.push(s)
  }
  return parts.join(' ')
}

function bulletList(r) {
  const out = []
  const n = 2 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    out.push(`- ${sentence(r, 5 + Math.floor(r() * 8))}`)
    if (r() < 0.4) out.push(`    - ${sentence(r, 4 + Math.floor(r() * 6))}`)
    if (r() < 0.15) out.push(`        - ${sentence(r, 4 + Math.floor(r() * 5))}`)
  }
  return out
}

function taskList(r) {
  const out = []
  const n = 2 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    out.push(`- [${r() < 0.4 ? 'x' : ' '}] ${sentence(r, 5 + Math.floor(r() * 7))}`)
  }
  return out
}

function table(r) {
  const cols = 3 + Math.floor(r() * 2)
  const head = []
  for (let c = 0; c < cols; c++) head.push(WORDS[Math.floor(r() * WORDS.length)])
  const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  const rows = 2 + Math.floor(r() * 4)
  for (let i = 0; i < rows; i++) {
    const cells = []
    for (let c = 0; c < cols; c++) cells.push(WORDS[Math.floor(r() * WORDS.length)])
    out.push(`| ${cells.join(' | ')} |`)
  }
  return out
}

function codeBlock(r) {
  const out = ['```js']
  const n = 3 + Math.floor(r() * 6)
  for (let i = 0; i < n; i++) {
    out.push(`  const ${WORDS[Math.floor(r() * WORDS.length)]} = ${Math.floor(r() * 1000)}`)
  }
  out.push('```')
  return out
}

// Build a markdown note of approximately `targetLines` lines. Blocks are emitted
// whole, so the result lands at or just past the target rather than exactly on it
// — a mid-table truncation would produce text no real note would contain.
export function generateNote(targetLines, seed = 20260728) {
  const r = rng(seed)
  const lines = ['# Book layout spike — synthetic note', '']
  let h2 = 0

  while (lines.length < targetLines) {
    const roll = r()
    if (roll < 0.12) {
      h2 += 1
      lines.push(`## ${TOPICS[h2 % TOPICS.length]} ${h2}`, '')
    } else if (roll < 0.2) {
      lines.push(`### ${sentence(r, 3 + Math.floor(r() * 3)).replace(/\.$/, '')}`, '')
    } else if (roll < 0.55) {
      lines.push(paragraph(r), '')
    } else if (roll < 0.7) {
      lines.push(...bulletList(r), '')
    } else if (roll < 0.78) {
      lines.push(...taskList(r), '')
    } else if (roll < 0.86) {
      lines.push(...table(r), '')
    } else if (roll < 0.93) {
      lines.push(...codeBlock(r), '')
    } else {
      lines.push(`> ${sentence(r, 10 + Math.floor(r() * 10))}`, '')
    }
  }

  return lines.join('\n')
}

// Pick plausible comment anchors spread through the document, so the comment
// StateField and its mark decorations are doing real work during measurement.
// Anchors land on word boundaries inside body text, never inside a fence marker.
export function generateComments(doc, count = 24) {
  const anchors = []
  const len = doc.length
  if (!len) return anchors
  const stride = Math.floor(len / (count + 1))
  if (stride < 40) return anchors
  for (let i = 1; i <= count; i++) {
    const seek = doc.indexOf(' ', i * stride)
    if (seek < 0) break
    const from = seek + 1
    const end = doc.indexOf(' ', from + 12)
    if (end < 0 || end <= from) continue
    // Skip anything straddling a newline — a cross-line anchor is legal but makes
    // the highlight span a block boundary, which isn't representative.
    const slice = doc.slice(from, end)
    if (slice.includes('\n') || slice.includes('`')) continue
    anchors.push({ id: `spike-${i}`, from, to: end, resolved: false })
  }
  return anchors
}
