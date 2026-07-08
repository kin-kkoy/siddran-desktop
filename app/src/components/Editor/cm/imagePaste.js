import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { ALLOWED_IMAGE_MIME, uploadImageFile } from '../../../utils/imageUpload'
import { toast } from '../../../utils/toast'

// Image paste/drop upload + drag-resize for the CodeMirror editor. Reuses the
// app's R2 uploader (uploadImageFile). The document is markdown, so an upload
// inserts a unique placeholder token at the cursor, then swaps it for the real
// `![name](path)` once the upload resolves (or removes it on failure). Width is
// stored in the URL fragment `#w=NNN` (ignored by the browser for src).

let uploadCounter = 0

// Strip markdown-breaking chars from a filename for use as alt text.
const safeName = (name) => (name || 'image').replace(/[[\]()\n\r]/g, '').trim() || 'image'

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
      replaceToken(view, job.token, `![${safeName(job.file.name)}](${path})`)
    } catch (e) {
      replaceToken(view, job.token, '')
      toast.error(e?.message || 'Image upload failed')
    }
  })
}

const imageFilesFrom = (list) => (list ? [...list].filter(f => ALLOWED_IMAGE_MIME.has(f.type)) : [])

export function imageExtensions(getAuth) {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const images = imageFilesFrom(event.clipboardData?.files)
      if (!images.length) return false
      event.preventDefault()
      startUploads(view, images, getAuth)
      return true
    },
    drop: (event, view) => {
      const images = imageFilesFrom(event.dataTransfer?.files)
      if (!images.length) return false
      event.preventDefault()
      startUploads(view, images, getAuth)
      return true
    },
    // Drag the resize handle on a rendered image → rewrite the markdown width.
    mousedown: (event, view) => {
      const handle = event.target?.closest?.('.cm-img-resize')
      if (!handle) return false
      event.preventDefault()
      const img = handle.closest('.cm-img-wrap')?.querySelector('img')
      if (!img) return true
      const startX = event.clientX
      const startW = img.offsetWidth
      let newW = startW
      const onMove = (e) => {
        newW = Math.max(40, Math.round(startW + (e.clientX - startX)))
        img.style.width = newW + 'px'
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        const pos = view.posAtDOM(handle)
        let node = syntaxTree(view.state).resolve(pos, 1)
        while (node && node.name !== 'Image') node = node.parent
        if (!node) return
        const raw = view.state.doc.sliceString(node.from, node.to)
        const m = /^!\[([^\]]*)\]\(([^)\s]*)\)$/.exec(raw)
        if (!m) return
        const url = m[2].replace(/#w=\d+$/, '') + `#w=${newW}`
        view.dispatch({ changes: { from: node.from, to: node.to, insert: `![${m[1]}](${url})` } })
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return true
    },
  })
}
