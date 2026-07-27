// Tests the caret-reveal DECISION logic (which tables become widgets, and where the
// replace range lands). The DOM rendering (renderTableDOM/toDOM) can't run here —
// the test env has no `document` — so it's exercised in the running app, not unit
// tests. What matters most for correctness (when to reveal source) is covered here.
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { buildTableDeco, liveTables } from './tables.js'

const mk = (doc, anchor = 0) => EditorState.create({
  doc,
  selection: { anchor },
  extensions: [markdown({ base: markdownLanguage, codeLanguages: languages })],
})

// Collect the [from,to] ranges the field would replace with a table widget.
function replacedRanges(state) {
  const out = []
  buildTableDeco(state).between(0, state.doc.length, (from, to) => { out.push([from, to]) })
  return out
}

const DOC = [
  'intro line',        // 0
  '',                  // 1
  '| A | B |',         // 2  ← table starts
  '| --- | --- |',     // 3
  '| 1 | 2 |',         // 4  ← table ends
  '',                  // 5
  'after line',        // 6
].join('\n')

const tableStart = DOC.indexOf('| A')
const tableEnd = DOC.indexOf('| 1 | 2 |') + '| 1 | 2 |'.length
const afterPos = DOC.indexOf('after line')

describe('buildTableDeco — caret reveal', () => {
  it('renders the table (one replace) when the caret is elsewhere', () => {
    const ranges = replacedRanges(mk(DOC, 0)) // caret on "intro line"
    expect(ranges).toHaveLength(1)
  })

  it('replace range covers whole table lines', () => {
    const [[from, to]] = replacedRanges(mk(DOC, 0))
    const state = mk(DOC, 0)
    expect(from).toBe(state.doc.lineAt(tableStart).from)
    expect(to).toBe(state.doc.lineAt(tableEnd).to)
  })

  it('reveals source (no replace) when the caret is inside the table', () => {
    const inside = DOC.indexOf('| --- ') + 2
    expect(replacedRanges(mk(DOC, inside))).toHaveLength(0)
  })

  it('reveals source when the caret is on the first table line', () => {
    expect(replacedRanges(mk(DOC, tableStart + 1))).toHaveLength(0)
  })

  it('reveals source when the caret is on the last table line', () => {
    expect(replacedRanges(mk(DOC, tableEnd - 1))).toHaveLength(0)
  })

  it('still renders when the caret is on an adjacent non-table line', () => {
    expect(replacedRanges(mk(DOC, afterPos))).toHaveLength(1)
  })

  it('renders when a selection is entirely outside the table', () => {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0, head: 5 }, // within "intro line"
      extensions: [markdown({ base: markdownLanguage, codeLanguages: languages })],
    })
    expect(replacedRanges(state)).toHaveLength(1)
  })

  it('reveals source when a selection overlaps the table', () => {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0, head: tableStart + 3 }, // spans intro into the table
      extensions: [markdown({ base: markdownLanguage, codeLanguages: languages })],
    })
    expect(replacedRanges(state)).toHaveLength(0)
  })

  it('handles two tables independently', () => {
    const twoDoc = DOC + '\n\n| C | D |\n| --- | --- |\n| 9 | 8 |\n'
    // caret on the intro line: BOTH tables render
    expect(replacedRanges(mk(twoDoc, 0))).toHaveLength(2)
    // caret inside the first table: only the second renders
    const insideFirst = twoDoc.indexOf('| --- | --- |') + 2
    expect(replacedRanges(mk(twoDoc, insideFirst))).toHaveLength(1)
  })

  it('produces nothing for a doc with no tables', () => {
    expect(replacedRanges(mk('just some\nplain text', 0))).toHaveLength(0)
  })
})

// The perf optimization prunes whole subtrees (paragraphs, code, headings) during
// the scan. These guard that pruning never hides a real table sitting next to one
// of those pruned blocks.
describe('buildTableDeco — pruning does not lose tables', () => {
  it('finds a table after paragraphs (Paragraph subtree is pruned)', () => {
    const doc = 'a paragraph with **bold** and a [link](x)\n\nmore prose here\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(replacedRanges(mk(doc, 0))).toHaveLength(1)
  })

  it('finds a table after a fenced code block (FencedCode is pruned)', () => {
    const doc = '```js\nconst x = 1\n| not | a | table |\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    // caret at 0 (on the code fence's first line, not the table)
    expect(replacedRanges(mk(doc, 0))).toHaveLength(1)
  })

  it('finds a table after a heading (ATXHeading is pruned)', () => {
    const doc = '# A heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(replacedRanges(mk(doc, 0))).toHaveLength(1)
  })

  it('finds tables both before and after a big prose block', () => {
    const prose = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} with some **words** here.`).join('\n\n')
    const doc = `| A | B |\n| --- | --- |\n| 1 | 2 |\n\n${prose}\n\n| C | D |\n| --- | --- |\n| 3 | 4 |`
    expect(replacedRanges(mk(doc, prose.indexOf('number 20')))).toHaveLength(2)
  })
})

// Exercises the actual StateField update() path — the caching optimization — rather
// than buildTableDeco directly. A selection change must update the reveal decision
// while reusing the cached table ranges (no re-walk).
describe('liveTables field — caret move via update() reuses cache correctly', () => {
  const withField = (doc, anchor = 0) => EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages }), liveTables],
  })
  const decoCount = (state) => {
    let n = 0
    state.field(liveTables).deco.between(0, state.doc.length, () => { n++ })
    return n
  }

  it('caret outside → rendered; move into the table → source revealed', () => {
    const inside = DOC.indexOf('| --- ') + 2
    let state = withField(DOC, 0)
    expect(decoCount(state)).toBe(1)                 // rendered
    state = state.update({ selection: { anchor: inside } }).state
    expect(decoCount(state)).toBe(0)                 // revealed for editing
  })

  it('caret inside → move back out → re-renders', () => {
    const inside = DOC.indexOf('| --- ') + 2
    let state = withField(DOC, inside)
    expect(decoCount(state)).toBe(0)
    state = state.update({ selection: { anchor: 0 } }).state
    expect(decoCount(state)).toBe(1)
  })

  it('caches table ranges across a selection change (structure only re-walked on edits)', () => {
    let state = withField(DOC, 0)
    const before = state.field(liveTables).tables
    state = state.update({ selection: { anchor: DOC.indexOf('after line') } }).state
    const after = state.field(liveTables).tables
    expect(after).toBe(before) // same array reference → not re-scanned
  })

  it('re-walks on an edit that adds a table', () => {
    let state = withField('no tables here\n', 0)
    expect(decoCount(state)).toBe(0)
    const table = '\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    state = state.update({ changes: { from: state.doc.length, insert: table } }).state
    // caret still at 0 (outside the new table) → it renders
    expect(decoCount(state)).toBe(1)
  })
})
