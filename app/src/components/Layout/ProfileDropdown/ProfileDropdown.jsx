import { useRef, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import styles from './ProfileDropdown.module.css'
import { IoMdSettings } from "react-icons/io";
import { TbLogout2 } from "react-icons/tb";
import { LuCheck } from "react-icons/lu";
import { useSettings } from "../../../contexts/SettingsContext";

function ProfileDropdown({ username, isCollapsed, handleLogout, recentBags = [], currentBagPath, onSwitchBag }) {
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef(null)
    const buttonRef = useRef(null) // This refers to the profile button
    const { openSettings } = useSettings()

    // rerender component or run when clicking outside (this case, the rerendering is to hide/remove the window (which is this component))
    useEffect(() => {
        const handleClickOutside = e => {
            if(dropdownRef.current && !dropdownRef.current.contains(e.target) && buttonRef.current && !buttonRef.current.contains(e.target)){
                setIsOpen(false)
            }
        }

        if(isOpen) document.addEventListener('mousedown', handleClickOutside)
        
        // IMPORTANT: This is a cleanup function (callback), we do this so that when the component unmounts or is removed (which is what happens in this case) it'll remove the event listener that we created just above this line
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }

    }, [isOpen])

    const navigateSettings = () => {
        setIsOpen(false)
        openSettings()
    }

    const Logout = () => {
        setIsOpen(false)
        handleLogout()
    }

    const selectBag = (bag) => {
        setIsOpen(false)
        if (bag.path !== currentBagPath) onSwitchBag?.(bag)
    }

    // get dropdown menu position based on button position (profile btn)
    const getDropdownStyle = () => {
        if(!buttonRef.current) return {}

        // honestly don't knwo much bout this but it's apparently used to get the size of the box
        const rect = buttonRef.current.getBoundingClientRect()

        if(isCollapsed){
            // When collapsed: position to the right of button but ensure it doesn't go off screen
            const maxTop = window.innerHeight - 200  // 200px is approx dropdown height
            const top = Math.min(rect.top, maxTop)  // ← FIX: Don't go below viewport
            
            return {
                position: 'fixed',
                top: `${top}px`,
                left: `${rect.right + 8}px`,
            }
        }else{
            // Profile sits at the TOP of the sidebar, so the menu opens downward.
            return{
                position: 'fixed',
                top: `${rect.bottom + 8}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`
            }
        }

    }

    return (
        <>
            <button
                ref={buttonRef}  // ← Add ref
                className={styles.profileBtn}
                onClick={() => setIsOpen(!isOpen)}
                title={isCollapsed ? "Profile" : undefined}
            >
                <span className={styles.avatar}>{username ? username.charAt(0).toUpperCase() : '?'}</span>
                <span className={`${styles.userInfo} ${isCollapsed ? styles.userInfoHidden : ''}`}>
                    <span className={styles.userName}>{username}</span>
                    <span className={styles.userTitle}>star chaser</span>
                </span>
            </button>

            {/* Render dropdown using Portal */}
            {isOpen && createPortal(
                <div
                    ref={dropdownRef}
                    className={styles.dropdownMenu}
                    style={getDropdownStyle()}  // ← Position dynamically
                >
                    {recentBags.length > 0 && (
                        <>
                            <p className={styles.switchLabel}>Switch Bag</p>
                            {/* Scrollable so a long list stays compact instead of cluttering. */}
                            <div className={styles.bagList}>
                                {recentBags.map((bag) => {
                                    const active = bag.path === currentBagPath
                                    return (
                                        <button
                                            key={bag.path}
                                            className={`${styles.bagItem} ${active ? styles.bagItemActive : ''}`}
                                            onClick={() => selectBag(bag)}
                                            title={bag.path}
                                        >
                                            <span className={styles.bagAvatar}>{bag.name ? bag.name.charAt(0).toUpperCase() : '?'}</span>
                                            <span className={styles.bagInfo}>
                                                <span className={styles.bagName}>{bag.name}</span>
                                                <span className={styles.bagPath}>{bag.path}</span>
                                            </span>
                                            {active && <span className={styles.bagCheck}><LuCheck size={14} /></span>}
                                        </button>
                                    )
                                })}
                            </div>
                            <div className={styles.divider}></div>
                        </>
                    )}
                    <button onClick={navigateSettings} className={styles.dropdownItem}>
                        <span className={styles.itemIcon}><IoMdSettings /></span>
                        <span>Settings</span>
                    </button>
                    <div className={styles.divider}></div>
                    <button onClick={Logout} className={`${styles.dropdownItem} ${styles.danger}`}>
                        <span className={styles.itemIcon}><TbLogout2 /></span>
                        <span>Close Bag</span>
                    </button>
                </div>,
                document.body  // ← Render directly into body
            )}
        </>
    )
}

export default ProfileDropdown