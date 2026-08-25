// Static scan of an HTML file before it's shown in the side pane. One pass over
// the source drives every prompt the viewer can raise, so a page that trips none
// of them opens with no chrome at all — which is most of them.
//
// Deliberately a heuristic on raw source, not a parse: it only decides which
// *warnings* to show. The actual enforcement is the iframe sandbox and the CSP,
// neither of which trusts this result. False positives cost a prompt; they can't
// weaken the sandbox.

export const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'`)<>]+/gi
// Protocol-relative, but only where it's unambiguously a URL — bare `//` in
// source is far more often a comment.
const PROTOCOL_RELATIVE = /(?:src|href)\s*=\s*["']\/\/[^\s"'`<>]+/gi
const STORAGE_API = /\b(localStorage|sessionStorage|indexedDB)\b/g
const NETWORK_API = /\bfetch\s*\(|\bXMLHttpRequest\b|\bnavigator\s*\.\s*sendBeacon\b|\bEventSource\b|\bWebSocket\b/g

const hostOf = (url) => {
  try { return new URL(url.startsWith('//') ? `https:${url}` : url).host.toLowerCase() }
  catch { return null }
}

const uniq = (xs) => [...new Set(xs)]

export function scanHtml(source) {
  const src = typeof source === 'string' ? source : ''

  const raw = [
    ...(src.match(ABSOLUTE_URL) || []),
    ...(src.match(PROTOCOL_RELATIVE) || []).map((m) => m.slice(m.indexOf('//'))),
  ]
  const external = uniq(raw).map((url) => {
    const host = hostOf(url)
    return { url, host, isFont: !!host && FONT_HOSTS.includes(host) }
  }).filter((e) => e.host)

  const storageApis = uniq(src.match(STORAGE_API) || [])
  const networkApis = uniq((src.match(NETWORK_API) || []).map((m) => m.replace(/\s*\($/, '').trim()))

  const fontHosts = uniq(external.filter((e) => e.isFont).map((e) => e.host))
  const blocked = external.filter((e) => !e.isFont)

  return {
    external,
    externalHosts: uniq(external.map((e) => e.host)),
    fontHosts,
    blocked,                       // non-font remote resources — always refused
    blockedHosts: uniq(blocked.map((e) => e.host)),
    storageApis,
    usesStorage: storageApis.length > 0,
    networkApis,
    usesNetworkApi: networkApis.length > 0,
  }
}

// ── the three questions the viewer actually asks ────────────────────

// The page wants to remember things, so offer trust. Without it, its storage
// calls throw under the opaque origin and the page silently forgets everything.
export const wantsTrust = (scan) => !!scan?.usesStorage

// The page asked for web fonts we're refusing — worth a toast, since the cause
// (it looks subtly wrong) isn't otherwise visible.
export const wantsFontNotice = (scan, fontsAllowed) => !fontsAllowed && (scan?.fontHosts?.length ?? 0) > 0

// The page fetches at runtime. Under an opaque origin that's CORS-blocked even
// for its own sibling files, so a page that hydrates this way renders BLANK with
// nothing in the UI to explain why.
export const wantsFetchWarning = (scan, trusted) => !trusted && !!scan?.usesNetworkApi
