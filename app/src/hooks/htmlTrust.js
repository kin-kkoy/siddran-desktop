// Which attached HTML pages you've allowed to remember things.
//
// Saving state is NOT what trust is about — every page gets working storage via
// the shim the viewer protocol injects, which the app persists itself.
//
// What an untrusted page cannot do is READ FILES. Its origin is opaque, so
// fetch/XHR are refused even for the page's own sibling data files. Trusting it
// grants `allow-same-origin`, which lets it read those — and, through the same
// protocol, any other file in the Bag. That is the whole of what trust buys and
// costs.
//
// Device-local and Bag-scoped, like the other caches here — a trust decision is
// about a file on this machine and should not travel.
import { getBagPath } from '../desktop/localStore'
import { canonicalAttachmentPath } from '../utils/attachmentLinks'

export const TRUST_PROMPT_MODES = { ALWAYS: 'always', ONCE: 'once', NEVER: 'never' }

const keyFor = (bagPath) => `siddran_html_trust:${bagPath || getBagPath() || 'default'}`

const empty = () => ({ trusted: {}, dismissed: {}, hosts: {} })

// Keys are canonicalised on the way in AND on the way out. The same file used to
// land under two spellings — raw from the attach flow, percent-encoded from the
// markdown link — so a page trusted one way looked untrusted the other. Folding
// on read also migrates any duplicate pairs already on disk, no separate step.
const foldKeys = (obj) => {
  const out = {}
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (obj[k]) out[canonicalAttachmentPath(k)] = true
    }
  }
  return out
}

export function readTrust(bagPath) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(bagPath)) || 'null')
    if (!raw || typeof raw !== 'object') return empty()
    const hosts = {}
    if (raw.hosts && typeof raw.hosts === 'object') {
      for (const k of Object.keys(raw.hosts)) {
        if (Array.isArray(raw.hosts[k])) hosts[canonicalAttachmentPath(k)] = raw.hosts[k]
      }
    }
    return { trusted: foldKeys(raw.trusted), dismissed: foldKeys(raw.dismissed), hosts }
  } catch { return empty() }
}

function write(bagPath, state) {
  try { localStorage.setItem(keyFor(bagPath), JSON.stringify(state)) } catch { /* ignore */ }
}

export const isTrusted = (path, bagPath) =>
  !!(path && readTrust(bagPath).trusted[canonicalAttachmentPath(path)])

export function setTrusted(path, trusted, bagPath) {
  if (!path) return
  const key = canonicalAttachmentPath(path)
  const state = readTrust(bagPath)
  if (trusted) state.trusted[key] = true
  else delete state.trusted[key]
  write(bagPath, state)
}

// "Don't ask again for this page" — remembered separately from trust, so
// declining once doesn't look the same as never having been asked.
export function setDismissed(path, bagPath) {
  if (!path) return
  const state = readTrust(bagPath)
  state.dismissed[canonicalAttachmentPath(path)] = true
  write(bagPath, state)
}

export const isDismissed = (path, bagPath) =>
  !!(path && readTrust(bagPath).dismissed[canonicalAttachmentPath(path)])

export const trustedPaths = (bagPath) => Object.keys(readTrust(bagPath).trusted)

// External hosts approved for one page.
export const allowedHosts = (path, bagPath) =>
  (path && readTrust(bagPath).hosts[canonicalAttachmentPath(path)]) || []

export function setAllowedHosts(path, hosts, bagPath) {
  if (!path) return
  const key = canonicalAttachmentPath(path)
  const state = readTrust(bagPath)
  if (hosts && hosts.length) state.hosts[key] = [...new Set(hosts)]
  else delete state.hosts[key]
  write(bagPath, state)
}

// Clears trust AND dismissals: after a reset you should be asked again, not left
// silently opted out.
export function forgetAllTrust(bagPath) {
  write(bagPath, empty())
}

// Whether to raise the trust prompt for a page. Pure so the policy is testable
// away from the viewer.
export function shouldPrompt({ mode, wantsFileAccess, trusted, dismissed }) {
  if (!wantsFileAccess) return false       // nothing to offer — the page reads nothing
  if (trusted) return false                // already answered, affirmatively
  if (mode === TRUST_PROMPT_MODES.NEVER) return false
  if (mode === TRUST_PROMPT_MODES.ALWAYS) return true
  return !dismissed                        // ONCE (default)
}
