import { useCallback, useEffect, useState } from 'react'
import ConfirmModal from './ConfirmModal'
import styles from './ExternalLinkGate.module.css'
import { openExternalUrl } from '../../desktop/openExternal'
import { toast } from '../../utils/toast'

// The one gate between a note and the outside world.
//
// Siddran never navigates itself to a link: doing so replaces the whole app,
// unsaved editor state included, with no way back. Every external link — from the
// reading view, the editor, or the capture-phase guard in desktop/linkGuard.js —
// arrives here, is shown to the user in full, and only then goes to the real
// browser.
//
// Mounted once at app level (like ToastContainer) and reached through the
// `window.__siddranOpenExternal` bridge rather than a context, because the guard
// is installed before React mounts and needs the same door as everyone else. One
// way in beats a hook for components and a global for everything else.
function ExternalLinkGate() {
  const [pending, setPending] = useState(null)

  const request = useCallback((url) => {
    const clean = String(url || '').trim()
    if (clean) setPending(clean)
  }, [])

  useEffect(() => {
    window.__siddranOpenExternal = request
    return () => { if (window.__siddranOpenExternal === request) delete window.__siddranOpenExternal }
  }, [request])

  const confirm = useCallback(async () => {
    const url = pending
    setPending(null)
    if (!url) return
    try {
      await openExternalUrl(url)
    } catch (e) {
      toast.error(e?.message || String(e) || 'Could not open that link')
    }
  }, [pending])

  return (
    <ConfirmModal
      isOpen={pending != null}
      title="Open in your browser?"
      // The URL is shown whole, as plain text, on purpose: the point of the prompt
      // is that a link reading "docs" going somewhere else is visible before you
      // commit to it. Never truncate or ellipsize it.
      message={
        <>
          <span className={styles.lead}>This leaves Siddran and opens in your browser.</span>
          <span className={styles.url}>{pending}</span>
        </>
      }
      confirmText="Open link"
      cancelText="Cancel"
      confirmVariant="primary"
      onConfirm={confirm}
      onClose={() => setPending(null)}
    />
  )
}

export default ExternalLinkGate
