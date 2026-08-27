// Last line of defence against the webview navigating away from Siddran.
//
// markdownToHtml strips the href off every anchor it produces, so a note's links
// cannot navigate in the first place. This catches everything that pipeline does
// not own: HTML rendered by some future surface, an anchor written directly in a
// component, anything at all that reaches the DOM with a live remote href. Losing
// the app takes unsaved editor state with it, so the backstop is worth its size.
//
// Sibling to dropGuard.js and installed the same way, from main.jsx before React
// mounts. CAPTURE phase, so it runs before any component's own handler and before
// the browser's default navigation.
//
// Only REMOTE hrefs are intercepted. In-app anchors (react-router links, the
// login/register pages' relative hrefs) are left alone — they are a different
// concern and stopping them here would break navigation.
import { requestOpenExternal } from './openExternal'

const isRemote = (href) => /^(https?:)?\/\//i.test(href.trim())

export function installLinkGuard() {
  if (typeof window === 'undefined' || window.__siddranLinkGuard) return
  window.__siddranLinkGuard = true
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (!isRemote(href)) return
    e.preventDefault()
    // If the gate hasn't mounted yet this does nothing, and the click is still
    // swallowed: doing nothing is strictly better than navigating the app away.
    requestOpenExternal(href)
  }, true)
}
