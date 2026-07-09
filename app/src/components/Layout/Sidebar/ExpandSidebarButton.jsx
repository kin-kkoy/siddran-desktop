import { useLocation } from 'react-router-dom'
import { LuPanelLeftOpen } from 'react-icons/lu'
import { useSidebar } from '../../../contexts/SidebarContext'
import styles from './ExpandSidebarButton.module.css'

// The "show sidebar" affordance — the only sidebar control left once it's fully
// hidden. Rendered contextually: the note tab bar (before the first tab), the
// sandbox header (beside the title), and floating on hubs/calendar. Renders
// nothing while the sidebar is expanded.
export default function ExpandSidebarButton({ className = '' }) {
  const { collapsed, setCollapsed } = useSidebar()
  if (!collapsed) return null
  return (
    <button
      type="button"
      className={`${styles.expandBtn} ${className}`}
      onClick={() => setCollapsed(false)}
      title="Show sidebar"
      aria-label="Show sidebar"
    >
      <LuPanelLeftOpen size={18} />
    </button>
  )
}

// Floating variant for pages that have no toolbar of their own (Hubs, Calendar):
// far left with padding from the window edge. Suppressed on note/sandbox pages,
// which host their own inline expand button.
export function GlobalExpandButton() {
  const { pathname } = useLocation()
  const hasOwnButton = /^\/notes\/[^/]+/.test(pathname) || /^\/sandboxes\/[^/]+/.test(pathname)
  if (hasOwnButton) return null
  return <ExpandSidebarButton className={styles.floating} />
}
