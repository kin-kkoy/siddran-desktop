import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { useSettings } from '../../contexts/SettingsContext'
import { markdownToHtml } from './utils/markdownToHtml'
import { CHEVRON_SVG } from './cm/fold'
import { readFolds, writeFolds } from '../../hooks/noteFoldsCache'
import { toast } from '../../utils/toast'
import 'highlight.js/styles/atom-one-dark.css'
import styles from './ReadingView.module.css'

// Wrap each unresolved comment's quoted text in a `.rv-comment` span so it reads
// highlighted in reading mode too. Anchors by text quote (offsets don't survive
// markdown→HTML rendering); re-walks per thread so several highlights can share a
// paragraph. Returns cleanups that unwrap the spans before the next re-decorate.
function highlightComments(root, threads, cleanups) {
  const active = (threads || []).filter((t) => !t.resolved && !t.orphaned && t.quote && t.quote.trim().length >= 2)
  for (const t of active) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        (n.nodeValue && n.nodeValue.includes(t.quote) &&
         !n.parentElement.closest('pre, code, .rv-comment'))
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    })
    const node = walker.nextNode()
    if (!node) continue
    const idx = node.nodeValue.indexOf(t.quote)
    const range = document.createRange()
    range.setStart(node, idx)
    range.setEnd(node, idx + t.quote.length)
    const span = document.createElement('span')
    span.className = 'rv-comment'
    span.setAttribute('data-comment-id', t.id)
    try { range.surroundContents(span) } catch { continue }
    cleanups.push(() => {
      const parent = span.parentNode
      if (parent) { parent.replaceChild(document.createTextNode(span.textContent), span); parent.normalize() }
    })
  }
}

