import logger from '../utils/logger'
import { toast } from '../utils/toast'
import { readItems, writeItems, newItemId } from './sandboxCache'
import { applyServerCount, ensureCreated } from './sandboxStore'

// Module-level singleton for per-board ITEMS (mirrors cinder_sandbox_<id>). Tracks
// dirty + deleted ids since the last flush and sends them as ONE debounced batch —
// never one request per stroke. localStorage is the offline cache; the backend is
// the source of truth.

const CACHE_DEBOUNCE = 300   // ms — durable local write
const NET_DEBOUNCE = 6000    // ms — flush ~6s after the user pauses (coalesce a drawing burst)
const MAX_WAIT = 25000       // ms — but never hold pending edits longer than this, even during
                            //      continuous drawing (bounds data-at-risk between flushes)
const BACKOFF = [1000, 2000, 4000]
const MAX_FLUSH_RETRIES = 6  // stop retrying a persistently-failing flush so it can't hammer the backend forever
const BATCH_CHUNK = 200      // server caps a batch at 500
const MAX_CHUNK_BYTES = 800 * 1024 // keep each request well under the server's 5mb body limit
const EMPTY = []

let api = { authFetch: null, API: '', isAuthed: false }
const boards = new Map() // id -> record

export const connect = (next) => {
    api = { authFetch: next.authFetch, API: next.API, isAuthed: !!next.isAuthed }
}

// Guest demo mode: drop all per-board records (and their pending timers) so a
// previous session's cached items can't surface, and each board reloads fresh
// from the guest mock on next ensure()/loadFromServer().
export const resetForGuest = () => {
    for (const rec of boards.values()) {
        if (rec.cacheTimer) clearTimeout(rec.cacheTimer)
        if (rec.netTimer) clearTimeout(rec.netTimer)
    }
    boards.clear()
}

export const ensure = (id) => {
    if (!id) return null
    let rec = boards.get(id)
    if (!rec) {
        rec = {
            items: readItems(id),
            dirty: new Set(),
            deleted: new Set(),
            cacheTimer: null,
            netTimer: null,
            pendingSince: null, // when the oldest un-flushed edit was made (for MAX_WAIT cap)
            inFlight: false,
            failures: 0,
            listeners: new Set(),
            loaded: false,
        }
        boards.set(id, rec)
    }
    return rec
}

export const subscribe = (id, cb) => {
    const rec = ensure(id)
    if (!rec) return () => {}
    rec.listeners.add(cb)
    return () => rec.listeners.delete(cb)
}

export const getSnapshot = (id) => {
    if (!id) return EMPTY
    const rec = ensure(id)
    return rec ? rec.items : EMPTY
}

const notify = (rec) => rec.listeners.forEach(cb => cb())

const scheduleCacheWrite = (id) => {
    const rec = boards.get(id)
    if (!rec) return
    if (rec.cacheTimer) clearTimeout(rec.cacheTimer)
    rec.cacheTimer = setTimeout(() => { writeItems(id, rec.items); rec.cacheTimer = null }, CACHE_DEBOUNCE)
}

const emit = (id) => {
    const rec = boards.get(id)
    if (!rec) return
    notify(rec)
    scheduleCacheWrite(id)
}

async function request(path, options) {
    if (!api.authFetch) throw new Error('sandbox API not connected')
    return api.authFetch(`${api.API}${path}`, options)
}

