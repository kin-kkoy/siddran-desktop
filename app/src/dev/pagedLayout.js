import { EditorView, ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import { StateField, StateEffect, Facet } from '@codemirror/state'

// Paged layout for WRITE mode — Google-Docs / Word style. Text flows top to
// bottom; where a page fills, a gap opens and the text continues below it.
//
// ── The problem this file exists to solve ───────────────────────────────────
// A page break is a fact about PIXELS, not about text: nothing in the markdown
// marks it. It can only be found by measuring rendered text and counting down
// from the top, which means it must be recomputed whenever anything above it
// moves — and measuring requires the text to be RENDERED, while CodeMirror
// deliberately renders only what is visible. Its estimates for off-screen lines
// are 20–46% wrong (measured), so an accurate pass has to force-render the whole
// document: ~200ms at 600 lines, ~900ms at 5,000.
//
// A first version simply did that on a 500ms debounce, and the page boundary
// visibly lurched into place a beat after typing stopped.
//
// ── Why this version keeps up ───────────────────────────────────────────────
// Three things, in order of how much they matter:
//
// 1. EARLY EXIT (the big one, borrowed from LibreOffice Writer's layout
//    invalidation). Most keystrokes do not change a paragraph's height — only
//    the one that pushes a word onto a new wrapped row does, perhaps every
//    60–80 characters. If the edited block's height is unchanged, nothing below
//    it can have moved, so there is nothing to recompute and nothing to redraw.
//    The boundaries simply sit still. Most of what read as "lag" before was
//    actually unnecessary motion.
//
// 2. CACHED GEOMETRY. Each block's natural height is measured once. Repagination
//    is then arithmetic over cached numbers — no rendering, no coordsAtPos.
//    Row offsets (needed only to split a paragraph mid-way) are measured lazily,
//    for the roughly one block per page that straddles a boundary, so memory
//    stays proportional to page count rather than document length.
//
// 3. LOCAL PATCHING. Pressing Enter changes the block structure, but only around
//    the caret — which is on screen, so those blocks can be re-measured in
//    place. The rest of the cache stays valid. A full re-measure happens only on
//    open, on resize, and when the cache genuinely cannot be trusted.
//
// Priming is deferred past first paint, so opening a note is never blocked by
// it; the pages appear a moment later.

// Space between one page's bottom edge and the next page's top edge.
const GAP = 28

// Page margins — the inset from the paper's edge to the text, as in any word
// processor. The usable text height per page is therefore pageH - 2*MARGIN_Y,
// and the vertical space between two pages' TEXT is
// MARGIN_Y + GAP + MARGIN_Y. Without these the text ran flush to the page edge
// and the "paper" read as a box drawn around a paragraph.
const MARGIN_Y = 48
const MARGIN_X = 56

// Page presentation. The dashed boundary rule and the paper look are two
// alternative treatments of the same break; only one should be on at a time.
// Kept as flags rather than deleted code — the rule is likely coming back.
const SHOW_PAGE_CARDS = true
const SHOW_BREAK_RULE = false

export const pageHeight = Facet.define({
  combine: (values) => (values.length ? values[values.length - 1] : 620),
})

// Mirrors the `bookBreaks` setting. 'continue' splits a paragraph across the
// page edge (LaTeX-style); 'keep' moves the whole block to the next page.
export const breakMode = Facet.define({
  combine: (values) => (values.length ? values[values.length - 1] : 'continue'),
})

export const setPagesEffect = StateEffect.define()

export const pagesField = StateField.define({
  create: () => [],
  update(pages, tr) {
    for (const e of tr.effects) if (e.is(setPagesEffect)) return e.value
    // Map through the edit so what is on screen stays pinned to its text while
    // the plugin decides whether anything needs recomputing at all.
    if (tr.docChanged) return pages.map((p) => ({ ...p, from: tr.changes.mapPos(p.from, -1) }))
    return pages
  },
  // `f` rather than naming pagesField: this runs synchronously inside
  // StateField.define, before the const is initialised.
  provide: (f) => EditorView.decorations.compute([f], (state) => buildDeco(state, f)),
})

// Both kinds of break — whole-block and mid-paragraph — are this one inline
// widget. Block decorations attach only between document lines, and a markdown
// paragraph is ONE soft-wrapped line, so splitting one needs an inline widget:
// `display:inline-block; width:100%` claims its own visual row and pushes the
// remainder down. CM measures the line including it, so the height map and the
// caret stay correct.
class PageGapWidget extends WidgetType {
  constructor(h, block = false) { super(); this.h = h; this.block = block }
  eq(other) { return other.h === this.h && other.block === this.block }

  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-page-gap'
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      `display:${this.block ? 'block' : 'inline-block'};width:100%;` +
      `height:${Math.round(this.h)}px;` +
      'vertical-align:top;position:relative;' +
      // The gap is scenery, not text. Without this the browser's caret
      // hit-testing resolves clicks onto it, parking the caret in empty space.
      'pointer-events:none;user-select:none;'

    // A real child element, not a ::before. A pseudo-element here has to survive
    // being generated inside a widget inside a contenteditable with its offset
    // coming from a custom property — it silently rendered nothing.
    if (SHOW_BREAK_RULE) {
      const rule = document.createElement('span')
      rule.className = 'cm-page-rule'
      rule.style.cssText =
        'position:absolute;left:var(--page-rule-left,0px);right:0;' +
        `bottom:${Math.round(GAP / 2)}px;` +
        // Derived from a TEXT tier, not --border-default: `bgBrightness` shifts
        // only the background tiers, so at high brightness the background rises
        // to meet a fixed border colour and the rule vanishes into it.
        'border-top:1px dashed color-mix(in srgb, var(--text-muted) 70%, transparent);' +
        'pointer-events:none;'
      el.appendChild(rule)
    }
    return el
  }

  ignoreEvent() { return true }
}

