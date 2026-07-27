import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, drawSelection, tooltips, placeholder as cmPlaceholder } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentUnit, foldEffect, unfoldEffect } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { livePreview } from './cm/livePreview'
import { domVerticalMotion } from './cm/verticalMotion'
import { codeCopy } from './cm/codeCopy'
import { imageExtensions } from './cm/imagePaste'
import { wikilinks, wikilinkMarkdownExtension, resolveNote } from './cm/wikilinks'
import { obsidianSyntax } from './cm/syntaxNodes'
import { headingFold, foldedLineSet, applyFolds } from './cm/fold'
import { commentsExtension, setCommentsEffect, setActiveCommentEffect, resolveAnchor, readAnchors, captureSelectionAnchor, anchorFromRange, commentState } from './cm/comments'
import { listEditingKeymap, listIndentNormalizer, enterIndent } from './cm/listEditing'
import { formattingKeymap } from './cm/formatting'
import { searchExtension, setSearchMatchesEffect, setActiveSearchEffect, clearSearchEffect } from './cm/search'
import { cinderHighlightStyle } from './cm/highlight'
import { cinderTheme } from './cm/theme'
import ReadingView from './ReadingView'
import EditorDock from './EditorDock'
import { useApi } from '../../contexts/ApiContext'
import { useSettings } from '../../contexts/SettingsContext'
import { readFolds, writeFolds } from '../../hooks/noteFoldsCache'
import { setActiveEditor, clearActiveEditor } from './activeEditor'
import styles from './CodeMirrorEditor.module.css'

// Autosave cadence — a periodic save to the local Bag. In-session edits also live
// in NotePage's doc cache (fed by onDocChange), so a layout remount never loses
// text; this interval + save-on-blur/unmount handle durable persistence to disk.
const AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000

