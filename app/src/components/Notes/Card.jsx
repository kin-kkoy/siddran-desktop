import { FaThumbtack, FaEllipsisV, FaRegFolderOpen } from 'react-icons/fa'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './Card.module.css'
import { Link, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect, useMemo, memo } from 'react'
import ConfirmModal from '../Common/ConfirmModal'
import { MdChromeReaderMode } from 'react-icons/md'
import { NOTE_COLORS, getNoteBackground, paperTone, getPaperSwatch } from './noteColors'
import { useSettings } from '../../contexts/SettingsContext'
import { resolveCardStyle, cardClassNames, tiltFor } from '../../hooks/noteCardStyle'
import { canReveal, revealNote } from '../../desktop/reveal'

function Card({ note, deleteNote, isSelectionMode, isSelected, onToggleSelect, toggleFavorite, updateColor, inheritTone }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState('below') // 'above' or 'below'
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const menuRef = useRef(null)
  const buttonRef = useRef(null)
  const navigate = useNavigate()
  const noteBackground = getNoteBackground(note.color)

  // The card is a stack of two sheets; which way they sit is four independent
  // axes resolved from settings. Memoised on the raw setting values rather than
  // the settings object, which is replaced on every unrelated toggle.
  const { settings } = useSettings()
  const {
    noteCardExposure, noteCardAnchor, noteCardTilt, noteCardTurns,
    noteCardVary, noteCardVaryEachLaunch, noteCardSurprise, noteCardTags,
  } = settings
  const cardStyle = useMemo(() => resolveCardStyle({
    noteCardExposure, noteCardAnchor, noteCardTilt, noteCardTurns,
    noteCardVary, noteCardVaryEachLaunch, noteCardSurprise,
  }), [noteCardExposure, noteCardAnchor, noteCardTilt, noteCardTurns,
    noteCardVary, noteCardVaryEachLaunch, noteCardSurprise])
  const stackClasses = cardClassNames(cardStyle, styles)
  const tagClass = styles['tg' + (noteCardTags === 'stamp' ? 'Stamp' : noteCardTags === 'marker' ? 'Marker' : 'Rule')]
  const tagList = useMemo(
    () => (note.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    [note.tags])
  // Per-note angle, hashed from the note id so it never moves between renders.
  const paper = {
    '--paper': paperTone(note.color, inheritTone),
    ...(cardStyle.vary
      ? { '--tilt': `${tiltFor(note.id, cardStyle.salt, cardStyle.tilt)}deg` }
      : null),
  }

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
      const menuHeight = 220 // Approximate menu height

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

  const handleReveal = (e) => {
    e.preventDefault()
    e.stopPropagation()
    revealNote(note)
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
      className={`${styles.card} ${stackClasses} ${tagClass} ${isSelected ? styles.isSelected : ''} ${noteBackground ? styles.hasColor : ''}`}
      style={paper}
      onClick={ cardClicked }
    >
      {/* The two sheets of paper. Empty on purpose — they are surfaces, and the
          words live in .cardInner above them so a tilt never reaches the text. */}
      <div className={`${styles.sheet} ${styles.sheetUnder}`} />
      <div className={`${styles.sheet} ${styles.sheetTop}`} />

      {/* A pinned note sorts ahead of the rest, so dragging it elsewhere looks
          like the drop failed. It did not — the pin wins. Say so. */}
      {note.is_favorite && (
        <span className={styles.pinMark} title="Pinned — pinned notes stay at the front">
          <FaThumbtack />
        </span>
      )}

      <div className={styles.cardInner}>

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

                {/* Only when there's a real file behind the note — no Bag open (or
                    running outside the desktop shell) means nothing to show. */}
                {canReveal() && (
                  <button onClick={handleReveal} className={styles.menuItem}>
                    <FaRegFolderOpen style={{ opacity: 0.7 }} />
                    <span>Show in file manager</span>
                  </button>
                )}

                <div className={styles.colorPicker}>
                  <span className={styles.colorLabel}>Color:</span>
                  <div className={styles.colorOptions}>
                    {NOTE_COLORS.map(c => (
                      <button
                        key={c.name}
                        onClick={(e) => handleColorChange(e, c.key)}
                        className={styles.colorBtn}
                        style={{ backgroundColor: getPaperSwatch(c) }}
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

      {/* Title alone, centred. Tags moved to the footer; a preview line under the
          title turned every card into a paragraph. */}
      <div className={styles.cardBody}>
        <h2 className={styles.title}>{note.title}</h2>
      </div>

      <div className={styles.footer}>
        {/* Tags stand where the timestamp used to. Two at most: a third pushes
            the row actions off the line, and a card is a glance, not an index. */}
        <span className={styles.cardTags}>
          {tagList.slice(0, 2).map(t => (
            <span key={t} className={styles.cardTag}>{t}</span>
          ))}
          {tagList.length > 2 && (
            <span className={`${styles.cardTag} ${styles.more}`}>+{tagList.length - 2}</span>
          )}
        </span>
        {!isSelectionMode && (
          <div className={styles.footerActions}>
            <button onClick={handleOpenInReadMode} className={styles.readModeBtn}><MdChromeReaderMode size={18} /></button>
            <button onClick={handleDelete} className={styles.deleteBtn}><HiOutlineTrash size={18} /></button>
          </div>
        )}
      </div>
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