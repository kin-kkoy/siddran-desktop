import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { LuX } from "react-icons/lu";
import styles from './NotePage.module.css'
import NotePane from './NotePane'
import NoteTabBar from '../../components/Notes/NoteTabBar'
import SandboxDock from '../../components/Sandbox/Dock/SandboxDock'
import EditorDock from '../../components/Editor/EditorDock'
import AttachmentPane from '../../components/Notes/AttachmentPane'
import PaneLockButton from '../../components/Notes/PaneLockButton'
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { useSidePane } from '../../contexts/SidePaneContext'
import ResizablePanes from '../../components/Layout/ResizablePanes'
import RightPaneMemory from '../../components/Session/RightPaneMemory'
import { useSandboxes } from '../../hooks/useSandboxes'
import { compareByOrder } from '../../utils/noteSorting'
import { getNoteBackground } from '../../components/Notes/noteColors'

const SandBoxPage = lazy(() => import('../Sandbox/SandBoxPage'))

// Thin shell around NotePane. Owns the page-level concerns: the sandbox dock /
// half-split, and the EXPERIMENTAL split view (two NotePanes side by side). The
// per-note editing surface lives entirely in NotePane.
function NotePage({ notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite, updateColor, exportNote, setSidebarCollapsed, tasks, toggleTaskCompletion, addNote, updateTask, bundles }) {

  const sandboxView = useSandboxView()
  const { sandboxes } = useSandboxes()
  const split = useNoteSplit()
  const sidePane = useSidePane()
  const { id } = useParams() //what note
  // The tab bar's right-side slot node; the primary NotePane portals its header
  // controls in here so tabs + controls share one row.
  const [controlsSlot, setControlsSlot] = useState(null)

  // Auto-collapse the sidebar when the sandbox dock expands to half mode so the
  // editor + sandbox columns have room to breathe.
  useEffect(() => {
    if (sandboxView.isHalf && setSidebarCollapsed) setSidebarCollapsed(true)
  }, [sandboxView.isHalf, setSidebarCollapsed])

  // Split view also needs the room — collapse the sidebar while it's on.
  useEffect(() => {
    if (split.enabled && setSidebarCollapsed) setSidebarCollapsed(true)
  }, [split.enabled, setSidebarCollapsed])

  // NOT auto-collapsed for the attachment pane, unlike split view and the sandbox.
  //
  // Collapsing the sidebar changes the pane's width ~220ms after it opens, and
  // WebKitGTK's PDF viewer lays out once, rasterises progressively, and never
  // reflows — so pages drawn during that transition came out sized for the old
  // width. Every attempt to schedule around it (remount, wait-for-stable-width,
  // nudge-after-load) fixed some documents and broke others, because how much of a
  // PDF is mid-render at any moment depends on the file. Leaving the layout alone
  // removes the cause: the geometry is final before the frame exists.
  //
  // The cost is a little less editor width; collapse it yourself if you want the room.

  // Keep the right column to ONE occupant: close the attachment if a split or
  // sandbox takes over. (Opening one disables both, so this won't fight that.)
  useEffect(() => {
    if (split.enabled || !sandboxView.isHidden) sidePane.close()
  }, [split.enabled, sandboxView.isHidden]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up the dock + cancel split + attachment when navigating away from NotePage.
  useEffect(() => () => { sandboxView.close(); split.disable(); sidePane.close() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Live per-note editor content, keyed by note id. Switching layout modes
  // (single ↔ PDF ↔ split) remounts the NotePane, so the editor would otherwise
  // reopen from the last saved body and drop just-typed edits. This cache (owned
  // by the stable NotePage, not the remounting pane) hands the editor back its
  // current text — no localStorage drafts, no "recovered from backup" churn.
  const docCacheRef = useRef(null)
  if (docCacheRef.current === null) docCacheRef.current = new Map()

  // Shared props handed to every NotePane instance.
  const paneProps = {
    notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite,
    updateColor, exportNote, tasks, addNote, updateTask, bundles, controlsSlot,
    docCache: docCacheRef.current,
  }

  // Layout mode flags. A "filled" layout (split / PDF / half-sandbox) hands its
  // body to ResizablePanes, whose panes need a definite page height to size
  // against — so the page becomes a flex column that fills the content pane.
  const isFilledLayout = split.enabled || sidePane.isOpen || sandboxView.isHalf
  // In split view there is only ever ONE editor dock — it lives in whichever note
  // pane is focused (its buttons target that pane's own editor). When the other
  // side isn't an editable note (sandbox / empty picker), the lone note keeps its
  // dock regardless of focus.
  // With two notes side by side there's ONE shared dock (below), pinned to the
  // screen and targeting the focused pane — so both panes' own docks are off.
  // When the other side is a sandbox/empty picker, the lone note keeps its dock.
  const bothNotes = split.enabled && split.splitTarget?.type === 'note'
  const showDockLeft = !bothNotes

  // Live handles on each split editor so the shared dock can act on the focused
  // one. `activeSplitViewRef` is a stable ref-like whose getter reads the current
  // focus, so the dock always operates on the right editor without re-rendering.
  const leftViewRef = useRef(null)
  const rightViewRef = useRef(null)
  const leftCommentRef = useRef(null)
  const rightCommentRef = useRef(null)
  const focusedSideRef = useRef(split.focusedSide)
  useEffect(() => { focusedSideRef.current = split.focusedSide }, [split.focusedSide])
  const activeSplitViewRef = useMemo(() => ({
    get current() {
      return focusedSideRef.current === 'left' ? leftViewRef.current : rightViewRef.current
    },
  }), [])
  // Shared-dock comment button → the focused pane's comment action.
  const sharedOnComment = useCallback(() => {
    const ref = focusedSideRef.current === 'left' ? leftCommentRef : rightCommentRef
    ref.current?.()
  }, [])

  // Ctrl+1 / Ctrl+2 move focus between the two columns. Direct rather than
  // cycling: there are only ever two sides, so pressing the same key twice is
  // idempotent instead of bouncing you back and forth.
  //
  // A note pane gets its CARET back — CodeMirror keeps the selection in the
  // EditorView, so focus() alone puts you where you left off on that side, with
  // no position bookkeeping of our own. A PDF / HTML / sandbox / picker pane has
  // no caret at all, so we focus its container instead and let onFocusCapture
  // move the ring. The container refs are the fallback for both sides.
  const leftPaneRef = useRef(null)
  const rightPaneRef = useRef(null)
  const focusSide = useCallback((side) => {
    if (split.enabled) split.setFocusedSide(side)
    const view = side === 'left' ? leftViewRef.current : rightViewRef.current
    if (view) { view.focus(); return }
    const el = side === 'left' ? leftPaneRef.current : rightPaneRef.current
    el?.focus()
    // Tracks the two split values it actually reads; `split` itself is a fresh
    // object on every provider render and would rebuild this on every keystroke.
  }, [split.enabled, split.setFocusedSide]) // eslint-disable-line react-hooks/exhaustive-deps

  const twoColumn = split.enabled || sidePane.isOpen || sandboxView.isHalf
  useEffect(() => {
    // Bubble phase on window, matching NoteTabsContext's Ctrl+Tab. CM6 never
    // calls stopPropagation on keydown, so this still fires with the caret in an
    // editor — the one exception is a rendered table cell, which swallows keys of
    // its own (Editor/cm/tables.js).
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key !== '1' && e.key !== '2') return
      // One column: leave the combo free rather than preventDefault-ing it.
      if (!twoColumn) return
      e.preventDefault()
      focusSide(e.key === '1' ? 'left' : 'right')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [twoColumn, focusSide])

  // Notes ordered to match the NotesHub list view (manual drag order), so the
  // split-view picker reads the same as the list the user is used to.
  const pickerNotes = [...notes].sort(compareByOrder)

  // EXPERIMENTAL split view: route note on the left, `splitTarget` on the right.
  // Clicking a pane focuses it (subtle ring); the sandbox dock is suppressed here.
  const body = split.enabled ? (
    <>
      <ResizablePanes
        left={
          <div
            ref={leftPaneRef}
            tabIndex={-1}
            className={`${styles.pane} ${split.focusedSide === 'left' ? styles.paneFocused : ''}`}
            style={{ flex: 'none', width: '100%', height: '100%', outline: 'none' }}
            onMouseDownCapture={() => split.setFocusedSide('left')}
            onFocusCapture={() => split.setFocusedSide('left')}
          >
            <NotePane noteId={id} isPrimary otherNoteId={split.splitTarget?.id} onEnterSplit={split.enable} showDock={showDockLeft} ownsControls={bothNotes ? split.focusedSide === 'left' : true} editorViewRef={leftViewRef} commentActionRef={leftCommentRef} {...paneProps} />
          </div>
        }
        right={
          <div
            ref={rightPaneRef}
            tabIndex={-1}
            className={`${styles.pane} ${split.focusedSide === 'right' ? styles.paneFocused : ''}`}
            style={{ flex: 'none', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', outline: 'none' }}
            onMouseDownCapture={() => split.setFocusedSide('right')}
            onFocusCapture={() => split.setFocusedSide('right')}
          >
            {split.splitTarget != null ? (
              split.splitTarget.type === 'sandbox' ? (
                <div style={{ height: '100%', position: 'relative' }}>
                  <PaneLockButton className={styles.paneLockFloat} />
                  <button onClick={split.disable} className={styles.splitEmptyClose} style={{ zIndex: 100 }} aria-label="Close split view">
                    <LuX />
                  </button>
                  <Suspense fallback={<div style={{padding: 24, color: 'var(--text-muted)'}}>Loading sandbox...</div>}>
                    <SandBoxPage notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} mode="half" sandboxIdOverride={split.splitTarget.id} />
                  </Suspense>
                </div>
              ) : (
                <NotePane
                  noteId={split.splitTarget.id}
                  isPrimary={false}
                  otherNoteId={id}
                  onClose={split.disable}
                  showDock={false}
                  ownsControls={split.focusedSide === 'right'}
                  editorViewRef={rightViewRef}
                  commentActionRef={rightCommentRef}
                  {...paneProps}
                />
              )
            ) : (
              <div className={styles.splitEmpty}>
                <button onClick={split.disable} className={styles.splitEmptyClose} aria-label="Close split view">
                  <LuX />
                </button>
                
                <div className={styles.splitPicker}>
                  <h3 className={styles.splitPickerTitle}>Open in Split View</h3>
                  
                  <div className={styles.splitPickerSection}>
                    <h4>Notes</h4>
                    <div className={styles.splitPickerList}>
                      {pickerNotes.map(n => {
                        const bg = getNoteBackground(n.color)
                        return (
                          <button
                            key={n.id}
                            onClick={() => split.setSplitTarget({ type: 'note', id: n.id })}
                            className={`${styles.splitPickerItem} ${bg ? styles.splitPickerItemColored : ''}`}
                            style={bg ? { backgroundColor: bg } : undefined}
                          >
                            {n.title || 'Untitled'}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className={styles.splitPickerSection}>
                    <h4>Sandboxes</h4>
                    <div className={styles.splitPickerList}>
                      {sandboxes.map(s => (
                        <button key={s.id} onClick={() => split.setSplitTarget({ type: 'sandbox', id: s.id })} className={styles.splitPickerItem}>
                           {s.title || 'Untitled'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        }
      />
      {bothNotes && <EditorDock viewRef={activeSplitViewRef} sandboxes={sandboxes} variant="fixed" onComment={sharedOnComment} />}
    </>
  ) : sidePane.isOpen ? (
    // PDF side-view: note column on the left, PDF viewer on the right.
    <ResizablePanes
      left={
        <div ref={leftPaneRef} tabIndex={-1} style={{ overflow: 'auto', height: '100%', outline: 'none' }}>
          <NotePane noteId={id} isPrimary onEnterSplit={split.enable} editorViewRef={leftViewRef} {...paneProps} />
        </div>
      }
      right={
        <div ref={rightPaneRef} tabIndex={-1} style={{ height: '100%', outline: 'none' }}>
          <AttachmentPane file={sidePane.file} onClose={sidePane.close} />
        </div>
      }
    />
  ) : (
    // Single-note mode. Half-mode wraps the note column + a sandbox column in a resizable split;
    // hidden/PiP modes leave the column full width and overlay the dock.
    sandboxView.isHalf ? (
      <ResizablePanes
        left={
          <div ref={leftPaneRef} tabIndex={-1} style={{ overflow: 'auto', height: '100%', outline: 'none' }}>
            <NotePane noteId={id} isPrimary onEnterSplit={split.enable} editorViewRef={leftViewRef} {...paneProps} />
          </div>
        }
        right={
          <div ref={rightPaneRef} tabIndex={-1} style={{ height: '100%', width: '100%', position: 'relative', outline: 'none' }}>
            <PaneLockButton className={styles.paneLockFloat} />
            <SandboxDock notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} />
          </div>
        }
      />
    ) : (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ height: '100%' }}>
          <NotePane noteId={id} isPrimary onEnterSplit={split.enable} editorViewRef={leftViewRef} {...paneProps} />
        </div>
        {!sandboxView.isHidden && <SandboxDock notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} />}
      </div>
    )
  )

  return (
    <div className={`${styles.tabbedPage} ${isFilledLayout ? styles.tabbedPageFilled : ''}`}>
      {/* Records/reopens the right-column pane. Lives here, not at App level, so the
          unmount cleanup above can't be observed as "nothing was open". */}
      <RightPaneMemory noteId={id} />
      <NoteTabBar notes={notes} controlsRef={setControlsSlot} />
      <div className={`${styles.tabbedBody} ${isFilledLayout ? styles.tabbedBodyFilled : ''}`}>{body}</div>
    </div>
  )
}

export default NotePage
