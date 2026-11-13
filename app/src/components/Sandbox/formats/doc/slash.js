/**
 * The Doc's slash menu (spec §13.3.2): type `/` at the start of a line, or
 * after a space, and pick a block. It's a completion source for the notes
 * editor (CodeMirrorEditor's `extraCompletions`), so it shares the wikilink
 * list's keys: ↑/↓, Enter, Esc. The block is plain Markdown, the same text you
 * could type by hand (`# `, `- [ ] `, three backticks…).
 */

import { diagramFence, emptyDiagram } from '../../../../utils/diagramBlock'

// `text` is inserted in place of "/query". `|` marks where the caret lands
// (first one), or the start of the selection when there are two.
export const SLASH_BLOCKS = [
    { id: 'h1', label: 'Heading 1', keys: 'h1 title heading', text: '# |' },
    { id: 'h2', label: 'Heading 2', keys: 'h2 heading subtitle', text: '## |' },
    { id: 'h3', label: 'Heading 3', keys: 'h3 heading', text: '### |' },
    { id: 'bullet', label: 'Bulleted list', keys: 'bullet list ul unordered', text: '- |' },
    { id: 'number', label: 'Numbered list', keys: 'numbered list ol ordered', text: '1. |' },
    { id: 'check', label: 'Checklist', keys: 'checklist todo task checkbox', text: '- [ ] |' },
    { id: 'quote', label: 'Quote', keys: 'quote blockquote', text: '> |' },
    { id: 'callout', label: 'Callout', keys: 'callout note info tip warning', text: '> [!note]\n> |' },
    { id: 'code', label: 'Code block', keys: 'code fence snippet', text: '```\n|\n```' },
    { id: 'table', label: 'Table', keys: 'table grid', text: '| | |\n| --- | --- |\n|  |  |', caret: 2 },
    { id: 'divider', label: 'Divider', keys: 'divider rule hr line separator', text: '---\n|' },
    { id: 'diagram', label: 'Diagram', keys: 'diagram flowchart drawing', text: () => `${diagramFence(emptyDiagram())}\n|` },
]

/** The blocks matching what's typed after the slash, best first. */
export function matchBlocks(query) {
    const q = String(query || '').toLowerCase()
    if (!q) return SLASH_BLOCKS
    const starts = [], has = []
    for (const b of SLASH_BLOCKS) {
        const name = b.label.toLowerCase()
        if (name.startsWith(q) || b.keys.split(' ').some(k => k.startsWith(q))) starts.push(b)
        else if (name.includes(q) || b.keys.includes(q)) has.push(b)
    }
    return [...starts, ...has]
}

/** A block's text with the caret marker taken out: `{ insert, caret }` (caret = offset into insert). */
export function blockInsert(block) {
    const raw = typeof block.text === 'function' ? block.text() : block.text
    if (block.caret != null) return { insert: raw.replace('|', ''), caret: block.caret }
    const i = raw.indexOf('|')
    return i < 0 ? { insert: raw, caret: raw.length } : { insert: raw.slice(0, i) + raw.slice(i + 1), caret: i }
}

// "/" then letters only, at the start of a line or after whitespace.
const SLASH_RE = /(?:^|\s)\/([a-z0-9]*)$/i

/** The completion source. Lines inside a fenced code block are left alone. */
export function slashCompletions(context) {
    const line = context.state.doc.lineAt(context.pos)
    const before = line.text.slice(0, context.pos - line.from)
    const m = SLASH_RE.exec(before)
    if (!m) return null
    if (insideFence(context.state.doc, line.number)) return null
    const from = context.pos - m[1].length - 1
    // Mid-line (after text), a block that wants its own line starts one.
    const lead = before.slice(0, from - line.from)
    const ownLine = lead.trim() === ''
    const options = matchBlocks(m[1]).map((b) => ({
        label: `/${b.label}`,
        displayLabel: b.label,
        type: 'text',
        apply: (view, _c, f, t) => {
            const { insert, caret } = blockInsert(b)
            const pre = ownLine ? '' : '\n'
            // On an otherwise blank line, replace the indent too, so "# " lands at column 0.
            const start = ownLine ? line.from : f
            view.dispatch({
                changes: { from: start, to: t, insert: pre + insert },
                selection: { anchor: start + pre.length + caret },
                userEvent: 'input.complete',
            })
        },
    }))
    if (!options.length) return null
    return { from, to: context.pos, options, filter: false }
}

function insideFence(doc, lineNo) {
    let open = false
    for (let n = 1; n < lineNo; n++) if (/^\s*(```|~~~)/.test(doc.line(n).text)) open = !open
    return open
}
