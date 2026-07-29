import { LuX } from 'react-icons/lu'
import { useNoteTabs } from '../../../contexts/NoteTabsContext'
import { useNoteSplit } from '../../../contexts/NoteSplitContext'
import styles from './SidebarOpenNotes.module.css'

// The notes currently open as tabs, shown in the sidebar when you are NOT on a
// note page. Off the note page the tab strip isn't on screen, so this is the
// only view of what you have open — and a way back into it.
//
// Deliberately mirrors NoteTabBar rather than SidebarList: same source of truth
// (`openTabs` from NoteTabsContext, in tab order — not alphabetical), same click
// -to-open and ×-to-close, same middle-click-to-close. On a note page the
// sidebar still shows the full note list, because there the tab strip is already
// visible above the editor.
function SidebarOpenNotes({ isCollapsed, notes = [] }) {
  const { openTabs, activeId, activateTab, closeTab } = useNoteTabs()
  const split = useNoteSplit()

  if (isCollapsed) return null

  const titleFor = (id) => {
    const n = notes.find((x) => String(x.id) === String(id))
    return (n?.title || '').trim() || 'Untitled'
  }

  // Highlight both halves of a split view, matching how the tab strip lights
  // the pair and how SidebarList highlights open notes.
  const splitId = split.splitTarget?.type === 'note' ? String(split.splitTarget.id) : null
  const isActive = (id) => String(id) === String(activeId) || String(id) === splitId

  return (
    <div className={styles.container}>
      {openTabs.length === 0 ? (
        <p className={styles.empty}>No notes open</p>
      ) : (
        <div className={styles.list} role="list">
          {openTabs.map((id) => (
            <div
              key={id}
              role="listitem"
              className={`${styles.item} ${isActive(id) ? styles.active : ''}`}
              onClick={() => activateTab(id)}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
              title={titleFor(id)}
            >
              <span className={styles.title}>{titleFor(id)}</span>
              <button
                type="button"
                className={styles.close}
                // The row itself navigates, so the button must not bubble.
                onClick={(e) => { e.stopPropagation(); closeTab(id) }}
                title="Close note"
                aria-label={`Close ${titleFor(id)}`}
              >
                <LuX size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SidebarOpenNotes
