import { useNavigate } from 'react-router-dom'
import { HiOutlineTrash } from 'react-icons/hi'
import styles from './SandboxCard.module.css'

const relativeTime = (iso) => {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const mins = Math.round(ms / 60000)
    if (mins < 1) return 'JUST NOW'
    if (mins < 60) return `${mins}M AGO`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}H AGO`
    const days = Math.round(hrs / 24)
    if (days < 30) return `${days}D AGO`
    return new Date(iso).toLocaleDateString()
}

function SandboxRow({ sandbox, onDelete }) {
    const navigate = useNavigate()

    return (
        <div
            className={styles.row}
            onClick={() => navigate(`/sandboxes/${sandbox.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/sandboxes/${sandbox.id}`) }}
        >
            <div className={styles.rowIcon}>✦</div>
            <div className={styles.rowTitle}>{sandbox.title}</div>
            <div className={styles.rowMeta}>{relativeTime(sandbox.updatedAt)}</div>
            <button
                className={styles.menuBtn}
                style={{ position: 'static', opacity: 1, marginLeft: 8 }}
                onClick={(e) => { e.stopPropagation(); onDelete?.(sandbox.id) }}
                title="Delete sandbox"
                aria-label="Delete sandbox"
            >
                <HiOutlineTrash size={16} />
            </button>
        </div>
    )
}

export default SandboxRow
