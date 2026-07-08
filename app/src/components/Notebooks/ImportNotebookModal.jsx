import { useState } from 'react'
import styles from './CreateNotebookModal.module.css'
import { toast } from '../../utils/toast'

const todayString = () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

function ImportNotebookModal({ fileCount, onClose, onConfirm }) {
    const [name, setName] = useState(`Imported ${todayString()}`)

    const handleSubmit = (e) => {
        e.preventDefault()
        if (!name.trim()) {
            toast.warning('Please enter a notebook name')
            return
        }
        onConfirm(name.trim())
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) onClose()
    }

    return (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2>Import to Notebook</h2>
                    <button onClick={onClose} className={styles.closeBtn}>×</button>
                </div>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.info}>
                        Importing <strong>{fileCount}</strong> markdown {fileCount === 1 ? 'file' : 'files'}
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="import-notebook-name">Notebook Name *</label>
                        <input
                            id="import-notebook-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={styles.input}
                            autoFocus
                        />
                        <span className={styles.hint}>An "Imported" tag will be added automatically</span>
                    </div>

                    <div className={styles.actions}>
                        <button type="button" onClick={onClose} className={styles.cancelBtn}>
                            Cancel
                        </button>
                        <button type="submit" className={styles.createBtn}>
                            Import
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default ImportNotebookModal
