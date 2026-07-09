import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LuX } from "react-icons/lu";
import styles from './NotePage.module.css'
import NotePane from './NotePane'
import NoteTabBar from '../../components/Notes/NoteTabBar'
import SandboxDock from '../../components/Sandbox/Dock/SandboxDock'
import PdfPane from '../../components/Notes/PdfPane'
import { useSandboxView } from '../../contexts/SandboxViewContext'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import { usePdfView } from '../../contexts/PdfViewContext'

// Thin shell around NotePane. Owns the page-level concerns: the sandbox dock /
// half-split, and the EXPERIMENTAL split view (two NotePanes side by side). The
// per-note editing surface lives entirely in NotePane.
function NotePage({ notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite, updateColor, exportNote, setSidebarCollapsed, tasks, toggleTaskCompletion, addNote, updateTask, bundles }) {

  const sandboxView = useSandboxView()
  const split = useNoteSplit()
  const pdfView = usePdfView()
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

  // The PDF pane is a right-column occupant too — collapse the sidebar for room.
  useEffect(() => {
    if (pdfView.isOpen && setSidebarCollapsed) setSidebarCollapsed(true)
  }, [pdfView.isOpen, setSidebarCollapsed])

  // Keep the right column to ONE occupant: close the PDF if a split or sandbox
  // takes over. (Opening the PDF disables both, so this won't fight that.)
  useEffect(() => {
    if (split.enabled || !sandboxView.isHidden) pdfView.close()
  }, [split.enabled, sandboxView.isHidden]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up the dock + cancel split + PDF when navigating away from NotePage.
  useEffect(() => () => { sandboxView.close(); split.disable(); pdfView.close() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared props handed to every NotePane instance.
  const paneProps = {
    notes, notesLoading, editTitle, editBody, updateTags, toggleFavorite,
    updateColor, exportNote, tasks, addNote, updateTask, bundles, controlsSlot,
  }

  // EXPERIMENTAL split view: route note on the left, `splitNoteId` on the right.
  // Clicking a pane focuses it (subtle ring); the sandbox dock is suppressed here.
  const body = split.enabled ? (
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
  ) : pdfView.isOpen ? (
    // PDF side-view: note column on the left, PDF viewer on the right.
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh', overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', height: '100%' }}>
        <NotePane noteId={id} isPrimary onEnterSplit={split.enable} {...paneProps} />
      </div>
      <PdfPane pdf={pdfView.pdf} onClose={pdfView.close} />
    </div>
  ) : (
    // Single-note mode. Half-mode wraps the note column + a sandbox column in a
    // CSS grid; hidden/PiP modes leave the column full width and overlay the dock.
    <div
      style={sandboxView.isHalf ? {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        height: '100vh',
        overflow: 'hidden',
      } : { width: '100%', height: '100%' }}
    >
      <div style={sandboxView.isHalf ? { overflow: 'auto', height: '100%' } : { height: '100%' }}>
        <NotePane noteId={id} isPrimary onEnterSplit={split.enable} {...paneProps} />
      </div>
      {!sandboxView.isHidden && <SandboxDock notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} />}
    </div>
  )

  return (
    <div className={styles.tabbedPage}>
      <NoteTabBar notes={notes} controlsRef={setControlsSlot} />
      <div className={styles.tabbedBody}>{body}</div>
    </div>
  )
}

export default NotePage
