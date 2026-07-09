import logger from '../utils/logger'

// localStorage cache layer for sandboxes. No React here — both sandboxStore and
// sandboxItemsStore read/write through these helpers so the cache stays the single
// source of offline truth. Keys are unchanged from the old hooks so existing local
// data is picked up as-is.

const LIST_KEY = 'cinder_sandboxes'
const ITEM_PREFIX = 'cinder_sandbox_'
const SIZE_WARN_THRESHOLD = 3 * 1024 * 1024 // 3MB — warn before localStorage's ~5MB cap

const itemKey = (id) => `${ITEM_PREFIX}${id}`
const quotaWarned = new Set() // board ids we've already toasted (avoid spamming on every write)

const uuidish = (prefix) => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)

export const newItemId = () => uuidish('it')
export const newSandboxId = () => uuidish('sb')

// ---- board list (cinder_sandboxes) ----
export const readList = () => {
    try {
        const raw = localStorage.getItem(LIST_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch (err) {
        logger.error('sandboxCache — failed to read list', err)
        return []
    }
}

export const writeList = (arr) => {
    try {
        localStorage.setItem(LIST_KEY, JSON.stringify(arr))
    } catch (err) {
        logger.error('sandboxCache — failed to write list', err)
    }
}

// ---- per-board items (cinder_sandbox_<id>) ----
export const readItems = (id) => {
    if (!id) return []
    try {
        const raw = localStorage.getItem(itemKey(id))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed?.items) ? parsed.items : []
    } catch (err) {
        logger.error('sandboxCache — failed to read items', err)
        return []
    }
}

export const writeItems = (id, items) => {
    if (!id) return
    try {
        const serialized = JSON.stringify({ items })
        if (serialized.length > SIZE_WARN_THRESHOLD) {
            logger.warn(`sandboxCache — payload ${(serialized.length / 1024 / 1024).toFixed(1)}MB near localStorage cap`)
        }
        localStorage.setItem(itemKey(id), serialized)
        quotaWarned.delete(id) // write succeeded — re-arm the warning if it fills up again
    } catch (err) {
        logger.error('sandboxCache — failed to write items', err)
    }
}

export const removeItemsCache = (id) => {
    try { localStorage.removeItem(itemKey(id)) } catch (err) {
        logger.error('sandboxCache — failed to remove items', err)
    }
}

// Collapse canvas item types into the four colour buckets the hub mosaic uses.
const TYPE_BUCKET = {
    stroke: 'draw', shape: 'draw', image: 'draw',
    note: 'note',
    task: 'task',
    text: 'text', connector: 'text',
}

// Lightweight per-sandbox summary read straight from cache, so the hub cards can
// render a density mosaic without mounting the full item store. `buckets` is one
// entry per item, in stored order.
export const getSandboxSummary = (sandboxId) => {
    if (!sandboxId) return { count: 0, buckets: [] }
    const items = readItems(sandboxId)
    return {
        count: items.length,
        buckets: items.map(it => TYPE_BUCKET[it?.type] || 'text'),
    }
}

// Convert a base64 data URL (legacy localStorage image payload) to a Blob so it can
// be uploaded to R2 during migration.
export const dataURLToBlob = (dataURL) => {
    const [meta, b64] = dataURL.split(',')
    const mimeMatch = /data:([^;]+);base64/.exec(meta || '')
    const mime = mimeMatch ? mimeMatch[1] : 'image/png'
    const binary = atob(b64 || '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
}
