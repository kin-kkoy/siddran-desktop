import styles from './SandboxCard.module.css'

function AddSandboxCard({ onClick, variant = 'grid' }) {
    if (variant === 'list') {
        return (
            <div
                className={styles.addRow}
                onClick={onClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
            >
                <span className={styles.addPlus} style={{ fontSize: 20 }}>+</span>
                <span className={styles.addLabel}>NEW SANDBOX</span>
            </div>
        )
    }
    return (
        <div
            className={styles.addCard}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
        >
            <span className={styles.addPlus}>+</span>
            <span className={styles.addLabel}>NEW SANDBOX</span>
        </div>
    )
}

export default AddSandboxCard
