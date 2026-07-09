import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { uploadImageFile, fileFromLocalPath } from '../../../utils/imageUpload'
import { deselectAllImages } from './widgets'
import { toast } from '../../../utils/toast'

// Image paste/drop upload + drag-resize for the CodeMirror editor. Reuses the
// app's R2 uploader (uploadImageFile). The document is markdown, so an upload
// inserts a unique placeholder token at the cursor, then swaps it for the real
// `![name](path)` once the upload resolves (or removes it on failure). Size is
// stored in the URL fragment `#w=NNN` (+ optional `#h=NNN`), ignored by the
// browser for src.

let uploadCounter = 0

// Strip markdown-breaking chars from a filename for use as alt text.
const safeName = (name) => (name || 'image').replace(/[[\]()\n\r]/g, '').trim() || 'image'

// Encode a Bag-relative path so it's a valid markdown URL — spaces and parens in
// a note-title folder (e.g. "another test", "SKILL (1)") would otherwise end the
// `](url)` early. Keep slashes; leave data:/http:/blob: URLs untouched.
const encodePathForMarkdown = (p) => {
  if (/^(data:|https?:|blob:)/.test(p)) return p
  return p.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')
}

// Replace the first occurrence of an exact placeholder token with `replacement`.
// Removal (empty) drops the placeholder's whole line + its newline so no blank
// line is left — but only when the token is alone on its line, so a failed upload
// can't swallow the newline separating it from the NEXT placeholder/line.
function replaceToken(view, token, replacement) {
  const doc = view.state.doc
  const idx = doc.toString().indexOf(token)
  if (idx < 0) return // user deleted it mid-upload — nothing to do
  let from = idx, to = idx + token.length
  if (replacement === '') {
    const line = doc.lineAt(idx)
    if (line.from === from && line.to === to) to = Math.min(to + 1, doc.length)
  }
  view.dispatch({ changes: { from, to, insert: replacement } })
}

// Run `worker` over items with at most `limit` in flight.
function runPool(items, limit, worker) {
  let i = 0
  const next = () => {
    if (i >= items.length) return Promise.resolve()
    const item = items[i++]
    return Promise.resolve(worker(item)).then(next)
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
}

function startUploads(view, images, getAuth) {
  const { authFetch, API } = getAuth() || {}
  if (!authFetch || !API) { toast.error('Not signed in — cannot upload image'); return }

  const jobs = images.map((file) => {
    const id = `up-${Date.now().toString(36)}-${++uploadCounter}`
    return { file, token: `![Uploading ${safeName(file.name)}…](uploading:${id})` }
  })

  // Insert all placeholders at the cursor as their own lines.
  const sel = view.state.selection.main
  const insert = jobs.map(j => j.token).join('\n') + '\n'
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
  })

  runPool(jobs, 3, async (job) => {
    try {
      const { path } = await uploadImageFile(authFetch, API, job.file)
      replaceToken(view, job.token, `![${safeName(job.file.name)}](${encodePathForMarkdown(path)})`)
    } catch (e) {
      replaceToken(view, job.token, '')
      toast.error(e?.message || 'Image upload failed')
    }
  })
}

// Extract image files from a DataTransfer (clipboard or drop). Deliberately
// lenient: a copied bitmap arrives in `.items` as an image/* item (this is what
// WebKitGTK uses); a dragged/copied file arrives in `.files`. We match on the
// MIME starting with "image/" (not an exact allow-list) and, for files with no
// type, fall back to the extension.
// WebKitGTK fallback: on paste it fires the event but exposes no image File
// synchronously (items/files empty) even when an image is on the clipboard. The
// async Clipboard API can still hand back the blob.
async function tryAsyncClipboardImage(view, getAuth) {
  try {
    if (!navigator.clipboard?.read) return
    const items = await navigator.clipboard.read()
    const files = []
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'))
      if (imgType) {
        const blob = await item.getType(imgType)
        files.push(new File([blob], `pasted.${imgType.split('/')[1] || 'png'}`, { type: imgType }))
      }
    }
    if (files.length) startUploads(view, files, getAuth)
  } catch { /* clipboard read unavailable/denied — nothing to paste */ }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i

const imageFilesFrom = (dt) => {
  if (!dt) return []
  const out = []
  for (const item of dt.items || []) {
    if (item && typeof item.type === 'string' && item.type.startsWith('image/')) {
      const f = item.getAsFile && item.getAsFile()
      if (f) out.push(f)
    }
  }
  if (!out.length) {
    for (const f of dt.files || []) {
      const okType = f && typeof f.type === 'string' && f.type.startsWith('image/')
      const okExt = f && f.name && IMG_EXT.test(f.name)
      if (okType || okExt) out.push(f)
    }
  }
  return out
}

