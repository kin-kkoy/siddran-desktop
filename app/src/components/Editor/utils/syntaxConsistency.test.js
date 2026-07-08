import { describe, it, expect } from 'vitest'
import { parser as mdParser } from '@lezer/markdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { obsidianSyntax } from '../cm/syntaxNodes'
import { parseTypedLink } from './parseWikilink'
import { remarkHashtag } from './remarkHashtag'
import { remarkHighlight } from './remarkHighlight'
import { remarkSpoiler } from './remarkSpoiler'
import { normalizeCalloutSource, normalizeCalloutWithMap } from './calloutBlocks'

// Drift guard: each inline syntax (hashtag, ==highlight==, ||spoiler||) is defined
// TWICE — once as a CodeMirror Lezer parser for the editor (cm/syntaxNodes.js) and
// once as a remark plugin for the reading view. They CAN'T share one parser (two
// engines), so this test feeds the same snippets through both and asserts they
// recognise the same tokens. If a future edit tightens/loosens one side only, a
// case here fails — which is exactly the divergence that makes a note look one way
// while editing and another when read.

const editorParser = mdParser.configure([obsidianSyntax])

// Inner text of every `nodeName` node the editor parser finds, stripping `front`
// chars of the opening delimiter and `back` of the closing one (hashtag has no
// closing delimiter, so back = 0; `==`/`||` strip 2 each side).
function editorInners(text, nodeName, front, back) {
  const out = []
  editorParser.parse(text).iterate({
    enter(n) { if (n.name === nodeName) out.push(text.slice(n.from + front, n.to - back)) },
  })
  return out.sort()
}

// Inner text of every reading-view node of `type` the remark plugin produces.
// (Plain recursion — unist-util-visit double-fires on these custom parent nodes.)
function readingInners(text, plugin, type, getInner) {
  const p = unified().use(remarkParse).use(plugin)
  const out = []
  const walk = (n) => { if (n.type === type) out.push(getInner(n)); (n.children || []).forEach(walk) }
  walk(p.runSync(p.parse(text)))
  return out.sort()
}

describe('editor ↔ reading view recognise the same hashtags', () => {
  for (const c of ['#tag here', 'a #mid b', '#start\nx', 'x\n\n#afterblank', 'no#match', 'plain text', 'two #a and #b']) {
    it(JSON.stringify(c), () => {
      expect(editorInners(c, 'Hashtag', 1, 0)).toEqual(readingInners(c, remarkHashtag, 'hashtag', n => n.tag))
    })
  }
})

describe('editor ↔ reading view recognise the same ==highlights== (tight delimiters)', () => {
  for (const c of ['==tight==', '==multi word==', 'a == b == c', '== loose ==', 'no marks', '==a== then ==b==']) {
    it(JSON.stringify(c), () => {
      expect(editorInners(c, 'Highlight', 2, 2)).toEqual(readingInners(c, remarkHighlight, 'highlight', n => n.children[0].value))
    })
  }
})

describe('editor ↔ reading view recognise the same ||spoilers|| (tight delimiters)', () => {
  for (const c of ['||secret||', '||two words||', 'x || y || z', '|| loose ||', 'a||b']) {
    it(JSON.stringify(c), () => {
      expect(editorInners(c, 'Spoiler', 2, 2)).toEqual(readingInners(c, remarkSpoiler, 'spoiler', n => n.children[0].value))
    })
  }
})

describe('wikilink classification (shared parseTypedLink)', () => {
  const cases = [
    ['Note Title', { kind: 'note', target: 'Note Title', label: '' }],
    ['Note#heading', { kind: 'note', target: 'Note', label: '' }],
    ['task:42|Do it', { kind: 'task', id: '42', label: 'Do it' }],
    ['sandbox:7', { kind: 'sandbox', id: '7', label: '' }],
    ['bundle:3|B', { kind: 'bundle', id: '3', label: 'B' }],
  ]
  for (const [inner, exp] of cases) {
    it(`[[${inner}]]`, () => {
      const got = parseTypedLink(inner)
      for (const k of Object.keys(exp)) expect(got[k]).toBe(exp[k])
    })
  }
})

describe('callout segmentation (normalizeCalloutSource)', () => {
  it('adjacent callouts split with a blank line', () => {
    expect(normalizeCalloutSource('> [!note] a\n> [!tip] b')).toBe('> [!note] a\n\n> [!tip] b')
  })
  it('lazy continuation line is ejected', () => {
    expect(normalizeCalloutSource('> [!note] a\nlazy')).toBe('> [!note] a\n\nlazy')
  })
  it('a multi-line callout body stays together', () => {
    expect(normalizeCalloutSource('> [!note] a\n> still a')).toBe('> [!note] a\n> still a')
  })
})

// The fold-persistence feature keys folds by source line number. When a callout
// inserts a blank line, the reading view must translate the heading/list line in
// the NORMALIZED text back to the ORIGINAL editor line, or it remembers the wrong
// line and the editor folds the wrong section on reload.
describe('callout line map (normalizeCalloutWithMap)', () => {
  it('maps normalized lines back to the original editor lines', () => {
    const { text, map } = normalizeCalloutWithMap('> [!note] a\n# H\nbody')
    expect(text).toBe('> [!note] a\n\n# H\nbody') // a blank line was inserted
    expect(map).toEqual([0, -1, 1, 2])           // -1 = the inserted blank (no original line)
    // '# H' is on normalized line 3 (1-based) → maps back to original line 2.
    expect(map[3 - 1] + 1).toBe(2)
  })
  it('uses an identity (null) map when there are no callouts', () => {
    const { text, map } = normalizeCalloutWithMap('# H\nbody')
    expect(text).toBe('# H\nbody')
    expect(map).toBe(null)
  })
})
