/**
 * Doc — a long-form writing page on the board (spec §13.3): briefs, meeting
 * notes, decision logs, anything too long for a sticky or a text box.
 *
 * Stored like every Format widget (formats.js): `type: 'shape'`,
 * `payload.kind: 'format'`, with `payload.view: 'doc'`. A build that doesn't
 * know the Doc view shows it as an empty list, never crashes.
 *
 * payload = {
 *   kind: 'format', view: 'doc', title,
 *   source: { type: 'own' }                  // the text below, in the board
 *         | { type: 'note', noteId },        // a real note in the Bag, edited in place
 *   body: string,                            // Markdown — the own text (kept while linked,
 *                                            //   so switching back gets it again)
 *   fontSize?: number,                       // the widget's text size (floating bar)
 * }
 *
 * The text is Markdown, the same as a note's body, so the notes editor
 * (CodeMirror live preview) edits it unchanged and "Save as a note" is a copy.
 * Two copies of a board that both edited one Doc's `body` merge line by line
 * (desktop/sync/merge.js), like a note does.
 */

// The literal, not formats.js's constant: formats.js imports this file.
const FORMAT_KIND = 'format'

export const DOC_VIEW = 'doc'
export const isDoc = (it) => it?.type === 'shape' && it.payload?.kind === FORMAT_KIND && it.payload?.view === DOC_VIEW
export const isNoteDoc = (p) => p?.source?.type === 'note' && p.source.noteId != null

export const DOC_SIZE = { w: 560, h: 640 }

/** Spec §13.3.3. Above 90 % the footer shows the count; we never block typing. */
export const DOC_CHAR_LIMIT = 80000

export function docPayload(title = 'Doc', body = '') {
    return { kind: FORMAT_KIND, view: DOC_VIEW, title, source: { type: 'own' }, body }
}

// ---- templates (spec §13.3.4; R13.16: data, not code) ----

const today = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const DOC_TEMPLATES = [
    { id: 'blank', label: 'Blank', hint: 'Free writing', body: () => '' },
    {
        id: 'meeting', label: 'Meeting notes', hint: 'Date, attendees, agenda, decisions, actions',
        body: () => `# Meeting notes\n\n**Date:** ${today()}\n**Attendees:** \n\n## Agenda\n\n1. \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n`,
    },
    {
        id: 'brief', label: 'Project brief', hint: 'Goal, scope, audience, metrics, risks, milestones',
        body: () => '# Project brief\n\n## Goal\n\n\n\n## Scope\n\n**In:** \n**Out:** \n\n## Audience\n\n\n\n## Success metrics\n\n- \n\n## Risks\n\n| Risk | Likelihood | Mitigation |\n| --- | --- | --- |\n|  |  |  |\n\n## Milestones\n\n- [ ] \n',
    },
    {
        id: 'decision', label: 'Decision log', hint: 'Decision, context, options, owner, status',
        body: () => `# Decision log\n\n## ${today()} · \n\n**Status:** Proposed\n**Owner:** \n\n### Context\n\n\n\n### Options\n\n1. \n2. \n\n### Decision\n\n\n\n### Consequences\n\n- \n`,
    },
]

/** A template's title for the widget ("Meeting notes"), or the given default for Blank. */
export const templateTitle = (id, fallback) => (id && id !== 'blank' ? DOC_TEMPLATES.find(t => t.id === id)?.label : null) || fallback

// ---- counts (spec §13.3.3: words and reading time in the footer) ----

// Markup that isn't text: list/quote/heading markers, task boxes, fences,
// table rules, emphasis and link punctuation. Approximate on purpose; it's a
// footer count, not a contract.
function plainText(md) {
    return String(md || '')
        .replace(/^```.*$/gm, '')
        .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+(\[[ xX]\]\s+)?)/gm, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
        .replace(/[*_~`|=]/g, '')
}

/** Graphemes when the engine can count them, else UTF-16 units. */
function countChars(s) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter().segment(s)].length
    return s.length
}

export function docStats(md) {
    const text = plainText(md)
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length
    const chars = countChars(text.replace(/\n+/g, '\n').trim())
    // ~230 words a minute; anything with words reads in at least a minute.
    const minutes = words ? Math.max(1, Math.round(words / 230)) : 0
    return { words, chars, minutes }
}

export function statsLabel({ words, minutes }) {
    if (!words) return 'Empty'
    return `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${minutes} min read`
}
