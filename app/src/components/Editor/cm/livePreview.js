import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { RangeSet } from '@codemirror/state'
import { syntaxTree, foldEffect, unfoldEffect } from '@codemirror/language'
import { BulletWidget, CheckWidget, ImageWidget } from './widgets'
import { wikilinkConfig, parseTypedLink } from './wikilinks'
import { listFoldRange, listFoldState, rangeFolded, CHEVRON_SVG } from './fold'

// Live-preview decorations — a Phase 1 subset of the reference clone's buildDeco
// (garb2/obsidian-notes-clone.html). The principle: walk the markdown syntax tree
// and, for each node, HIDE its syntax marks (replace with nothing) when the
// selection is NOT on it, and reveal them when the caret lands there.
//
// PERFORMANCE: the inline/line decorations are built by a ViewPlugin scoped to the
// VISIBLE ranges only, so cost is O(viewport) per keystroke / caret move instead of
// O(document). The few decorations that affect vertical layout — block widgets for
// horizontal rules and whole-line images — must be known document-wide (CM6
// requires block decorations to come from a StateField, not a plugin), so they live
// in a separate slim StateField that only re-scans on doc changes or when the caret
// crosses a line that holds such a widget.
//
// Two outputs are produced: visual decorations (mark/line/replace) and a RangeSet of
// the *hidden* spans fed to EditorView.atomicRanges, so the caret treats hidden
// syntax as one unit and steps over it cleanly.
//
// IMPORTANT: every `hide()` stays within a single line (never spans a line break).
// A cross-line replace merges two document lines into one visual line, which drops
// the merged line's styling and desyncs CM's document-line vs visual-line counts,
// making vertical caret motion overshoot.

// selection helpers, bound to a given state
function selProbes(state) {
  const doc = state.doc, sel = state.selection
  // selection overlaps the range [f,t)
  const over = (f, t) => sel.ranges.some(r => r.from <= t && r.to >= f)
  // selection touches any line spanned by [f,t)
  const lact = (f, t) => {
    const a = doc.lineAt(f).number
    const b = doc.lineAt(t).number
    return sel.ranges.some(r => doc.lineAt(r.from).number <= b && doc.lineAt(r.to).number >= a)
  }
  return { over, lact }
}

// Parse an `![alt](url)` image node into its rendered pieces, or null when it isn't
// a render-able image (malformed, or a transient `uploading:` placeholder).
function parseImage(doc, nf, nt) {
  const m = /^!\[([^\]]*)\]\(([^)\s]*)\)$/.exec(doc.sliceString(nf, nt))
  if (!m) return null
  const fullUrl = m[2]
  if (fullUrl.startsWith('uploading:')) return null
  // Size travels in the trailing fragment: `#w=NNN` and optionally `#h=NNN`.
  const fm = /#w=(\d+)(?:#h=(\d+))?$/.exec(fullUrl)
  return {
    width: fm ? parseInt(fm[1], 10) : null,
    height: fm && fm[2] ? parseInt(fm[2], 10) : null,
    src: fm ? fullUrl.slice(0, fm.index) : fullUrl,
  }
}

class InlineFoldWidget extends WidgetType {
  constructor(folded) { super(); this.folded = folded }
  eq(o) { return o.folded === this.folded }
  toDOM(view) {
    const s = document.createElement('span')
    s.className = 'cm-fold-inline' + (this.folded ? ' is-folded' : '')
    s.innerHTML = CHEVRON_SVG
    s.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = view.posAtDOM(s)
      const line = view.state.doc.lineAt(pos)
      const range = listFoldRange(view.state, line.from)
      if (!range) return
      const f = rangeFolded(view.state, range)
      view.dispatch({ effects: f ? unfoldEffect.of(range) : foldEffect.of(range) })
    })
    return s
  }
  ignoreEvent() { return true }
}

