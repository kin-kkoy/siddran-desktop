import { EditorView } from '@codemirror/view'
import { uploadImageFile, fileFromLocalPath } from '../utils/imageUpload'
import { isOpen as isLocalOpen } from './localStore'

// Native OS file-drop handling for the desktop shell. On WebKitGTK the webview's
// DOM drop event exposes no usable file data (and `dragDropEnabled:false` just
// let the webview navigate to the file), so we rely on Tauri's native drag-drop
// event (`tauri://drag-drop`, enabled by `dragDropEnabled:true`) which hands us
// the real absolute paths + drop position straight from the OS. We read each
// image off disk (Rust `bag_read_bytes` via fileFromLocalPath), save it into the
// Bag, and insert the markdown at the drop point in whichever editor was hit.

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i
const safeName = (n) => (n || 'image').replace(/[[\]()\n\r]/g, '').trim() || 'image'
const encodePathForMarkdown = (p) => {
  if (/^(data:|https?:|blob:)/.test(p)) return p
  return p.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')
}

// Find the CodeMirror view under the drop point (falling back to the only editor
// on screen), and the doc position at those coordinates.
function editorAt(cssX, cssY) {
  let dom = document.elementFromPoint(cssX, cssY)?.closest?.('.cm-editor')
  if (!dom) dom = document.querySelector('.cm-editor')
  const view = dom ? EditorView.findFromDOM(dom) : null
  if (!view) return null
  let pos = view.posAtCoords({ x: cssX, y: cssY })
  if (pos == null) pos = view.state.selection.main.head
  return { view, pos }
}

async function handleDrop(paths, position) {
  if (!isLocalOpen()) return
  const imgs = (paths || []).filter((p) => IMG_EXT.test(p))
  if (!imgs.length) return
  // Tauri gives a PhysicalPosition; convert to CSS pixels for DOM hit-testing.
  const dpr = window.devicePixelRatio || 1
  const target = editorAt((position?.x || 0) / dpr, (position?.y || 0) / dpr)
  if (!target) return
  const { view } = target
  let pos = target.pos
  for (const p of imgs) {
    const file = await fileFromLocalPath(p)
    if (!file) continue
    try {
      const { path } = await uploadImageFile(null, null, file) // local Bag save — no auth needed
      const md = `![${safeName(file.name)}](${encodePathForMarkdown(path)})\n`
      view.dispatch({ changes: { from: pos, insert: md }, selection: { anchor: pos + md.length } })
      pos += md.length
    } catch { /* skip this file */ }
  }
}

export function installTauriFileDrop() {
  const T = typeof window !== 'undefined' && window.__TAURI__
  const listen = T?.event?.listen
  if (!listen || window.__siddranFileDrop) return
  window.__siddranFileDrop = true
  // Payload shape: { paths: string[], position: { x, y } } (physical pixels).
  listen('tauri://drag-drop', (ev) => {
    const { paths, position } = ev?.payload || {}
    handleDrop(paths, position)
  })
}
