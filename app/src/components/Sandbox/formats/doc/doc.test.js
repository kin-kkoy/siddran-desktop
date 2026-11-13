import { describe, it, expect } from 'vitest'
import { docPayload, isDoc, isNoteDoc, docStats, statsLabel, DOC_TEMPLATES, templateTitle } from './doc'
import { formatPayload, formatSize, nextFormatTitle, viewLabel } from '../formats'

describe('Doc model', () => {
    it('is a format shape with view doc and its own empty text', () => {
        const p = formatPayload('doc', 'Doc')
        expect(p).toEqual(docPayload('Doc'))
        expect(p).toMatchObject({ kind: 'format', view: 'doc', source: { type: 'own' }, body: '' })
        expect(isDoc({ type: 'shape', payload: p })).toBe(true)
        expect(isDoc({ type: 'shape', payload: formatPayload('table') })).toBe(false)
        expect(p.records).toBeUndefined()
    })
    it('names and sizes like the other widgets', () => {
        expect(viewLabel('doc')).toBe('Doc')
        const items = [{ type: 'shape', payload: docPayload('Doc') }]
        expect(nextFormatTitle(items, 'doc')).toBe('Doc 2')
        expect(formatSize('doc').h).toBeGreaterThan(formatSize('doc').w)
    })
    it('knows a linked note', () => {
        expect(isNoteDoc({ source: { type: 'note', noteId: 7 } })).toBe(true)
        expect(isNoteDoc({ source: { type: 'own' } })).toBe(false)
    })
})

describe('docStats', () => {
    it('counts words, not markup', () => {
        const s = docStats('# Title here\n\n- [ ] buy **milk**\n- [x] done\n\n| a | b |\n| --- | --- |\n\n[link text](http://x.y) and [[Some Note]]')
        // Title here buy milk done a b link text and Some Note
        expect(s.words).toBe(12)
        expect(s.minutes).toBe(1)
    })
    it('an empty doc reads as Empty', () => {
        expect(docStats('').words).toBe(0)
        expect(statsLabel(docStats('  \n'))).toBe('Empty')
        expect(statsLabel(docStats('one'))).toBe('1 word · 1 min read')
    })
    it('reading time grows with length', () => {
        expect(docStats('word '.repeat(1000)).minutes).toBe(4)
    })
})

describe('templates', () => {
    it('are data with a body each; Blank is empty', () => {
        expect(DOC_TEMPLATES.map(t => t.id)).toEqual(['blank', 'meeting', 'brief', 'decision'])
        expect(DOC_TEMPLATES[0].body()).toBe('')
        for (const t of DOC_TEMPLATES.slice(1)) expect(t.body()).toMatch(/^# /)
        expect(DOC_TEMPLATES[1].body()).toMatch(/- \[ \] /)
    })
    it('gives a title, except Blank', () => {
        expect(templateTitle('meeting', 'Doc')).toBe('Meeting notes')
        expect(templateTitle('blank', 'Doc')).toBe('Doc')
    })
})

describe('your own templates', () => {
    it('saves, replaces by name, removes', async () => {
        const { saveTemplate, removeTemplate, userTemplates, asTemplate } = await import('./doc')
        let l = saveTemplate([], ' Weekly ', '# W', 'a')
        expect(l).toEqual([{ id: 'a', label: 'Weekly', body: '# W' }])
        l = saveTemplate(l, 'Weekly', '# W2', 'b')
        expect(l).toEqual([{ id: 'b', label: 'Weekly', body: '# W2' }])
        l = saveTemplate(l, '', 'x', 'c')
        expect(l.map(t => t.label)).toEqual(['Weekly', 'My template'])
        expect(removeTemplate(l, 'b').map(t => t.id)).toEqual(['c'])
        expect(userTemplates({ docTemplates: [...l, null, { id: 'z' }] })).toHaveLength(2)
        expect(userTemplates({})).toEqual([])
        expect(asTemplate(l[0]).body()).toBe('# W2')
    })
})

describe('docMarkdown', () => {
    it('adds frontmatter, quoting a title that needs it', async () => {
        const { docMarkdown } = await import('./doc')
        expect(docMarkdown('Plan', '# Hi', 'T')).toBe("---\ntitle: Plan\nexported_at: T\nsource: siddran board doc\n---\n\n# Hi")
        expect(docMarkdown("Q3: Bob's", '', 'T')).toContain("title: 'Q3: Bob''s'")
    })
})
