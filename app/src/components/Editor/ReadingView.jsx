import { useLayoutEffect, useMemo, useRef } from 'react'
import { markdownToHtml } from './utils/markdownToHtml'
import { CHEVRON_SVG } from './cm/fold'
import { readFolds, writeFolds } from '../../hooks/noteFoldsCache'
import { toast } from '../../utils/toast'
import 'highlight.js/styles/atom-one-dark.css'
import styles from './ReadingView.module.css'

// Read-only rendered view of a note — the "reading mode" the read/edit toggle
// switches to in the new editor. Renders note markdown to HTML once per content
// change and decorates each <pre> with a Copy button.
function ReadingView({ markdown, noteId, rememberFolds, onSearchTag, onOpenLink, onCheckboxToggle }) {
  const ref = useRef(null)
  const html = useMemo(() => markdownToHtml(markdown || ''), [markdown])

  const handleClick = (e) => {
    const link = e.target.closest?.('.rv-link')
    if (link && onOpenLink) { onOpenLink(link); return }
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
    return () => cleanups.forEach((fn) => fn())
  })

  return <div ref={ref} className={styles.reading} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
}

export default ReadingView
