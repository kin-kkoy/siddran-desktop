import { WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { resolveImageUrl } from '../../../utils/imageUpload'

// Phase 1 live-preview widgets — ports of the reference clone's HrWidget /
// BulletWidget / CheckWidget (garb2/obsidian-notes-clone.html). Richer widgets
// (image, note-embed, table, callout) arrive in later phases.
//
// These come from a StateField (block decorations like the HR and the
// cross-line fenced-code hides must), so widgets get no view at construction.
// The checkbox toggle is therefore handled by a domEventHandler in
// CodeMirrorEditor.jsx rather than a dispatch closure here.

// Renders a thematic-break line (---/***/___) as a horizontal rule.
export class HrWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const d = document.createElement('div')
    d.className = 'cm-hr'
    d.setAttribute('contenteditable', 'false')
    return d
  }
}

// Replaces a list marker (-, *, +) with a typographic bullet. ignoreEvent
// returns false so the caret can still land just after it for editing.
export class BulletWidget extends WidgetType {
  eq() { return true }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    // contenteditable=false so native caret hit-testing (clickFix in
    // verticalMotion.js) can't land the caret *inside* the glyph — it resolves to
    // the adjacent editable position instead (matching CheckWidget).
    s.setAttribute('contenteditable', 'false')
    s.textContent = '•'
    return s
  }
  ignoreEvent() { return false }
}

// Replaces `[ ]` / `[x]` with a checkbox reflecting the checked state. The
// actual source toggle is performed by CodeMirrorEditor's click handler, which
// resolves the clicked position back to the line and flips the marker — so this
// widget stays purely presentational.
export class CheckWidget extends WidgetType {
  constructor(checked) {
    super()
    this.checked = checked
  }
  eq(o) { return o.checked === this.checked }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-task'
    s.setAttribute('contenteditable', 'false')
    const c = document.createElement('input')
    c.type = 'checkbox'
    c.className = 'cm-task-check'
    c.checked = this.checked
    // Prevent the editor from stealing focus / moving the caret on toggle.
    c.addEventListener('mousedown', e => e.preventDefault())
    s.appendChild(c)
    return s
  }
  ignoreEvent() { return false }
}

// The 8 resize handles of the bounding box, clockwise from top-left. Corners
// aspect-lock; edges resize one axis. Each `data-dir` drives the drag maths.
const IMG_HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// The src of the currently-selected image, tracked at module scope so the
// selection survives a widget rebuild — a resize dispatches a doc change, which
// recreates the ImageWidget DOM (eq is false on the new #w/#h), and toDOM below
// re-applies `.cm-img-selected` when this.src matches. (Two images sharing a src
// would both highlight — an acceptable edge case.)
let selectedSrc = null

// Select an image: mark this wrap, clear the others, remember its src, and focus
// the editor so keyboard Backspace/Delete can act on it.
function selectImage(view, wrap, src) {
  selectedSrc = src
  view.dom.querySelectorAll('.cm-img-wrap.cm-img-selected').forEach((el) => {
    if (el !== wrap) el.classList.remove('cm-img-selected')
  })
  wrap.classList.add('cm-img-selected')
  view.focus()
}

// Clear image selection everywhere (used on click-outside and after delete).
export function deselectAllImages(root) {
  selectedSrc = null
  root.querySelectorAll('.cm-img-wrap.cm-img-selected').forEach((el) => el.classList.remove('cm-img-selected'))
}

