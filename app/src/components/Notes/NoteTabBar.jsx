import { LuX } from 'react-icons/lu'
import { useNoteTabs } from '../../contexts/NoteTabsContext'
import { useNoteSplit } from '../../contexts/NoteSplitContext'
import ExpandSidebarButton from '../Layout/Sidebar/ExpandSidebarButton'
import styles from './NoteTabBar.module.css'

// The open-notes tab strip above the editor. Click a tab to switch, × to close,
// middle-click to close. Tabs that are part of the current split view get an
// Edge-style "|" marker.
export default function NoteTabBar({ notes = [], controlsRef }) {
  const { openTabs, activeId, activateTab, closeTab } = useNoteTabs()
  const split = useNoteSplit()

  const titleFor = (id) => {
    const n = notes.find(x => String(x.id) === String(id))
    return (n?.title || '').trim() || 'Untitled'
  }
  const splitRightId = split.enabled && split.splitNoteId != null ? String(split.splitNoteId) : null
  const inSplit = (id) => split.enabled && (id === activeId || id === splitRightId)

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabBarInner}>
      <ExpandSidebarButton className={styles.tabBarExpand} />
      <div className={styles.tabsScroll} role="tablist" aria-label="Open notes">
      {openTabs.map((id) => (
        <div
          key={id}
          role="tab"
          aria-selected={id === activeId}
          tabIndex={0}
          className={`${styles.tab} ${id === activeId ? styles.active : ''} ${inSplit(id) ? styles.inSplit : ''}`}
          onClick={() => activateTab(id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(id) } }}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
          title={titleFor(id)}
        >
          {inSplit(id) && <span className={styles.splitMark} aria-hidden="true">|</span>}
          <span className={styles.tabTitle}>{titleFor(id)}</span>
          <button
            type="button"
            className={styles.tabClose}
            onClick={(e) => { e.stopPropagation(); closeTab(id) }}
            aria-label={`Close ${titleFor(id)}`}
          >
            <LuX size={13} />
          </button>
        </div>
      ))}
      </div>
      {/* right column: NotePane portals the active note's controls in here */}
      <div className={styles.controlsSlot} ref={controlsRef} />
      </div>
    </div>
  )
}
