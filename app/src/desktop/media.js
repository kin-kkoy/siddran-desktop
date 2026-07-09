import { fileFromLocalPath, uploadImageFile } from '../utils/imageUpload'
import { saveAttachment, isOpen as isLocalOpen } from './localStore'
import { isTauri } from './bag'
import { toast } from '../utils/toast'

// Native file picker (single file) with the given filters; returns absolute path.
async function pickFile(title, filters) {
  const inv = typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)
  if (!inv) return null
  const res = await inv('plugin:dialog|open', { options: { multiple: false, title, filters } })
  return typeof res === 'string' ? res : (Array.isArray(res) && res.length ? res[0] : null)
}

// Encode a Bag-relative path for a markdown link (spaces/parens in note-title
// folders would otherwise break the `](…)`).
const encodeMd = (p) =>
  p.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')

// Pick a PDF and copy it into the active note's Bag attachments. → { path, name } | null.
export async function attachPdfViaPicker() {
  if (!isLocalOpen() || !isTauri()) { toast.error('Open a Bag first'); return null }
  const abs = await pickFile('Attach a PDF', [{ name: 'PDF', extensions: ['pdf'] }])
  if (!abs) return null
  if (!/\.pdf$/i.test(abs)) { toast.error('Only PDF files can be attached'); return null }
  const file = await fileFromLocalPath(abs)
  if (!file) { toast.error('Could not read the PDF'); return null }
  const rel = await saveAttachment(file)
  if (!rel) { toast.error('Could not save the PDF'); return null }
  return { path: rel, name: abs.split('/').pop() || 'document.pdf' }
}

// Pick an image and copy it into the Bag → { markdown, name } to insert, or null.
export async function attachImageViaPicker() {
  if (!isLocalOpen() || !isTauri()) { toast.error('Open a Bag first'); return null }
  const abs = await pickFile('Attach an image', [
    { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] },
  ])
  if (!abs) return null
  const file = await fileFromLocalPath(abs)
  if (!file) { toast.error('Could not read the image'); return null }
  try {
    const { path } = await uploadImageFile(null, null, file)
    const name = abs.split('/').pop() || 'image'
    return { name, markdown: `![${name.replace(/[[\]()\n\r]/g, '')}](${encodeMd(path)})` }
  } catch (e) {
    toast.error(e?.message || 'Could not attach image')
    return null
  }
}
