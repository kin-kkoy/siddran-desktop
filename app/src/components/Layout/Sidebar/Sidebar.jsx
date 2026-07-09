import { Link, useLocation, useNavigate } from "react-router-dom";
import styles from './Sidebar.module.css'
import SidebarList from "./SidebarList";
import ProfileDropdown from "../ProfileDropdown/ProfileDropdown";
import { LuStickyNote, LuListTodo, LuShapes, LuCalendarDays, LuPanelLeftClose, LuPanelLeftOpen } from "react-icons/lu";


function Sidebar({ username, isCollapsed, toggleSidebar, notes, notebooks, currentNoteID, setIsAuthed }) {

    const navigate = useNavigate()
    const location = useLocation()

    const onNotePage = location.pathname.startsWith('/notes/') && location.pathname !== '/notes';

    // Close the current Bag. Desktop has no auth session, so this just flushes the
    // Bag to disk (via setIsAuthed → closeBag) and returns to the Bag picker.
    const handleLogout = async () => {
        sessionStorage.clear()
        if (setIsAuthed) setIsAuthed(false)   // App wires this to closeBag()
        navigate('/')
    }


    return (
        <div className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}>

            {/* TOP SECTION: brand + navigation links */}
            <div className={styles.topSection}>

                {/* Brand: logo (→ home) on the left, collapse/expand toggle on the right */}
                <div className={styles.brand}>
                    <Link to="/" className={styles.brandLink} title="Home">
                        <div className={styles.brandName}>SIDDRAN</div>
                        <div className={styles.brandSub}>space drifting</div>
                    </Link>
                    <button
                        className={styles.collapseBtn}
                        onClick={() => toggleSidebar(!isCollapsed)}
                        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {isCollapsed ? <LuPanelLeftOpen size={18} /> : <LuPanelLeftClose size={18} />}
                    </button>
                </div>

                {/* Navigation area */}
                <div className={styles.navSection}>
                    <Link to="/notes"
                        className={`${styles.menuBtn} ${location.pathname.startsWith('/notes') ? styles.active : ''}`}
                        title="Notes">
                            <LuStickyNote className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>Notes</span>
                    </Link>
                    <Link to="/tasks"
                        className={`${styles.menuBtn} ${location.pathname === '/tasks' ? styles.active : ''}`} title="Tasks">
                            <LuListTodo className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>Tasks</span>
                    </Link>

                    <Link to="/sandboxes"
                        className={`${styles.menuBtn} ${location.pathname === '/sandboxes' ? styles.active : ''}`}
                        title="SandBoxes">
                            <LuShapes className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>SandBoxes</span>
                    </Link>

                    <Link to="/calendar"
                        className={`${styles.menuBtn} ${location.pathname === '/calendar' ? styles.active : ''}`}
                        title="Calendar">
                            <LuCalendarDays className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>Calendar</span>
                    </Link>

                </div>

            </div>


            {/* MIDDLE SECTION: the list of notes/tasks/mods */}
            <div className={styles.menuSection}>
                {onNotePage && (
                    <SidebarList
                        isCollapsed={isCollapsed}
                        notes={notes}
                        notebooks={notebooks}
                        currentNoteID={currentNoteID}
                    />
                )}
            </div>


            {/* BOTTOM SECTION: user & settings */}
            <div className={styles.bottomSection}>
                <ProfileDropdown username={username} isCollapsed={isCollapsed} handleLogout={handleLogout} />
            </div>

        </div>
    )
}

export default Sidebar
