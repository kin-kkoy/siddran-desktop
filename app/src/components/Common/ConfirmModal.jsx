import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './ConfirmModal.module.css'
import { modalPresence } from '../../utils/modalPresence'

// Reusable confirm dialog. Optional `busy` mode shows a spinner + `busyText`
// (and any `busyContent`, e.g. skeletons) while an async action runs, and blocks
// closing until it finishes. `confirmVariant` switches the confirm button colour
// ('danger' default for deletes, 'primary' for constructive actions).
function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Delete',
    cancelText = 'Cancel',
    busy = false,
    busyText = 'Working…',
    busyContent = null,
    confirmVariant = 'danger',
    hideCancel = false,
    glow = null,
}) {
    // Count as an open modal (pauses StarCanvas) only while actually shown.
    useEffect(() => {
        if (!isOpen) return
        modalPresence.push()
        return () => modalPresence.pop()
    }, [isOpen])

    if (!isOpen) return null

    const stop = (e) => e.stopPropagation()

    // Don't allow closing while a busy action is in flight.
    const requestClose = () => { if (!busy) onClose() }

    const handleBackdropClick = (e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) requestClose()
    }

    const confirmClass = `${styles.confirmBtn} ${confirmVariant === 'primary' ? styles.confirmPrimary : ''}`

    return createPortal(
        <div className={styles.backdrop} onClick={handleBackdropClick} onMouseDown={stop}>
            <div className={`${styles.modal} ${glow === 'danger' ? styles.glowDanger : ''}`} onClick={stop}>
                <div className={styles.header}>
                    <h2>{title}</h2>
                    <button onClick={requestClose} className={styles.closeBtn} disabled={busy}>×</button>
                </div>

                <div className={styles.content}>
                    {busy && busyContent ? busyContent : <p>{message}</p>}
                </div>

                <div className={styles.actions}>
                    {busy ? (
                        <button className={confirmClass} disabled>
                            <span className={styles.spinner} aria-hidden="true" />
                            {busyText}
                        </button>
                    ) : (
                        <>
                            {!hideCancel && (
                                <button onClick={onClose} className={styles.cancelBtn}>
                                    {cancelText}
                                </button>
                            )}
                            <button onClick={onConfirm} className={confirmClass}>
                                {confirmText}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}

export default ConfirmModal
