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

  // Two notes side by side render as ONE Edge-style split tab: `left | right`,
  // with the focused half lit. `left` is the route note (activeId); `right` is
  // the split target. Their standalone tabs are folded into this combined tab.
  const leftId = activeId
  const rightId = split.enabled && split.splitTarget?.type === 'note' ? String(split.splitTarget.id) : null
  const isSplitPair = leftId != null && rightId != null
  const pairIds = isSplitPair ? new Set([String(leftId), rightId]) : null

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabBarInner}>
      <ExpandSidebarButton className={styles.tabBarExpand} />
      <div className={styles.tabsScroll} role="tablist" aria-label="Open notes">
      {openTabs.map((id) => {
        // Fold the pair's standalone tabs away; the combined tab is rendered in
        // place of the left (active) note's slot.
        if (pairIds && pairIds.has(id)) {
          if (id !== String(leftId)) return null
          return (
            <div key="split-pair" className={styles.splitTab} role="group" aria-label="Split view">
              <button
                type="button"
                className={`${styles.splitHalf} ${split.focusedSide === 'left' ? styles.splitHalfActive : ''}`}
                onClick={() => { split.setFocusedSide('left'); if (String(leftId) !== activeId) activateTab(leftId) }}
                title={titleFor(leftId)}
              >
                {titleFor(leftId)}
              </button>
              <span className={styles.splitTabDivider} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.splitHalf} ${split.focusedSide === 'right' ? styles.splitHalfActive : ''}`}
                onClick={() => split.setFocusedSide('right')}
                title={titleFor(rightId)}
              >
                {titleFor(rightId)}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                onClick={(e) => { e.stopPropagation(); split.disable() }}
                aria-label="Close split view"
              >
                <LuX size={13} />
              </button>
            </div>
          )
        }
        return (
          <div
            key={id}
            role="tab"
            aria-selected={id === activeId}
            tabIndex={0}
            className={`${styles.tab} ${id === activeId ? styles.active : ''}`}
            onClick={() => activateTab(id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateTab(id) } }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(id) } }}
            title={titleFor(id)}
          >
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
        )
      })}
      </div>
      {/* right column: NotePane portals the active note's controls in here */}
      <div className={styles.controlsSlot} ref={controlsRef} />
      </div>
    </div>
  )
}
