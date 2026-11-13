import { EditorView, keymap } from '@codemirror/view'
import { Facet, Prec } from '@codemirror/state'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { isAttachmentHref, isExternalHref } from '../../../utils/attachmentLinks'

// Obsidian-style `[[wikilinks]]` between notes: a Lezer inline node, live-preview
// rendering (in cm/livePreview.js), `[[`-autocomplete over existing note titles,
// and click-to-open (creating the note first when it doesn't exist yet).

// Lezer markdown extension — a Wikilink node spanning `[[ … ]]`. Parsed before
// `Link` so `[[` isn't consumed as a normal link.
export const wikilinkMarkdownExtension = {
  defineNodes: [{ name: 'Wikilink' }],
  parseInline: [
    {
      name: 'Wikilink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91) return -1
        let e = pos + 2
        while (e < cx.end && !(cx.char(e) === 93 /* ] */ && cx.char(e + 1) === 93)) e++
        if (e >= cx.end) return -1
        return cx.addElement(cx.elt('Wikilink', pos, e + 2))
      },
    },
  ],
}

// Config the editor provides: current notes + resolve/navigate/create callbacks.
// Read from `state.facet(wikilinkConfig)` by buildDeco and the click handler.
export const wikilinkConfig = Facet.define({
  combine: (values) => values[0] || {},
})

// Case-insensitive, first-match resolution by title (ignoring any `#heading`
// suffix and the `|alias`). Titles aren't unique, so first match wins.
export function resolveNote(notes, target) {
  if (!notes || !target) return null
  const key = String(target).split('#')[0].trim().toLowerCase()
  if (!key) return null
  return notes.find((n) => (n.title || '').trim().toLowerCase() === key) || null
}

// Split `target|alias` (and strip `#heading`) out of the raw inner text.
export function parseWikilink(inner) {
  const pipe = inner.indexOf('|')
  const linkpart = pipe >= 0 ? inner.slice(0, pipe) : inner
  const alias = pipe >= 0 ? inner.slice(pipe + 1) : ''
  const target = linkpart.split('#')[0].trim()
  return { target, alias, pipe }
}

// `parseTypedLink` lives in utils/parseWikilink.js (shared with the reading view's
// remarkWikilinks so the two can't classify a `[[ … ]]` differently); re-exported
// here for the live-preview decorations that import it from this module.
export { parseTypedLink } from '../utils/parseWikilink'

// Autocomplete source. After `[[` it suggests notes; after a typed prefix
// (`[[task:` / `[[sandbox:`) it suggests that kind — tasks (+ bundle tasks, which
// insert a `bundle:` link since bundle tasks open the whole bundle) or sandboxes.
function wikilinkComplete(context) {
  const before = context.matchBefore(/\[\[[^\]\n]*/)
  if (!before) return null
  const cfg = context.state.facet(wikilinkConfig)
  const from = before.from + 2
  const after = before.text.slice(2)

  // Build an option whose `apply` replaces the inner text with `<inner>]]`.
  const opt = (inner, label, detail) => ({
    label,
    detail,
    type: 'text',
    apply: (view, _c, f, t) => view.dispatch({
      changes: { from: f, to: t, insert: `${inner}]]` },
      selection: { anchor: f + inner.length + 2 },
    }),
  })

  const taskM = /^task:(.*)$/i.exec(after)
  if (taskM) {
    const q = taskM[1].trim().toLowerCase()
    const options = []
    for (const t of (cfg.tasks?.() || [])) {
      const title = t.title || 'Untitled'
      if (!q || title.toLowerCase().includes(q)) options.push(opt(`task:${t.id}|${title}`, title, 'task'))
    }
    for (const b of (cfg.bundles?.() || [])) {
      const bundleTitle = b.title || 'bundle'
      for (const bt of (b.tasks || [])) {
        const title = bt.title || 'Untitled'
        if (!q || title.toLowerCase().includes(q) || bundleTitle.toLowerCase().includes(q)) {
          options.push(opt(`bundle:${b.id}|${title}`, `${title}  (in ${bundleTitle})`, 'bundle'))
        }
      }
    }
    return { from, to: context.pos, options, filter: false, validFor: /[^\]\n]*/ }
  }

  const sbM = /^sandbox:(.*)$/i.exec(after)
  if (sbM) {
    const q = sbM[1].trim().toLowerCase()
    const options = []
    for (const s of (cfg.sandboxes?.() || [])) {
      const title = s.title || 'Untitled'
      if (!q || title.toLowerCase().includes(q)) options.push(opt(`sandbox:${s.id}|${title}`, title, 'sandbox'))
    }
    return { from, to: context.pos, options, filter: false, validFor: /[^\]\n]*/ }
  }

  // Plain note titles.
  const options = (cfg.notes?.() || []).map((n) => {
    const title = n.title || 'Untitled'
    return opt(title, title, 'note')
  })
  return { from, to: context.pos, options, filter: true, validFor: /[^\]\n]*/ }
}

// Click a rendered link → typed links open the task modal / sandbox board; note
// links open the note (or confirm-create it when unresolved).
const clickHandler = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const cfg = view.state.facet(wikilinkConfig)
    const tag = event.target?.closest?.('.cm-hashtag')
    if (tag) { event.preventDefault(); cfg.searchTag?.(tag.getAttribute('data-tag')); return true }
    // Attachments (.pdf / local .html) and web links reach the same two
    // destinations as in the reading view — the side viewer and the browser —
    // through the same shared predicates (utils/attachmentLinks.js; this used to
    // carry its own copy of the regex).
    //
    // But in WRITE mode they need Ctrl/Cmd. A plain click here is someone putting
    // the caret in a link they are editing, and stealing it to open a viewer or a
    // confirm makes the link's own text uneditable. Read mode has no caret to
    // place, so there a plain click opens.
    const ext = event.target?.closest?.('.cm-external-link')
    if (ext && (event.ctrlKey || event.metaKey)) {
      const href = ext.getAttribute('data-href') || ''
      if (isAttachmentHref(href)) { event.preventDefault(); cfg.openAttachment?.(href); return true }
      if (isExternalHref(href)) { event.preventDefault(); cfg.openExternal?.(href); return true }
    }
    if (ext) return false
    const el = event.target?.closest?.('.cm-internal-link')
    if (!el) return false
    event.preventDefault()
    const kind = el.getAttribute('data-link-kind')
    if (kind === 'task') { cfg.openTask?.(el.getAttribute('data-link-id')); return true }
    if (kind === 'sandbox') { cfg.openSandbox?.(el.getAttribute('data-link-id')); return true }
    if (kind === 'bundle') { cfg.openBundle?.(el.getAttribute('data-link-id')); return true }
    const target = el.getAttribute('data-target') || ''
    const note = cfg.resolve ? cfg.resolve(target) : null
    if (note) cfg.navigate?.(note.id)
    else if (target) cfg.create?.(target)
    return true
  },
})

export function wikilinks(config) {
  return [
    wikilinkConfig.of(config),
    autocompletion({ override: [wikilinkComplete], activateOnTyping: true, icons: false }),
    // Highest precedence so the open completion list owns Arrow/Enter/Esc; when
    // no completion is active these fall through to caret motion / newline.
    Prec.highest(keymap.of(completionKeymap)),
    clickHandler,
  ]
}
