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
import { listEditingKeymap, listIndentNormalizer, enterIndent } from './cm/listEditing'
import { cinderHighlightStyle } from './cm/highlight'
import { cinderTheme } from './cm/theme'
import ReadingView from './ReadingView'
import EditorDock from './EditorDock'
import { useApi } from '../../contexts/ApiContext'
import { useSettings } from '../../contexts/SettingsContext'
import { readFolds, writeFolds } from '../../hooks/noteFoldsCache'
import styles from './CodeMirrorEditor.module.css'

// Autosave cadence — crash-safe like the rest of the app: a periodic backend save
// plus a frequent localStorage draft that NotePage's recovery (cinder_draft_<id>)
// reads back.
const AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000 // backend save
const DRAFT_SAVE_INTERVAL_MS = 5 * 1000    // localStorage draft

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
  tasks = [],
  bundles = [],
  sandboxes = [],
  scrollApiRef,
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
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { bundlesRef.current = bundles }, [bundles])
  useEffect(() => { sandboxesRef.current = sandboxes }, [sandboxes])

  // Keep the latest callbacks reachable from the long-lived EditorView without
  // rebuilding it on every parent render.
  const onSaveRef = useRef(onSave)
  const onDirtyRef = useRef(onDirtyChange)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { onDirtyRef.current = onDirtyChange }, [onDirtyChange])

  // Save bookkeeping (refs so they survive across the view's lifetime).
  const lastSavedRef = useRef(initialContent) // last content persisted to backend
  const dirtyRef = useRef(false)              // differs from backend-saved content
  const draftDirtyRef = useRef(false)         // differs from last localStorage draft

  // Build the editor once on mount.
  useEffect(() => {
    const draftKey = `cinder_draft_${noteId}`
    const editableExt = (ro) => [
      EditorView.editable.of(!ro),
      EditorState.readOnly.of(ro),
    ]
    const getDoc = () => (viewRef.current ? viewRef.current.state.doc.toString() : null)

    // Refresh the localStorage crash-draft when content diverges from the last
    // backend save; clear it (and dirty state) once they match again.
    const saveDraft = () => {
      if (!draftDirtyRef.current) return
      const md = getDoc()
      if (md == null) return
      if (md === lastSavedRef.current) {
        try { localStorage.removeItem(draftKey) } catch { /* ignore quota/parse */ }
        draftDirtyRef.current = false
        if (dirtyRef.current) { dirtyRef.current = false; onDirtyRef.current?.(false) }
        return
      }
      try {
        localStorage.setItem(draftKey, JSON.stringify({ content: md, savedAt: Date.now() }))
      } catch { /* ignore quota */ }
      draftDirtyRef.current = false
    }

    // Persist to the backend; on success clear dirty state and delete the draft.
    const saveBackend = () => {
      if (!dirtyRef.current) return
      const md = getDoc()
      if (md == null) return
      if (md === lastSavedRef.current) {
        dirtyRef.current = false
        draftDirtyRef.current = false
        onDirtyRef.current?.(false)
        return
      }
      Promise.resolve(onSaveRef.current?.(md)).then(ok => {
        if (ok !== false) {
          lastSavedRef.current = md
          dirtyRef.current = false
          draftDirtyRef.current = false
          onDirtyRef.current?.(false)
          try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
        }
      }).catch(() => { /* keep dirty + draft for a later retry */ })
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
      draftDirtyRef.current = true
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
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of('    '),
          listIndentNormalizer, // snap stray hand-typed list indents to a sibling level
          drawSelection(),
          EditorView.lineWrapping,
          headingFold,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [wikilinkMarkdownExtension, obsidianSyntax, { remove: ['SetextHeading', 'IndentedCode'] }] }),
          syntaxHighlighting(cinderHighlightStyle),
          livePreview,
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
            tasks: () => tasksRef.current,
            bundles: () => bundlesRef.current,
            sandboxes: () => sandboxesRef.current,
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

    // Restore this note's saved folds (no-op when the toggle is off / none saved).
    // KNOWN ISSUE: when a note opens with a LARGE folded section, the lines that fold
    // reveals can render as raw markdown until the first click or read↔write toggle.
    // CM's viewport is provisional during the page's initial layout, so livePreview
    // decorates the wrong region; nothing re-triggers it until an interaction. A bare
    // rAF deferral was tried and did NOT resolve it. Tracked as a known bug — see the
    // fold-persistence memory.
    if (rememberRef.current) applyFolds(view, readFolds(noteId))

    const autosaveTimer = setInterval(saveBackend, AUTOSAVE_INTERVAL_MS)
    const draftTimer = setInterval(saveDraft, DRAFT_SAVE_INTERVAL_MS)

    return () => {
      clearInterval(autosaveTimer)
      clearInterval(draftTimer)
      if (foldSaveTimer) clearTimeout(foldSaveTimer)
      // Final draft write on unmount so unsaved changes survive navigation/crash.
      if (dirtyRef.current || draftDirtyRef.current) {
        const md = view.state.doc.toString()
        if (md !== lastSavedRef.current) {
          try {
            localStorage.setItem(draftKey, JSON.stringify({ content: md, savedAt: Date.now() }))
          } catch { /* ignore quota */ }
        }
      }
      view.destroy()
      viewRef.current = null
    }
    // Mount-once: NotePage remounts this component per note via `key`, so the
    // doc never needs external syncing. Deps intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {readMode && <ReadingView markdown={readSnapshot} noteId={noteId} rememberFolds={rememberFolds} onSearchTag={onSearchTag} onOpenLink={onOpenLink} onCheckboxToggle={handleCheckboxToggle} />}
      {!readMode && !interfaceMode && <EditorDock viewRef={viewRef} sandboxes={sandboxes} />}
    </div>
  )
}

export default CodeMirrorEditor