// CodeMirror 6 live-preview note editor. The document IS the markdown (note.body),
// so there is no serialize/deserialize layer: onSave just hands back the doc text.
//
// Props:
//   initialContent  markdown string the editor opens with
//   onSave(md)      => Promise<boolean>, persists the note body
//   onDirtyChange   (isDirty: boolean) => void
//   noteId          stable id (editor is remounted per note via key); draft key
//   placeholder     empty-state text
//   interfaceMode   true = read-only
function CodeMirrorEditor({
  initialContent = '',
  onSave,
  onDocChange,
  onDirtyChange,
  noteId,
  placeholder = 'Start typing here...',
  interfaceMode = false,
  readMode = false,
  notes = [],
  onNavigateNote,
  onCreateNote,
  onOpenTask,
  onOpenSandbox,
  onOpenBundle,
  onSearchTag,
  onOpenLink,
  onOpenPdf,
  tasks = [],
  bundles = [],
  sandboxes = [],
  scrollApiRef,
  searchApiRef,
  showDock = true,
  editorViewRef,
  comments = [],
  onCommentsRemap,
  onCommentClick,
  commentApiRef,
  onComment,
}) {
  const hostRef = useRef(null)
  const rootRef = useRef(null)
  const viewRef = useRef(null)
  const editableRef = useRef(new Compartment())

  // Read mode renders a fully-rendered HTML view from the editor's LIVE doc while
  // keeping the CodeMirror instance mounted (just hidden). Toggling read/edit no
  // longer unmounts the editor, so in-flight unsaved edits are never lost.
  const [readSnapshot, setReadSnapshot] = useState(initialContent)

  // "Remember File/Note State" — when on, per-note folds persist (localStorage)
  // and restore across remounts + read/edit modes. Kept in a ref so the mount-once
  // view's listeners read the live value.
  const { settings } = useSettings()
  const rememberFolds = settings.rememberNoteState === true
  const rememberRef = useRef(rememberFolds)
  useEffect(() => { rememberRef.current = rememberFolds }, [rememberFolds])

  // Auth for image upload — kept in refs so the mount-once view handlers always
  // read the current authFetch/API.
  const { authFetch, API } = useApi()
  const authFetchRef = useRef(authFetch)
  const apiRef = useRef(API)
  useEffect(() => { authFetchRef.current = authFetch }, [authFetch])
  useEffect(() => { apiRef.current = API }, [API])

  // Wikilink data/callbacks — refs so the mount-once view always reads current.
  const notesRef = useRef(notes)
  const onNavigateRef = useRef(onNavigateNote)
  const onCreateRef = useRef(onCreateNote)
  const onOpenTaskRef = useRef(onOpenTask)
  const onOpenSandboxRef = useRef(onOpenSandbox)
  const onOpenBundleRef = useRef(onOpenBundle)
  const onSearchTagRef = useRef(onSearchTag)
  const onOpenPdfRef = useRef(onOpenPdf)
  const onCommentsRemapRef = useRef(onCommentsRemap)
  const onCommentClickRef = useRef(onCommentClick)
  const tasksRef = useRef(tasks)
  const bundlesRef = useRef(bundles)
  const sandboxesRef = useRef(sandboxes)
  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { onNavigateRef.current = onNavigateNote }, [onNavigateNote])
  useEffect(() => { onCreateRef.current = onCreateNote }, [onCreateNote])
  useEffect(() => { onOpenTaskRef.current = onOpenTask }, [onOpenTask])
  useEffect(() => { onOpenSandboxRef.current = onOpenSandbox }, [onOpenSandbox])
  useEffect(() => { onOpenBundleRef.current = onOpenBundle }, [onOpenBundle])
  useEffect(() => { onSearchTagRef.current = onSearchTag }, [onSearchTag])
  useEffect(() => { onOpenPdfRef.current = onOpenPdf }, [onOpenPdf])
  useEffect(() => { onCommentsRemapRef.current = onCommentsRemap }, [onCommentsRemap])
  useEffect(() => { onCommentClickRef.current = onCommentClick }, [onCommentClick])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { bundlesRef.current = bundles }, [bundles])
  useEffect(() => { sandboxesRef.current = sandboxes }, [sandboxes])

  // Keep the latest callbacks reachable from the long-lived EditorView without
  // rebuilding it on every parent render.
  const onSaveRef = useRef(onSave)
  const onDirtyRef = useRef(onDirtyChange)
  const onDocChangeRef = useRef(onDocChange)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { onDirtyRef.current = onDirtyChange }, [onDirtyChange])
  useEffect(() => { onDocChangeRef.current = onDocChange }, [onDocChange])

  // Save bookkeeping (refs so they survive across the view's lifetime).
  const lastSavedRef = useRef(initialContent) // last content persisted to the Bag
  const dirtyRef = useRef(false)              // differs from saved content

  // Build the editor once on mount.
  useEffect(() => {
    const editableExt = (ro) => [
      EditorView.editable.of(!ro),
      EditorState.readOnly.of(ro),
    ]
    const getDoc = () => (viewRef.current ? viewRef.current.state.doc.toString() : null)

    // Persist to the local Bag; on success clear dirty state.
    const saveBackend = () => {
      if (!dirtyRef.current) return
      const md = getDoc()
      if (md == null) return
      if (md === lastSavedRef.current) {
        dirtyRef.current = false
        onDirtyRef.current?.(false)
        return
      }
      Promise.resolve(onSaveRef.current?.(md)).then(ok => {
        if (ok !== false) {
          lastSavedRef.current = md
          dirtyRef.current = false
          onDirtyRef.current?.(false)
        }
      }).catch(() => { /* keep dirty for a later retry */ })
    }

    // Persist folds (per note) when the toggle is on. A fold/unfold lands as an
    // effect with no doc change, so persist those immediately (the reading view
    // reads the store on the next mode switch). A pure doc edit shifts where folds
    // sit, so refresh the stored line numbers on a debounce to keep them current.
    let foldSaveTimer = null
    const persistFolds = () => {
      if (!rememberRef.current || !viewRef.current) return
      writeFolds(noteId, foldedLineSet(viewRef.current.state))
    }
    const scheduleFoldPersist = () => {
      if (foldSaveTimer) clearTimeout(foldSaveTimer)
      foldSaveTimer = setTimeout(persistFolds, 1000)
    }

    const updateListener = EditorView.updateListener.of((u) => {
      if (rememberRef.current) {
        const foldChanged = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)))
        if (foldChanged) persistFolds()
        else if (u.docChanged) scheduleFoldPersist()
      }
      if (!u.docChanged) return
      // Hand the live text to NotePage's per-note cache so a layout remount reopens
      // with the current content (this replaces the old localStorage crash-draft).
      onDocChangeRef.current?.(u.state.doc.toString())
      // Report remapped comment anchors (offsets + fresh quotes + orphan flags).
      if (onCommentsRemapRef.current) onCommentsRemapRef.current(readAnchors(u.state))
      if (!dirtyRef.current) { dirtyRef.current = true; onDirtyRef.current?.(true) }
    })

    // Checkbox toggle from its rendered widget + save-on-blur.
    // NOTE: this MUST be `click`, not `mousedown`. The CheckWidget's <input> calls
    // preventDefault() on mousedown (to stop the caret jumping into the widget), and
    // CM6 skips every registered DOM handler once an event's default is prevented
    // (view runHandlers: `if (event.defaultPrevented) break`). A mousedown handler
    // here therefore never fires. The click event is not prevented, so it runs;
    // returning true makes CM preventDefault the native toggle, keeping the document
    // text the single source of truth for the checkbox state.
    const domHandlers = EditorView.domEventHandlers({
      click: (event, view) => {
        const target = event.target
        if (!target || !target.classList?.contains('cm-task-check')) return false
        const pos = view.posAtDOM(target)
        const line = view.state.doc.lineAt(pos)
        const m = /^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\][ \t]/.exec(line.text)
        if (!m) return false
        const from = line.from + m[1].length + m[2].length + m[3].length
        const checked = /x/i.test(m[4])
        view.dispatch({ changes: { from, to: from + 3, insert: checked ? '[ ]' : '[x]' } })
        event.preventDefault()
        return true
      },
      focus: (_e, view) => { setActiveEditor(view); return false },
      blur: () => { saveBackend(); return false },
    })

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialContent,
        extensions: [
          history(),
          // Render tooltips (the [[ ]] autocomplete dropdown) in document.body so the
          // app's nested scroll/stacking contexts (StarCanvas, overflow panes) can't
          // clip or hide them.
          tooltips({ parent: document.body }),
          domVerticalMotion, // must precede defaultKeymap's Arrow-Up/Down
          // List editing (Enter/Tab/Shift-Tab) must win over defaultKeymap + indentWithTab.
          // markdown() is configured with addKeymap:false (below) so its own Prec.high
          // Enter→insertNewlineContinueMarkup no longer shadows our list Enter; we keep
          // its Backspace→deleteMarkupBackward (nice list-marker delete) explicitly.
          // The [[ ]] completionKeymap (Prec.highest) still owns Enter while open.
          keymap.of([...listEditingKeymap, { key: 'Enter', run: enterIndent }, { key: 'Backspace', run: deleteMarkupBackward }]),
          // Inline-format shortcuts (Ctrl+B/I/U/H/=) — before defaultKeymap so they win.
          keymap.of(formattingKeymap),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of('    '),
          listIndentNormalizer, // snap stray hand-typed list indents to a sibling level
          drawSelection(),
          EditorView.lineWrapping,
          headingFold,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [wikilinkMarkdownExtension, obsidianSyntax, { remove: ['SetextHeading', 'IndentedCode'] }] }),
          syntaxHighlighting(cinderHighlightStyle),
          livePreview,
          searchExtension,
          codeCopy,
          imageExtensions(() => ({ authFetch: authFetchRef.current, API: apiRef.current })),
          wikilinks({
            notes: () => notesRef.current,
            resolve: (t) => resolveNote(notesRef.current, t),
            navigate: (id) => onNavigateRef.current?.(id),
            create: (t) => onCreateRef.current?.(t),
            openTask: (id) => onOpenTaskRef.current?.(id),
            openSandbox: (id) => onOpenSandboxRef.current?.(id),
            openBundle: (id) => onOpenBundleRef.current?.(id),
            searchTag: (tag) => onSearchTagRef.current?.(tag),
            openPdf: (href) => onOpenPdfRef.current?.(href),
            tasks: () => tasksRef.current,
            bundles: () => bundlesRef.current,
            sandboxes: () => sandboxesRef.current,
          }),
          commentsExtension({
            onClickComment: (id) => onCommentClickRef.current?.(id),
          }),
          cinderTheme,
          cmPlaceholder(placeholder),
          editableRef.current.of(editableExt(interfaceMode)),
          updateListener,
          domHandlers,
        ],
      }),
    })
    viewRef.current = view
    // Publish the live view to an external ref (split view's shared dock targets
    // whichever pane is focused, so NotePage needs a handle on each editor).
    if (editorViewRef) editorViewRef.current = view

    // Imperative comment controls for NotePane (positions live in the editor).
    if (commentApiRef) {
      commentApiRef.current = {
        captureSelection: () => captureSelectionAnchor(view.state),
        // Read mode: locate the plain text of a reading-view selection in the doc
        // so a comment can be anchored (best-effort; null if not found verbatim).
        locateSelectionText: (text) => {
          const doc = view.state.doc.toString()
          const i = text ? doc.indexOf(text) : -1
          if (i < 0) return null
          return anchorFromRange(view.state, i, i + text.length)
        },
        scrollTo: (id) => {
          const v = view.state.field(commentState, false)
          const a = v?.anchors.find((x) => x.id === id)
          if (a && a.to > a.from) {
            view.dispatch({ selection: { anchor: a.from, head: a.to }, effects: EditorView.scrollIntoView(a.from, { y: 'center' }) })
            view.focus()
          }
        },
        setActive: (id) => view.dispatch({ effects: setActiveCommentEffect.of(id ?? null) }),
      }
    }
    // Seed the anchor field with whatever comments were already loaded at mount
    // (re-anchoring by quote when stored offsets have drifted).
    if (comments.length) {
      view.dispatch({ effects: setCommentsEffect.of(comments.map((c) => resolveAnchor(view.state, c))) })
    }

    // Restore this note's saved folds (no-op when the toggle is off / none saved).
    // KNOWN ISSUE: when a note opens with a LARGE folded section, the lines that fold
    // reveals can render as raw markdown until the first click or read↔write toggle.
    // CM's viewport is provisional during the page's initial layout, so livePreview
    // decorates the wrong region; nothing re-triggers it until an interaction. A bare
    // rAF deferral was tried and did NOT resolve it. Tracked as a known bug — see the
    // fold-persistence memory.
    if (rememberRef.current) applyFolds(view, readFolds(noteId))

    const autosaveTimer = setInterval(saveBackend, AUTOSAVE_INTERVAL_MS)

    return () => {
      clearInterval(autosaveTimer)
      if (foldSaveTimer) clearTimeout(foldSaveTimer)
      // Flush to the Bag on unmount so edits persist to disk across navigation.
      // (In-session remounts are already covered by NotePage's doc cache.)
      if (dirtyRef.current) {
        const md = view.state.doc.toString()
        if (md !== lastSavedRef.current) { try { onSaveRef.current?.(md) } catch { /* ignore */ } }
      }
      clearActiveEditor(view)
      view.destroy()
      viewRef.current = null
      if (editorViewRef) editorViewRef.current = null
      if (commentApiRef) commentApiRef.current = null
    }
    // Mount-once: NotePage remounts this component per note via `key`, so the
    // doc never needs external syncing. Deps intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-seed the comment anchors whenever the STRUCTURE changes (threads load,
  // added/deleted/resolved) — keyed on a signature so position-only remaps (which
  // flow editor → React) never bounce back here and cause a loop.
  const commentsRef = useRef(comments)
  useEffect(() => { commentsRef.current = comments })
  const commentSig = comments.map((c) => `${c.id}:${c.resolved ? 1 : 0}`).join('|')
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setCommentsEffect.of(commentsRef.current.map((c) => resolveAnchor(view.state, c))) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentSig])

  // Reconfigure read-only state when the view mode flips, without rebuilding.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: editableRef.current.reconfigure([
        EditorView.editable.of(!interfaceMode),
        EditorState.readOnly.of(interfaceMode),
      ]),
    })
  }, [interfaceMode])

  // Entering read mode: snapshot the live doc so the reading view reflects unsaved
  // edits. Leaving it: the hidden editor needs a re-measure to lay out correctly.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (readMode) setReadSnapshot(view.state.doc.toString())
    else {
      // Returning to the editor: re-sync folds with whatever the reading view
      // persisted, so a fold toggled there shows here too.
      if (rememberRef.current) applyFolds(view, readFolds(noteId))
      view.requestMeasure()
    }
  }, [readMode, noteId])

  // Expose a scroll-to-line function to the parent (used by the outline panel).
  // Works in both modes: the CM view when editing, the reading view's data-line
  // elements when reading.
  useEffect(() => {
    if (!scrollApiRef) return
    scrollApiRef.current = (line) => {
      if (readMode) {
        const el = rootRef.current?.querySelector(`[data-line="${line}"]`)
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        return
      }
      const view = viewRef.current
      if (!view) return
      const n = Math.max(1, Math.min(line, view.state.doc.lines))
      const pos = view.state.doc.line(n).from
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 64 }) })
      view.focus()
    }
    return () => { if (scrollApiRef) scrollApiRef.current = null }
  }, [readMode, scrollApiRef])

  // Imperative in-note SEARCH API for the per-note find bar (NoteSearch). Mode-aware,
  // like scrollApiRef: edit mode highlights matches via CM decorations and scrolls the
  // doc; read mode wraps matches in the rendered HTML and scrolls to them (arbitrary
  // matches have no data-line, so we walk text nodes like the comment highlighter).
  const readSearchSpansRef = useRef([])
  const editSearchRangesRef = useRef([])
  // Read the live mode from a ref so the search API can be built once (below) without
  // being torn down + rebuilt on every read/edit toggle (which would briefly null the
  // ref and race the find bar's re-run).
  const readModeRef = useRef(readMode)
  useEffect(() => { readModeRef.current = readMode }, [readMode])
  useEffect(() => {
    if (!searchApiRef) return
    const MAX = 300
    // Build a { before, hit, after } snippet around a match for the results list.
    const snippet = (id, text, start, len, line) => {
      const CTX = 44
      const s = Math.max(0, start - CTX)
      return {
        id, line,
        before: (s > 0 ? '…' : '') + text.slice(s, start),
        hit: text.slice(start, start + len),
        after: text.slice(start + len, start + len + CTX * 2) + (start + len + CTX * 2 < text.length ? '…' : ''),
      }
    }
    const clearReadHits = () => {
      for (const span of readSearchSpansRef.current) {
        const parent = span.parentNode
        if (!parent) continue
        parent.replaceChild(document.createTextNode(span.textContent), span)
        parent.normalize()
      }
      readSearchSpansRef.current = []
    }
    const runEdit = (query) => {
      const view = viewRef.current
      if (!view) return []
      const doc = view.state.doc
      const hay = doc.toString().toLowerCase()
      const needle = query.toLowerCase()
      const ranges = []; const results = []
      let i = hay.indexOf(needle)
      while (i !== -1 && ranges.length < MAX) {
        const from = i, to = i + query.length
        ranges.push({ from, to })
        const ln = doc.lineAt(from)
        results.push(snippet(ranges.length - 1, ln.text, from - ln.from, query.length, ln.number))
        i = hay.indexOf(needle, to)
      }
      editSearchRangesRef.current = ranges
      view.dispatch({ effects: setSearchMatchesEffect.of({ ranges, active: -1 }) })
      return results
    }
    const gotoEdit = (id) => {
      const view = viewRef.current
      const r = editSearchRangesRef.current[id]
      if (!view || !r) return
      view.dispatch({
        selection: { anchor: r.from, head: r.to },
        effects: [setActiveSearchEffect.of(id), EditorView.scrollIntoView(r.from, { y: 'center' })],
      })
    }
    const runRead = (query) => {
      clearReadHits()
      const root = rootRef.current
      if (!root) return []
      const needle = query.toLowerCase()
      const results = []; const spans = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          (n.nodeValue && n.nodeValue.toLowerCase().includes(needle) && n.parentElement &&
            !n.parentElement.closest('pre, code, .cm-editor, .rv-search-hit'))
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      })
      const nodes = []
      let node
      while ((node = walker.nextNode())) nodes.push(node)
      for (const tn of nodes) {
        if (results.length >= MAX) break
        const val = tn.nodeValue
        const low = val.toLowerCase()
        let idx = low.indexOf(needle)
        if (idx === -1) continue
        const frag = document.createDocumentFragment()
        let cursor = 0
        while (idx !== -1 && results.length < MAX) {
          if (idx > cursor) frag.appendChild(document.createTextNode(val.slice(cursor, idx)))
          const span = document.createElement('span')
          span.className = 'rv-search-hit'
          span.textContent = val.slice(idx, idx + query.length)
          frag.appendChild(span)
          spans.push(span)
          results.push(snippet(spans.length - 1, val, idx, query.length, null))
          cursor = idx + query.length
          idx = low.indexOf(needle, cursor)
        }
        if (cursor < val.length) frag.appendChild(document.createTextNode(val.slice(cursor)))
        tn.parentNode?.replaceChild(frag, tn)
      }
      readSearchSpansRef.current = spans
      return results
    }
    const gotoRead = (id) => {
      const spans = readSearchSpansRef.current
      spans.forEach((s, i) => s.classList.toggle('rv-search-hit-active', i === id))
      spans[id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    searchApiRef.current = {
      // `isRead` is passed by the find bar (authoritative for the surface it's showing);
      // falls back to the live ref if omitted.
      run: (query, isRead = readModeRef.current) => {
        if (!query) { searchApiRef.current.clear(); return [] }
        return isRead ? runRead(query) : runEdit(query)
      },
      goto: (id, isRead = readModeRef.current) => { if (isRead) gotoRead(id); else gotoEdit(id) },
      clear: () => {
        clearReadHits()
        const view = viewRef.current
        if (view) view.dispatch({ effects: clearSearchEffect.of(null) })
      },
    }
    return () => {
      clearReadHits()
      const view = viewRef.current
      if (view) { try { view.dispatch({ effects: clearSearchEffect.of(null) }) } catch { /* view gone */ } }
      if (searchApiRef) searchApiRef.current = null
    }
  }, [searchApiRef])

  const handleCheckboxToggle = (index) => {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc.toString()
    // Must match EXACTLY what GFM/remark renders as a task checkbox so this index
    // lines up with the reading view's rendered <input> order. That means: a
    // bullet (-,*,+) OR an ordered marker (1. / 1)), then the [ ]/[x] box, then
    // REQUIRED whitespace after ']' — `- [ ]text` (no trailing space) is literal
    // text, not a task, and must NOT be counted (else every later checkbox is
    // toggled one row off).
    const regex = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]/gm
    let match
    let count = 0
    while ((match = regex.exec(doc)) !== null) {
      if (count === index) {
        const checked = /[xX]/.test(match[1])
        const cbPos = match.index + match[0].indexOf('[') + 1
        view.dispatch({ changes: { from: cbPos, to: cbPos + 1, insert: checked ? ' ' : 'x' } })
        setReadSnapshot(view.state.doc.toString())
        break
      }
      count++
    }
  }

  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      <div ref={hostRef} className={styles.editorRoot} style={readMode ? { display: 'none' } : undefined} />
      {readMode && <ReadingView markdown={readSnapshot} noteId={noteId} rememberFolds={rememberFolds} onSearchTag={onSearchTag} onOpenLink={onOpenLink} onCheckboxToggle={handleCheckboxToggle} comments={comments} onCommentClick={(id) => onCommentClickRef.current?.(id)} />}
      {!readMode && !interfaceMode && showDock && <EditorDock viewRef={viewRef} sandboxes={sandboxes} onComment={onComment} />}
    </div>
  )
}

export default CodeMirrorEditor
