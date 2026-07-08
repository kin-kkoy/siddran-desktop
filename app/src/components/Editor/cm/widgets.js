import { WidgetType } from '@codemirror/view'
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

// Renders a markdown image `![alt](path#w=NNN)` as an actual <img> (path
// resolved through the R2 helper) with an optional pixel width and a drag handle.
// The drag itself is handled by a domEventHandler in cm/imagePaste.js (which
// rewrites the markdown width); this widget is otherwise presentational.
export class ImageWidget extends WidgetType {
  constructor(src, width) {
    super()
    this.src = src
    this.width = width
  }
  eq(o) { return o.src === this.src && o.width === this.width }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-img-wrap'
    wrap.setAttribute('contenteditable', 'false')
    const img = document.createElement('img')
    img.className = 'cm-img'
    img.src = resolveImageUrl(this.src)
    img.alt = ''
    img.loading = 'lazy'
    if (this.width) img.style.width = this.width + 'px'
    const handle = document.createElement('span')
    handle.className = 'cm-img-resize'
    handle.title = 'Drag to resize'
    wrap.appendChild(img)
    wrap.appendChild(handle)
    return wrap
  }
  ignoreEvent() { return true }
}
