// PNG encoding for the board export, off the main thread: encoding a few
// thousand pixels square is the slow part of an export, and done on the page it
// froze the board (no panning) until it finished. Receives an ImageBitmap,
// answers with a PNG Blob, or { error }.
self.onmessage = async (e) => {
    try {
        const bitmap = e.data.bitmap
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        canvas.getContext('2d').drawImage(bitmap, 0, 0)
        bitmap.close?.()
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        self.postMessage({ blob })
    } catch (err) {
        self.postMessage({ error: String(err?.message || err) })
    }
}
