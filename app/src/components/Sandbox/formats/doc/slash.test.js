import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { matchBlocks, blockInsert, slashCompletions, SLASH_BLOCKS } from './slash'

const ctx = (doc, pos = doc.length) => new CompletionContext(EditorState.create({ doc }), pos, false)

// Apply an option the way the completion list would, on a fake view.
function apply(doc, label) {
    let state = EditorState.create({ doc })
    const r = slashCompletions(new CompletionContext(state, doc.length, false))
    const opt = r.options.find(o => o.displayLabel === label)
    const view = { dispatch: (spec) => { state = state.update(spec).state } }
    opt.apply(view, opt, r.from, r.to)
    return { text: state.doc.toString(), caret: state.selection.main.head }
}

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
    it('opens at a line start or after a space, not inside a word or a code block', () => {
        expect(slashCompletions(ctx('/'))).not.toBeNull()
        expect(slashCompletions(ctx('hello /he'))).not.toBeNull()
        expect(slashCompletions(ctx('and/or'))).toBeNull()
        expect(slashCompletions(ctx('```\n/h'))).toBeNull()
        expect(slashCompletions(ctx('/zzz'))).toBeNull()
    })
    it('replaces "/query" with the block and puts the caret in it', () => {
        expect(apply('/h1', 'Heading 1')).toEqual({ text: '# ', caret: 2 })
        expect(apply('  /check', 'Checklist')).toEqual({ text: '- [ ] ', caret: 6 })
        // Mid-line: the block starts its own line.
        expect(apply('text /quote', 'Quote')).toEqual({ text: 'text \n> ', caret: 8 })
    })
})