// Drag a bounding-box handle → live-scale the image, then rewrite the markdown
// size fragment (#w=NNN#h=NNN) on release. Corners scale proportionally, locking
// the image's CURRENT displayed aspect ratio (so a prior edge-stretch is kept);
// edges resize a single axis. Both dimensions are always persisted.
function startResize(event, view, wrap, img, dir, src) {
  event.preventDefault()
  event.stopPropagation()
  selectImage(view, wrap, src) // keep it selected through & after the resize
  const handle = event.currentTarget
  const corner = dir.length === 2                                  // nw/ne/se/sw
  const xs = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0    // horizontal grow sign
  const ys = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0    // vertical grow sign
  const startX = event.clientX
  const startY = event.clientY
  const startW = img.offsetWidth
  const startH = img.offsetHeight
  // Aspect ratio of the image AS CURRENTLY DISPLAYED (may already be stretched by
  // a prior edge drag) — corners preserve this, not the file's natural ratio.
  const ratio = startH / startW || 1
  let newW = startW
  let newH = startH
  let moved = false
  wrap.classList.add('cm-img-dragging')

  const onMove = (e) => {
    moved = true
    const dx = (e.clientX - startX) * xs
    const dy = (e.clientY - startY) * ys
    if (corner) {
      // Aspect-locked to the current ratio: grow by whichever axis moved more
      // (in width terms), then derive height so the current proportions hold.
      const growFromY = dy / ratio
      const grow = Math.abs(dx) >= Math.abs(growFromY) ? dx : growFromY
      newW = Math.max(40, Math.round(startW + grow))
      newH = Math.max(24, Math.round(newW * ratio))
    } else if (xs !== 0) {
      // Left/right edge: width free, keep current height.
      newW = Math.max(40, Math.round(startW + dx))
      newH = startH
    } else {
      // Top/bottom edge: height free, keep current width.
      newH = Math.max(24, Math.round(startH + dy))
      newW = startW
    }
    img.style.width = newW + 'px'
    img.style.height = newH + 'px'
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    wrap.classList.remove('cm-img-dragging')
    if (!moved) return // a plain click on a handle — don't rewrite the markdown
    const pos = view.posAtDOM(handle)
    let node = syntaxTree(view.state).resolve(pos, 1)
    while (node && node.name !== 'Image') node = node.parent
    if (!node) return
    const raw = view.state.doc.sliceString(node.from, node.to)
    const m = /^!\[([^\]]*)\]\(([^)\s]*)\)$/.exec(raw)
    if (!m) return
    const base = m[2].replace(/#w=\d+(?:#h=\d+)?$/, '')
    view.dispatch({ changes: { from: node.from, to: node.to, insert: `![${m[1]}](${base}#w=${newW}#h=${newH})` } })
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Renders a markdown image `![alt](path#w=NNN#h=NNN)` as an actual <img> (path
// resolved through the R2 helper) with optional pixel width/height. Clicking the
// image selects it, revealing a Google-Docs-style bounding box (outline + 8 drag
// handles). Listeners are wired directly on the widget DOM here (toDOM receives
// the view) rather than via a bubbling domEventHandler, so they fire reliably on
// the contenteditable=false / atomic widget internals in WebKitGTK.
export class ImageWidget extends WidgetType {
  constructor(src, width, height) {
    super()
    this.src = src
    this.width = width
    this.height = height
  }
  eq(o) { return o.src === this.src && o.width === this.width && o.height === this.height }
  toDOM(view) {
    const src = this.src
    const wrap = document.createElement('span')
    wrap.className = 'cm-img-wrap'
    wrap.setAttribute('contenteditable', 'false')
    const img = document.createElement('img')
    img.className = 'cm-img'
    img.src = resolveImageUrl(src)
    img.alt = ''
    img.loading = 'lazy'
    if (this.width) img.style.width = this.width + 'px'
    if (this.height) img.style.height = this.height + 'px'
    // Select on click (preventDefault keeps the caret off the image so it stays
    // rendered — the live-preview would otherwise reveal raw markdown).
    img.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      selectImage(view, wrap, src)
    })
    wrap.appendChild(img)
    const box = document.createElement('span')
    box.className = 'cm-img-box'
    wrap.appendChild(box)
    for (const dir of IMG_HANDLE_DIRS) {
      const h = document.createElement('span')
      h.className = `cm-img-handle cm-img-handle-${dir}`
      h.dataset.dir = dir
      h.addEventListener('mousedown', (e) => startResize(e, view, wrap, img, dir, src))
      wrap.appendChild(h)
    }
    // Re-apply selection after a rebuild (e.g. straight after a resize commit).
    if (src === selectedSrc) wrap.classList.add('cm-img-selected')
    return wrap
  }
  ignoreEvent() { return true }
}
