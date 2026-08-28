import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import styles from './Sidebar.module.css'
import SidebarList from "./SidebarList";
import SidebarOpenNotes from "./SidebarOpenNotes";
import ProfileDropdown from "../ProfileDropdown/ProfileDropdown";
import { LuStickyNote, LuListTodo, LuShapes, LuCalendarDays, LuPanelLeftClose, LuPanelLeftOpen, LuChevronDown } from "react-icons/lu";
import { readListOpen, writeListOpen } from "../../../hooks/sidebarState";
import { readSession, sectionTarget } from "../../../hooks/sessionRouteCache";


function Sidebar({ username, isCollapsed, toggleSidebar, notes, notebooks, currentNoteID, setIsAuthed, recentBags = [], currentBagPath, onSwitchBag, onReloadBag, addNotesToNotebook, removeNoteFromNotebook, reorderNotes }) {

    const navigate = useNavigate()
    const location = useLocation()

    // On a note page the tab strip sits above the editor, so the sidebar shows the
    // full note list — that is what you need there, to reach a note you haven't
    // opened. Everywhere else the tab strip is off screen, so the sidebar shows
    // the OPEN notes instead: off the note page a second copy of the whole note
    // list is just noise (NotesHub already lists every note in its main area).
    const onNotePage = location.pathname.startsWith('/notes/') && location.pathname !== '/notes';
    // SandBoxes is the exception, hub and individual board alike: a board is a
    // full-bleed canvas you work inside, and a list of notes down the side is
    // off-topic there in exactly the way it is on the hub's grid of boards.
    const onSandbox = location.pathname.startsWith('/sandboxes');
    const showOpenNotes = !onNotePage && !onSandbox;

    // Section buttons return you to where you were in that section. Read on every
    // render so it can't go stale: `location.pathname` is already a render input,
    // and the session store is a synchronous localStorage read.
    // Already inside a section → the button goes to that section's hub instead, so
    // it stays a way back to the overview rather than a no-op.
    const session = readSession(currentBagPath)
    const target = (section) => sectionTarget(session, section, location.pathname)

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
                            onReloadBag={onReloadBag}
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
                    <Link to={target('notes')}
                        className={`${styles.menuBtn} ${location.pathname.startsWith('/notes') ? styles.active : ''}`}
                        title="Notes">
                            <LuStickyNote className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>Notes</span>
                    </Link>
                    <Link to={target('tasks')}
                        className={`${styles.menuBtn} ${location.pathname === '/tasks' ? styles.active : ''}`} title="Tasks">
                            <LuListTodo className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>Tasks</span>
                    </Link>

                    {/* startsWith, not ===: restoring to /sandboxes/:id would otherwise
                        leave no nav item lit at all. */}
                    <Link to={target('sandboxes')}
                        className={`${styles.menuBtn} ${location.pathname.startsWith('/sandboxes') ? styles.active : ''}`}
                        title="SandBoxes">
                            <LuShapes className={styles.navIcon} size={18} />
                            <span className={styles.navLabel}>SandBoxes</span>
                    </Link>

                    <Link to={target('calendar')}
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
                        addNotesToNotebook={addNotesToNotebook}
                        removeNoteFromNotebook={removeNoteFromNotebook}
                        reorderNotes={reorderNotes}
                    />
                )}
                {showOpenNotes && (
                    <div className={styles.listAccordion}>
                        <button
                            type="button"
                            className={styles.listAccordionHeader}
                            onClick={toggleList}
                            aria-expanded={listOpen}
                            title={listOpen ? 'Collapse open notes' : 'Expand open notes'}
                        >
                            <LuChevronDown
                                size={18}
                                className={`${styles.listChevron} ${listOpen ? '' : styles.listChevronCollapsed}`}
                            />
                            <span>Opened Notes</span>
                        </button>
                        {listOpen && (
                            <SidebarOpenNotes isCollapsed={isCollapsed} notes={notes} />
                        )}
                    </div>
                )}
            </div>


        </div>
    )
}

export default Sidebar
