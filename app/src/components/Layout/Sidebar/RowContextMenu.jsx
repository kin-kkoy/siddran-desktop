import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './RowContextMenu.module.css'
import { modalPresence } from '../../../utils/modalPresence'

// A small right-click menu for a sidebar row.
//
// The app had no context menu at all before this, and no shared menu primitive to
// reuse — the note card rolls its own dropdown. This is deliberately the smallest
// thing that works: a list of { label, icon, onSelect } at a point.
//
// Portalled to <body> because a sidebar row lives inside a scrolling, clipping
// column; rendered in place, the menu would be cut off by the first ancestor with
// overflow hidden.
function RowContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    modalPresence.push()
    return () => modalPresence.pop()
  }, [])

  // Keep the menu on screen: a row near the bottom or the right edge would
  // otherwise open into nothing. Measured after mount, before paint.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - height - pad)),
    })
  }, [x, y])

  // Anything that moves the row out from under the menu closes it. `scroll` is
  // captured because the scrolling element is an ancestor, not the window.
  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('contextmenu', away)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('contextmenu', away)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={styles.menuItem}
          onClick={() => { onClose(); item.onSelect() }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

export default RowContextMenu
