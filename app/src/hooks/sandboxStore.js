import logger from '../utils/logger'
import { toast } from '../utils/toast'
import { uploadImageFile } from '../utils/imageUpload'
import {
    readList, writeList, readItems, removeItemsCache, newSandboxId, dataURLToBlob,
} from './sandboxCache'

// Module-level singleton for the board LIST (mirrors cinder_sandboxes). All
// useSandboxes() mounts subscribe to this one store, so create/rename/delete stay
// consistent across the hub, dock, and page. localStorage is the offline cache;
// the backend is the source of truth, reconciled on first authed load.

const MAX_RETRIES = 3
const BACKOFF = [1000, 2000, 4000] // ms — Render cold-start friendly
const MIGRATED_FLAG = 'cinder_sandbox_migrated_v1'
const BATCH_CHUNK = 200 // server caps a batch at 500; stay well under

let list = readList()
let hydrated = false // true once the first server load has completed (or failed)
const listeners = new Set()
let api = { authFetch: null, API: '', isAuthed: false }
let booted = false
const pendingCreates = new Set() // board ids whose POST hasn't succeeded yet

const nowISO = () => new Date().toISOString()

const sortByUpdated = (arr) => [...arr].sort((a, b) => {
    const ta = a.updatedAt || a.createdAt || ''
    const tb = b.updatedAt || b.createdAt || ''
    if (ta < tb) return 1
    if (ta > tb) return -1
    return 0
})

const setList = (next, { persist = true } = {}) => {
    list = next
    if (persist) writeList(list)
    listeners.forEach(cb => cb())
}

export const subscribe = (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
}

// Guest demo mode: wipe the singleton so a previous (real) session's cached
// boards can't leak in, and allow connect() to re-hydrate from the guest mock.
export const resetForGuest = () => {
    list = []
    hydrated = false
    booted = false
    pendingCreates.clear()
    listeners.forEach(cb => cb())
}
export const getSnapshot = () => list
// Whether the board list has been reconciled with the server at least once. Lets
// callers tell "no boards yet, still loading" from "this user genuinely has none".
export const getHydrated = () => hydrated

async function request(path, options) {
    if (!api.authFetch) throw new Error('sandbox API not connected')
    return api.authFetch(`${api.API}${path}`, options)
}

// ---- server reconciliation ----
async function hydrate() {
    try {
        const res = await request('/sandboxes', { method: 'GET' })
        if (!res.ok) throw new Error(`GET /sandboxes ${res.status}`)
        const data = await res.json()
        const serverRows = (data.sandboxes || []).map(r => ({
            id: r.id,
            title: r.title,
            item_count: r.item_count,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        }))
        const serverIds = new Set(serverRows.map(r => r.id))
        // Keep any local-only boards that haven't been pushed up yet.
        const localOnly = list.filter(s => !serverIds.has(s.id))
        setList(sortByUpdated([...serverRows, ...localOnly]))
    } catch (err) {
        logger.error('sandboxStore — hydrate failed', err)
        // cache already on screen; stay offline-friendly
    } finally {
        if (!hydrated) { hydrated = true; listeners.forEach(cb => cb()) }
    }
}

export const connect = (next) => {
    api = { authFetch: next.authFetch, API: next.API, isAuthed: !!next.isAuthed }
    if (api.isAuthed && !booted) {
        booted = true
        hydrate()
            .then(() => migrateOnce())
            .catch(err => logger.error('sandboxStore — boot failed', err))
    }
}

// ---- mutations (optimistic) ----
export const create = (title = 'Untitled Sandbox') => {
    const now = nowISO()
    const sandbox = {
        id: newSandboxId(),
        title: (title || '').trim() || 'Untitled Sandbox',
        item_count: 0,
        createdAt: now,
        updatedAt: now,
    }
    setList([sandbox, ...list])
    pushCreate(sandbox)
    return sandbox
}

async function pushCreate(sandbox, attempt = 0) {
    if (!api.isAuthed) return
    pendingCreates.add(sandbox.id)
    try {
        const res = await request('/sandboxes', {
            method: 'POST',
            body: JSON.stringify({ id: sandbox.id, title: sandbox.title }),
        })
        if (!res.ok) throw new Error(`POST /sandboxes ${res.status}`)
        pendingCreates.delete(sandbox.id)
    } catch (err) {
        logger.error('sandboxStore — create sync failed', err)
        if (attempt < MAX_RETRIES - 1) {
            setTimeout(() => pushCreate(sandbox, attempt + 1), BACKOFF[attempt])
        }
    }
}