// Dropping an OS file into a WebKitGTK webview exposes no File — only a
// `file://` URI (in text/uri-list, falling back to text/plain). Pull out the
// absolute paths of any images so we can read them off disk via Rust.
const imagePathsFrom = (dt) => {
  if (!dt) return []
  const raw = (dt.getData?.('text/uri-list') || '') + '\n' + (dt.getData?.('text/plain') || '')
  const out = []
  for (let line of raw.split(/[\r\n]+/)) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('file://')) {
      try { line = decodeURIComponent(line.replace(/^file:\/\/(localhost)?/, '')) } catch { /* keep raw */ }
    }
    if (line.startsWith('/') && IMG_EXT.test(line) && !out.includes(line)) out.push(line)
  }
  return out
}

// Read each dropped absolute path off disk (Rust) into a File, then upload/embed.
async function uploadDroppedPaths(view, paths, getAuth) {
  const files = (await Promise.all(paths.map((p) => fileFromLocalPath(p)))).filter(Boolean)
  if (files.length) startUploads(view, files, getAuth)
  else toast.error('Could not read the dropped image')
}

// Backspace/Delete while an image is selected → remove the image markdown (like
// deleting a character). Returns false when no image is selected so normal
// editing is untouched.
function deleteSelectedImage(view) {
  const wrap = view.dom.querySelector('.cm-img-wrap.cm-img-selected')
  if (!wrap) return false
  const pos = view.posAtDOM(wrap)
  let node = syntaxTree(view.state).resolve(pos, 1)
  while (node && node.name !== 'Image') node = node.parent
  if (!node) return false
  let from = node.from, to = node.to
  // If the image is alone on its line, take the trailing newline too.
  const line = view.state.doc.lineAt(from)
  if (line.from === from && line.to === to) to = Math.min(to + 1, view.state.doc.length)
  deselectAllImages(view.dom)
  view.dispatch({ changes: { from, to }, selection: { anchor: from } })
  return true
}

export function imageExtensions(getAuth) {
  const handlers = EditorView.domEventHandlers({
    paste: (event, view) => {
      const images = imageFilesFrom(event.clipboardData)
      if (images.length) {
        event.preventDefault()
        startUploads(view, images, getAuth)
        return true
      }
      // Copied an image FILE (not a bitmap): WebKitGTK puts a file:// path on the
      // clipboard, not bytes — read it off disk instead of pasting the URI text.
      const paths = imagePathsFrom(event.clipboardData)
      if (paths.length) {
        event.preventDefault()
        uploadDroppedPaths(view, paths, getAuth)
        return true
      }
      // No File exposed synchronously — try the async Clipboard API (WebKitGTK).
      tryAsyncClipboardImage(view, getAuth)
      return false
    },
    // Signal we accept a file drag so the browser fires the `drop` event.
    dragover: (event) => {
      const types = event.dataTransfer && Array.from(event.dataTransfer.types || [])
      if (types && (types.includes('Files') || types.includes('text/uri-list'))) {
        event.preventDefault()
        return true
      }
      return false
    },
    drop: (event, view) => {
      const images = imageFilesFrom(event.dataTransfer)
      // OS file drops in WebKitGTK carry no File, only a file:// path.
      const paths = images.length ? [] : imagePathsFrom(event.dataTransfer)
      if (!images.length && !paths.length) return false
      event.preventDefault()
      // Insert where the image was dropped, not at the old cursor.
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos != null) view.dispatch({ selection: { anchor: pos } })
      if (images.length) startUploads(view, images, getAuth)
      else uploadDroppedPaths(view, paths, getAuth)
      return true
    },
    // Click anywhere outside a rendered image → clear its selection box.
    mousedown: (event, view) => {
      if (!event.target?.closest?.('.cm-img-wrap')) deselectAllImages(view.dom)
      return false
    },
  })
  // Prec.highest so image-delete wins over the default Backspace/Delete bindings
  // when an image is selected; otherwise `run` returns false and they take over.
  const deleteKeys = Prec.highest(keymap.of([
    { key: 'Backspace', run: deleteSelectedImage },
    { key: 'Delete', run: deleteSelectedImage },
  ]))
  return [handlers, deleteKeys]
}
