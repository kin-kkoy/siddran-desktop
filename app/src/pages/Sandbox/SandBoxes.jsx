import { useMemo, useState } from 'react'
import { HiOutlineViewGrid, HiOutlineViewList } from 'react-icons/hi'
import { useNavigate } from 'react-router-dom'
import styles from './SandBoxes.module.css'
import { useSandboxes } from '../../hooks/useSandboxes'
import { getSandboxSummary } from '../../hooks/useSandbox'
import SandboxCard from '../../components/Sandbox/Hub/SandboxCard'
import SandboxRow from '../../components/Sandbox/Hub/SandboxRow'
import AddSandboxCard from '../../components/Sandbox/Hub/AddSandboxCard'
import ConfirmModal from '../../components/Common/ConfirmModal'
import { toast } from '../../utils/toast'

function SandBoxes() {
    const navigate = useNavigate()
    const { sandboxes, create, remove } = useSandboxes()
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('sandboxesViewMode') || 'grid')
    const [search, setSearch] = useState('')
    const [creating, setCreating] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const [pendingDelete, setPendingDelete] = useState(null)

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return sandboxes
        return sandboxes.filter(s => s.title.toLowerCase().includes(q))
    }, [sandboxes, search])

    // Per-sandbox summary (count + item-type buckets for the mosaic), read from
    // localStorage. Recomputed when the list changes (create/delete) and on
    // mount — which covers navigating back from a board after editing it.
    const summaries = useMemo(() => {
        const map = {}
        for (const s of sandboxes) map[s.id] = getSandboxSummary(s.id)
        return map
    }, [sandboxes])

    const toggleView = () => {
        const next = viewMode === 'grid' ? 'list' : 'grid'
        setViewMode(next)
        localStorage.setItem('sandboxesViewMode', next)
    }

    const beginCreate = () => {
        setCreating(true)
        setNewTitle('')
    }

    const confirmCreate = () => {
        const title = newTitle.trim() || 'Untitled Sandbox'
        const sandbox = create(title)
        setCreating(false)
        setNewTitle('')
        toast.success(`Created "${sandbox.title}"`)
        navigate(`/sandboxes/${sandbox.id}`)
    }

    const cancelCreate = () => {
        setCreating(false)
        setNewTitle('')
    }

    const handleDelete = (id) => setPendingDelete(id)
    const confirmDelete = () => {
        if (pendingDelete) {
            const sb = sandboxes.find(s => s.id === pendingDelete)
            remove(pendingDelete)
            toast.success(`Deleted "${sb?.title ?? 'sandbox'}"`)
        }
        setPendingDelete(null)
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1>Sand<span className={styles.accent}>Boxes</span></h1>
                <input
                    className={styles.searchInput}
                    placeholder="Search sandboxes by title..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <button className={styles.toggleBtn} onClick={toggleView} title="Toggle view">
                    {viewMode === 'grid' ? <HiOutlineViewList size={16} /> : <HiOutlineViewGrid size={16} />}
                    <span>{viewMode === 'grid' ? 'List' : 'Grid'}</span>
                </button>
            </header>

            {sandboxes.length === 0 && !creating ? (
                <section className={styles.empty}>
                    <div className={styles.emptyMark}>✦</div>
                    <div className={styles.emptyTitle}>NO SANDBOXES YET</div>
                    <p className={styles.emptyHint}>
                        A sandbox is your personal whiteboard — draw, pin notes, sketch with pressure.
                    </p>
                    <button className={styles.primaryBtn} onClick={beginCreate} style={{ marginTop: 8, flex: 'none', padding: '10px 22px' }}>
                        + Create your first sandbox
                    </button>
                </section>
            ) : (
                <div className={viewMode === 'grid' ? styles.gridView : styles.listView}>
                    {creating ? (
                        <CreateInline
                            value={newTitle}
                            onChange={setNewTitle}
                            onCancel={cancelCreate}
                            onConfirm={confirmCreate}
                        />
                    ) : (
                        <AddSandboxCard onClick={beginCreate} variant={viewMode === 'grid' ? 'grid' : 'list'} />
                    )}

                    {filtered.map(sb => viewMode === 'grid'
                        ? <SandboxCard key={sb.id} sandbox={sb} onDelete={handleDelete} summary={summaries[sb.id]} />
                        : <SandboxRow  key={sb.id} sandbox={sb} onDelete={handleDelete} />
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
                title="Delete sandbox?"
                message="This permanently removes the sandbox and all its drawings and attached notes. Notes themselves are NOT deleted."
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    )
}

function CreateInline({ value, onChange, onCancel, onConfirm }) {
    return (
        <div className={styles.createForm}>
            <input
                className={styles.createInput}
                placeholder="Untitled Sandbox"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onConfirm()
                    if (e.key === 'Escape') onCancel()
                }}
                autoFocus
            />
            <div className={styles.createActions}>
                <button className={styles.primaryBtn} onClick={onConfirm}>Create</button>
                <button className={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
            </div>
        </div>
    )
}

export default SandBoxes