// ---- server load ----
export const loadFromServer = async (id) => {
    const rec = ensure(id)
    if (!rec || !api.isAuthed) return
    // De-dupe concurrent loads of the same board — e.g. the NotePage dock and the inner page both
    // mount and call this. Share one in-flight GET instead of firing two identical requests.
    if (rec.loadPromise) return rec.loadPromise
    rec.loadPromise = (async () => {
        try {
            const res = await request(`/sandboxes/${id}`, { method: 'GET' })
            if (res.status === 404) {
                // Local-only board (its create never landed). Treat like an empty server: mark ALL
                // local items dirty so the whole board syncs once ensureCreated() makes it —
                // otherwise only later edits sync and the next GET-200 "replace local with server"
                // wipes the rest.
                if (rec.items.length > 0) {
                    for (const it of rec.items) rec.dirty.add(it.id)
                    scheduleFlush(id)
                }
                rec.loaded = true
                return
            }
            if (!res.ok) throw new Error(`GET /sandboxes/${id} ${res.status}`)
            const data = await res.json()
            const serverItems = data.items || []
            // Server has nothing but we hold local items (e.g. a board whose items never
            // finished syncing) — push the local copy up instead of wiping it.
            if (serverItems.length === 0 && rec.items.length > 0) {
                for (const it of rec.items) rec.dirty.add(it.id)
                rec.loaded = true
                scheduleFlush(id)
                return
            }
            if (rec.dirty.size === 0 && rec.deleted.size === 0) {
                rec.items = serverItems
            } else {
                // Merge: server base, drop local deletes, re-apply local dirty so an
                // offline edit isn't clobbered by a stale GET.
                const byId = new Map(serverItems.map(it => [it.id, it]))
                for (const did of rec.deleted) byId.delete(did)
                for (const it of rec.items) if (rec.dirty.has(it.id)) byId.set(it.id, it)
                rec.items = [...byId.values()]
            }
            rec.loaded = true
            emit(id)
        } catch (err) {
            logger.error('sandboxItemsStore — load failed', err)
        } finally {
            rec.loadPromise = null
        }
    })()
    return rec.loadPromise
}

// ---- mutations (optimistic, synchronous) ----
export const addItem = (id, item) => {
    const rec = ensure(id)
    if (!rec) return item
    const withId = { ...item, id: item.id ?? newItemId() }
    rec.items = [...rec.items, withId]
    rec.dirty.add(withId.id)
    rec.deleted.delete(withId.id)
    emit(id)
    scheduleFlush(id)
    return withId
}

export const updateItem = (id, itemId, patch) => {
    const rec = ensure(id)
    if (!rec) return
    rec.items = rec.items.map(it => it.id === itemId ? { ...it, ...patch } : it)
    rec.dirty.add(itemId)
    emit(id)
    scheduleFlush(id)
}

export const removeItem = (id, itemId) => {
    const rec = ensure(id)
    if (!rec) return
    rec.items = rec.items.filter(it => it.id !== itemId)
    rec.dirty.delete(itemId)
    rec.deleted.add(itemId)
    emit(id)
    scheduleFlush(id)
}

export const getItemById = (id, itemId) => {
    const rec = boards.get(id)
    return rec ? rec.items.find(it => it.id === itemId) : undefined
}

// ---- batch delta-sync ----
const scheduleFlush = (id) => {
    const rec = boards.get(id)
    if (!rec) return
    if (rec.pendingSince == null) rec.pendingSince = Date.now()
    // Debounce by NET_DEBOUNCE, but cap total wait at MAX_WAIT so continuous drawing
    // (which keeps resetting the debounce) still saves periodically.
    const remaining = MAX_WAIT - (Date.now() - rec.pendingSince)
    const delay = Math.max(0, Math.min(NET_DEBOUNCE, remaining))
    if (rec.netTimer) clearTimeout(rec.netTimer)
    rec.netTimer = setTimeout(() => { rec.netTimer = null; flush(id) }, delay)
}

// Only ship image items backed by a real R2 URL. Blob previews, failed uploads, and
// legacy base64 (`payload.src`, no `url`) are never sent — the DB stores R2 URLs only.
const shippable = (it) => {
    if (it.type !== 'image') return true
    const url = it.payload?.url
    return typeof url === 'string' && !url.startsWith('blob:') && !url.startsWith('data:')
}

const sanitizeItem = (it) => ({
    id: it.id,
    type: it.type,
    x: it.x,
    y: it.y,
    w: it.w,
    h: it.h,
    rotation: it.rotation ?? 0,
    z_index: it.z_index ?? 0,
    payload: it.payload ?? {},
})

