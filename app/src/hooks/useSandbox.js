import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useApi } from '../contexts/ApiContext'
import * as itemsStore from './sandboxItemsStore'

/**
 * Per-board items, cloud-backed. Items live in `cinder_sandbox_<id>` as an offline
 * cache while the backend is the source of truth. Mutations are optimistic and
 * synchronous; changes are coalesced into one debounced batch request (never one
 * per stroke). All the logic lives in the sandboxItemsStore singleton so the page,
 * dock, and any other mount of this hook share one state + flush queue.
 *
 * Public API is unchanged from the localStorage-only version.
 */
export function useSandbox(sandboxId) {
    const { authFetch, API, isAuthed } = useApi()

    useEffect(() => {
        itemsStore.connect({ authFetch, API, isAuthed })
    }, [authFetch, API, isAuthed])

    const subscribe = useCallback((cb) => itemsStore.subscribe(sandboxId, cb), [sandboxId])
    const getSnapshot = useCallback(() => itemsStore.getSnapshot(sandboxId), [sandboxId])
    const items = useSyncExternalStore(subscribe, getSnapshot)

    // Seed from cache instantly, reconcile with the server when authed, and flush
    // pending edits on route change / unmount.
    useEffect(() => {
        if (!sandboxId) return undefined
        itemsStore.ensure(sandboxId)
        if (isAuthed) itemsStore.loadFromServer(sandboxId)
        return () => { itemsStore.flushNow(sandboxId) }
    }, [sandboxId, isAuthed])

    const addItem = useCallback((item) => itemsStore.addItem(sandboxId, item), [sandboxId])
    const updateItem = useCallback((id, patch) => itemsStore.updateItem(sandboxId, id, patch), [sandboxId])
    const removeItem = useCallback((id) => itemsStore.removeItem(sandboxId, id), [sandboxId])
    const getItemById = useCallback((id) => itemsStore.getItemById(sandboxId, id), [sandboxId])

    // Live mirror for the return contract (undo/redo reads through getItemById, not
    // this ref, but it's part of the public shape so keep it current).
    const itemsRef = useRef(items)
    itemsRef.current = items

    return { items, addItem, updateItem, removeItem, getItemById, itemsRef }
}

export { newItemId as newSandboxItemId, getSandboxSummary } from './sandboxCache'
