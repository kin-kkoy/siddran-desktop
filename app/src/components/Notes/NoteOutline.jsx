import { LuX } from 'react-icons/lu'
import styles from './NoteOutline.module.css'

// Right-rail document outline: the note's headings, indented by level. Clicking a
// heading asks the editor to scroll to that source line. One of these renders per
// NotePane, so each split pane can have its own.
export default function NoteOutline({ headings = [], onJump, onClose }) {
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1
  return (
    <aside className={styles.outline} aria-label="Document outline">
      <div className={styles.head}>
        <span className={styles.title}>Outline</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close outline" aria-label="Close outline">
          <LuX size={14} />
        </button>
      </div>
      {headings.length === 0 ? (
        <div className={styles.empty}>No headings yet</div>
      ) : (
        <ul className={styles.list}>
          {headings.map((h, i) => {
            const depth = h.level - minLevel
            return (
              <li key={`${h.line}-${i}`}>
                <button
                  className={styles.item}
                  data-depth={Math.min(depth, 4)}
                  style={{ paddingLeft: `${depth * 15 + 8}px` }}
                  onClick={() => onJump?.(h.line)}
                  title={h.text}
                >
                  <span className={styles.bullet} aria-hidden="true" />
                  <span className={styles.label}>{h.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
