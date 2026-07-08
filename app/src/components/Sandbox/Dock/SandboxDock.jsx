import { Suspense, lazy, useMemo } from 'react'
import styles from './SandboxDock.module.css'
import { useSandboxes } from '../../../hooks/useSandboxes'
import { useSandbox } from '../../../hooks/useSandbox'
import { useSandboxView, SANDBOX_VIEW_MODES } from '../../../contexts/SandboxViewContext'

// Lazy-load SandBoxPage only when the dock expands to half mode. Until then
// the dock renders a static text-only preview — keeps Konva out of the
// NotePage bundle.
const SandBoxPage = lazy(() => import('../../../pages/Sandbox/SandBoxPage'))

/**
 * Floating dock on NotePage. Two modes:
 *   - PiP: small bottom-right thumbnail summarising the active sandbox.
 *           Click → expand to half. Static, no Konva.
 *   - HALF: mounts the real SandBoxPage as the right half (handled by NotePage's
 *           layout). The dock component itself only renders the PiP variant —
 *           half-mode rendering lives in NotePage's own CSS grid.
 */
function SandboxDock({ notes, tasks, toggleTaskCompletion }) {
    const view = useSandboxView()
    const { sandboxes } = useSandboxes()

    const activeId = view.activeSandboxId
        ?? (() => { try { return localStorage.getItem('cinder_last_sandbox') } catch { return null } })()
        ?? sandboxes[0]?.id
        ?? null

    const sandbox = useMemo(() => sandboxes.find(s => s.id === activeId), [sandboxes, activeId])
    const { items } = useSandbox(activeId)

    if (view.isHidden || view.isFull) return null

    if (view.isHalf) {
        return (
            <div className={styles.half}>
                <Suspense fallback={<div style={{padding: 18, color: 'var(--text-muted)', fontSize: 12}}>Opening sandbox…</div>}>
                    <SandBoxPage notes={notes} tasks={tasks} toggleTaskCompletion={toggleTaskCompletion} mode="half" sandboxIdOverride={activeId} />
                </Suspense>
            </div>
        )
    }

    // PiP mode
    const empty = !sandbox || items.length === 0

    return (
        <div
            className={styles.dock}
            onClick={() => view.setMode(SANDBOX_VIEW_MODES.HALF)}
            title="Click to open sandbox"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') view.setMode(SANDBOX_VIEW_MODES.HALF) }}
        >
            <div className={styles.dockHeader}>
                <span className={styles.dockTitle}>{sandbox?.title ?? 'No sandbox'}</span>
                <span className={styles.dockBadge}>PIP</span>
                <button
                    className={styles.closeBtn}
                    onClick={(e) => { e.stopPropagation(); view.close() }}
                    title="Hide dock"
                    aria-label="Hide dock"
                >×</button>
            </div>
            <div className={styles.preview}>
                {empty ? (
                    <div className={styles.previewEmpty}>
                        <span className={styles.gold}>✦</span>
                        {sandbox ? 'EMPTY BOARD' : 'NO SANDBOX YET'}
                        <small>{sandbox ? 'click to open' : 'create one first'}</small>
                    </div>
                ) : (
                    <div className={styles.previewEmpty}>
                        <span className={styles.gold}>✦</span>
                        {items.length} ITEMS
                        <small>click to open</small>
                    </div>
                )}
            </div>
        </div>
    )
}

export default SandboxDock
