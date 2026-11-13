import { useNavigate } from 'react-router-dom'
import { revealPath } from '../../../../../desktop/reveal'
import { getBagPath } from '../../../../../desktop/localStore'

/** What an attachment is: a note in the Bag, an image, a PDF or another file. */
const IMG = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i
export const kindOf = (a) => (a?.note != null ? 'note' : IMG.test(a?.path || '') ? 'image' : /\.pdf$/i.test(a?.path || '') ? 'pdf' : 'file')
export const attKey = (a) => (a?.note != null ? `n:${a.note}` : `f:${a?.path}`)

/**
 * Open an attachment: a note in the notes page, an image or PDF in the
 * preview (`setPreview` — the caller renders AttachmentPreview), anything
 * else in the file manager.
 */
export function useOpenAttachment(setPreview) {
    const navigate = useNavigate()
    return (att) => {
        const k = kindOf(att)
        if (k === 'note') navigate(`/notes/${att.note}`)
        else if (k === 'image' || k === 'pdf') setPreview(att)
        else revealPath(`${getBagPath()}/${att.path}`)
    }
}