// Read-only rendered view of a note — the "reading mode" the read/edit toggle
// switches to in the new editor. Renders note markdown to HTML once per content
// change and decorates each <pre> with a Copy button.
function ReadingView({ markdown, noteId, rememberFolds, onSearchTag, onOpenLink, onCheckboxToggle, comments, onCommentClick }) {
  const ref = useRef(null)
  const html = useMemo(() => markdownToHtml(markdown || ''), [markdown])

  // ── Book layout ──────────────────────────────────────────────────
  // Two pages side by side, fixed height, paged a spread at a time. The browser's
  // multi-column engine does the flow (including cutting mid-sentence at a page
  // edge); paging is just a horizontal shift of that column strip.
  const { settings } = useSettings()
  const book = settings.noteLayout === 'book'
  const pageH = settings.bookPageHeight || 620
  const turn = settings.bookTurn || 'fade'
  const [spread, setSpread] = useState(0)
  const [step, setStep] = useState(0)
  const [total, setTotal] = useState(1)
  const [fading, setFading] = useState(false)

  // Re-measure whenever the content or the page box changes.
  useLayoutEffect(() => {
    if (!book) { setStep(0); setTotal(1); return }
    const el = ref.current
    if (!el) return
    const measure = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const s = el.clientWidth + gap
      if (!s) return
      setStep(s)
      setTotal(Math.max(1, Math.round((el.scrollWidth + gap) / s)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [book, html, pageH, settings.noteEditorWidth])

  useLayoutEffect(() => { setSpread(0) }, [noteId, book])
  useEffect(() => { setSpread((s) => Math.min(s, Math.max(0, total - 1))) }, [total])

  const go = useCallback((d) => {
    setSpread((cur) => {
      const next = Math.max(0, Math.min(cur + d, total - 1))
      if (next === cur) return cur
      if (turn === 'fade') {
        // Cross-fade in place rather than panning — a pan reads as a filmstrip.
        setFading(true)
        setTimeout(() => { setSpread(next); setFading(false) }, 110)
        return cur
      }
      return next
    })
  }, [total, turn])

  useEffect(() => {
    if (!book) return
    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(e.key)) return
      if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      go(e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [book, go])

  const handleClick = (e) => {
    const cm = e.target.closest?.('.rv-comment')
    if (cm && onCommentClick) { e.preventDefault(); onCommentClick(cm.getAttribute('data-comment-id')); return }
    const link = e.target.closest?.('.rv-link')
    if (link && onOpenLink) { e.preventDefault(); onOpenLink(link); return }
    const tag = e.target.closest?.('.rv-hashtag')
    if (tag && onSearchTag) onSearchTag(tag.getAttribute('data-tag'))
  }

  // Decorate the rendered HTML with fold chevrons, interactive checkboxes and
  // code-copy buttons. These are imperative DOM mutations INTO the
  // dangerouslySetInnerHTML subtree that React owns, so any re-render where React
  // re-applies the innerHTML silently wipes them. We therefore run with no
  // dependency array — re-decorating after EVERY commit. As a layout effect this
  // runs after React's DOM mutations but before paint, so a wiped-then-restored
  // pass is never visible.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const cleanups = []
    const sectionMap = new Map()

    // Persistent per-note folds (shared with the editor by source line number).
    // `foldedSet` is the saved state to restore; `persistFolds` snapshots whatever
    // is currently collapsed back to the store. Both are no-ops when the toggle is
    // off. This effect re-runs after every commit, so restore re-applies on its own.
    const foldedSet = rememberFolds ? new Set(readFolds(noteId)) : null
    const lineOf = (el) => parseInt(el?.getAttribute('data-line'), 10)
    const persistFolds = () => {
      if (!rememberFolds || !noteId) return
      const lines = []
      root.querySelectorAll('.rv-fold-chevron.is-folded').forEach((ch) => {
        const ln = lineOf(ch.parentElement)
        if (ln) lines.push(ln)
      })
      writeFolds(noteId, lines)
    }

    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
      const level = parseInt(heading.tagName[1])
      const section = []
      let el = heading.nextElementSibling
      while (el) {
        if (/^H[1-6]$/i.test(el.tagName) && parseInt(el.tagName[1]) <= level) break
        section.push(el)
        el = el.nextElementSibling
      }
      if (section.length === 0) return

      sectionMap.set(heading, section)
      const chevron = document.createElement('span')
      chevron.className = 'rv-fold-chevron rv-fold-h' + level
      chevron.innerHTML = CHEVRON_SVG

      if (foldedSet?.has(lineOf(heading))) {
        chevron.classList.add('is-folded')
        section.forEach((s) => s.classList.add('rv-folded'))
      }

      const onClick = (e) => {
        e.stopPropagation()
        const folded = chevron.classList.toggle('is-folded')
        section.forEach((s) => s.classList.toggle('rv-folded', folded))
        if (!folded) {
          section.forEach((s) => {
            if (/^H[1-6]$/i.test(s.tagName)) {
              const cc = s.querySelector('.rv-fold-chevron.is-folded')
              if (!cc) return
              const cs = sectionMap.get(s)
              if (cs) cs.forEach((c) => c.classList.add('rv-folded'))
            }
          })
        }
        persistFolds()
      }

      chevron.addEventListener('click', onClick)
      heading.prepend(chevron)
      cleanups.push(() => {
        chevron.removeEventListener('click', onClick)
        chevron.remove()
        section.forEach((s) => s.classList.remove('rv-folded'))
      })
    })

    root.querySelectorAll('li').forEach((li) => {
      const nested = li.querySelectorAll(':scope > ul, :scope > ol')
      if (nested.length === 0) return

      const chevron = document.createElement('span')
      chevron.className = 'rv-fold-chevron rv-fold-list'
      chevron.innerHTML = CHEVRON_SVG

      if (foldedSet?.has(lineOf(li))) {
        chevron.classList.add('is-folded')
        nested.forEach((n) => n.classList.add('rv-folded'))
      }

      const onClick = (e) => {
        e.stopPropagation()
        const folded = chevron.classList.toggle('is-folded')
        nested.forEach((n) => n.classList.toggle('rv-folded', folded))
        persistFolds()
      }

      chevron.addEventListener('click', onClick)
      li.style.position = 'relative'
      li.prepend(chevron)
      cleanups.push(() => {
        chevron.removeEventListener('click', onClick)
        chevron.remove()
        li.style.position = ''
        nested.forEach((n) => n.classList.remove('rv-folded'))
      })
    })

    if (onCheckboxToggle) {
      root.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
        cb.removeAttribute('disabled')
        cb.style.cursor = 'pointer'
        const onChange = () => onCheckboxToggle(i)
        cb.addEventListener('change', onChange)
        cleanups.push(() => cb.removeEventListener('change', onChange))
      })
    }

    root.querySelectorAll('pre').forEach((pre) => {
      pre.classList.add('rv-pre')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'rv-copy-btn'
      btn.textContent = 'Copy'
      const onClick = () => {
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
        navigator.clipboard.writeText(code)
          .then(() => toast.success('Code copied'))
          .catch(() => toast.error('Copy failed'))
      }
      btn.addEventListener('click', onClick)
      pre.appendChild(btn)
      cleanups.push(() => { btn.removeEventListener('click', onClick); btn.remove() })
    })

    // Comment highlights (run last so it doesn't fight the other decorations).
    highlightComments(root, comments, cleanups)

    return () => cleanups.forEach((fn) => fn())
  })

  const content = (
    <div
      ref={ref}
      className={`${styles.reading} ${book ? styles.pages : ''} ${fading ? styles.fading : ''}`}
      style={book ? { height: pageH, transform: `translateX(${-spread * step}px)` } : undefined}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
  if (!book) return content

  return (
    <div className={styles.bookOuter}>
      <div className={styles.viewport} style={{ height: pageH }}>
        {content}
        <div className={styles.spine} aria-hidden="true" />
      </div>
      <div className={styles.bookNav}>
        <button type="button" className={styles.pageBtn} onClick={() => go(-1)} disabled={spread === 0} aria-label="Previous page">
          <LuChevronLeft size={15} /> Previous
        </button>
        <span className={styles.pageNo}>{spread * 2 + 1}–{spread * 2 + 2} of ~{total * 2}</span>
        <button type="button" className={styles.pageBtn} onClick={() => go(1)} disabled={spread >= total - 1} aria-label="Next page">
          Next <LuChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

export default ReadingView
