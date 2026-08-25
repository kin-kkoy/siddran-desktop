import { useCallback, useEffect, useRef, useState } from 'react'
import { LuX, LuShieldAlert, LuLock, LuLockOpen, LuArrowLeft, LuArrowRight, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { resolveImageUrl } from '../../utils/imageUpload'
import { hrefKind, ATTACHMENT_KINDS } from '../../utils/attachmentLinks'
import { scanHtml, wantsFontNotice, wantsFetchWarning } from '../../utils/htmlScan'
import { readAttachmentText } from '../../desktop/media'
import { viewerUrl, setViewerFonts, saveViewerStorage, setViewerAllowedHosts } from '../../desktop/htmlViewer'
import { isTrusted, setTrusted, setDismissed, isDismissed, shouldPrompt, allowedHosts, setAllowedHosts } from '../../hooks/htmlTrust'
import { useSettings } from '../../contexts/SettingsContext'
import { toast } from '../../utils/toast'
import TrustPromptModal from './TrustPromptModal'
import styles from './AttachmentPane.module.css'

// Right-column attachment viewer.
//
// PDFs go straight to the webview by asset URL — WebKitGTK's built-in viewer
// renders them, and it breaks if the iframe carries a `sandbox` attribute.
//
// HTML is served over the `siddran-html` scheme instead (src-tauri/src/main.rs),
// which attaches a per-request CSP and gives the page an origin of its own. That
// origin is what makes trust possible: `allow-same-origin` then grants the page
// ITS identity rather than Siddran's. Untrusted pages stay on `allow-scripts`
// alone, so scripts and animations run against an opaque origin that can reach
// neither the Bag, the parent document, nor the Tauri IPC.
export default function AttachmentPane({ file, onClose }) {
  const path = file?.path || ''
  const kind = hrefKind(path)
  const isHtml = kind === ATTACHMENT_KINDS.HTML
  const { settings } = useSettings()
  const allowFonts = settings.htmlWebFonts === true
  const promptMode = settings.htmlTrustPrompt || 'once'

  const [trusted, setTrustedState] = useState(false)
  const [scan, setScan] = useState(null)
  const [prompting, setPrompting] = useState(false)
  // Bumped once the Rust side has the current font policy, so the iframe is never
  // loaded against a stale CSP. Doubles as the reload trigger after a trust change.
  const [policyReady, setPolicyReady] = useState(0)
  const warnedFor = useRef(null)

  useEffect(() => { setTrustedState(isHtml && isTrusted(path)) }, [path, isHtml])

  // Push the font policy before the first load, and re-push (forcing a reload)
  // whenever it changes.
  const [approved, setApproved] = useState([])
  useEffect(() => { setApproved(isHtml ? allowedHosts(path) : []) }, [path, isHtml])

  useEffect(() => {
    if (!isHtml) return
    let cancelled = false
    Promise.all([setViewerFonts(allowFonts), setViewerAllowedHosts(path, approved)])
      .then(() => { if (!cancelled) setPolicyReady((n) => n + 1) })
    return () => { cancelled = true }
  }, [allowFonts, isHtml, path, approved])

  // The parent can't touch a cross-origin frame's history, so the injected shim
  // does it on request.
  const navigate = useCallback((dir) => {
    try { frameRef.current?.contentWindow?.postMessage({ __siddranNav: dir }, '*') } catch { /* ignore */ }
  }, [])

  const approveAll = useCallback(() => {
    const hosts = scan?.blockedHosts || []
    setAllowedHosts(path, hosts)
    setApproved(hosts)
    setShowBlocked(false)
  }, [scan, path])

  // Read the source only to SCAN it — the iframe loads from the protocol, not from
  // this text. Drives which notices, if any, the page earns.
  useEffect(() => {
    if (!isHtml || !path) { setScan(null); return }
    let cancelled = false
    readAttachmentText(path).then((text) => {
      if (!cancelled) setScan(text == null ? null : scanHtml(text))
    })
    return () => { cancelled = true }
  }, [path, isHtml])

  useEffect(() => {
    if (!scan || !path || warnedFor.current === path) return
    warnedFor.current = path
    if (wantsFontNotice(scan, allowFonts)) {
      toast.warning('Web fonts blocked — this page will look different. Enable them in Settings if you want its own fonts.')
    }
    if (wantsFetchWarning(scan, trusted) && !shouldPrompt({ mode: promptMode, wantsFileAccess: scan.usesNetworkApi, trusted: isTrusted(path), dismissed: isDismissed(path) })) {
      toast.warning('This page loads content at runtime, which is blocked here — parts of it may stay empty.')
    }
  }, [scan, allowFonts, path, trusted, promptMode])

  // Offer trust only for a page that actually saves something, and only per the
  // chosen policy.
  useEffect(() => {
    if (!scan || !path) return
    setPrompting(shouldPrompt({
      mode: promptMode,
      wantsFileAccess: scan.usesNetworkApi,
      trusted: isTrusted(path),
      dismissed: isDismissed(path),
    }))
  }, [scan, path, promptMode])

  const applyTrust = useCallback((next, dontAsk) => {
    setTrusted(path, next)
    if (dontAsk) setDismissed(path)
    setTrustedState(next)
    setPrompting(false)
    setPolicyReady((n) => n + 1)   // remount the iframe under the new sandbox
  }, [path])

  // The viewer's storage shim (injected in Rust) posts the page's saved state up
  // here. WebKitGTK discards localStorage for custom schemes on exit, so the app
  // owns it instead — otherwise a trusted page appears to remember things and has
  // forgotten them all by the next launch.
  const frameRef = useRef(null)
  useEffect(() => {
    if (!isHtml || !path) return
    const onMessage = (e) => {
      if (e.data?.__siddranStorage !== 1) return
      // Only our own frame, and always keyed to the file WE have open.
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return
      if (typeof e.data.data === 'string') saveViewerStorage(path, e.data.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [isHtml, path])

  const [showBlocked, setShowBlocked] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const blockedRef = useRef(null)
  useEffect(() => { setShowBlocked(false); setShowPrivacy(false) }, [path])
  useEffect(() => {
    if (!showBlocked) return
    const onDown = (e) => { if (!blockedRef.current?.contains(e.target)) setShowBlocked(false) }
    const onKey = (e) => { if (e.key === 'Escape') setShowBlocked(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showBlocked])

  const paneRef = useRef(null)

  const blocked = scan?.blockedHosts?.length ?? 0
  const src = isHtml ? viewerUrl(path) : (path ? resolveImageUrl(path) : '')
  const sandbox = trusted ? 'allow-scripts allow-same-origin' : 'allow-scripts'

  return (
    <div className={styles.pane} ref={paneRef}>
      <div className={styles.header}>
        {isHtml && (
          <span className={styles.navGroup}>
            <button type="button" className={styles.navBtn} onClick={() => navigate('back')} title="Back" aria-label="Back">
              <LuArrowLeft size={14} />
            </button>
            <button type="button" className={styles.navBtn} onClick={() => navigate('forward')} title="Forward" aria-label="Forward">
              <LuArrowRight size={14} />
            </button>
          </span>
        )}


        {/* Always available, so trust stays reversible and visible even when the
            prompt is switched off entirely. */}
        {isHtml && (
          <button
            type="button"
            className={`${styles.lockBtn} ${trusted ? styles.lockOpen : ''}`}
            onClick={() => applyTrust(!trusted, false)}
            title={trusted
              ? 'Trusted — this page can save its own state. Click to block it again.'
              : 'Blocked from saving anything. Click to trust this page.'}
            aria-label={trusted ? 'Stop trusting this page' : 'Trust this page'}
          >
            {trusted ? <LuLockOpen size={14} /> : <LuLock size={14} />}
          </button>
        )}

        <span className={styles.name} title={file?.name}>{file?.name || 'Attachment'}</span>

        {blocked > 0 && (
          <span className={styles.blockedWrap} ref={blockedRef}>
            <button
              type="button"
              className={styles.blockedBtn}
              onClick={() => setShowBlocked((v) => !v)}
              aria-expanded={showBlocked}
              title="See what was blocked"
            >
              <LuShieldAlert size={13} /> {blocked} blocked
            </button>
            {showBlocked && (
              <div className={styles.blockedPopover} role="dialog" aria-label="Blocked resources">
                <span className={styles.blockedTitle}>
                  {blocked} external {blocked === 1 ? 'source' : 'sources'} blocked
                </span>
                <span className={styles.blockedDesc}>
                  This page tried to load files from the internet. Siddran refused, so it
                  may look unstyled or be missing images — nothing was sent anywhere.
                </span>
                <ul className={styles.blockedList}>
                  {scan.blockedHosts.map((h) => <li key={h}>{h}</li>)}
                </ul>
                <button type="button" className={styles.allowBtn} onClick={approveAll}>
                  Allow these for this page
                </button>
                <span className={styles.blockedDesc} style={{ marginTop: 8, marginBottom: 0 }}>
                  Lets the page load its styling and images from these hosts. It still
                  can&rsquo;t open a connection to send your files out, and this applies
                  to this page only.
                </span>

                <button
                  type="button"
                  className={styles.whyBtn}
                  onClick={() => setShowPrivacy((v) => !v)}
                  aria-expanded={showPrivacy}
                >
                  {showPrivacy ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />} What does allowing actually expose?
                </button>

                {showPrivacy && (
                  <div className={styles.privacy}>
                    <p>
                      Siddran blocks <code>fetch</code>, <code>XHR</code>, WebSockets and
                      <code> sendBeacon</code> for viewed pages, and allowing hosts does not
                      change that. There is no channel for a page to upload what it read.
                    </p>
                    <p>
                      But a request is itself a signal. Loading a stylesheet tells that host
                      your IP address and that you opened this page — and a hostile page could
                      smuggle small amounts of data <em>into</em> a URL it requests, for
                      example an image address ending in <code>?d=…</code>. One-way, tiny, and
                      no reply comes back, but it isn&rsquo;t nothing.
                    </p>
                    <p>
                      For a page you saved yourself this is noise. For a page from somewhere
                      you don&rsquo;t trust, treat Allow as a real decision. That is why it is
                      off by default and applies to one page at a time.
                    </p>
                  </div>
                )}
              </div>
            )}
          </span>
        )}

        <span className={styles.spacer} />

        <button className={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close attachment">
          <LuX size={16} />
        </button>
      </div>

      {src && (!isHtml || policyReady > 0) ? (
        <iframe
          ref={frameRef}
          key={`${path}|${trusted}|${policyReady}`}
          className={styles.frame}
          src={src}
          title={file?.name || 'Attachment'}
          {...(isHtml ? { sandbox } : {})}
        />
      ) : (
        <div className={styles.empty}>{isHtml ? 'Opening…' : 'Could not load PDF'}</div>
      )}

      {prompting && (
        <TrustPromptModal
          name={file?.name}
          onTrust={(dontAsk) => applyTrust(true, dontAsk)}
          onBlock={(dontAsk) => { if (dontAsk) setDismissed(path); setPrompting(false) }}
        />
      )}
    </div>
  )
}
