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

// Fixed mosaic grid (8 cols × 4 rows). The first `count` cells are coloured by
// their item's bucket; the rest stay dim — so a near-empty board reads sparse
// and a busy one reads full. Boards with more than MOSAIC_CELLS items just fill
// the grid (it caps at "full" rather than growing).
const MOSAIC_CELLS = 32

function SandboxCard({ sandbox, onDelete, summary }) {
    const navigate = useNavigate()
    // Prefer the server's denormalized count (shows for boards synced from another
    // device before their items are cached locally); fall back to the cache summary.
    const count = sandbox?.item_count ?? summary?.count ?? 0
    const buckets = summary?.buckets ?? []

    return (
        <div
            className={styles.card}
            onClick={() => navigate(`/sandboxes/${sandbox.id}`)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/sandboxes/${sandbox.id}`) }}
        >
            <div className={styles.preview}>
                {count > 0 ? (
                    <div className={styles.mosaic}>
                        {Array.from({ length: MOSAIC_CELLS }, (_, i) => {
                            const bucket = buckets[i]
                            return (
                                <span
                                    key={i}
                                    className={`${styles.tile} ${bucket ? styles[`tile_${bucket}`] : ''}`}
                                />
                            )
                        })}
                    </div>
                ) : (
                    <div className={styles.previewEmpty}>empty board</div>
                )}
            </div>

            <div className={styles.meta}>
                <div className={styles.title}>{sandbox.title}</div>
                <div className={styles.timestamp}>{relativeTime(sandbox.updatedAt)}</div>
                <button
                    className={styles.menuBtn}
                    onClick={(e) => { e.stopPropagation(); onDelete?.(sandbox.id) }}
                    title="Delete sandbox"
                    aria-label="Delete sandbox"
                >
                    <HiOutlineTrash size={15} />
                </button>
            </div>
        </div>
    )
}

export default SandboxCard
