import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useApi } from '../contexts/ApiContext'
import * as store from './sandboxStore'

/**
 * Board list, cloud-backed. Mirrors `cinder_sandboxes` as an offline cache while the
 * backend is the source of truth. All logic lives in the sandboxStore singleton so
 * every mount (hub, dock, page) shares one consistent list. On first authed load it
 * hydrates from the server and runs a one-time localStorage -> backend migration.
 *
 * Public API is unchanged from the localStorage-only version: `create` still returns
 * the new board synchronously so callers can navigate to it immediately.
 */
export function useSandboxes() {
    const { authFetch, API, isAuthed } = useApi()

    useEffect(() => {
        store.connect({ authFetch, API, isAuthed })
    }, [authFetch, API, isAuthed])

    const sandboxes = useSyncExternalStore(store.subscribe, store.getSnapshot)
    const sandboxesLoaded = useSyncExternalStore(store.subscribe, store.getHydrated)

    const create = useCallback((title) => store.create(title), [])
    const rename = useCallback((id, title) => store.rename(id, title), [])
    const remove = useCallback((id) => store.remove(id), [])
    const touch = useCallback((id) => store.touch(id), [])

    return { sandboxes, sandboxesLoaded, create, rename, remove, touch }
}

export const STORAGE_KEY_SANDBOXES = 'cinder_sandboxes'
