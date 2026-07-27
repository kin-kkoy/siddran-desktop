import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import styles from './Sidebar.module.css'
import SidebarList from "./SidebarList";
import ProfileDropdown from "../ProfileDropdown/ProfileDropdown";
import { LuStickyNote, LuListTodo, LuShapes, LuCalendarDays, LuPanelLeftClose, LuPanelLeftOpen, LuChevronDown } from "react-icons/lu";
import { readListOpen, writeListOpen } from "../../../hooks/sidebarState";


function Sidebar({ username, isCollapsed, toggleSidebar, notes, notebooks, currentNoteID, setIsAuthed, recentBags = [], currentBagPath, onSwitchBag }) {

    const navigate = useNavigate()
    const location = useLocation()

    const onNotePage = location.pathname.startsWith('/notes/') && location.pathname !== '/notes';
    // NotesHub lives at both '/' and '/notes'. There the note list is offered as a
    // collapsible accordion (persisted open/closed) rather than always-shown.
    const onNotesHub = location.pathname === '/notes' || location.pathname === '/';

    const [listOpen, setListOpen] = useState(readListOpen)
    const toggleList = () => setListOpen(prev => { const next = !prev; writeListOpen(next); return next })

    // Close the current Bag. Desktop has no auth session, so this just flushes the
    // Bag to disk (via setIsAuthed → closeBag) and returns to the Bag picker.
    const handleLogout = async () => {
        sessionStorage.clear()
        if (setIsAuthed) setIsAuthed(false)   // App wires this to closeBag()
        navigate('/')
    }


    return (
        <div className={`${styles.sidebar} ${isCollapsed ? styles.hidden : ''}`} aria-hidden={isCollapsed}>

            {/* TOP SECTION: brand + navigation links */}
            <div className={styles.topSection}>

                {/* Identity: profile (avatar · Bag name · "star chaser") on the left,
                    collapse toggle on the right. */}
                <div className={styles.brand}>
                    <div className={styles.brandProfile}>
                        <ProfileDropdown
                            username={username}
                            isCollapsed={isCollapsed}
                            handleLogout={handleLogout}
                            recentBags={recentBags}
                            currentBagPath={currentBagPath}
                            onSwitchBag={onSwitchBag}
                        />
                    </div>
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
                {onNotesHub && (
                    <div className={styles.listAccordion}>
                        <button
                            type="button"
                            className={styles.listAccordionHeader}
                            onClick={toggleList}
                            aria-expanded={listOpen}
                            title={listOpen ? 'Collapse note list' : 'Expand note list'}
                        >
                            <LuChevronDown
                                size={16}
                                className={`${styles.listChevron} ${listOpen ? '' : styles.listChevronCollapsed}`}
                            />
                            <span>{listOpen && (notes?.length ?? 0) === 0 ? 'No notes yet' : 'List of Notes'}</span>
                        </button>
                        {listOpen && (
                            <SidebarList
                                isCollapsed={isCollapsed}
                                notes={notes}
                                notebooks={notebooks}
                                currentNoteID={currentNoteID}
                            />
                        )}
                    </div>
                )}
            </div>


        </div>
    )
}

export default Sidebar
