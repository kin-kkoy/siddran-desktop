import { FaThumbtack, FaEllipsisV } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './Card.module.css'
import { Link, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect, memo } from 'react'
import ConfirmModal from '../Common/ConfirmModal'
import { MdChromeReaderMode } from 'react-icons/md'
import { NOTE_COLORS, getNoteBackground, getSwatchColor } from './noteColors'

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Card({ note, deleteNote, isSelectionMode, isSelected, onToggleSelect, toggleFavorite, updateColor }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState('below') // 'above' or 'below'
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)
  const navigate = useNavigate()
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
    // stop the usual navigation if in selection mode (selecting notes to add to notebook) and instead allow selection
    if(isSelectionMode){
      e.preventDefault()
      onToggleSelect(note.id)
    }
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

  const handleOpenInReadMode = (e) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/notes/${note.id}?view=read`)
  }


  const cardContent = (
    <div
      className={`${styles.card} ${isSelected ? styles.isSelected : ''} ${noteBackground ? styles.hasColor : ''}`}
      style={noteBackground ? { backgroundColor: noteBackground } : undefined}
      onClick={ cardClicked }
    >

      {isSelectionMode && (
        <div className={styles.checkbox}>
          <input type='checkbox'
            checked={isSelected}
            onChange={() => onToggleSelect(note.id)}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {!isSelectionMode && (
        <div className={styles.cardHeader}>
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
        </div>
      )}

      <div className={styles.cardBody}>
        <h2 className={styles.title}>{note.title}</h2>
        {note.tags && <p className={styles.tags}>{note.tags.split(',').map(t => t.trim()).filter(Boolean).join(' · ')}</p>}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerDate}>{formatDate(note.updated_at || note.created_at)}</span>
        {!isSelectionMode && (
          <div className={styles.footerActions}>
            <button onClick={handleOpenInReadMode} className={styles.readModeBtn}><MdChromeReaderMode size={18} /></button>
            <button onClick={handleDelete} className={styles.deleteBtn}><HiOutlineTrash size={18} /></button>
          </div>
        )}
      </div>
    </div>
  )


  return (
    <>
      {isSelectionMode ? (
        cardContent
      ) : (
        <Link to={`/notes/${note.id}`} style={{ textDecoration: 'none' }}>
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

export default memo(Card)