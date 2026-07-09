import { Link, useNavigate } from 'react-router-dom'
import styles from './Card.module.css'
import { FaThumbtack, FaEllipsisV } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import { useState, useRef, useEffect, memo } from 'react'
import ConfirmModal from '../Common/ConfirmModal'
import { MdChromeReaderMode } from 'react-icons/md'
import { NOTE_COLORS, getNoteBackground, getSwatchColor } from './noteColors'

function HorizontalCard({ note, deleteNote, isSelectionMode, isSelected, onToggleSelect, toggleFavorite, updateColor }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState('below') // 'above' or 'below'
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)
  const navigate = useNavigate();
  const noteBackground = getNoteBackground(note.color)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  const handleDelete = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const confirmDelete = () => {
    deleteNote(note.id)
    setShowDeleteModal(false)
  }

  const cardClicked = (e) => {
    // If in selection mode, toggle selection instead of navigating
    if (isSelectionMode) {
      e.preventDefault()
      onToggleSelect(note.id)
    }
  }

  const handleOpenInReadMode = (e) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/notes/${note.id}?view=read`)
  }

  const toggleMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (!menuOpen && buttonRef.current) {
      // Calculate if there's enough space below
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - buttonRect.bottom
      const menuHeight = 180 // Approximate menu height

      // If not enough space below, show above
      setMenuPosition(spaceBelow < menuHeight ? 'above' : 'below')
    }

    setMenuOpen(!menuOpen)
  }

  const handleFavoriteToggle = (e) => {
    e.preventDefault()
    e.stopPropagation()
    toggleFavorite(note.id)
    setMenuOpen(false)
  }

  const handleColorChange = (e, color) => {
    e.preventDefault()
    e.stopPropagation()
    updateColor(note.id, color)
  }


  const cardContent = (
    <div
      className={`${styles.horizontalCard} ${isSelected ? styles.selected : ''} ${noteBackground ? styles.hasColor : ''}`}
      style={noteBackground ? { backgroundColor: noteBackground } : undefined}
      onClick={cardClicked}
    >

      {/* checkbox should ONLY APPEAR IN SELECTION MODE */}
      {isSelectionMode && (
        <div className={styles.checkbox}>
          <input type='checkbox'
            checked={isSelected}
            onChange={() => onToggleSelect(note.id)}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      <div className={styles.horizontalCardContent}>
        <h4>{note.title}</h4>
        {note.tags && <p className={styles.horizontalTags}>{note.tags.split(',').map(t => t.trim()).filter(Boolean).join(' · ')}</p>}
      </div>

      <div className={styles.meta}>
        {/* Show menu and delete button only when NOT in selection mode */}
        {!isSelectionMode && (
          <>
            <div className={styles.menuContainer} ref={menuRef}>
              <button ref={buttonRef} onClick={toggleMenu} className={styles.menuBtn}>
                <FaEllipsisV />
              </button>

              {menuOpen && (
                <div className={`${styles.menu} ${menuPosition === 'above' ? styles.menuAbove : styles.menuBelow}`}>
                  <button onClick={handleFavoriteToggle} className={styles.menuItem}>
                    {note.is_favorite ? <FaThumbtack color="#fbbf24" /> : <FaThumbtack style={{ opacity: 0.45 }} />}
                    <span>{note.is_favorite ? 'Unpin' : 'Pin'}</span>
                  </button>

                  <div className={styles.colorPicker}>
                    <span className={styles.colorLabel}>Color:</span>
                    <div className={styles.colorOptions}>
                      {NOTE_COLORS.map(c => (
                        <button
                          key={c.name}
                          onClick={(e) => handleColorChange(e, c.key)}
                          className={styles.colorBtn}
                          style={{ backgroundColor: getSwatchColor(c) || 'var(--bg-surface)' }}
                          title={c.name}
                        ></button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <button onClick={handleOpenInReadMode} className={styles.readModeBtn}>
              <MdChromeReaderMode size={18} />
            </button>
            <button onClick={handleDelete} className={styles.deleteBtn}>
              <HiOutlineTrash size={18} />
            </button>
          </>
        )}
      </div>

    </div>
  )


  return (
    <>
      {isSelectionMode ? (
        cardContent
      ) : (
        <Link to={`/notes/${note.id}`} style={{textDecoration: 'none'}}>
          {cardContent}
        </Link>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmDelete}
        title="Delete Note"
        message={`Are you sure you want to delete "${note.title}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </>
  )
}

export default memo(HorizontalCard)