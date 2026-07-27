// Tests the field's decision logic: which tables become rendered widgets. The DOM
// rendering + interactive editing (toDOM, contenteditable cells, +/- controls) can't
// run here (no `document`), so they're exercised in the running app. Tables now render
// ALWAYS (no caret-reveal); a table that doesn't parse is left as source.
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

function widgetRanges(state) {
  const out = []
  buildTableDeco(state).between(0, state.doc.length, (from, to) => { out.push([from, to]) })
  return out
}

const DOC = [
  'intro line', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after line',
].join('\n')
const tableStart = DOC.indexOf('| A')
const tableEnd = DOC.indexOf('| 1 | 2 |') + '| 1 | 2 |'.length

describe('buildTableDeco — always render well-formed tables', () => {
  it('renders one widget over the whole table', () => {
    const [[from, to]] = widgetRanges(mk(DOC, 0))
    const state = mk(DOC, 0)
    expect(from).toBe(state.doc.lineAt(tableStart).from)
    expect(to).toBe(state.doc.lineAt(tableEnd).to)
  })

  it('renders regardless of where the caret is (no reveal)', () => {
    const inside = DOC.indexOf('| --- ') + 2
    expect(widgetRanges(mk(DOC, 0))).toHaveLength(1)        // caret elsewhere
    expect(widgetRanges(mk(DOC, inside))).toHaveLength(1)   // caret "in" the table
    expect(widgetRanges(mk(DOC, tableStart + 1))).toHaveLength(1)
  })

  it('renders two tables independently', () => {
    const doc = DOC + '\n\n| C | D |\n| --- | --- |\n| 9 | 8 |\n'
    expect(widgetRanges(mk(doc, 0))).toHaveLength(2)
  })

  it('leaves a malformed table as source (no widget)', () => {
    // header + a non-delimiter second line — not a valid table
    const doc = '| A | B |\n| x | y |\n| 1 | 2 |'
    expect(widgetRanges(mk(doc, 0))).toHaveLength(0)
  })

  it('produces nothing for a doc with no tables', () => {
    expect(widgetRanges(mk('just some\nplain text', 0))).toHaveLength(0)
  })
})

describe('buildTableDeco — pruning does not lose tables', () => {
  it('finds a table after paragraphs', () => {
    const doc = 'a paragraph with **bold** and a [link](x)\n\nmore prose\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(widgetRanges(mk(doc, 0))).toHaveLength(1)
  })

  it('finds a table after a fenced code block', () => {
    const doc = '```js\nconst x = 1\n| not | a | table |\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(widgetRanges(mk(doc, 0))).toHaveLength(1)
  })

  it('finds a table after a heading', () => {
    expect(widgetRanges(mk('# A heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', 0))).toHaveLength(1)
  })
})

describe('liveTables field — rebuild only on doc change', () => {
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

  it('a selection change does not rebuild (value reused)', () => {
    let state = withField(DOC, 0)
    const before = state.field(liveTables)
    state = state.update({ selection: { anchor: DOC.indexOf('after line') } }).state
    expect(state.field(liveTables)).toBe(before) // same object → no rebuild
    expect(decoCount(state)).toBe(1)
  })

  it('an edit that adds a table rebuilds', () => {
    let state = withField('no tables here\n', 0)
    expect(decoCount(state)).toBe(0)
    state = state.update({ changes: { from: state.doc.length, insert: '\n| A | B |\n| --- | --- |\n| 1 | 2 |\n' } }).state
    expect(decoCount(state)).toBe(1)
  })
})
