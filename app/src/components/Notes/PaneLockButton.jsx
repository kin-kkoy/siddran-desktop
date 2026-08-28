import { LuPin, LuPinOff } from 'react-icons/lu'
import { useParams } from 'react-router-dom'
import { usePaneLock } from '../../contexts/PaneLockContext'
import styles from './PaneLockButton.module.css'

// Locks the right column to the note you are in. Off by default: an unlocked
// panel is global and follows you from note to note, which is the original
// behaviour. A locked one only appears in its own note, so coming back to that
// note brings its context back with it.
//
// A PIN, not a padlock, on purpose. AttachmentPane's header already has a
// LuLock/LuLockOpen button that means something else entirely — whether an HTML
// page is trusted to save its own state — and two padlocks side by side in one
// header would be genuinely confusing. "Pinned to this note" also describes what
// this does more honestly than "locked" does. The wording keeps the word lock.
export default function PaneLockButton({ className = '' }) {
  const { id } = useParams()
  const paneLock = usePaneLock()
  if (id == null) return null

  const locked = paneLock.isLockedFor(id)
  return (
    <button
      type="button"
      className={`${styles.lockBtn} ${locked ? styles.locked : ''} ${className}`}
      onClick={(e) => { e.stopPropagation(); if (locked) paneLock.unlock(); else paneLock.lock(id) }}
      title={locked
        ? 'Locked to this note — this panel stays here instead of following you. Click to unlock.'
        : 'Lock this panel to this note, so it only opens here.'}
      aria-pressed={locked}
      aria-label={locked ? 'Unlock this panel from this note' : 'Lock this panel to this note'}
    >
      {locked ? <LuPin size={13} /> : <LuPinOff size={13} />}
    </button>
  )
}