async function postBatchChunked(id, upserts, deletes) {
    let last = null
    const bodies = []
    // Chunk upserts by BOTH count and approximate byte size so one request never
    // exceeds the server body limit (e.g. a board full of dense strokes).
    let chunk = []
    let bytes = 0
    for (const it of upserts) {
        const size = JSON.stringify(it).length
        if (chunk.length >= BATCH_CHUNK || (chunk.length > 0 && bytes + size > MAX_CHUNK_BYTES)) {
            bodies.push({ upserts: chunk, deletes: [] })
            chunk = []
            bytes = 0
        }
        chunk.push(it)
        bytes += size
    }
    if (chunk.length) bodies.push({ upserts: chunk, deletes: [] })
    for (let i = 0; i < deletes.length; i += BATCH_CHUNK) {
        bodies.push({ upserts: [], deletes: deletes.slice(i, i + BATCH_CHUNK) })
    }
    for (const body of bodies) {
        const res = await request(`/sandboxes/${id}/items/batch`, {
            method: 'POST',
            body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`batch ${res.status}`)
        last = await res.json()
    }
    return last
}

async function flush(id) {
    const rec = boards.get(id)
    if (!rec) return
    if (rec.inFlight) return
    if (rec.dirty.size === 0 && rec.deleted.size === 0) return
    if (!api.isAuthed) return

    // Snapshot then clear: edits arriving during the request accumulate in fresh sets,
    // re-arming pendingSince via scheduleFlush.
    const dirtyIds = new Set(rec.dirty)
    const deleteIds = new Set(rec.deleted)
    rec.dirty = new Set()
    rec.deleted = new Set()
    rec.pendingSince = null

    const upserts = [...dirtyIds]
        .map(i => rec.items.find(it => it.id === i))
        .filter(Boolean)
        .filter(shippable)
        .map(sanitizeItem)
    const deletes = [...deleteIds]

    if (upserts.length === 0 && deletes.length === 0) return

    rec.inFlight = true
    try {
        const last = await postBatchChunked(id, upserts, deletes)
        if (last) applyServerCount(id, last.item_count, last.updated_at)
        rec.failures = 0
        rec.inFlight = false
        if (rec.dirty.size || rec.deleted.size) scheduleFlush(id)
    } catch (err) {
        logger.error('sandboxItemsStore — flush failed', err)
        // Re-queue the snapshot WITHOUT clobbering ids changed during the flight.
        for (const i of dirtyIds) if (!rec.deleted.has(i)) rec.dirty.add(i)
        for (const i of deleteIds) if (!rec.dirty.has(i)) rec.deleted.add(i)
        if (rec.failures === 0) toast.error('Sandbox changes saved locally — will retry.')
        rec.failures += 1
        rec.inFlight = false

        // A 404 means the board doesn't exist server-side (its create never landed). Create it
        // (idempotent) and retry once — never loop forever POSTing items to a missing board.
        if (String(err?.message).includes('404')) {
            if (rec.failures <= MAX_FLUSH_RETRIES) {
                const created = await ensureCreated(id)
                if (created) { rec.failures = 0; scheduleFlush(id) }
            }
            return
        }

        // Cap retries so a persistently-failing flush stops hammering the backend; queued edits
        // stay in localStorage and flush again on the next edit or an 'online' event.
        if (rec.failures >= MAX_FLUSH_RETRIES) return
        const delay = BACKOFF[Math.min(rec.failures - 1, BACKOFF.length - 1)]
        if (rec.netTimer) clearTimeout(rec.netTimer)
        rec.netTimer = setTimeout(() => { rec.netTimer = null; flush(id) }, delay)
    }
}

// Flush on route change / unmount: persist the cache synchronously, then fire the
// network flush (it lives on this singleton, so it survives the component unmount).
export const flushNow = (id) => {
    const rec = boards.get(id)
    if (!rec) return
    if (rec.cacheTimer) { clearTimeout(rec.cacheTimer); rec.cacheTimer = null }
    writeItems(id, rec.items)
    if (rec.netTimer) { clearTimeout(rec.netTimer); rec.netTimer = null }
    flush(id)
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        for (const [id, rec] of boards) {
            if (rec.dirty.size || rec.deleted.size) flush(id)
        }
    })
    const persistAll = () => { for (const id of boards.keys()) flushNow(id) }
    window.addEventListener('pagehide', persistAll)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistAll()
    })
}
