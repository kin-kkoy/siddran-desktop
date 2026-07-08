import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { LuX } from "react-icons/lu";
import styles from './NotePage.module.css'
import NotePane from './NotePane'
import SandboxDock from '../../components/Sandbox/Dock/SandboxDock'
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { useNoteSplit } from '../../contexts/NoteSplitContext'

// Thin shell around NotePane. Owns the page-level concerns: the sandbox dock /
// half-split, and the EXPERIMENTAL split view (two NotePanes side by side). The
// per-note editing surface lives entirely in NotePane.
function NotePage({ notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite, updateColor, exportNote, setSidebarCollapsed, lessDistraction = false, setLessDistraction, tasks, toggleTaskCompletion, addNote, updateTask, bundles }) {

  const sandboxView = useSandboxView()
  const split = useNoteSplit()
  const { id } = useParams() //what note

  // Auto-collapse the sidebar when the sandbox dock expands to half mode so the
  // editor + sandbox columns have room to breathe.
  useEffect(() => {
    if (sandboxView.isHalf && setSidebarCollapsed) setSidebarCollapsed(true)
  }, [sandboxView.isHalf, setSidebarCollapsed])

  // Split view also needs the room — collapse the sidebar while it's on.
  useEffect(() => {
    if (split.enabled && setSidebarCollapsed) setSidebarCollapsed(true)
  }, [split.enabled, setSidebarCollapsed])

  // Clean up the dock + cancel split when navigating away from NotePage entirely.
  useEffect(() => () => { sandboxView.close(); split.disable() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared props handed to every NotePane instance.
  const paneProps = {
    notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite,
    updateColor, exportNote, setSidebarCollapsed, lessDistraction,
    setLessDistraction, tasks, addNote, updateTask, bundles,
  }

  // EXPERIMENTAL split view: route note on the left, `splitNoteId` on the right.
  // Clicking a pane focuses it (subtle ring); the sandbox dock is suppressed here.
  if (split.enabled) {
    return (
      <div className={styles.splitRow}>
        <div
          className={`${styles.pane} ${split.focusedSide === 'left' ? styles.paneFocused : ''}`}
          onMouseDownCapture={() => split.setFocusedSide('left')}
          onFocusCapture={() => split.setFocusedSide('left')}
        >
          <NotePane noteId={id} isPrimary otherNoteId={split.splitNoteId} onEnterSplit={split.enable} {...paneProps} />
        </div>
        <div
          className={`${styles.pane} ${split.focusedSide === 'right' ? styles.paneFocused : ''}`}
          onMouseDownCapture={() => split.setFocusedSide('right')}
          onFocusCapture={() => split.setFocusedSide('right')}
        >
          {split.splitNoteId != null ? (
            <NotePane
              noteId={split.splitNoteId}
              isPrimary={false}
              otherNoteId={id}
              onClose={split.disable}
              {...paneProps}
            />
          ) : (
            <div className={styles.splitEmpty}>
              <button onClick={split.disable} className={styles.splitEmptyClose} aria-label="Close split view">
                <LuX />
              </button>
              <p className={styles.splitEmptyText}>Expand the sidebar and pick a note to open it here.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Single-note mode (unchanged). Half-mode wraps the note column + a sandbox
  // column in a CSS grid. Hidden and PiP modes leave the note column at full
  // width and overlay the dock.
  return (
    <div
      style={sandboxView.isHalf ? {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        height: '100vh',
        overflow: 'hidden',
      } : { width: '100%' }}
    >
      <div style={sandboxView.isHalf ? { overflow: 'auto', height: '100%' } : undefined}>
        <NotePane noteId={id} isPrimary onEnterSplit={split.enable} {...paneProps} />
      </div>
      {!sandboxView.isHidden && <SandboxDock notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} />}
    </div>
  )
}

export default NotePage
