/**
 * The Doc's slash menu (spec §13.3.2): type `/` at the start of a line, or
 * after a space, and pick a block. ↑/↓ choose, Enter or Tab inserts, Esc
 * closes (until the next `/`). The block is plain Markdown, the same text you
 * could type by hand (`# `, `- [ ] `, three backticks…).
 *
 * Its own tooltip rather than a completion source. The notes editor's fold
 * gutter is "fixed", so CodeMirror counts it as a scroll margin and hides any
 * completion list anchored over it — which is where a `/` at a line start sits
 * (the theme pulls the gutter into the left padding). This tooltip opts out of
 * that clipping (`clip: false`). Un-fixing the gutter instead moved the Notes
 * text 25px, so it was left alone.
 */

import { StateField, StateEffect, Prec } from '@codemirror/state'
import { EditorView, showTooltip, keymap } from '@codemirror/view'
import { diagramFence, emptyDiagram } from '../../../../utils/diagramBlock'

// `text` is inserted in place of "/query". `|` marks where the caret lands.
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

/**
 * The slash query at the caret, or null: `{ slash, to, query, lineFrom, ownLine }`
 * (`slash` = the "/" position). Only with one empty selection, outside code fences.
 */
export function slashQuery(state) {
    const sel = state.selection
    if (sel.ranges.length !== 1 || !sel.main.empty) return null
    const pos = sel.main.head
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)
    const m = SLASH_RE.exec(before)
    if (!m) return null
    if (insideFence(state.doc, line.number)) return null
    const slash = pos - m[1].length - 1
    return { slash, to: pos, query: m[1], lineFrom: line.from, ownLine: before.slice(0, slash - line.from).trim() === '' }
}

/** The change that turns "/query" into `block` (a transaction spec). */
export function applyBlockSpec(q, block) {
    const { insert, caret } = blockInsert(block)
    // On an otherwise blank line, replace the indent too, so "# " lands at column 0.
    // Mid-line (after text), a block starts its own line.
    const pre = q.ownLine ? '' : '\n'
    const start = q.ownLine ? q.lineFrom : q.slash
    return { changes: { from: start, to: q.to, insert: pre + insert }, selection: { anchor: start + pre.length + caret }, userEvent: 'input.complete' }
}

function insideFence(doc, lineNo) {
    let open = false
    for (let n = 1; n < lineNo; n++) if (/^\s*(```|~~~)/.test(doc.line(n).text)) open = !open
    return open
}

// ---- the menu (state + tooltip + keys) ----

const moveSel = StateEffect.define()      // +1 / -1
const dismiss = StateEffect.define()      // Esc: closed until this "/" is gone

// { q, items, selected } while open; { q: null, dismissedAt } after Esc; null otherwise.
const slashState = StateField.define({
    create: () => null,
    update(value, tr) {
        let dismissedAt = value?.dismissedAt ?? null
        if (dismissedAt != null) dismissedAt = tr.changes.mapPos(dismissedAt)
        for (const e of tr.effects) if (e.is(dismiss)) dismissedAt = value?.q?.slash ?? null
        const q = slashQuery(tr.state)
        if (!q) return null
        if (dismissedAt != null && dismissedAt === q.slash) return { q: null, dismissedAt }
        // Opens only when you type; moving the caret onto an old "/" doesn't open it.
        if (!value?.q && !tr.isUserEvent('input.type')) return null
        const items = matchBlocks(q.query)
        if (!items.length) return null
        const sameQuery = value?.q && tr.changes.mapPos(value.q.slash) === q.slash && value.q.query === q.query
        let selected = sameQuery ? value.selected : 0
        for (const e of tr.effects) if (e.is(moveSel)) selected = (selected + e.value + items.length) % items.length
        return { q, items: sameQuery ? value.items : items, selected, dismissedAt: null }
    },
    provide: (f) => showTooltip.from(f, (s) => (s?.q ? {
        pos: s.q.slash + 1,
        above: false,
        clip: false,   // see the header comment
        create: (view) => menuView(view),
    } : null)),
})

function pick(view, i) {
    const s = view.state.field(slashState, false)
    if (!s?.q) return false
    view.dispatch(applyBlockSpec(s.q, s.items[i ?? s.selected]))
    return true
}

function menuView(view) {
    const dom = document.createElement('div')
    // The completion list's own classes, so the theme already styles it.
    dom.className = 'cm-tooltip-autocomplete cm-slash-menu'
    const ul = document.createElement('ul')
    ul.setAttribute('role', 'listbox')
    ul.setAttribute('aria-label', 'Insert a block')
    dom.appendChild(ul)
    // Keep the caret in the text: pressing an item mustn't blur the editor.
    dom.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const li = e.target.closest('li[data-i]')
        if (li) pick(view, Number(li.dataset.i))
    })
    let shown = null
    const render = () => {
        const s = view.state.field(slashState, false)
        if (!s?.q || s === shown) return
        const same = shown && shown.items === s.items
        shown = s
        if (!same) {
            ul.replaceChildren(...s.items.map((b, i) => {
                const li = document.createElement('li')
                li.dataset.i = String(i)
                li.setAttribute('role', 'option')
                const label = document.createElement('span')
                label.className = 'cm-completionLabel'
                label.textContent = b.label
                li.appendChild(label)
                return li
            }))
        }
        ul.querySelectorAll('li').forEach((li, i) => {
            const on = i === s.selected
            li.setAttribute('aria-selected', on ? 'true' : 'false')
            if (on) li.scrollIntoView?.({ block: 'nearest' })
        })
    }
    render()
    return { dom, update: render }
}

const whenOpen = (fn) => (v) => (v.state.field(slashState, false)?.q ? (fn(v), true) : false)
const slashKeys = Prec.highest(keymap.of([
    { key: 'ArrowDown', run: whenOpen((v) => v.dispatch({ effects: moveSel.of(1) })) },
    { key: 'ArrowUp', run: whenOpen((v) => v.dispatch({ effects: moveSel.of(-1) })) },
    { key: 'Enter', run: (v) => pick(v) },
    { key: 'Tab', run: (v) => pick(v) },
    { key: 'Escape', run: whenOpen((v) => v.dispatch({ effects: dismiss.of(null) })) },
]))

/** The extension for CodeMirrorEditor's `extraExtensions`. */
export const slashMenu = [slashState, slashKeys, EditorView.baseTheme({
    '.cm-slash-menu ul': { margin: 0, padding: 0, listStyle: 'none', maxHeight: '15em', overflowY: 'auto', minWidth: '11em' },
    '.cm-slash-menu li': { padding: '2px 10px', cursor: 'pointer', whiteSpace: 'nowrap' },
})]

// For tests: the field and its effects.
export const _slash = { slashState, moveSel, dismiss }
