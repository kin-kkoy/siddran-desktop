// TEMPORARY — throwaway spike for Book (two-page) layout in WRITE mode.
// Delete app/src/dev/ and the /dev/book-spike route once it has answered its
// questions. See references/plan-book-write-mode.md.
//
// This page does NOT import or modify CodeMirrorEditor.jsx, cm/*, ReadingView.jsx
// or settings. It stands up its own EditorView with the REAL extension stack and
// instruments it, because the thing under test is exactly what the decoration
// pass costs when CM's viewport is widened to the whole document.
//
// ── The problem, precisely ────────────────────────────────────────────────────
// CM6 virtualises: it renders only the lines it believes are visible. The single
// lever for full render is `viewState.printing`, at
// @codemirror/view/dist/index.js:6321:
//     let pixelViewport = (this.printing ? fullPixelRange : visiblePixelRange)(dom, ...)
// where `dom` is `view.contentDOM` (:6273) and
//     fullPixelRange = { top: paddingTop, bottom: rect.bottom - (rect.top + paddingTop) }
// i.e. the content element's own BORDER-BOX height.
//
// CSS multi-column needs a *definite* height on the multicol container to
// fragment into horizontally overflowing columns (`column-fill: auto`). So
// `.cm-content` gets `height: pageH` — which collapses the very box
// fullPixelRange measures. Printing alone therefore buys a viewport of one page,
// not the document. That is MECHANISM 1, and it is expected to under-render; it
// is included because it must be measured rather than assumed.
//
// MECHANISM 2 is the interesting one: `box-sizing: content-box` +
// `height: pageH` + an enormous `padding-bottom`. The multicol engine fragments
// against the CONTENT box (pageH, so columns still break per page), while
// getBoundingClientRect returns the BORDER box (huge, so fullPixelRange reports
// a viewport tall enough to cover the whole document). The outer viewport's
// `overflow: hidden` clips the padding away. Pure CSS, no private API.
//
// MECHANISM 3 overrides `viewState.pixelViewport` directly. Private API; if this
// is what it takes, that is a standing maintenance cost against the approach and
// gets reported as such.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { EditorView, keymap, drawSelection, tooltips, placeholder as cmPlaceholder, Decoration, WidgetType } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

// The real stack — every decoration source the production editor mounts.
import { livePreview } from '../components/Editor/cm/livePreview'
import { liveTables, tableTypingGuard, tableKeymap } from '../components/Editor/cm/tables'
import { collapseTableGap } from '../components/Editor/cm/tableGap'
import { domVerticalMotion } from '../components/Editor/cm/verticalMotion'
import { codeCopy } from '../components/Editor/cm/codeCopy'
import { imageExtensions } from '../components/Editor/cm/imagePaste'
import { wikilinks, wikilinkMarkdownExtension, resolveNote } from '../components/Editor/cm/wikilinks'
import { obsidianSyntax } from '../components/Editor/cm/syntaxNodes'
import { headingFold } from '../components/Editor/cm/fold'
import { commentsExtension, setCommentsEffect } from '../components/Editor/cm/comments'
import { listEditingKeymap, listIndentNormalizer, enterIndent } from '../components/Editor/cm/listEditing'
import { formattingKeymap } from '../components/Editor/cm/formatting'
import { searchExtension } from '../components/Editor/cm/search'
import { cinderHighlightStyle } from '../components/Editor/cm/highlight'
import { cinderTheme } from '../components/Editor/cm/theme'

import { generateNote, generateComments } from './bookSpikeDoc'
import realNoteRaw from './realNote.md?raw'
import styles from './BookSpike.module.css'

const PAD_LIE = 1000000 // px of padding-bottom for mechanism 2 (see header)

const MECHANISMS = {
  1: 'printing flag only',
  2: 'printing + content-box padding lie (CSS only)',
  3: 'pixelViewport override (private API)',
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(r))
const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (xs, p) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const r1 = (n) => Math.round(n * 10) / 10

// The real-note fixture ships with placeholder prose; treat it as absent until
// the user actually pastes something, so the dropdown can say so.
const REAL_NOTE_READY = !realNoteRaw.startsWith('Paste your biggest real note here')

