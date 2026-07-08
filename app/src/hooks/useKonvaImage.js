import { useEffect, useState } from 'react'

/**
 * Loads a base64 / URL src into an HTMLImageElement for Konva's <Image>.
 * Tiny local replacement for the `use-image` dep — no extra bundle weight.
 */
export function useKonvaImage(src) {
    const [image, setImage] = useState(null)
    useEffect(() => {
        if (!src) { setImage(null); return }
        let alive = true
        const isRemote = /^https?:\/\//i.test(src)
        const load = (withCors) => {
            const img = new window.Image()
            // CORS so Konva's stage.toDataURL export doesn't taint on cross-origin
            // (R2) images. data:/blob: are same-origin and need no flag.
            if (withCors && isRemote) img.crossOrigin = 'anonymous'
            img.onload = () => { if (alive) setImage(img) }
            // If the CORS load fails (e.g. bucket missing ACAO headers), fall back to
            // a plain load so the image still displays — export of that board may taint.
            img.onerror = () => { if (alive && withCors && isRemote) load(false) }
            img.src = src
        }
        load(true)
        return () => { alive = false }
    }, [src])
    return image
}
