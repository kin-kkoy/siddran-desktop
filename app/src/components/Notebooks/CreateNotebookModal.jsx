import { useState } from 'react'
import styles from './CreateNotebookModal.module.css'
import { toast } from '../../utils/toast'

function CreateNotebookModal({ onClose, onCreate, selectedNotesCount }) {
    const [name, setName] = useState('')
    const [tags, setTags] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (submitting) return
        if (!name.trim()) {
            toast.warning('Please enter a notebook name')
            return
        }
        setSubmitting(true)
        try {
            await onCreate(name, tags)
            onClose()
        } finally {
            setSubmitting(false)
        }
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    return (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2>Create New Notebook</h2>
                    <button onClick={onClose} className={styles.closeBtn}>×</button>
                </div>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.info}>
                        Creating notebook with <strong>{selectedNotesCount}</strong> {selectedNotesCount === 1 ? 'note' : 'notes'}
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="notebook-name">Notebook Name *</label>
                        <input
                            id="notebook-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., Work Projects, Personal Ideas..."
                            className={styles.input}
                            autoFocus
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="notebook-tags">Tags (Optional)</label>
                        <input
                            id="notebook-tags"
                            type="text"
                            value={tags}
                            onChange={(e) => setTags(e.target.value)}
                            placeholder="e.g., work, personal, archive..."
                            className={styles.input}
                        />
                        <span className={styles.hint}>Separate multiple tags with commas</span>
                    </div>

                    <div className={styles.actions}>
                        <button type="button" onClick={onClose} className={styles.cancelBtn} disabled={submitting}>
                            Cancel
                        </button>
                        <button type="submit" className={styles.createBtn} disabled={submitting}>
                            {submitting ? 'Creating…' : 'Create Notebook'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default CreateNotebookModal
