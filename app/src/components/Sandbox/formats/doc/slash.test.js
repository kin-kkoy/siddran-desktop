import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { matchBlocks, blockInsert, slashQuery, applyBlockSpec, SLASH_BLOCKS, _slash } from './slash'

const st = (doc, pos = doc.length) => EditorState.create({ doc, selection: { anchor: pos } })
const apply = (doc, id) => {
    const s = st(doc)
    const t = s.update(applyBlockSpec(slashQuery(s), SLASH_BLOCKS.find(b => b.id === id)))
    return { text: t.state.doc.toString(), caret: t.state.selection.main.head }
}
// The menu's state through typed transactions (no view needed).
const withMenu = (doc) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [_slash.slashState] })
const type = (s, text) => s.update({ changes: { from: s.selection.main.head, insert: text }, selection: { anchor: s.selection.main.head + text.length }, userEvent: 'input.type' }).state
const menu = (s) => s.field(_slash.slashState)

describe('slash menu', () => {
    it('matches by name and keyword, prefix first', () => {
        expect(matchBlocks('h2')[0].id).toBe('h2')
        expect(matchBlocks('todo')[0].id).toBe('check')
        expect(matchBlocks('').length).toBe(SLASH_BLOCKS.length)
        expect(matchBlocks('zzz')).toEqual([])
    })
    it('strips the caret marker', () => {
        expect(blockInsert(SLASH_BLOCKS.find(b => b.id === 'code'))).toEqual({ insert: '```\n\n```', caret: 4 })
    })
    it('finds a query at a line start or after a space, not inside a word or a code block', () => {
        expect(slashQuery(st('/'))).toMatchObject({ slash: 0, query: '', ownLine: true })
        expect(slashQuery(st('hello /he'))).toMatchObject({ slash: 6, query: 'he', ownLine: false })
        expect(slashQuery(st('and/or'))).toBeNull()
        expect(slashQuery(st('```\n/h'))).toBeNull()
    })
    it('replaces "/query" with the block and puts the caret in it', () => {
        expect(apply('/h1', 'h1')).toEqual({ text: '# ', caret: 2 })
        expect(apply('  /check', 'check')).toEqual({ text: '- [ ] ', caret: 6 })
        // Mid-line: the block starts its own line.
        expect(apply('text /quote', 'quote')).toEqual({ text: 'text \n> ', caret: 8 })
    })
    it('opens on a typed "/" on an empty line, narrows, moves, and Esc keeps it shut', () => {
        let s = type(withMenu('Intro\n'), '/')
        expect(menu(s).q).toMatchObject({ slash: 6 })
        s = type(s, 'he')
        expect(menu(s).items[0].id).toBe('h1')
        s = s.update({ effects: _slash.moveSel.of(1) }).state
        expect(menu(s).selected).toBe(1)
        s = s.update({ effects: _slash.dismiss.of(null) }).state
        expect(menu(s).q).toBeNull()
        s = type(s, 'a')                       // still the same "/": stays shut
        expect(menu(s)?.q ?? null).toBeNull()
        s = type(type(s, ' '), '/')            // a new "/" opens again
        expect(menu(s).q).toBeTruthy()
    })
    it('a caret move onto an old "/" does not open it; no match closes it', () => {
        let s = withMenu('/h')
        s = s.update({ selection: { anchor: 2 } }).state
        expect(menu(s)).toBeNull()
        s = type(withMenu(''), '/zz')
        expect(menu(s)).toBeNull()
    })
})