// Ensure a board exists server-side. Used when an items flush 404s because the board's create
// never landed (e.g. it was created while offline/unauthed, or its 3 create retries were
// exhausted). POST /sandboxes is idempotent (returns the existing row), so this is safe to call
// repeatedly. Returns true if the board is present on the server afterwards.
export const ensureCreated = async (id) => {
    if (!api.isAuthed) return false
    const board = list.find(s => s.id === id)
    if (!board) return false
    try {
        const res = await request('/sandboxes', {
            method: 'POST',
            body: JSON.stringify({ id: board.id, title: board.title || 'Untitled Sandbox' }),
        })
        if (res.ok) { pendingCreates.delete(id); return true }
        return false
    } catch (err) {
        logger.error('sandboxStore — ensureCreated failed', err)
        return false
    }
}

export const rename = (id, title) => {
    const trimmed = (title || '').trim()
    setList(list.map(s => s.id === id
        ? { ...s, title: trimmed || s.title, updatedAt: nowISO() }
        : s))
    pushRename(id, trimmed)
}

async function pushRename(id, title) {
    if (!api.isAuthed) return
    try {
        const res = await request(`/sandboxes/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ title }),
        })
        if (!res.ok) throw new Error(`PUT /sandboxes/${id} ${res.status}`)
    } catch (err) {
        logger.error('sandboxStore — rename save failed', err)
    }
}

export const remove = (id) => {
    const prev = list
    setList(list.filter(s => s.id !== id))
    removeItemsCache(id)
    pushDelete(id, prev)
}

async function pushDelete(id, prevList) {
    if (!api.isAuthed) return
    try {
        const res = await request(`/sandboxes/${id}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 404) throw new Error(`DELETE /sandboxes/${id} ${res.status}`)
    } catch (err) {
        logger.error('sandboxStore — delete save failed', err)
        setList(prevList) // roll back the optimistic removal
    }
}

// Bump updatedAt locally only. Called on every canvas edit (bump()); the server
// already refreshes updated_at inside the items batch transaction, so this must
// never hit the network.
export const touch = (id) => {
    setList(list.map(s => s.id === id ? { ...s, updatedAt: nowISO() } : s))
}

// Called by sandboxItemsStore after a successful batch flush.
export const applyServerCount = (id, item_count, updatedAt) => {
    setList(list.map(s => s.id === id
        ? { ...s, item_count, updatedAt: updatedAt || s.updatedAt }
        : s))
}

// ---- one-time localStorage -> backend migration ----
async function postBatchChunked(id, upserts) {
    for (let i = 0; i < upserts.length; i += BATCH_CHUNK) {
        const res = await request(`/sandboxes/${id}/items/batch`, {
            method: 'POST',
            body: JSON.stringify({ upserts: upserts.slice(i, i + BATCH_CHUNK), deletes: [] }),
        })
        if (!res.ok) throw new Error(`migrate batch ${res.status}`)
    }
}

async function migrateOnce() {
    try {
        if (localStorage.getItem(MIGRATED_FLAG)) return
        if (!api.isAuthed) return

        const serverIds = new Set(list.map(s => s.id))
        const localBoards = readList()
        const toPush = localBoards.filter(b => !serverIds.has(b.id))
        let imgFailures = 0

        for (const b of toPush) {
            try {
                const res = await request('/sandboxes', {
                    method: 'POST',
                    body: JSON.stringify({ id: b.id, title: b.title || 'Untitled Sandbox' }),
                })
                if (!res.ok) throw new Error(`migrate create ${res.status}`)

                const items = readItems(b.id)
                const upserts = []
                for (const it of items) {
                    if (it.type === 'image' && typeof it.payload?.src === 'string' && it.payload.src.startsWith('data:')) {
                        try {
                            const blob = dataURLToBlob(it.payload.src)
                            const { path } = await uploadImageFile(api.authFetch, api.API, blob)
                            upserts.push({ ...it, payload: { url: path, naturalW: it.payload.naturalW, naturalH: it.payload.naturalH } })
                        } catch (err) {
                            imgFailures++
                            logger.error('sandboxStore — migrate image failed', err)
                            // skip — never ship base64 to the server
                        }
                    } else {
                        upserts.push(it)
                    }
                }
                if (upserts.length) await postBatchChunked(b.id, upserts)
            } catch (err) {
                logger.error('sandboxStore — migrate board failed', err)
            }
        }

        localStorage.setItem(MIGRATED_FLAG, '1')
        if (imgFailures) toast.error(`Migrated sandboxes; ${imgFailures} image(s) could not be uploaded.`)
        await hydrate() // refresh counts now that boards/items exist server-side
    } catch (err) {
        logger.error('sandboxStore — migrate failed', err)
    }
}

// Retry any boards whose create never landed (offline create) once we're back online.
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        if (!api.isAuthed) return
        for (const s of list) {
            if (pendingCreates.has(s.id)) pushCreate(s)
        }
    })

    // Cross-tab: when another tab changes the board list (create/rename/delete), pick up
    // its write. persist:false avoids a storage-event ping-pong between tabs.
    window.addEventListener('storage', (e) => {
        if (e.key === 'cinder_sandboxes') setList(readList(), { persist: false })
    })
}