// ---- inline + line decorations, scoped to the given ranges (the viewport) ----
function scanInline(state, ranges) {
  const deco = []
  const atomic = []
  const doc = state.doc
  const tree = syntaxTree(state)
  const { over, lact } = selProbes(state)
  const hide = (f, t) => {
    if (t > f) {
      deco.push(Decoration.replace({}).range(f, t))
      atomic.push(Decoration.replace({}).range(f, t))
    }
  }
  const mk = (f, t, cls, at) => { if (t > f) deco.push(Decoration.mark({ class: cls, attributes: at }).range(f, t)) }
  const lineCls = (pos, cls) => deco.push(Decoration.line({ class: cls }).range(pos))
  const fenced = new Set() // line numbers inside a ``` / ~~~ block (so list pass skips them)

  const enter = (node) => {
    const name = node.name, nf = node.from, nt = node.to
    switch (name) {
      case 'StrongEmphasis':
      case 'Emphasis':
      case 'Strikethrough':
      case 'InlineCode': {
        const cls = name === 'StrongEmphasis' ? 'cm-strong'
          : name === 'Emphasis' ? 'cm-em'
            : name === 'Strikethrough' ? 'cm-strike'
              : 'cm-code-inline'
        const mn = (name === 'StrongEmphasis' || name === 'Emphasis') ? 'EmphasisMark'
          : name === 'Strikethrough' ? 'StrikethroughMark'
            : 'CodeMark'
        const marks = node.node.getChildren(mn)
        let iF = nf, iT = nt
        if (marks.length) { iF = marks[0].to; iT = marks[marks.length - 1].from }
        mk(iF, iT, cls)
        if (!over(nf, nt)) marks.forEach(m => hide(m.from, m.to))
        break
      }
      case 'ATXHeading1':
      case 'ATXHeading2':
      case 'ATXHeading3':
      case 'ATXHeading4':
      case 'ATXHeading5':
      case 'ATXHeading6': {
        const lvl = name.slice(-1)
        lineCls(doc.lineAt(nf).from, 'cm-h cm-h' + lvl)
        if (!lact(nf, nt)) {
          node.node.getChildren('HeaderMark').forEach(m => {
            let t = m.to
            if (doc.sliceString(t, t + 1) === ' ') t++
            hide(m.from, t)
          })
        }
        break
      }
      case 'Wikilink': {
        // Caret on the link → editable `[[ ]]` source; off → rendered link with
        // brackets hidden. A `task:`/`sandbox:` prefix makes it a typed link
        // (handled by cm/wikilinks.js click via data-link-kind/id); otherwise a
        // note link (data-target → resolve/navigate/create).
        const inner = doc.sliceString(nf + 2, nt - 2)
        if (over(nf, nt)) { mk(nf, nt, 'cm-wikilink-src'); return false }
        const parsed = parseTypedLink(inner)
        hide(nf, nf + 2)
        hide(nt - 2, nt)
        // With an alias, hide the `head|` part and render only the alias.
        const showFrom = parsed.pipe >= 0 ? nf + 2 + parsed.pipe + 1 : nf + 2
        if (parsed.pipe >= 0) hide(nf + 2, showFrom)

        if (parsed.kind !== 'note') {
          const kindClass = parsed.kind === 'task' ? 'cm-task-link'
            : parsed.kind === 'sandbox' ? 'cm-sandbox-link'
              : 'cm-bundle-link'
          mk(showFrom, nt - 2, 'cm-internal-link ' + kindClass, { 'data-link-kind': parsed.kind, 'data-link-id': parsed.id })
          return false
        }
        const cfg = state.facet(wikilinkConfig)
        const resolved = cfg && cfg.resolve ? !!cfg.resolve(parsed.target) : false
        const cls = 'cm-internal-link' + (resolved ? '' : ' is-unresolved')
        mk(showFrom, nt - 2, cls, { 'data-target': parsed.target })
        return false
      }
      case 'Highlight': {
        // ==text== → highlighted; caret on it keeps the whole thing visible.
        if (over(nf, nt)) { mk(nf, nt, 'cm-highlight'); return false }
        mk(nf + 2, nt - 2, 'cm-highlight')
        hide(nf, nf + 2)
        hide(nt - 2, nt)
        return false
      }
      case 'Underline': {
        // <u>text</u> → underlined; caret on it shows the raw tags. Open tag is
        // 3 chars (`<u>`), close tag 4 (`</u>`).
        if (over(nf, nt)) { mk(nf, nt, 'cm-underline'); return false }
        mk(nf + 3, nt - 4, 'cm-underline')
        hide(nf, nf + 3)
        hide(nt - 4, nt)
        return false
      }
      case 'Hashtag': {
        // Caret on it → plain editable text; off → clickable pill.
        if (over(nf, nt)) break
        mk(nf, nt, 'cm-hashtag', { 'data-tag': doc.sliceString(nf + 1, nt) })
        return false
      }
      case 'Spoiler': {
        // ||text|| → blurred (CSS hover reveals); caret on it shows source.
        if (over(nf, nt)) break
        mk(nf + 2, nt - 2, 'cm-spoiler')
        hide(nf, nf + 2)
        hide(nt - 2, nt)
        return false
      }
      case 'Link': {
        const marks = node.node.getChildren('LinkMark')
        const url = node.node.getChild('URL')
        const href = url ? doc.sliceString(url.from, url.to) : ''
        if (over(nf, nt)) {
          mk(nf, nt, 'cm-link-active')
        } else if (marks.length >= 2) {
          mk(marks[0].to, marks[1].from, 'cm-external-link', { 'data-href': href })
          hide(nf, marks[0].to)
          hide(marks[1].from, nt)
        }
        break
      }
      case 'FencedCode': {
        // Style the whole block (fence + content lines) uniformly. When the
        // caret is outside, hide only the fence *characters* within their own
        // line — never across the line break — so the block keeps its styling
        // and vertical caret motion stays in sync.
        const marks = node.node.getChildren('CodeMark')
        const openLine = doc.lineAt(nf)
        const lastMark = marks.length ? marks[marks.length - 1] : null
        const closeLine = lastMark ? doc.lineAt(lastMark.from) : doc.lineAt(nt)
        const hasClose = marks.length >= 2 && closeLine.number > openLine.number
        const firstLn = openLine.number
        const lastLn = hasClose ? closeLine.number : doc.lineAt(nt).number
        for (let n = firstLn; n <= lastLn; n++) {
          if (n < 1 || n > doc.lines) continue
          fenced.add(n) // list pass must skip list-like lines inside the code block
          let cls = 'cm-codeblock'
          if (n === firstLn) cls += ' cm-codeblock-top'
          if (n === lastLn) cls += ' cm-codeblock-bot'
          lineCls(doc.line(n).from, cls)
        }
        if (!lact(nf, nt)) {
          hide(openLine.from, openLine.to)
          if (hasClose) hide(closeLine.from, closeLine.to)
        }
        return false
      }
      case 'HorizontalRule': {
        const line = doc.lineAt(nf)
        if (!lact(nf, nt)) {
          hide(line.from, line.to)
          lineCls(line.from, 'cm-hr-line')
        }
        return false
      }
      case 'Image': {
        // `![alt](path)` → real image when the caret isn't on it. Width travels in
        // the URL fragment `#w=NNN`. Whole-line images render as their own line via
        // the widget's block-display wrapper; inline images render inline.
        const info = parseImage(doc, nf, nt)
        if (!info) break
        const line = doc.lineAt(nf)
        const whole = line.from === nf && line.to === nt
        if (whole ? lact(nf, nt) : over(nf, nt)) break
        deco.push(Decoration.replace({ widget: new ImageWidget(info.src, info.width, info.height) }).range(nf, nt))
        return false
      }
      case 'Blockquote': {
        const sl = doc.lineAt(nf), el = doc.lineAt(nt)
        // Walk lines: each `> [!type]` starts a fresh callout; following `>`
        // lines are its body; a non-`>` (lazy-continuation) line ends the callout
        // and is left unstyled. This separates back-to-back callouts and stops a
        // plain trailing line from being absorbed into the callout/quote.
        let calloutType = null
        for (let n = sl.number; n <= el.number; n++) {
          const ln = doc.line(n)
          if (!/^\s*>/.test(ln.text)) { calloutType = null; continue }
          const head = /^\s*>\s*\[!(\w+)\]/.exec(ln.text)
          if (head) {
            calloutType = head[1].toLowerCase()
            lineCls(ln.from, 'cm-callout cm-callout-' + calloutType + ' cm-callout-head')
          } else if (calloutType) {
            lineCls(ln.from, 'cm-callout cm-callout-' + calloutType)
          } else {
            lineCls(ln.from, 'cm-quote')
          }
        }
        node.node.getChildren('QuoteMark').forEach(q => {
          if (!lact(q.from, q.to)) {
            let t = q.to
            if (doc.sliceString(t, t + 1) === ' ') t++
            hide(q.from, t)
          }
        })
        break
      }
      default:
        break
    }
  }

  for (const r of ranges) tree.iterate({ from: r.from, to: r.to, enter })

  // list bullets & task checkboxes — line-based, over the visible lines only.
  // Code-block membership comes from the `fenced` set populated above (covers both
  // ``` and ~~~, and fences that opened above the viewport), not a stateful regex.
  for (const r of ranges) {
    const firstLn = doc.lineAt(r.from).number, lastLn = doc.lineAt(r.to).number
    for (let ln = firstLn; ln <= lastLn; ln++) {
      if (fenced.has(ln)) continue
      const line = doc.line(ln), txt = line.text
      // Per list line we publish three CSS custom props consumed by the theme:
      //   --nest-pad : extra per-depth indent padding
      //   --hang     : hanging-indent width (marker + spaces) for wrapped rows
      //   --mark     : x-offset of the marker itself (depth indent + leading spaces),
      //                used to anchor the inline fold chevron beside it regardless of
      //                marker type — bullet, checkbox and number all sit at this x.
      // Require whitespace after `]` so this matches GFM/remark exactly: `- [ ]x`
      // (no space) is literal text, not a task, and must fall through to the
      // bullet branch below — otherwise write mode shows a checkbox while read
      // mode shows a plain bullet for the same line.
      // Ordered markers (1. / 1)) count too: remark renders `1. [ ] x` as a task
      // (number hidden, list-style:none), so we hide the whole marker and show
      // just the checkbox here — matching read mode.
      const tm = /^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\][ \t]/.exec(txt)
      if (tm) {
        const sp = tm[1].length
        const checked = /x/i.test(tm[4])
        const dashStart = line.from + sp
        const cbFrom = dashStart + tm[2].length + tm[3].length, cbTo = cbFrom + 3
        hide(dashStart, cbFrom)
        deco.push(Decoration.replace({ widget: new CheckWidget(checked) }).range(cbFrom, cbTo))
        const nestPad = (Math.floor(sp / 4) * 0.6).toFixed(2)
        const mark = (Math.floor(sp / 4) * 0.6 + sp * 0.25).toFixed(2)
        const hang = (sp * 0.25 + 1.56).toFixed(2)
        // A checked task gets `cm-task-checked` so the theme can grey the label text.
        deco.push(Decoration.line({ class: checked ? 'cm-list-line cm-task-checked' : 'cm-list-line', attributes: { style: `--nest-pad:${nestPad}em;--mark:${mark}em;--hang:${hang}em` } }).range(line.from))
        const tfs = listFoldState(state, line.from)
        if (tfs.foldable) deco.push(Decoration.widget({ widget: new InlineFoldWidget(tfs.folded), side: -1 }).range(dashStart))
        continue
      }
      const bm = /^(\s*)([-*+])(\s+)/.exec(txt)
      if (bm) {
        const sp = bm[1].length
        const f = line.from + sp
        deco.push(Decoration.replace({ widget: new BulletWidget() }).range(f, f + 1))
        const nestPad = (Math.floor(sp / 4) * 0.6).toFixed(2)
        const mark = (Math.floor(sp / 4) * 0.6 + sp * 0.25).toFixed(2)
        const hang = (sp * 0.25 + 0.9 + bm[3].length * 0.25).toFixed(2)
        deco.push(Decoration.line({ class: 'cm-list-line', attributes: { style: `--nest-pad:${nestPad}em;--mark:${mark}em;--hang:${hang}em` } }).range(line.from))
        const bfs = listFoldState(state, line.from)
        if (bfs.foldable) deco.push(Decoration.widget({ widget: new InlineFoldWidget(bfs.folded), side: -1 }).range(f))
        continue
      }
      // Ordered-list number: tint it so it matches the bullet colour (and the
      // reading view's coloured markers). The number text stays editable.
      const om = /^(\s*)(\d+[.)])(\s+)/.exec(txt)
      if (om) {
        const sp = om[1].length
        const f = line.from + sp
        deco.push(Decoration.mark({ class: 'cm-ordered-mark' }).range(f, f + om[2].length))
        const nestPad = (Math.floor(sp / 4) * 0.6).toFixed(2)
        const mark = (Math.floor(sp / 4) * 0.6 + sp * 0.25).toFixed(2)
        const digitCount = om[2].length - 1
        const hang = (sp * 0.25 + digitCount * 0.56 + 0.3 + om[3].length * 0.25).toFixed(2)
        deco.push(Decoration.line({ class: 'cm-list-line', attributes: { style: `--nest-pad:${nestPad}em;--mark:${mark}em;--hang:${hang}em` } }).range(line.from))
        const ofs = listFoldState(state, line.from)
        if (ofs.foldable) deco.push(Decoration.widget({ widget: new InlineFoldWidget(ofs.folded), side: -1 }).range(f))
      }
    }
  }

  return { decorations: Decoration.set(deco, true), atomic: RangeSet.of(atomic, true) }
}

// Union the visible ranges into a single [from,to] span so multi-line nodes and the
// list pass are handled without gaps; the small over-scan (folded gaps) is cheap.
function viewportRanges(view) {
  const vr = view.visibleRanges
  if (!vr.length) return [{ from: 0, to: 0 }]
  return [{ from: vr[0].from, to: vr[vr.length - 1].to }]
}

// ViewPlugin: inline + line decorations for the visible region only.
const inlinePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.compute(view) }
  compute(view) {
    const r = scanInline(view.state, viewportRanges(view))
    this.decorations = r.decorations
    this.atomic = r.atomic
  }
  update(u) {
    // geometryChanged catches lines brought into view by something other than a
    // scroll or edit — chiefly a fold collapsing above them (restoring saved folds
    // on mount) or the editor un-hiding when leaving read mode. Without it those
    // newly-visible lines stay as raw markdown until the next caret move/click.
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged) this.compute(u.view)
  }
}, {
  decorations: v => v.decorations,
  provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic || RangeSet.empty),
})

export const livePreview = inlinePlugin