function buildDeco(state, field) {
  const pages = state.field(field, false) || []
  const deco = []
  for (const p of pages) {
    if (!p.pad) continue
    const pos = Math.max(0, Math.min(p.from, state.doc.length))

    if (p.inline) {
      // Mid-paragraph: must be an inline widget, because the break is inside a
      // single soft-wrapped document line.
      deco.push(Decoration.widget({ widget: new PageGapWidget(p.pad), side: -1 }).range(pos))
      continue
    }

    // Whole-block break: a BLOCK widget, sitting between blocks.
    //
    // An inline widget here is swallowed when the next block is atomic. A
    // rendered table is a block `Decoration.replace` covering its whole range,
    // so an inline widget at the table's start position falls inside that
    // replacement and never renders — which is why a table butted straight up
    // against the page edge with no gap in front of it.
    const line = state.doc.lineAt(pos)
    deco.push(
      Decoration.widget({ widget: new PageGapWidget(p.pad, true), block: true, side: -1 })
        .range(line.from),
    )
  }
  return Decoration.set(deco, true)
}

// ── Measurement ─────────────────────────────────────────────────────────────

const gapsIn = (pages, from, to) =>
  pages.filter((p) => p.pad && p.from >= from && p.from <= to)

const gapSum = (gaps) => gaps.reduce((s, g) => s + g.pad, 0)

// Offsets of each wrapped row inside a block, in its own gap-free space. Only
// needed for blocks that actually straddle a page boundary, so it is measured
// lazily rather than for the whole document.
function measureRows(view, line, gaps) {
  let node
  try { node = view.domAtPos(line.from).node } catch { return null }
  let el = node && node.nodeType === 1 ? node : node && node.parentElement
  el = el && el.closest ? el.closest('.cm-line') : null
  if (!el) return null

  const box = el.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0)

  const above = (pos) => gaps.reduce((s, g) => (g.from <= pos ? s + g.pad : s), 0)
  const rows = []
  let lastTop = -Infinity
  for (const r of rects) {
    if (r.top - lastTop < 2) continue
    lastTop = r.top
    const pos = view.posAtCoords({ x: r.left + 1, y: r.top + Math.min(4, r.height / 2) })
    if (pos == null) continue
    rows.push({ y: (r.top - box.top) - above(pos), pos })
  }
  return rows
}

