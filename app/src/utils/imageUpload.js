import { isGuestActive } from '../guest/guestState'

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
    if (path.startsWith('/')) {
        return `${R2_PUBLIC_URL}${path}`
    }
    return path
}

export const validateImageFile = (file) => {
    if (!file) throw new Error('No file provided')
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
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

    // Guest demo mode: never touch the network or R2. Inline the image as a data
    // URL so it renders for the session and disappears on refresh. resolveImageUrl
    // already passes `data:` URLs straight through.
    if (isGuestActive()) {
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
