import { isOpen as isLocalOpen, getBagPath, saveAttachment } from '../desktop/localStore'
import { isTauri } from '../desktop/bag'

// Keep ALLOWED_IMAGE_MIME / MAX_IMAGE_BYTES in sync with backend routes/uploads.js.
export const ALLOWED_IMAGE_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
])
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || ''

export const resolveImageUrl = (path) => {
    if (!path) return ''
    if (typeof path !== 'string') return ''
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
        return path
    }
    // Desktop Bag attachment (relative path like "attachments/Note/img.png"):
    // resolve to an asset URL the webview can load from the Bag folder on disk.
    const bag = getBagPath && getBagPath()
    if (bag && !path.startsWith('/')) {
        // The markdown link is URL-encoded (spaces/parens in note-title folders);
        // decode back to the real on-disk path before handing it to convertFileSrc.
        let rel = path
        try { rel = path.split('/').map(decodeURIComponent).join('/') } catch { /* keep raw */ }
        const abs = `${bag}/${rel}`
        const convert = typeof window !== 'undefined' && window.__TAURI__?.core?.convertFileSrc
        return convert ? convert(abs) : abs
    }
    if (path.startsWith('/')) {
        return `${R2_PUBLIC_URL}${path}`
    }
    return path
}

const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf',
    html: 'text/html', htm: 'text/html',
}

// Read a file at an absolute on-disk path (via the Rust `bag_read_bytes` command,
// base64) into a File. Used for OS drag-and-drop of images, where WebKitGTK hands
// the webview only a file:// path, not the bytes. Returns null off the desktop
// shell or on failure.
export const fileFromLocalPath = async (absPath) => {
    const inv = typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)
    if (!inv || !absPath) return null
    try {
        const b64 = await inv('bag_read_bytes', { path: absPath })
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const name = absPath.split('/').pop() || 'image'
        const ext = (name.split('.').pop() || '').toLowerCase()
        return new File([bytes], name, { type: MIME_BY_EXT[ext] || 'application/octet-stream' })
    } catch {
        return null
    }
}

export const validateImageFile = (file) => {
    if (!file) throw new Error('No file provided')
    // Lenient: accept any image/* MIME (WebKitGTK may report odd types) or an
    // image file extension.
    const isImage = (typeof file.type === 'string' && file.type.startsWith('image/'))
        || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || '')
    if (!isImage) {
        throw new Error('Unsupported image type (use PNG, JPEG, GIF, or WEBP)')
    }
    if (file.size > MAX_IMAGE_BYTES) {
        throw new Error('Image too large (max 5 MB)')
    }
}

const messageForStatus = (status) => {
    switch (status) {
        case 401: return 'Session expired, please log in again'
        case 400: return 'Unsupported image type'
        case 413: return 'Image too large (max 5 MB)'
        default: return 'Upload failed, try again'
    }
}

const fileToDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
})

export const uploadImageFile = async (authFetch, API, file) => {
    validateImageFile(file)

    // Desktop (Bag open): save into the active note's attachments folder on disk
    // and embed a Bag-relative path. In a plain browser (dev, no Tauri) there's no
    // disk, so fall back to an inline data URL.
    if (isLocalOpen()) {
        if (isTauri()) {
            const rel = await saveAttachment(file)
            if (rel) return { path: rel }
        }
        const dataUrl = await fileToDataURL(file)
        return { path: dataUrl }
    }

    const presignRes = await authFetch(`${API}/uploads/presign`, {
        method: 'POST',
        body: JSON.stringify({ mimeType: file.type, size: file.size }),
    })
    if (!presignRes.ok) throw new Error(messageForStatus(presignRes.status))

    const { uploadUrl, path } = await presignRes.json()
    if (!uploadUrl || !path) throw new Error('Malformed presign response')

    const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': file.type,
            'Content-Length': String(file.size),
            'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: file,
    })
    if (!putRes.ok) throw new Error('Upload failed, try again')

    return { path }
}
