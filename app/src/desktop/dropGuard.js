// Stop the webview from navigating to (opening fullscreen) a file the user drags
// anywhere onto the app — the default browser action for an unhandled file drop.
//
// It must be UNCONDITIONAL: WebKitGTK hides `dataTransfer.types` during dragover
// for cross-origin/file drags, so we can't sniff for files to decide. We only
// call preventDefault (never stopPropagation), so element-level drop handlers —
// the note editor's image embed (cm/imagePaste.js), the sandbox, HTML5 drag-drop
// in Kanban/calendar — still run their own logic. And by making every element a
// valid drop target, this is also what lets the editor's `drop` fire at all.
export function installDropGuard() {
  if (typeof window === 'undefined' || window.__siddranDropGuard) return
  window.__siddranDropGuard = true
  const prevent = (e) => e.preventDefault()
  window.addEventListener('dragover', prevent)
  window.addEventListener('drop', prevent)
}