// One geometry entry per block. `rows` is undefined until someone needs to split
// this block, null once measured and found unsplittable.
function blockEntry(view, block, pages) {
  const line = view.state.doc.lineAt(block.from)
  const gaps = gapsIn(pages, block.from, block.to)
  return {
    from: block.from,
    to: block.to,
    // A block spanning more than one document line is a merged widget (a
    // rendered table) — atomic, and it must move whole rather than be split.
    splittable: line.to === block.to,
    h: Math.max(0, (Number.isFinite(block.height) ? block.height : 0) - gapSum(gaps)),
    rows: undefined,
    stale: false,
  }
}

// Walk every block. Must run with the whole document rendered.
function buildGeometry(view, pages) {
  const doc = view.state.doc
  const geom = []
  let pos = 0
  let guard = 0
  while (pos <= doc.length && guard++ < 200000) {
    const block = view.lineBlockAt(pos)
    if (!block) break
    geom.push(blockEntry(view, block, pages))
    const next = block.to + 1
    if (next <= pos) break
    pos = next
  }
  return geom
}

// ── Pagination ──────────────────────────────────────────────────────────────

// Pure arithmetic over cached geometry. `getRows(entry)` is called only for a
// block that straddles a boundary and may return null, in which case the block
// moves whole instead of being split.
//
// Each break carries the padding needed to fill out the page it ends PLUS the
// gap, so every page is exactly `pageH` tall regardless of where its content
// fell.
function computePages(geom, pageH, mode, getRows) {
  // Text only occupies the page between its margins.
  const usable = Math.max(40, pageH - 2 * MARGIN_Y)
  // Filling out the rest of one page, then its bottom margin, the gap, and the
  // next page's top margin.
  const between = MARGIN_Y + GAP + MARGIN_Y

  const pages = [{ from: 0, pad: 0, inline: false }]
  let acc = 0
  let incomplete = false

  for (const b of geom) {
    if (acc + b.h <= usable || acc === 0) {
      acc += b.h
      continue
    }

    let split = false
    if (mode === 'continue' && b.splittable && b.h > 0) {
      const rows = getRows(b)
      if (rows == null) incomplete = true
      if (rows && rows.length > 1) {
        let consumed = 0
        let guard = 0
        while (acc + (b.h - consumed) > usable && guard++ < 400) {
          const target = consumed + (usable - acc)
          const row = rows.find((r) => r.y >= target && r.y > consumed && r.pos > b.from)
          if (!row || row.pos >= b.to) break
          pages.push({
            from: row.pos,
            pad: (usable - acc - (row.y - consumed)) + between,
            inline: true,
          })
          acc = 0
          consumed = row.y
          split = true
        }
        if (split) acc = b.h - consumed
      }
    }

    if (!split) {
      pages.push({ from: b.from, pad: (usable - acc) + between, inline: false })
      acc = b.h
    }
  }
  return { pages, incomplete }
}

const samePages = (a, b) =>
  a.length === b.length &&
  a.every((p, i) => p.from === b[i].from && p.inline === b[i].inline &&
    Math.abs(p.pad - b[i].pad) < 0.5)

// ── Plugin ──────────────────────────────────────────────────────────────────

const pagedPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view
    this.geom = null
    this.frame = 0
    this.idle = 0
    this.dirty = null // {from, to} document range whose block structure changed
    this.width = view.contentDOM.clientWidth // only a WIDTH change invalidates
    if (SHOW_PAGE_CARDS) {
      // Behind the text, inside the scroller so it scrolls with the content.
      // Not inside .cm-content — CM owns those children and syncs them against
      // the document.
      this.layer = document.createElement('div')
      this.layer.className = 'cm-page-layer'
      this.layer.setAttribute('aria-hidden', 'true')
      view.scrollDOM.insertBefore(this.layer, view.scrollDOM.firstChild)
    }
    this.syncGutter()
    // Deferred so opening a note is never blocked by the measure pass; the
    // pages appear a moment after the text does.
    this.idle = (window.requestIdleCallback || window.setTimeout)(
      () => { this.idle = 0; this.prime() }, { timeout: 300 })
  }

  // The dashed rule reaches past the fold gutter to the editor's left edge. The
  // gutter is a flex sibling of the content, so the content's own offsetLeft IS
  // the gutter width.
  syncGutter() {
    const view = this.view
    view.dom.style.setProperty('--page-rule-left', `${-(view.contentDOM.offsetLeft || 0)}px`)
  }

  update(update) {
    // Our OWN page dispatch changes every gap's height, which CM reports back as
    // a geometry change — which used to invalidate the cache and trigger another
    // full pass, which dispatched again. That loop is the flicker seen when
    // pressing Enter near a page edge: it only stopped once the pagination
    // happened to land on the same answer twice. Ignore transactions we caused.
    if (update.transactions.some((tr) => tr.effects.some((e) => e.is(setPagesEffect)))) {
      if (SHOW_PAGE_CARDS) this.drawCards()
      return
    }

    const cfgChanged =
      update.startState.facet(pageHeight) !== update.state.facet(pageHeight) ||
      update.startState.facet(breakMode) !== update.state.facet(breakMode)

    if (cfgChanged) {
      this.geom = null
      this.schedule()
      return
    }

    if (update.geometryChanged && !update.docChanged) {
      // A geometry change alone is NOT a reason to throw the cache away.
      //
      // Applying page gaps changes every gap's height, and CM reports that back
      // as a geometry change on a later measure cycle — with NO transaction
      // attached, so it cannot be recognised by effect. Treating it as "the
      // world moved" invalidated the cache, forced a full pass, dispatched
      // again, and looped: that is the flicker, and it survived the
      // transaction-level guard above precisely because there is no transaction.
      //
      // Width is the honest signal. Line wrapping — and therefore every break —
      // depends on it, and our own gaps only ever change HEIGHT. So invalidate
      // only when the text column actually got wider or narrower.
      const w = this.view.contentDOM.clientWidth
      if (w !== this.width) {
        this.width = w
        this.geom = null
        this.schedule()
      } else if (SHOW_PAGE_CARDS) {
        this.drawCards()
      }
      return
    }

    if (update.docChanged) {
      if (this.geom) {
        let structural = false
        update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
          if (inserted.lines > 1 || update.startState.doc.sliceString(fromA, toA).includes('\n')) {
            structural = true
          }
          this.dirty = this.dirty
            ? { from: Math.min(this.dirty.from, fromB), to: Math.max(this.dirty.to, toB) }
            : { from: fromB, to: toB }
        })
        for (const b of this.geom) {
          if (update.changes.touchesRange(b.from, b.to)) b.stale = true
          b.from = update.changes.mapPos(b.from, -1)
          b.to = update.changes.mapPos(b.to, 1)
        }
        if (structural) this.structural = true
      }
      this.schedule()
    }
  }

  // Next frame, not a debounce. Early exit means most of these do no work at
  // all, so there is nothing to hold back.
  schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.recompute() })
  }

  // Render the whole document, measure it, return to virtualisation.
  withFullRender(fn) {
    const view = this.view
    try {
      view.viewState.printing = true
      view.measure()
      return fn()
    } finally {
      view.viewState.printing = false
      view.requestMeasure()
    }
  }

  prime() {
    const view = this.view
    if (!view.dom.isConnected) return
    const pages = view.state.field(pagesField, false) || []
    this.geom = this.withFullRender(() => {
      const geom = buildGeometry(view, pages)
      // Row offsets are needed only where a block straddles a boundary, and this
      // is the one moment the whole document is rendered — so resolve them now,
      // inside the same window, rather than paying for another full render.
      const mode = view.state.facet(breakMode)
      computePages(geom, view.state.facet(pageHeight), mode, (b) => this.rowsFor(b, pages))
      return geom
    })
    this.structural = false
    this.dirty = null
    this.apply()
  }

  rowsFor(b, pages) {
    if (b.rows !== undefined) return b.rows
    const view = this.view
    if (b.from > view.state.doc.length) return null
    const line = view.state.doc.lineAt(b.from)
    b.rows = measureRows(view, line, gapsIn(pages, b.from, b.to))
    return b.rows
  }

  // Re-measure the blocks the last edit touched, in place. They are the blocks
  // being typed in, so they are on screen. Returns false when the cache can no
  // longer be trusted and a full pass is needed.
  //
  // THE EARLY EXIT lives here: if every touched block came back the same height,
  // nothing below it moved, so the caller skips repagination entirely.
  refreshStale() {
    const view = this.view
    const doc = view.state.doc
    const pages = (view.state.field(pagesField, false) || []).filter((p) => p.pad)
    let heightChanged = false

    for (const b of this.geom) {
      if (!b.stale) continue
      if (b.from > doc.length) return { ok: false }
      const block = view.lineBlockAt(b.from)
      if (!block) return { ok: false }
      const gaps = gapsIn(pages, block.from, block.to)
      const line = doc.lineAt(block.from)
      const h = Math.max(0, (Number.isFinite(block.height) ? block.height : 0) - gapSum(gaps))

      if (Math.abs(h - b.h) > 0.5) heightChanged = true

      // A break INSIDE this block must be re-derived even when the block's total
      // height is unchanged. The break is a document offset that maps forward
      // through the edit, so after typing it no longer sits at the start of a
      // wrapped row — the gap widget then splits a row mid-way, leaving a ragged
      // short line, and each further keystroke ratchets it further out of
      // alignment. It also stops text ever flowing back up when you delete.
      // Total height cannot detect any of that, so force a recompute.
      if (pages.some((p) => p.from > block.from && p.from <= block.to)) heightChanged = true

      b.from = block.from
      b.to = block.to
      b.h = h
      b.splittable = line.to === block.to
      b.rows = undefined // its wrapping changed; re-measure only if needed
      b.stale = false
    }
    return { ok: true, heightChanged }
  }

  // Enter/paste/delete-newline changes the block structure around the caret.
  // Rebuild just those entries from the live DOM and keep the rest of the cache.
  patchStructure() {
    const view = this.view
    const doc = view.state.doc
    const pages = view.state.field(pagesField, false) || []
    const range = this.dirty
    if (!range) return false

    const from = Math.max(0, Math.min(range.from, doc.length))
    const to = Math.max(from, Math.min(range.to, doc.length))

    let first = this.geom.findIndex((b) => b.to >= from)
    if (first < 0) first = this.geom.length
    let last = first
    while (last < this.geom.length && this.geom[last].from <= to) last += 1

    const startPos = first < this.geom.length ? Math.min(this.geom[first].from, from) : from
    const endPos = last > 0 && last - 1 < this.geom.length
      ? Math.max(this.geom[last - 1].to, to) : to

    const rebuilt = []
    let pos = Math.max(0, Math.min(startPos, doc.length))
    let guard = 0
    while (pos <= Math.min(endPos, doc.length) && guard++ < 10000) {
      const block = view.lineBlockAt(pos)
      if (!block) return false
      rebuilt.push(blockEntry(view, block, pages))
      const next = block.to + 1
      if (next <= pos) return false
      pos = next
    }
    this.geom.splice(first, last - first, ...rebuilt)
    return true
  }

  recompute() {
    const view = this.view
    if (!view.dom.isConnected) return
    if (!this.geom) {
      if (!this.idle) this.prime()
      return
    }

    let needsFull = false
    if (this.structural) {
      this.structural = false
      if (!this.patchStructure()) needsFull = true
    }

    if (!needsFull) {
      const res = this.refreshStale()
      if (!res.ok) needsFull = true
      // ── EARLY EXIT ──
      // No touched block changed height and the structure is intact, so no page
      // boundary can have moved. Do nothing at all: no recompute, no dispatch,
      // no reflow. This is what keeps the boundaries still while you type.
      else if (!res.heightChanged && !this.dirty) return
    }

    this.dirty = null
    if (needsFull) { this.prime(); return }
    this.apply()
  }

  apply() {
    const view = this.view
    if (!this.geom) return
    const pages = view.state.field(pagesField, false) || []
    const { pages: next, incomplete } = computePages(
      this.geom,
      view.state.facet(pageHeight),
      view.state.facet(breakMode),
      (b) => this.rowsFor(b, pages),
    )
    if (!samePages(next, pages)) {
      view.dispatch({ effects: setPagesEffect.of(next) })
    } else if (SHOW_PAGE_CARDS) {
      this.drawCards()
    }
    // A block needed splitting but was off-screen, so its rows could not be
    // measured and it moved whole instead. Re-prime when idle to resolve it,
    // rather than leaving the pagination subtly wrong.
    if (incomplete && !this.idle) {
      this.idle = (window.requestIdleCallback || window.setTimeout)(
        () => { this.idle = 0; this.prime() }, { timeout: 500 })
    }
  }

  // Every page is padded to exactly pageH, so page k sits at k * (pageH + GAP).
  // No per-card measurement, and the cards cannot drift out of step with the
  // text they frame.
  drawCards() {
    const view = this.view
    if (!this.layer || !view.dom.isConnected) return
    const pages = view.state.field(pagesField, false) || []
    const h = view.state.facet(pageHeight)
    const content = view.contentDOM

    // Aligned to the CONTENT box, not the scroller: the scroller also holds the
    // fold gutter, so a full-width layer puts the page edges in the wrong place.
    // No padding offset here — the content's top padding IS the first page's top
    // margin, so the card starts where the content box starts.
    this.layer.style.left = `${content.offsetLeft}px`
    this.layer.style.width = `${content.offsetWidth}px`
    this.layer.style.top = `${content.offsetTop}px`

    while (this.layer.childElementCount > pages.length) this.layer.lastChild.remove()
    while (this.layer.childElementCount < pages.length) {
      const card = document.createElement('div')
      card.className = 'cm-page-card'
      this.layer.appendChild(card)
    }
    for (let i = 0; i < pages.length; i++) {
      const card = this.layer.children[i]
      card.style.top = `${i * (h + GAP)}px`
      card.style.height = `${h}px`
    }
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.layer?.remove()
    if (this.idle && window.cancelIdleCallback) window.cancelIdleCallback(this.idle)
    this.view?.dom.style.removeProperty('--page-rule-left')
    // Leaving `printing` on would silently render every document in full for the
    // rest of the session.
    if (this.view?.dom.isConnected) {
      this.view.viewState.printing = false
      this.view.requestMeasure()
    }
  }
})

const pagedTheme = EditorView.theme({
  '.cm-content': {
    // The page margins. The top padding is page 1's top margin, which is why
    // drawCards places card 0 at the content box's top rather than after it.
    padding: `${MARGIN_Y}px ${MARGIN_X}px`,
  },
  '.cm-page-layer': {
    position: 'absolute',
    pointerEvents: 'none',
    // MUST sit below CM's own layers. drawSelection's selection layer is a
    // sibling in this stacking context at z-index -1 (@codemirror/view:9400 —
    // `(above ? 150 : -1) - pos`), so a card layer at 0 paints over it and
    // selection highlighting goes invisible wherever a page card is.
    zIndex: '-30',
  },
  '.cm-page-card': {
    position: 'absolute',
    left: '0',
    right: '0',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: '10px',
  },
})

export function pagedLayout(h = 620, breaks = 'continue') {
  return [pageHeight.of(h), breakMode.of(breaks), pagesField, pagedPlugin, pagedTheme]
}