export default function BookSpike() {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const contentRef = useRef(null)

  const [docKind, setDocKind] = useState('1500')
  const [mechanism, setMechanism] = useState(2)
  const [pageH, setPageH] = useState(620)
  const [breaks, setBreaks] = useState('continue')

  const [spread, setSpread] = useState(0)
  const [geom, setGeom] = useState({ step: 0, total: 1 })
  const [vp, setVp] = useState({ from: 0, to: 0, len: 0, lines: 0, gaps: 0 })
  const [scrollDrift, setScrollDrift] = useState({ left: 0, top: 0, maxLeft: 0, maxTop: 0 })
  const [warnings, setWarnings] = useState([])
  const [log, setLog] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // The auto-run needs to read warnings and scroll drift synchronously mid-sweep,
  // before React has re-rendered, so mirror both into refs.
  const warningsRef = useRef([])
  const scrollDriftRef = useRef({ maxLeft: 0, maxTop: 0 })
  // Mirrors of the two restyle knobs, so the build effect can read them without
  // taking them as dependencies (see the build effect for why that matters).
  const mechanismRef = useRef(mechanism)
  const pageHRef = useRef(pageH)
  useEffect(() => { mechanismRef.current = mechanism }, [mechanism])
  useEffect(() => { pageHRef.current = pageH }, [pageH])

  const doc = useMemo(() => {
    if (docKind === 'real') return REAL_NOTE_READY ? realNoteRaw : generateNote(1500)
    return generateNote(Number(docKind))
  }, [docKind])

  // ── Q1 early abort: mirror CM's measure-loop warnings ──────────────────────
  // CM gives up after 5 restarts and warns at index.js:8124. The guard emits two
  // different strings depending on whether measure requests are pending:
  //   "Measure loop restarted more than 5 times" — measureRequests non-empty
  //   "Viewport failed to stabilize"            — measureRequests empty
  // Pure viewport oscillation (what printing-while-short would cause) hits the
  // SECOND. Either one is a Q1 failure even if the columns look correct.
  useEffect(() => {
    const original = console.warn
    console.warn = (...args) => {
      const msg = args.map(String).join(' ')
      if (/Measure loop restarted|Viewport failed to stabilize/.test(msg)) {
        if (!warningsRef.current.includes(msg)) warningsRef.current = [...warningsRef.current, msg]
        setWarnings((w) => (w.includes(msg) ? w : [...w, msg]))
      }
      original.apply(console, args)
    }
    return () => { console.warn = original }
  }, [])

  // Reset per-run state whenever the thing under test changes.
  useEffect(() => {
    warningsRef.current = []
    setWarnings([])
    setSpread(0)
    scrollDriftRef.current = { left: 0, top: 0, maxLeft: 0, maxTop: 0 }
    setScrollDrift({ left: 0, top: 0, maxLeft: 0, maxTop: 0 })
  }, [docKind, mechanism, pageH, breaks])

  // ── build the editor ───────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = buildView(host, doc)
    viewRef.current = view
    contentRef.current = view.contentDOM

    // Read mechanism/pageH from refs, NOT from the closure: if they were deps of
    // this effect, changing either would tear the view down — and an auto-run
    // that switches mechanism mid-sweep would then be benchmarking a destroyed,
    // detached instance. (That bug produced clientWidth 0, null coords, and a
    // stale viewport length on the first real run.)
    applyMechanism(view, mechanismRef.current, pageHRef.current)

    // Seed comment anchors so the comment StateField and its mark decorations
    // are doing real work during the keystroke benchmark.
    const anchors = generateComments(doc, 24)
    if (anchors.length) view.dispatch({ effects: setCommentsEffect.of(anchors) })

    // Q6 — CM may set scrollLeft/scrollTop on a short, wide scroller while the
    // transform does the paging. Record the worst drift seen, not just current.
    const scroller = view.scrollDOM
    const onScroll = () => {
      const next = {
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
        maxLeft: Math.max(scrollDriftRef.current.maxLeft, Math.abs(scroller.scrollLeft)),
        maxTop: Math.max(scrollDriftRef.current.maxTop, Math.abs(scroller.scrollTop)),
      }
      scrollDriftRef.current = next
      setScrollDrift(next)
    }
    scroller.addEventListener('scroll', onScroll)

    const id = requestAnimationFrame(() => { measureGeometry(); readViewport() })

    return () => {
      cancelAnimationFrame(id)
      scroller.removeEventListener('scroll', onScroll)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // Mechanism / page height are pure restyles — applied to the LIVE view, never
  // by rebuilding it. This is what keeps a mechanism sweep from destroying the
  // instance under test.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !view.dom.isConnected) return
    applyMechanism(view, mechanism, pageH)
    view.requestMeasure()
    requestAnimationFrame(() => { measureGeometry(); readViewport() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageH, breaks, mechanism])

  // ── Q2: the reading view's paging maths, applied to .cm-content ────────────
  // Identical to ReadingView.jsx:66-72 — column gap + clientWidth = one spread's
  // step; scrollWidth over that = spread count.
  const measureGeometry = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0
    const step = el.clientWidth + gap
    if (!step) return
    setGeom({ step, total: Math.max(1, Math.round((el.scrollWidth + gap) / step)) })
  }, [])

  // ── Q1: did CM actually render the whole document? ─────────────────────────
  const readViewport = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    setVp({
      from: view.viewport.from,
      to: view.viewport.to,
      len: view.state.doc.length,
      lines: view.contentDOM.querySelectorAll('.cm-line').length,
      // Line gaps fire above 4000 chars of viewport (index.js:6373, :6263) —
      // under full render that is the DEFAULT path on any real note, not an
      // edge case, so their placeholders are a primary check.
      gaps: view.contentDOM.querySelectorAll('.cm-gap').length,
    })
  }, [])

  useEffect(() => {
    const t = setInterval(() => { readViewport(); measureGeometry() }, 700)
    return () => clearInterval(t)
  }, [readViewport, measureGeometry])

  // ── paging (transform, exactly as ReadingView does it) ─────────────────────
  const go = useCallback((d) => {
    setSpread((cur) => Math.max(0, Math.min(cur + d, geom.total - 1)))
  }, [geom.total])

  useEffect(() => {
    const host = hostRef.current
    if (host) host.style.transform = `translateX(${-spread * geom.step}px)`
  }, [spread, geom.step])

  // ── Q3: mount cost ─────────────────────────────────────────────────────────
  const benchMount = useCallback(async () => {
    setBusy(true)
    const times = []
    const scratch = document.createElement('div')
    scratch.style.cssText = 'position:absolute;left:-99999px;top:0;width:900px;'
    document.body.appendChild(scratch)
    try {
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        const v = buildView(scratch, doc)
        applyMechanism(v, mechanism, pageH)
        v.contentDOM.getBoundingClientRect() // force layout, don't just build state
        await nextFrame()
        times.push(performance.now() - t0)
        v.destroy()
      }
    } finally {
      scratch.remove()
      setBusy(false)
    }
    appendLog(setLog, [
      `── Q3 MOUNT — ${describeRun(docKind, doc, mechanism, pageH)}`,
      `   runs   : ${times.map(r1).join(', ')} ms`,
      `   median : ${r1(median(times))} ms`,
      '',
    ])
  }, [doc, docKind, mechanism, pageH])

  // ── Q4: keystroke cost, ONE PER FRAME ──────────────────────────────────────
  // A synchronous burst measures transaction handling and misses layout+paint
  // entirely — which is the cost we actually care about. dispatch, then wait two
  // rAFs (one to schedule, one to land after paint), then record.
  const benchKeystrokes = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    setBusy(true)

    const longTasks = []
    let observer = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push(e.duration)
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { /* Firefox has no longtask observer — the medians still stand */ }

    const N = 200
    const len = view.state.doc.length
    const positions = [
      ['start', Math.min(200, len)],
      ['middle', Math.floor(len / 2)],
      ['end', Math.max(0, len - 200)],
    ]
    const out = [`── Q4 KEYSTROKES — ${describeRun(docKind, doc, mechanism, pageH)}`]

    for (const [name, basePos] of positions) {
      const times = []
      for (let i = 0; i < N; i++) {
        const pos = Math.min(basePos + i, view.state.doc.length)
        // Paced one per frame, TIMED synchronously — see the auto-run's Q4 note:
        // timing across the rAF waits measures the frame clock, not the work.
        const t0 = performance.now()
        view.dispatch({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 } })
        view.contentDOM.getBoundingClientRect() // force sync style+layout flush
        times.push(performance.now() - t0)
        await nextFrame()
      }
      // Undo the insertions so the next position measures the same document.
      view.dispatch({ changes: { from: basePos, to: basePos + N, insert: '' } })
      await nextFrame()

      const med = median(times)
      out.push(
        `   ${name.padEnd(7)} median ${String(r1(med)).padStart(6)} ms` +
        `   p95 ${String(r1(pct(times, 95))).padStart(6)} ms` +
        `   ${band(med)}`,
      )
    }

    observer?.disconnect()
    if (longTasks.length) {
      out.push(`   long tasks: ${longTasks.length}, worst ${r1(Math.max(...longTasks))} ms`)
    }
    out.push('')
    appendLog(setLog, out)
    setBusy(false)
  }, [docKind, doc, mechanism, pageH])

  // ── Q5 probe: does coordsAtPos still return sane rects under columns? ──────
  const probeCaret = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    appendLog(setLog, [...runCaretProbe(view), ''])
  }, [])

  // ── Mid-paragraph break test ──────────────────────────────────────────────
  const runInlineBreakTest = useCallback(async () => {
    setBusy(true)
    setLog('')
    const out = []
    const say = (s) => { out.push(s); setLog(out.join('\n') + '\n') }
    const check = (label, ok, detail) =>
      say(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)

    say('════ MID-PARAGRAPH BREAK (inline widget) ════')
    say('Can a page break land INSIDE a soft-wrapped paragraph?')
    say('If yes: "Continue" works and a 4-line paragraph stops jumping whole.')
    say('')

    // One long paragraph as a SINGLE document line, so it can only be split
    // mid-line — exactly the case that defeats block decorations.
    const para = ('The quick brown fox jumps over the lazy dog while the '
      + 'compositor reflows another paragraph of prose that must wrap across '
      + 'a great many visual rows before it reaches its end. ').repeat(14).trim()
    const text = `# Mid-paragraph break test\n\n${para}\n\nA short trailing paragraph.\n`

    const stage = document.createElement('div')
    stage.style.cssText =
      'position:fixed;left:0;top:0;width:820px;height:900px;overflow:auto;' +
      'z-index:9999;background:var(--bg-surface);'
    document.body.appendChild(stage)

    const holder = document.createElement('div')
    stage.appendChild(holder)
    const v = new EditorView({
      parent: holder,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorView.lineWrapping,
          gapField,
          cinderTheme,
          domVerticalMotion,
          drawSelection(),
          keymap.of(defaultKeymap),
          EditorView.editable.of(true),
        ],
      }),
    })
    for (let i = 0; i < 4; i++) await nextFrame()

    try {
      const GAP_H = 140
      const line = v.state.doc.line(3) // the long paragraph
      const blockBefore = v.lineBlockAt(line.from)
      const lineTop = v.coordsAtPos(line.from)
      say(`paragraph: ${line.length} chars, rendered ${Math.round(blockBefore.height)}px tall`)

      // Break roughly a third of the way down the paragraph.
      const threshold = lineTop.top + blockBefore.height / 3
      const breakPos = posAtRowCrossing(v, line, threshold)
      const rowsSpanned = Math.round(blockBefore.height / (v.defaultLineHeight || 24))
      say(`wraps to ~${rowsSpanned} visual rows; breaking at offset ${breakPos - line.from} of ${line.length}`)
      check('break position is strictly inside the paragraph',
        breakPos > line.from && breakPos < line.to,
        `pos ${breakPos}, line ${line.from}–${line.to}`)

      const beforeCoords = v.coordsAtPos(breakPos)
      const docTextBefore = v.state.doc.toString()

      v.dispatch({ effects: setGapEffect.of({ pos: breakPos, h: GAP_H }) })
      for (let i = 0; i < 4; i++) await nextFrame()

      // 1. Did the paragraph actually get taller by the gap?
      const blockAfter = v.lineBlockAt(line.from)
      const grew = blockAfter.height - blockBefore.height
      check('CM height map accounts for the widget',
        Math.abs(grew - GAP_H) < 6,
        `line grew ${Math.round(grew)}px, expected ~${GAP_H}`)

      // 2. Did the text after the break move DOWN by the gap (a real break),
      //    rather than the widget merely being squeezed onto an existing row?
      const afterCoords = v.coordsAtPos(breakPos)
      const pushed = afterCoords.top - beforeCoords.top
      check('text after the break moved down by the gap',
        Math.abs(pushed - GAP_H) < 12,
        `moved ${Math.round(pushed)}px`)

      // 3. Is the continuation at the start of a fresh visual row?
      check('continuation starts a new visual row',
        afterCoords.left < lineTop.left + 24,
        `x=${Math.round(afterCoords.left)} vs line start x=${Math.round(lineTop.left)}`)

      // 4. Document text untouched — the widget is decoration, not content.
      check('document text unchanged', v.state.doc.toString() === docTextBefore)

      // 5. THE ONE THAT MATTERS: browser hit-testing on both sides. This is what
      //    verticalMotion.js uses for clicks and Arrow-Up/Down; if it breaks
      //    here, the caret is unusable regardless of how good the layout looks.
      const probe = (pos, tag) => {
        const c = v.coordsAtPos(pos)
        if (!c) { check(`hit-test ${tag}`, false, 'no coords'); return }
        const back = pointToPos(v, c.left + 1, (c.top + c.bottom) / 2)
        check(`hit-test round-trip ${tag}`,
          back != null && Math.abs(back - pos) <= 2,
          `pos ${pos} → ${back}`)
      }
      probe(breakPos - 40, 'before the break')
      probe(breakPos + 40, 'after the break')

      // 6. Arrow-Down across the gap, through the real keymap path.
      v.focus()
      v.dispatch({ selection: { anchor: breakPos - 5 } })
      await nextFrame()
      const headBefore = v.state.selection.main.head
      const moved = moveVerticalLike(v, true)
      check('Arrow-Down crosses the gap without leaping',
        moved != null && moved > headBefore && moved - headBefore < line.length / 2,
        `${headBefore} → ${moved}`)

      // 7. Typing right before the break must not corrupt the layout.
      v.dispatch({ changes: { from: breakPos - 1, insert: 'ZZZ' } })
      for (let i = 0; i < 3; i++) await nextFrame()
      const blockTyped = v.lineBlockAt(v.state.doc.line(3).from)
      check('still one paragraph, gap intact after typing',
        Math.abs(blockTyped.height - blockAfter.height) < 40,
        `height ${Math.round(blockAfter.height)} → ${Math.round(blockTyped.height)}`)

      say('')
      const fails = out.filter((l) => l.includes('FAIL')).length
      say(fails === 0
        ? '→ VIABLE. Mid-paragraph breaks work; "Continue" is buildable.'
        : `→ ${fails} check(s) failed. See above; if the hit-test or Arrow-Down`
          + ' ones failed, this approach is not worth pursuing.')
    } catch (err) {
      say(`EXCEPTION: ${err && err.message ? err.message : String(err)}`)
      say('→ NOT VIABLE (threw)')
    } finally {
      v.destroy()
      stage.remove()
      setLog(out.join('\n') + '\n')
      setProgress('')
      setBusy(false)
    }
  }, [])

  // ── Vertical-pages drift check ────────────────────────────────────────────
  // Deliberately its own run: it tests a DIFFERENT architecture (normal
  // virtualised vertical flow, no columns, no printing) and needs a real
  // scrolling container, so it cannot share the book-layout editor.
  const runDriftCheck = useCallback(async () => {
    setBusy(true)
    setLog('')
    const out = []
    const say = (s) => { out.push(s); setLog(out.join('\n') + '\n') }

    say('════ VERTICAL PAGES — BREAK-POSITION DRIFT ════')
    say('Normal virtualised editor, no columns, no full render.')
    say('Question: how far do page breaks move once real heights are known?')
    say('')

    const stage = document.createElement('div')
    stage.style.cssText =
      'position:fixed;left:0;top:0;width:900px;height:800px;overflow:hidden;' +
      'z-index:9999;background:var(--bg-surface);visibility:hidden;'
    document.body.appendChild(stage)

    const docs = [
      ['synthetic 1,500', generateNote(1500)],
      ['synthetic 5,000', generateNote(5000)],
      ...(REAL_NOTE_READY ? [['REAL NOTE', realNoteRaw]] : []),
    ]

    for (const [label, text] of docs) {
      setProgress(`Drift — ${label}…`)
      const holder = document.createElement('div')
      stage.appendChild(holder)
      const v = buildView(holder, text, 'full')
      // CM owns the scroll here so the test can drive it directly. The height
      // model behaves the same either way; only the scroll driver differs.
      v.dom.style.height = '800px'
      v.scrollDOM.style.overflow = 'auto'
      v.scrollDOM.style.height = '800px'
      stage.style.visibility = 'visible'
      v.requestMeasure()
      for (let i = 0; i < 6; i++) await nextFrame()

      const scroller = v.scrollDOM
      const walkWholeDoc = async () => {
        for (let y = 0; y < scroller.scrollHeight; y += 700) {
          scroller.scrollTop = y
          await nextFrame()
        }
        scroller.scrollTop = 0
        for (let i = 0; i < 4; i++) await nextFrame()
      }

      // Compare page N before vs page N after. NOTE: index-matching exaggerates
      // late pages when the document's total height changes — page 80 of 81 and
      // page 80 of 98 are not the same place. The trustworthy figures are the
      // height error, the page count, and the MEDIAN shift.
      const compare = (before, after) => {
        const n = Math.min(before.length, after.length)
        let moved = 0, maxLines = 0
        const px = []
        for (let i = 0; i < n; i++) {
          if (before[i].pos !== after[i].pos) {
            moved += 1
            maxLines = Math.max(maxLines, Math.abs(
              v.state.doc.lineAt(after[i].pos).number - v.state.doc.lineAt(before[i].pos).number))
          }
          px.push(Math.abs(after[i].top - before[i].top))
        }
        return { n, moved, maxLines, medPx: median(px) }
      }

      say(`── ${label} — ${text.split('\n').length} lines`)

      // ── Pass 1: COLD. Breaks from pure estimates, then fully measured.
      const cold = computePageBreaks(v, pageH)
      const hCold = v.contentHeight
      await walkWholeDoc()
      const settled = computePageBreaks(v, pageH)
      const hSettled = v.contentHeight
      const c = compare(cold, settled)

      say(`   COLD (estimates only)`)
      say(`      pages ${cold.length} → ${settled.length} once measured`)
      say(`      doc height ${Math.round(hCold)}px → ${Math.round(hSettled)}px` +
          ` (error ${hCold ? r1(Math.abs(hSettled - hCold) / hCold * 100) : 0}%)`)
      say(`      moved ${c.moved}/${c.n}, median shift ${Math.round(c.medPx)}px, worst ${c.maxLines} lines`)

      // ── Pass 2: PRIMED. Render the whole document once so every line is
      // measured into the height map, then return to normal virtualisation and
      // see whether the breaks now hold still. This is the candidate fix: a
      // one-off mount cost in exchange for accurate pagination, while typing
      // stays virtualised (so no 20ms floor, no scaling ceiling).
      setProgress(`Drift — ${label} (primed)…`)
      const t0 = performance.now()
      v.viewState.printing = true
      v.measure()
      for (let i = 0; i < 4; i++) await nextFrame()
      v.viewState.printing = false
      v.requestMeasure()
      for (let i = 0; i < 4; i++) await nextFrame()
      const primeMs = performance.now() - t0

      const primed = computePageBreaks(v, pageH)
      const hPrimed = v.contentHeight
      await walkWholeDoc()
      const primedSettled = computePageBreaks(v, pageH)
      const p = compare(primed, primedSettled)

      say(`   PRIMED (one full-render measure pass, ${r1(primeMs)}ms)`)
      say(`      pages ${primed.length} → ${primedSettled.length} once re-measured`)
      say(`      doc height ${Math.round(hPrimed)}px → ${Math.round(v.contentHeight)}px` +
          ` (error ${hPrimed ? r1(Math.abs(v.contentHeight - hPrimed) / hPrimed * 100) : 0}%)`)
      say(`      moved ${p.moved}/${p.n}, median shift ${Math.round(p.medPx)}px, worst ${p.maxLines} lines`)

      // ── Raggedness: how much page bottom goes to waste? ──────────────────
      // Block widgets attach only BETWEEN document lines, so a page can never
      // break mid-paragraph. In markdown a paragraph is ONE soft-wrapped line,
      // so a tall paragraph moves whole to the next page and leaves the bottom
      // of the previous one empty. Word and Docs split mid-paragraph; we cannot.
      // This measures the resulting waste on real content.
      // Walk DOCUMENT LINES rather than chaining block.to — a merged or
      // zero-length block made the previous version bail on the first iteration
      // and report nothing at all, which is worse than a wrong number.
      const leftovers = []
      let acc = 0
      let tallest = 0
      let oversized = 0   // single lines taller than a whole page
      let badHeights = 0
      const doc = v.state.doc
      for (let n = 1; n <= doc.lines; n++) {
        const blk = v.lineBlockAt(doc.line(n).from)
        const h = blk && Number.isFinite(blk.height) ? blk.height : 0
        if (!blk || !Number.isFinite(blk.height)) badHeights += 1
        if (h > pageH) oversized += 1
        tallest = Math.max(tallest, h)
        if (acc > 0 && acc + h > pageH) {
          leftovers.push(Math.max(0, pageH - acc)) // unused space at that page's bottom
          acc = h
        } else {
          acc += h
        }
      }
      const pctOf = (x) => Math.round((x / pageH) * 100)
      say(`   RAGGEDNESS (pages can only break between lines)`)
      if (!leftovers.length) {
        say(`      no page breaks produced — ${doc.lines} lines, tallest ${Math.round(tallest)}px,` +
            ` ${badHeights} unmeasurable. INSTRUMENT BUG if this doc is long.`)
      } else {
        const worst = Math.max(...leftovers)
        const med = median(leftovers)
        say(`      pages from this walk: ${leftovers.length + 1}`)
        say(`      wasted at page bottom: median ${Math.round(med)}px (${pctOf(med)}%),` +
            ` worst ${Math.round(worst)}px (${pctOf(worst)}%)`)
        say(`      tallest single line: ${Math.round(tallest)}px (${pctOf(tallest)}% of a page)` +
            `${oversized ? `, ${oversized} line(s) TALLER THAN A PAGE` : ''}`)
        if (badHeights) say(`      ${badHeights} line(s) had no usable height`)
        say(`      → ${pctOf(med) <= 8 ? 'TIGHT — reads as natural page breaks'
          : pctOf(med) <= 18 ? 'ACCEPTABLE — some short pages, looks deliberate'
          : 'RAGGED — pages routinely end well short; would read as broken'}`)
      }

      const verdict = p.maxLines === 0 ? 'ROCK SOLID — priming fixes it, breaks never move'
        : p.maxLines <= 1 ? 'FINE — sub-line jitter after priming, invisible in practice'
        : p.maxLines <= 3 ? 'NOTICEABLE — still nudges a line or two after priming'
        : 'BAD — priming did not help; needs the near-viewport design'
      say(`   → ${verdict}`)
      say('')

      v.destroy()
      holder.remove()
      stage.style.visibility = 'hidden'
    }

    stage.remove()
    say('COLD vs PRIMED is the decision. If PRIMED is rock-solid, vertical pages')
    say('cost one full-render measure pass per note open and nothing thereafter.')
    say('')
    say('Caveat: index-matched shifts exaggerate late pages when the total height')
    say('changes (page 80 of 81 vs page 80 of 98 are different places). Trust the')
    say('page COUNT, the height error, and the MEDIAN shift.')
    say('This measures ESTIMATE error only; the gap spacers add their own')
    say('deterministic shift, which is computed, not guessed.')
    setLog(out.join('\n') + '\n')
    setProgress('')
    setBusy(false)
  }, [pageH])

  // ── THE ONE BUTTON ────────────────────────────────────────────────────────
  // Sweeps the three mechanisms, picks the first that renders the whole document
  // without a measure-loop warning, then benchmarks all three documents on it and
  // prints a single verdict block. Nothing here needs the operator to sequence
  // anything — the whole point is that the spike drives itself.
  const runEverything = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    setBusy(true)
    setLog('')

    const out = []
    const say = (s) => { out.push(s); setLog(out.join('\n') + '\n') }

    say('════ BOOK-IN-WRITE-MODE SPIKE — FULL RUN ════')
    say(`browser: ${navigator.userAgent}`)
    say(`page height: ${pageH}px, breaks: ${breaks}`)
    say('')

    // Backgrounded tabs throttle requestAnimationFrame to ~1Hz or suspend it
    // entirely. The run is paced one keystroke per rAF, so switching away
    // stalls the loop and makes every frame look "slow" — the timings would be
    // measuring the tab throttler, not CodeMirror. Track it and say so.
    let hiddenDuringRun = document.hidden
    const onVis = () => { if (document.hidden) hiddenDuringRun = true }
    document.addEventListener('visibilitychange', onVis)

    // ── Q1: mechanism sweep ────────────────────────────────────────────────
    say('── Q1: which full-render mechanism holds?')
    let winner = null
    for (const m of [1, 2, 3]) {
      setProgress(`Q1 — testing mechanism ${m}…`)
      warningsRef.current = []
      setWarnings([])
      mechanismRef.current = m
      applyMechanism(view, m, pageH)
      // Give CM several frames to settle (or to start oscillating).
      for (let i = 0; i < 8; i++) await nextFrame()

      const len = view.state.doc.length
      const covered = view.viewport.to >= len && view.viewport.from === 0
      const warned = warningsRef.current.length > 0
      const share = len ? Math.round(((view.viewport.to - view.viewport.from) / len) * 100) : 0
      const gaps = view.contentDOM.querySelectorAll('.cm-gap').length

      // Did the page height actually take? CM clears inline height on
      // contentDOM every redraw, so this is not a given — and a mechanism that
      // "renders 100%" of an unfragmented single column is not a pass, it is a
      // measurement of the wrong thing wearing a pass's clothes.
      const h = parseFloat(getComputedStyle(view.contentDOM).height)
      const heightOK = Math.abs(h - pageH) < 2
      const frag = view.contentDOM.scrollWidth > view.contentDOM.clientWidth + 1

      say(
        `   mech ${m} (${MECHANISMS[m]})\n` +
        `      rendered ${String(share).padStart(3)}%   viewport ${view.viewport.from}–${view.viewport.to} of ${len}` +
        `   line gaps ${gaps}\n` +
        `      content height ${Math.round(h)}px (want ${pageH})${heightOK ? '' : '  ← HEIGHT NOT APPLIED'}` +
        `   fragmented ${frag ? 'yes' : 'NO'}` +
        `${warned ? `\n      MEASURE-LOOP WARNING: ${warningsRef.current.join(' / ')}` : ''}` +
        `\n      → ${!heightOK ? 'INVALID (page height never applied)'
          : warned ? 'FAIL (oscillating)'
          : covered ? 'PASS' : 'FAIL (under-rendered)'}`,
      )
      if (covered && !warned && heightOK && winner === null) winner = m
    }
    say('')

    if (winner === null) {
      say('════ VERDICT: Q1 FAILED ON ALL THREE MECHANISMS ════')
      say('Approach A is dead — CM cannot be made to render the whole document')
      say('under a short, wide content box. Fall back to C (overlay) or D.')
      setLog(out.join('\n') + '\n')
      setProgress('')
      setBusy(false)
      return
    }

    say(`WINNER: mechanism ${winner} — ${MECHANISMS[winner]}`)
    say('')
    // NB: deliberately NOT setMechanism(winner) here — that is React state, and
    // a state change mid-run would rebuild the view and leave everything below
    // measuring a detached instance. Apply imperatively; sync state at the end.
    mechanismRef.current = winner
    applyMechanism(view, winner, pageH)
    for (let i = 0; i < 4; i++) await nextFrame()

    if (!view.dom.isConnected) {
      say('!! ABORT: the EditorView was detached mid-run. Every number below would')
      say('!! be meaningless. This is a spike bug, not a result.')
      setLog(out.join('\n') + '\n'); setProgress(''); setBusy(false); return
    }

    // ── Q2: paging maths + WHY ─────────────────────────────────────────────
    setProgress('Q2 — checking paging maths…')
    const el = view.contentDOM
    const cs = getComputedStyle(el)
    const gap = parseFloat(cs.columnGap) || 0
    const step = el.clientWidth + gap
    const total = step > 0 ? Math.max(1, Math.round((el.scrollWidth + gap) / step)) : 0
    const fragmented = el.scrollWidth > el.clientWidth + 1

    say('── Q2: paging maths (ReadingView formula, applied to .cm-content)')
    say(`   clientWidth ${el.clientWidth}  columnGap ${gap}  step ${Math.round(step)}px`)
    say(`   scrollWidth ${el.scrollWidth}  scrollHeight ${el.scrollHeight}  clientHeight ${el.clientHeight}`)
    say(`   → ${fragmented && total > 1 ? `PASS — ${total} spreads (~${total * 2} pages)` : 'FAIL (no horizontal overflow)'}`)

    // When fragmentation fails, the computed styles say why far faster than
    // another round of guessing. Multicol needs: column-count > 1, column-fill
    // auto, and a DEFINITE height on the multicol box.
    if (!fragmented) {
      say('   why it did not fragment — computed styles on .cm-content:')
      for (const p of ['columnCount', 'columnFill', 'columnGap', 'columnWidth',
                       'height', 'minHeight', 'maxHeight', 'boxSizing',
                       'overflow', 'display', 'position', 'paddingBottom']) {
        say(`      ${p.padEnd(14)} ${cs[p]}`)
      }
      const sc2 = getComputedStyle(view.scrollDOM)
      say('   .cm-scroller:')
      for (const p of ['display', 'height', 'minHeight', 'overflow', 'alignItems']) {
        say(`      ${p.padEnd(14)} ${sc2[p]}`)
      }
      const ed = getComputedStyle(view.dom)
      say(`   .cm-editor: height ${ed.height}, display ${ed.display}`)
      // Where do the rendered lines actually sit? If every line shares one x
      // band, the box is one tall column; if the last line's bottom exceeds
      // clientHeight, the height is not constraining the flow.
      const lines = el.querySelectorAll('.cm-line')
      if (lines.length) {
        const box = el.getBoundingClientRect()
        const xs = new Set()
        let maxBottom = 0
        for (const ln of lines) {
          const r = ln.getBoundingClientRect()
          xs.add(Math.round((r.left - box.left) / 50))
          maxBottom = Math.max(maxBottom, r.bottom - box.top)
        }
        say(`   ${lines.length} rendered lines, ${xs.size} x-band(s), lowest line bottom ${Math.round(maxBottom)}px vs clientHeight ${el.clientHeight}px`)
      }
    }
    say('')

    // ── Q3–Q5 per document ─────────────────────────────────────────────────
    const docs = [
      ['synthetic 1,500', generateNote(1500)],
      ['synthetic 5,000', generateNote(5000)],
      ...(REAL_NOTE_READY ? [['REAL NOTE', realNoteRaw]] : []),
    ]
    if (!REAL_NOTE_READY) {
      say('!! realNote.md still holds the placeholder — the go/no-go band is')
      say('!! judged on YOUR note, so this run is indicative only.')
      say('')
    }

    const verdicts = []
    for (const [label, text] of docs) {
      setProgress(`Benchmarking ${label}…`)
      say(`── ${label} — ${text.split('\n').length} lines, ${text.length} chars`)

      // Swap the document into the live, visible view rather than an offscreen
      // one: offscreen elements can skip paint, and paint is part of the cost.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } })
      const anchors = generateComments(text, 24)
      if (anchors.length) view.dispatch({ effects: setCommentsEffect.of(anchors) })
      // A doc swap invalidates the inline styles' relationship to the new
      // content and leaves the viewport stale until CM re-measures. Re-assert
      // and force a measure, or the next reading reports the PREVIOUS document's
      // range (which is exactly what the first run did).
      applyMechanism(view, winner, pageH)
      view.requestMeasure()
      for (let i = 0; i < 8; i++) await nextFrame()

      const len2 = view.state.doc.length
      const covered2 = view.viewport.to >= len2 && view.viewport.from === 0
      say(`   render : ${covered2 ? 'whole doc' : `ONLY ${view.viewport.from}–${view.viewport.to} of ${len2}`}` +
          `   line gaps ${view.contentDOM.querySelectorAll('.cm-gap').length}` +
          `   spreads ${view.contentDOM.clientWidth > 0
            ? Math.max(1, Math.round((view.contentDOM.scrollWidth + gap) / (view.contentDOM.clientWidth + gap)))
            : 'n/a'}`)
      if (!covered2) say('   !! under-rendered: the Q4 numbers below understate the real cost')

      // Q3 mount (fresh construction, offscreen — construction+layout only).
      const mountTimes = []
      const scratch = document.createElement('div')
      scratch.style.cssText = 'position:absolute;left:-99999px;top:0;width:900px;'
      document.body.appendChild(scratch)
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        const v = buildView(scratch, text)
        applyMechanism(v, winner, pageH)
        v.contentDOM.getBoundingClientRect()
        await nextFrame()
        mountTimes.push(performance.now() - t0)
        v.destroy()
      }
      scratch.remove()
      say(`   Q3 mount   : median ${r1(median(mountTimes))} ms  (${mountTimes.map(r1).join(', ')})`)

      // Q4 keystrokes, one per frame.
      const longTasks = []
      let observer = null
      try {
        observer = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration) })
        observer.observe({ entryTypes: ['longtask'] })
      } catch { /* no longtask support — medians still stand */ }

      // Q4 — the cost of ONE keystroke.
      //
      // Paced one per frame (a synchronous burst would measure transaction
      // handling and skip layout entirely), but TIMED synchronously. Timing
      // across the two rAF waits measures the frame clock, not the work: it can
      // never report below 33.3ms at 60Hz, which is exactly the artefact the
      // first run produced. So the stopwatch brackets dispatch + a forced
      // reflow, and the rAF waits sit OUTSIDE it, pacing without being counted.
      //
      // getBoundingClientRect() after dispatch forces style+layout to flush
      // synchronously, so the number includes CM's decoration pass, its DOM
      // writes, and the browser's layout of the result. Paint/composite land
      // after and are counted separately as dropped frames.
      const N = 200
      const meds = []
      for (const [name, basePos] of [
        ['start', Math.min(200, len2)],
        ['middle', Math.floor(len2 / 2)],
        ['end', Math.max(0, len2 - 200)],
      ]) {
        setProgress(`Benchmarking ${label} — typing at ${name}…`)
        const times = []
        let slowFrames = 0
        let lastFrame = performance.now()
        for (let i = 0; i < N; i++) {
          const pos = Math.min(basePos + i, view.state.doc.length)

          const t0 = performance.now()
          view.dispatch({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 } })
          view.contentDOM.getBoundingClientRect() // force sync style+layout flush
          times.push(performance.now() - t0)

          await nextFrame()
          const now = performance.now()
          // >20ms between frames means the browser missed its 60Hz budget on
          // this keystroke — the user-visible symptom of a slow decoration pass.
          if (now - lastFrame > 20) slowFrames += 1
          lastFrame = now
        }
        view.dispatch({ changes: { from: basePos, to: basePos + N, insert: '' } })
        await nextFrame()
        const med = median(times)
        meds.push(med)
        say(`   Q4 ${name.padEnd(6)}: median ${String(r1(med)).padStart(6)} ms` +
            `   p95 ${String(r1(pct(times, 95))).padStart(6)} ms` +
            `   slow frames ${String(slowFrames).padStart(3)}/${N}   ${band(med)}`)
      }
      observer?.disconnect()
      if (longTasks.length) say(`   long tasks : ${longTasks.length}, worst ${r1(Math.max(...longTasks))} ms`)

      // Q5 caret probe — browser hit-testing, plus the column-break arrow test.
      for (const l of runCaretProbe(view)) say(l.replace(/^── .*/, '   Q5 caret:'))

      verdicts.push({ label, worst: Math.max(...meds) })
      say('')
    }

    // ── Q6 ─────────────────────────────────────────────────────────────────
    const sc = view.scrollDOM
    say('── Q6: does CM fight the transform?')
    say(`   scrollLeft now ${Math.round(sc.scrollLeft)}, worst seen ${Math.round(scrollDriftRef.current.maxLeft)}`)
    say(`   scrollTop  now ${Math.round(sc.scrollTop)}, worst seen ${Math.round(scrollDriftRef.current.maxTop)}`)
    say(`   → ${scrollDriftRef.current.maxLeft > 1 || scrollDriftRef.current.maxTop > 1
      ? 'CM IS SCROLLING the short wide scroller; a build must suppress this in book mode'
      : 'no drift — transform paging is uncontested'}`)
    say('')

    // ── the verdict ────────────────────────────────────────────────────────
    const decisive = verdicts.find((v) => v.label === 'REAL NOTE') || verdicts[verdicts.length - 1]
    say('════ VERDICT ════')
    say(`mechanism ${winner} — ${MECHANISMS[winner]}`)
    for (const v of verdicts) say(`   ${v.label.padEnd(16)} worst-position median ${r1(v.worst)} ms  ${band(v.worst)}`)
    say('')
    // ── COST ATTRIBUTION ───────────────────────────────────────────────────
    // The Q4 numbers show cost rising with how much document sits AFTER the
    // caret (typing at the start costs 2–3× typing at the end). The decoration
    // pass scans the whole document regardless of caret position, so that
    // gradient points at browser re-layout instead — and if that's right, then
    // scoping livePreview/collapseTableGap to the visible spread targets the
    // wrong cost entirely. This isolates the contributions rather than guessing.
    //
    // Four variants on the SAME 5,000-line document, same mechanism:
    //   A full stack + 2 columns  — the real thing
    //   B full stack + 1 column   — A minus multicol layout
    //   C no decorations + 2 cols — A minus the decoration pass
    //   D minimal + 2 columns     — C minus markdown parsing/highlighting
    setProgress('Cost attribution — isolating what is actually expensive…')
    say('── COST ATTRIBUTION (5,000 lines, mechanism ' + winner + ')')
    say('   Which layer owns the cost? Same doc, same mechanism, layers removed.')

    const attribDoc = generateNote(5000)
    const stage = document.createElement('div')
    // Sits over the real editor inside the same clipping viewport, so widths and
    // paint behaviour match. Visible (not offscreen) — paint is part of the cost.
    stage.style.cssText = 'position:absolute;inset:28px 34px;z-index:10;background:var(--bg-surface);'
    view.dom.parentElement?.parentElement?.appendChild(stage)

    const variants = [
      ['A full stack + 2 columns  ', 'full', true],
      ['B full stack + 1 column   ', 'full', false],
      ['C no decorations + 2 cols ', 'nodeco', true],
      ['D minimal + 2 columns     ', 'minimal', true],
    ]
    const attrib = {}
    for (const [label, stack, columns] of variants) {
      setProgress(`Cost attribution — ${label.trim()}…`)
      const holder = document.createElement('div')
      holder.className = `${styles.host}${columns ? '' : ' ' + styles.noColumns}`
      stage.appendChild(holder)

      const v = buildView(holder, attribDoc, stack)
      applyMechanism(v, winner, pageH)
      for (let i = 0; i < 6; i++) await nextFrame()

      const res = {}
      const dlen = v.state.doc.length
      for (const [name, basePos] of [['start', 200], ['end', Math.max(0, dlen - 200)]]) {
        const times = []
        for (let i = 0; i < 60; i++) {
          const pos = Math.min(basePos + i, v.state.doc.length)
          const t0 = performance.now()
          v.dispatch({ changes: { from: pos, insert: 'x' }, selection: { anchor: pos + 1 } })
          v.contentDOM.getBoundingClientRect()
          times.push(performance.now() - t0)
          await nextFrame()
        }
        v.dispatch({ changes: { from: basePos, to: basePos + 60, insert: '' } })
        await nextFrame()
        res[name] = median(times)
      }
      attrib[label.trim().charAt(0)] = res
      say(`   ${label} start ${String(r1(res.start)).padStart(7)} ms   end ${String(r1(res.end)).padStart(7)} ms`)
      v.destroy()
      holder.remove()
    }
    stage.remove()

    // Deltas name the owner of the cost.
    const A = attrib.A, B = attrib.B, C = attrib.C, D = attrib.D
    if (A && B && C && D) {
      const multicol = A.start - B.start
      const decoration = A.start - C.start
      const parsing = C.start - D.start
      say('')
      say(`   multicol re-layout (A−B) : ${r1(multicol)} ms`)
      say(`   decoration pass    (A−C) : ${r1(decoration)} ms`)
      say(`   markdown parsing   (C−D) : ${r1(parsing)} ms`)
      say(`   irreducible base   (D)   : ${r1(D.start)} ms`)
      const biggest = Math.max(multicol, decoration, parsing, D.start)
      say('')
      say(`   → dominant cost: ${
        biggest === multicol ? 'BROWSER MULTICOL RE-LAYOUT — scoping decorations will NOT fix this'
        : biggest === decoration ? 'THE DECORATION PASS — scoping livePreview/collapseTableGap is the right fix'
        : biggest === parsing ? 'MARKDOWN PARSING/HIGHLIGHTING under full render'
        : 'FULL RENDER ITSELF (base cost of having every line in the DOM)'}`)
    }
    say('')

    document.removeEventListener('visibilitychange', onVis)
    if (hiddenDuringRun) {
      say('')
      say('!! THE TAB WAS BACKGROUNDED DURING THIS RUN. requestAnimationFrame is')
      say('!! throttled or suspended in hidden tabs, so the pacing stalled and the')
      say('!! slow-frame counts are meaningless. Re-run with this tab visible.')
    }
    say('')
    say(`decided on: ${decisive.label} → ${band(decisive.worst)}`)
    say('')
    say('Q4 measures dispatch + forced layout (decoration pass, DOM writes,')
    say('browser layout). Paint/composite are excluded and show up as slow frames.')
    if (!fragmented) {
      say('')
      say('!! Q2 FAILED — columns never fragmented, so the Q4 numbers above are')
      say('!! for a SINGLE-column editor and do NOT answer the real question.')
    }
    if (winner === 3) {
      say('NOTE: the winning mechanism uses private CM API (pixelViewport override).')
      say('That is a maintenance cost on every @codemirror/view upgrade.')
    }

    setLog(out.join('\n') + '\n')
    setProgress('')
    setBusy(false)
    // Safe now the run is over: this rebuilds nothing (mechanism is not a build
    // dependency), it just makes the dropdown agree with what was measured.
    setMechanism(winner)
  }, [pageH, breaks])

  // ── derived verdicts ───────────────────────────────────────────────────────
  const fullyRendered = vp.len > 0 && vp.to >= vp.len && vp.from === 0
  const q1Failed = warnings.length > 0 || !fullyRendered
  const renderedPct = vp.len ? Math.round(((vp.to - vp.from) / vp.len) * 100) : 0

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Book layout in WRITE mode — spike</h1>
      <p className={styles.sub}>
        Throwaway. Does not touch CodeMirrorEditor.jsx, cm/*, ReadingView.jsx or settings.
        Mechanism in use: <strong>{MECHANISMS[mechanism]}</strong>.
      </p>

      <div className={styles.runBar}>
        <button className={styles.runBtn} onClick={runInlineBreakTest} disabled={busy}>
          {busy ? 'Running…' : '▶  Test mid-paragraph break'}
        </button>
        <div className={styles.runHint}>
          Seconds. Answers whether &ldquo;Continue&rdquo; (LaTeX-style splitting) is
          buildable at all. Copy the black box back to me.
        </div>
      </div>

      <div className={styles.runBar}>
        <button className={styles.btn} onClick={runDriftCheck} disabled={busy}>
          Re-check vertical-page drift
        </button>
        <div className={styles.runHint}>
          {busy
            ? (progress || 'Working…')
            : 'Quick (under a minute). Answers whether Google-Docs-style stacked pages hold still while you scroll. Copy the black box back to me.'}
        </div>
      </div>

      <div className={styles.runBar}>
        <button className={styles.btn} onClick={runEverything} disabled={busy}>
          Re-run the two-page spike (superseded)
        </button>
        <div className={styles.runHint}>
          Only needed if you want the old book-spread numbers again.
        </div>
      </div>

      <button
        className={styles.disclosure}
        onClick={() => setShowAdvanced((s) => !s)}
        disabled={busy}
      >
        {showAdvanced ? '▾' : '▸'} Manual controls (not needed for the run)
      </button>

      {showAdvanced && (
        <div className={styles.controls}>
          <label className={styles.field}>
            <span className={styles.label}>Document</span>
            <select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
              <option value="1500">Synthetic 1,500 lines</option>
              <option value="5000">Synthetic 5,000 lines</option>
              <option value="real">
                {REAL_NOTE_READY ? 'Real note (fixture)' : 'Real note — NOT PASTED YET'}
              </option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Full-render mechanism</span>
            <select value={mechanism} onChange={(e) => setMechanism(Number(e.target.value))}>
              <option value={1}>1 — printing flag only</option>
              <option value={2}>2 — printing + padding lie (CSS)</option>
              <option value={3}>3 — pixelViewport override</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Page height</span>
            <input type="number" min={360} max={900} step={20} value={pageH}
                   onChange={(e) => setPageH(Number(e.target.value) || 620)} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Breaks</span>
            <select value={breaks} onChange={(e) => setBreaks(e.target.value)}>
              <option value="continue">Continue</option>
              <option value="keep">Keep whole</option>
            </select>
          </label>

          <button className={styles.btn} onClick={benchMount} disabled={busy}>Q3 mount</button>
          <button className={styles.btn} onClick={benchKeystrokes} disabled={busy}>Q4 keystrokes</button>
          <button className={styles.btn} onClick={probeCaret} disabled={busy}>Q5 probe</button>
          <button className={styles.btn} onClick={() => setLog('')} disabled={busy}>Clear log</button>
        </div>
      )}

      <div className={styles.nav}>
        <button className={styles.btn} onClick={() => go(-1)} disabled={spread === 0}>Previous</button>
        <span className={styles.pageNo}>
          {spread * 2 + 1}–{spread * 2 + 2} of ~{geom.total * 2}
        </span>
        <button className={styles.btn} onClick={() => go(1)} disabled={spread >= geom.total - 1}>Next</button>
      </div>

      <div className={styles.bookOuter}>
        <div className={styles.viewport} style={{ height: pageH }}>
          <div
            ref={hostRef}
            className={`${styles.host} ${breaks === 'keep' ? styles.keepWhole : ''}`}
          />
          <div className={styles.spine} aria-hidden="true" />
        </div>
      </div>

      <div className={styles.panel}>
        <p className={styles.panelTitle}>Measurements</p>

        {warnings.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <strong>Q1 FAILURE — measure loop.</strong> CM logged:{' '}
            {warnings.map((w) => <code key={w}>“{w}”</code>)}. The viewport is
            oscillating rather than settling. This is a failure <em>even if the
            columns look correct</em> — a page that re-measures on a loop is fine
            in a spike and unacceptable in production.
          </div>
        )}
        {!warnings.length && fullyRendered && (
          <div className={`${styles.banner} ${styles.bannerOk}`}>
            Whole document rendered, no measure-loop warning. Q1 mechanism {mechanism} holds so far.
          </div>
        )}

        <div className={styles.grid}>
          <Stat label="Viewport" value={`${vp.from} – ${vp.to}`} />
          <Stat label="Doc length" value={String(vp.len)} />
          <Stat label="Rendered" value={`${renderedPct}%`} tone={fullyRendered ? 'ok' : 'bad'} />
          <Stat label="Rendered .cm-line" value={String(vp.lines)} />
          <Stat label="Line gaps" value={String(vp.gaps)} tone={vp.gaps ? 'warn' : 'ok'} />
          <Stat label="Spread step" value={`${Math.round(geom.step)} px`} />
          <Stat label="Spreads" value={String(geom.total)} />
          <Stat
            label="scrollLeft (now / max)"
            value={`${Math.round(scrollDrift.left)} / ${Math.round(scrollDrift.maxLeft)}`}
            tone={scrollDrift.maxLeft > 1 ? 'bad' : 'ok'}
          />
          <Stat
            label="scrollTop (now / max)"
            value={`${Math.round(scrollDrift.top)} / ${Math.round(scrollDrift.maxTop)}`}
            tone={scrollDrift.maxTop > 1 ? 'bad' : 'ok'}
          />
          <Stat label="Q1 verdict" value={q1Failed ? 'FAIL' : 'pass'} tone={q1Failed ? 'bad' : 'ok'} />
        </div>

        {scrollDrift.maxLeft > 1 && (
          <div className={`${styles.banner} ${styles.bannerBad}`}>
            <strong>Q6 — CM is fighting the transform.</strong> scrollLeft moved to{' '}
            {Math.round(scrollDrift.maxLeft)}px, so <code>scrollIntoView</code> is
            scrolling the short wide scroller while the transform does the paging.
            A build would need this suppressed in book mode.
          </div>
        )}

        <pre className={styles.results}>{log || 'No benchmarks run yet.'}</pre>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${tone ? styles[tone] : ''}`}>{value}</span>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function appendLog(setLog, lines) {
  setLog((prev) => prev + lines.join('\n') + '\n')
}

// Mirror of cm/verticalMotion.js:22-34 — the browser hit-test the production
// editor actually resolves clicks and Arrow-Up/Down through. The earlier probe
// used view.posAtCoords, which is CM's OWN coordinate logic and partly height-map
// based; under column layout the height map is meaningless, so a mismatch there
// says nothing about whether this editor's caret works.
function pointToPos(view, x, y) {
  const dom = view.contentDOM.ownerDocument
  let node = null, offset = 0
  if (dom.caretPositionFromPoint) {
    const p = dom.caretPositionFromPoint(x, y)
    if (p) { node = p.offsetNode; offset = p.offset }
  } else if (dom.caretRangeFromPoint) {
    const r = dom.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node || !view.contentDOM.contains(node)) return null
  try { return view.posAtDOM(node, offset) } catch { return null }
}

// Replicates moveVertical's walk from cm/verticalMotion.js:36-76 — including its
// document-line fallback — and returns where the caret WOULD land. Driving the
// real keymap with a synthetic KeyboardEvent silently does nothing (tried), so
// this mirrors the algorithm instead of re-implementing the command.
function moveVerticalLike(view, forward) {
  const head = view.state.selection.main.head
  const coords = view.coordsAtPos(head)
  if (!coords) return null
  const goalX = coords.left
  const step = Math.max(4, (view.defaultLineHeight || 18) * 0.5)
  let y = forward ? coords.bottom + 1 : coords.top - 1
  for (let i = 0; i < 80; i++) {
    const p = pointToPos(view, goalX, y)
    if (p == null) break
    if (p !== head) {
      const pc = view.coordsAtPos(p)
      if (pc && (forward ? pc.top > coords.top + 1 : pc.bottom < coords.bottom - 1)) return p
    }
    y += forward ? step : -step
  }
  const doc = view.state.doc
  const line = doc.lineAt(head)
  const n = forward ? line.number + 1 : line.number - 1
  if (n < 1 || n > doc.lines) return head
  const tl = doc.line(n)
  return Math.min(tl.from + (head - line.from), tl.to)
}

// Which column band does a client-x fall in, relative to the content box?
function columnOf(view, clientX) {
  const box = view.contentDOM.getBoundingClientRect()
  const gap = parseFloat(getComputedStyle(view.contentDOM).columnGap) || 0
  const colW = (view.contentDOM.clientWidth - gap) / 2
  return Math.floor((clientX - box.left) / (colW + gap))
}

// Q5 — does caret placement survive column layout?
//
// Only positions in the CURRENTLY VISIBLE spread can be tested: the document is
// hundreds of columns wide, caretPositionFromPoint hit-tests visible pixels
// only, and sampling the whole document just produces a wall of "no-hit" for
// off-screen columns that says nothing.
function runCaretProbe(view) {
  const out = ['── Q5 CARET (browser hit-testing, as verticalMotion.js does it)']
  const { from, to } = view.viewport

  // The clipping box — anything outside it cannot be hit-tested.
  const clip = view.dom.parentElement?.parentElement?.getBoundingClientRect()
  if (!clip) return [...out, '   SKIPPED (no viewport element)']

  const inView = (c) =>
    c.left >= clip.left && c.right <= clip.right && c.top >= clip.top && c.bottom <= clip.bottom

  const stats = {}
  let sampled = 0
  for (let i = 0; i <= 400; i++) {
    const pos = from + Math.floor(((to - from) * i) / 400)
    const c = view.coordsAtPos(pos)
    if (!c || !inView(c)) continue
    sampled += 1
    const col = columnOf(view, c.left)
    const key = `col ${col + 1}`
    stats[key] ||= { ok: 0, miss: 0, none: 0 }
    const back = pointToPos(view, c.left + 1, (c.top + c.bottom) / 2)
    if (back == null) stats[key].none += 1
    else if (Math.abs(back - pos) <= 2) stats[key].ok += 1
    else stats[key].miss += 1
  }
  out.push(`   ${sampled} positions sampled inside the visible spread`)
  for (const [k, v] of Object.entries(stats)) {
    const total = v.ok + v.miss + v.none
    out.push(`   ${k}: ${v.ok}/${total} round-trip OK, ${v.miss} mismatch, ${v.none} no-hit`)
  }

  // Which branch will moveVertical (cm/verticalMotion.js:36-76) take at a column
  // break? It walks DOWNWARD in y from the caret; the next visual row after the
  // bottom of the left page is at the TOP of the right page — same y, different
  // x — so the walk finds nothing and falls through to the document-line
  // fallback at :61. This replicates that walk (it does not re-implement the
  // command) purely to report WHICH branch fires, because the fallback works by
  // luck here and loses goal-column tracking.
  const lines = [...view.contentDOM.querySelectorAll('.cm-line')]
  let lastOfCol1 = null, lastBottom = -Infinity
  for (const ln of lines) {
    const r = ln.getBoundingClientRect()
    if (r.height === 0 || !inView(r)) continue
    if (columnOf(view, r.left) !== 0) continue
    if (r.bottom > lastBottom) { lastBottom = r.bottom; lastOfCol1 = ln }
  }

  if (!lastOfCol1) {
    out.push('   column-break: SKIPPED (no visible line in the left page)')
    return out
  }

  const head = view.state.doc.lineAt(view.posAtDOM(lastOfCol1, 0)).to
  const coords = view.coordsAtPos(head)
  if (!coords) {
    out.push('   column-break: coordsAtPos returned null → moveVertical bails (returns false)')
    return out
  }
  const step = Math.max(4, (view.defaultLineHeight || 18) * 0.5)
  let found = null
  let y = coords.bottom + 1
  for (let i = 0; i < 80; i++) {
    const p = pointToPos(view, coords.left, y)
    if (p == null) break
    if (p !== head) {
      const pc = view.coordsAtPos(p)
      if (pc && pc.top > coords.top + 1) { found = p; break }
    }
    y += step
  }
  out.push(`   column-break: caret at ${head} (bottom of left page)`)
  if (found != null) {
    const pc = view.coordsAtPos(found)
    out.push(`   → hit-test walk SUCCEEDED → pos ${found}, column ${columnOf(view, pc.left) + 1}`)
  } else {
    const doc = view.state.doc
    const line = doc.lineAt(head)
    const ok = line.number < doc.lines
    out.push('   → hit-test walk found nothing (next row is sideways, not below)')
    out.push(`   → falls back to verticalMotion.js:61 "same column, next document line" — ${
      ok ? 'lands on the next doc line, which IS the top of the right page (works, but by luck:'
         + ' loses goalX, approximates wrapped lines, and fires scrollIntoView)'
         : 'at the document edge, returns without moving'}`)
    out.push('   → BUILD TASK: give moveVertical a column-aware branch (try the top')
    out.push('     of the next column at goalX before the document-line fallback)')
  }
  return out
}

// ── Mid-paragraph page break via an INLINE widget ───────────────────────────
//
// Block decorations attach only between document lines, and a markdown
// paragraph is ONE soft-wrapped line — which is why the current paged layout
// can only move a whole paragraph to the next page ("Keep whole"), and why the
// `bookBreaks: 'continue'` setting does nothing in write mode.
//
// An INLINE widget can sit at an arbitrary mid-line position. Rendered as
// `display:inline-block; width:100%`, it claims its own visual row and pushes
// the rest of the paragraph down — a spacer INSIDE a paragraph. If CM measures
// the line including it, and the caret still resolves correctly on both sides,
// that is LaTeX-style Continue with vertical pages.
//
// This tests exactly that, and nothing else.
class InlineGapWidget extends WidgetType {
  constructor(h) { super(); this.h = h }
  eq(other) { return other.h === this.h }
  toDOM() {
    const el = document.createElement('span')
    el.setAttribute('aria-hidden', 'true')
    // width:100% is what forces it onto its own visual row; vertical-align:top
    // keeps it from shifting the baseline of the row it lands on.
    el.style.cssText =
      `display:inline-block;width:100%;height:${this.h}px;vertical-align:top;` +
      'outline:1px dashed rgba(255,120,120,.5);'
    return el
  }
  ignoreEvent() { return true }
}

const setGapEffect = StateEffect.define()

const gapField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setGapEffect)) continue
      if (!e.value) return Decoration.none
      return Decoration.set([
        Decoration.widget({ widget: new InlineGapWidget(e.value.h), side: -1 })
          .range(e.value.pos),
      ])
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

// First position in `line` whose visual row bottom falls past `yThreshold`
// (client coords). coordsAtPos is monotonic in y across a wrapped line, so a
// binary search is valid — this is how a real implementation would choose where
// to break.
function posAtRowCrossing(view, line, yThreshold) {
  let lo = line.from, hi = line.to
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const c = view.coordsAtPos(mid)
    if (!c) break
    if (c.bottom <= yThreshold) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ── Vertical (Google-Docs style) pages: is the break position stable? ───────
//
// Vertical paging does NOT need full render — text still flows top-to-bottom, so
// CM's virtualisation stays intact and cost stops scaling with document length.
// The price is that a page break's position depends on the height of everything
// above it, and for unrendered lines CM only has ESTIMATES. This measures how
// far the breaks move once those lines are really measured.
//
// Ignores the feedback from the gap spacers themselves (inserting a gap shifts
// every later break). That is a convergent, deterministic effect; what is being
// measured here is the non-deterministic part — estimate error.
function computePageBreaks(view, pageH) {
  const breaks = []
  const total = view.contentHeight
  let last = -1
  for (let y = pageH; y < total; y += pageH) {
    const block = view.lineBlockAtHeight(y)
    if (!block || block.from <= last) continue
    breaks.push({ pos: block.from, top: block.top })
    last = block.from
  }
  return breaks
}

function band(med) {
  if (med < 16) return '→ BUILD IT (<16ms)'
  if (med <= 33) return '→ VIABLE, budget the scoping mitigation (16–33ms)'
  return '→ FAIL (>33ms)'
}

function describeRun(docKind, doc, mechanism, pageH) {
  const label = docKind === 'real' ? 'real note' : `synthetic ${docKind} lines`
  return `${label}, ${doc.split('\n').length} lines, ${doc.length} chars, mech ${mechanism}, pageH ${pageH}`
}

// The production extension list from CodeMirrorEditor.jsx:231-284, in the same
// order. Callbacks that need app context are stubbed — they affect behaviour on
// click, not the decoration pass, which is what is being measured.
//
// `stack` selects how much of it to mount, for cost attribution:
//   'full'    — everything (the real editor)
//   'nodeco'  — markdown parsing + highlighting, but NO decoration sources
//               (livePreview, liveTables, collapseTableGap, comments, search,
//               codeCopy, images, wikilinks removed)
//   'minimal' — no markdown language at all; plain text in a wrapped editor
function buildView(parent, doc, stack = 'full') {
  const deco = stack === 'full'
  const lang = stack !== 'minimal'
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        tooltips({ parent: document.body }),
        domVerticalMotion,
        keymap.of([...listEditingKeymap, { key: 'Enter', run: enterIndent }, { key: 'Backspace', run: deleteMarkupBackward }]),
        keymap.of(formattingKeymap),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        indentUnit.of('    '),
        listIndentNormalizer,
        drawSelection(),
        EditorView.lineWrapping,
        ...(deco ? [headingFold] : []),
        ...(lang ? [
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [wikilinkMarkdownExtension, obsidianSyntax, { remove: ['SetextHeading', 'IndentedCode'] }] }),
          syntaxHighlighting(cinderHighlightStyle),
        ] : []),
        ...(deco ? [
        livePreview,
        liveTables,
        tableTypingGuard,
        tableKeymap,
        collapseTableGap,
        searchExtension,
        codeCopy,
        imageExtensions(() => ({ authFetch: null, API: null })),
        wikilinks({
          notes: () => [],
          resolve: (t) => resolveNote([], t),
          navigate: () => {},
          create: () => {},
          openTask: () => {},
          openSandbox: () => {},
          openBundle: () => {},
          searchTag: () => {},
          openPdf: () => {},
          tasks: () => [],
          bundles: () => [],
          sandboxes: () => [],
        }),
        commentsExtension({ onClickComment: () => {} }),
        ] : []),
        cinderTheme,
        cmPlaceholder('spike'),
        EditorView.editable.of(true),
      ],
    }),
  })
}

// Apply the column layout plus whichever full-render mechanism is selected.
// Everything here is inline style on the live view's own DOM, so switching
// mechanisms never requires rebuilding the editor.
function applyMechanism(view, mechanism, pageH) {
  const content = view.contentDOM
  const scroller = view.scrollDOM
  const editor = view.dom

  // The multicol height/min-height live in the CSS module behind !important —
  // CM clears inline height on contentDOM every redraw, so inline cannot hold.
  // Everything this function sets is on elements CM does NOT rewrite.
  const host = editor.parentElement
  if (host) host.style.setProperty('--spike-page-h', `${pageH}px`)

  // Undo anything a previous mechanism set.
  if (host) host.classList.remove(styles.padLie)
  scroller.style.height = ''
  scroller.style.minHeight = ''
  editor.style.height = ''

  // Undo mechanism 3's property override. Without this, once mech 3 has been
  // tried the getter stays installed and every LATER mechanism inherits a fake
  // full-document pixel viewport — so re-applying a "winning" mech 1 or 2 after
  // the sweep would report a full render it did not actually achieve.
  if (view.viewState.__spikePatched) {
    delete view.viewState.pixelViewport
    view.viewState.pixelViewport = { left: 0, right: 0, top: 0, bottom: 0 }
    delete view.viewState.__spikePatched
  }
  view.viewState.printing = false

  // The editor and scroller are pinned to the page height so they cannot
  // re-inflate and give the base theme's percentage min-height a tall basis.
  editor.style.height = `${pageH}px`
  scroller.style.height = `${pageH}px`
  scroller.style.minHeight = '0'
  // Deliberately NOT `hidden`. The overflow columns (3, 4, …) sit to the RIGHT
  // of the scroller's box, and the transform pages by sliding them into view —
  // if the scroller clipped, every spread past the first would be blank no
  // matter how well the fragmentation worked. Clipping is the outer .viewport's
  // job, exactly as in ReadingView. `visible` also means no scrollLeft to fight
  // (Q6), which is why cinderTheme sets it that way in production too.
  scroller.style.overflow = 'visible'

  if (mechanism === 1) {
    view.viewState.printing = true
  } else if (mechanism === 2) {
    // The padding lie lives in the CSS module (.padLie) for the same reason the
    // height does: box-sizing/padding sit on contentDOM, and a stylesheet rule
    // cannot be clobbered by CM's redraw.
    if (host) host.classList.add(styles.padLie)
    view.viewState.printing = true
  } else if (mechanism === 3) {
    // Last resort: lie about the pixel viewport directly. Private API — if this
    // is the only thing that works, that is a maintenance cost on every
    // @codemirror/view upgrade and belongs in the report.
    const vs = view.viewState
    Object.defineProperty(vs, 'pixelViewport', {
      configurable: true,
      get: () => ({ left: 0, right: content.clientWidth || 1000, top: 0, bottom: PAD_LIE }),
      set: () => {},
    })
    vs.__spikePatched = true
    vs.printing = true
  }

  view.requestMeasure()
}
