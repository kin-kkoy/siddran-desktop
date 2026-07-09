import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useNoteSplit } from './NoteSplitContext'
import { useSandboxView } from './SandboxViewContext'
import ConfirmModal from '../components/Common/ConfirmModal'

// Opens a PDF in the note's RIGHT column (a viewer pane, mirroring split view /
// the sandbox half). The right column holds at most one of: split note, sandbox,
// or PDF — so opening a PDF clears the others. If a note-split or sandbox is
// already there, we confirm first (replacing an existing PDF is silent).
const PdfViewContext = createContext(null)

export function usePdfView() {
  const ctx = useContext(PdfViewContext)
  if (!ctx) throw new Error('usePdfView must be used within <PdfViewProvider>')
  return ctx
}

export function PdfViewProvider({ children }) {
  const split = useNoteSplit()
  const sandbox = useSandboxView()
  const [pdf, setPdf] = useState(null)       // { path, name } | null
  const [pending, setPending] = useState(null)

  const doOpen = useCallback((p) => {
    split.disable()
    sandbox.close()
    setPdf(p)
  }, [split, sandbox])

  const requestOpen = useCallback((path, name) => {
    const occupied = (split.enabled && split.splitTarget != null) || !sandbox.isHidden
    if (occupied) setPending({ path, name })
    else doOpen({ path, name })
  }, [split.enabled, split.splitTarget, sandbox.isHidden, doOpen])

  const close = useCallback(() => setPdf(null), [])

  // Bridge for the non-React OS file-drop handler (desktop/fileDrop.js): dropping
  // a PDF onto a note opens it here.
  useEffect(() => {
    window.__siddranOpenPdf = (path, name) => requestOpen(path, name)
    return () => { if (window.__siddranOpenPdf) delete window.__siddranOpenPdf }
  }, [requestOpen])

  const value = useMemo(() => ({ pdf, isOpen: pdf != null, requestOpen, close }), [pdf, requestOpen, close])

  return (
    <PdfViewContext.Provider value={value}>
      {children}
      <ConfirmModal
        isOpen={pending != null}
        title="Replace the side panel?"
        message="A note or sandbox is already open on the right. Open the PDF there instead?"
        confirmText="Open PDF"
        cancelText="Cancel"
        confirmVariant="primary"
        onConfirm={() => { if (pending) doOpen(pending); setPending(null) }}
        onClose={() => setPending(null)}
      />
    </PdfViewContext.Provider>
  )
}
