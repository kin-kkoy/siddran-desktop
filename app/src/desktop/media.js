import { fileFromLocalPath, uploadImageFile } from '../utils/imageUpload'
import { saveAttachment, isOpen as isLocalOpen, getBagPath } from './localStore'
import { isTauri } from './bag'
import { toast } from '../utils/toast'
import { htmlToMarkdown, titleFromHtml } from '../utils/htmlToMarkdown'

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

const invoker = () =>
  (typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)) || null

// Browsers save a page as `page.html` PLUS a `page_files/` folder holding its CSS
// and images. Find that folder if it's there — copying only the .html leaves the
// page stripped of everything that made it look like itself.
async function findSidecarFolder(abs) {
  const inv = invoker()
  if (!inv) return null
  const base = abs.replace(/\.html?$/i, '')
  // Chrome localises the suffix; these cover the common ones.
  for (const suffix of ['_files', '.files', '_fichiers', '-Dateien', '_archivos', '_arquivos', '_bestanden', '_file']) {
    try { if (await inv('bag_exists', { path: base + suffix })) return base + suffix } catch { /* ignore */ }
  }
  return null
}

const shortId = () => {
  try { return crypto.randomUUID().slice(0, 8) } catch { return String(Date.now()).slice(-8) }
}

// Copy a saved page and its assets folder into the Bag as one self-contained
// bundle. Deliberately NOT under `attachments/<Note Title>/` like single files:
// that path is derived from the note's title, so renaming the note would orphan a
// whole directory AND break the link at the same time. A uuid directory is
// title-independent, so the link keeps working whatever you call the note.
async function saveHtmlBundle(abs, fileName) {
  const inv = invoker()
  const bag = getBagPath()
  if (!inv || !bag) return null
  const sidecar = await findSidecarFolder(abs)
  const dir = `attachments/_bundles/${shortId()}`
  try {
    await inv('bag_mkdirp', { path: `${bag}/${dir}` })
    const b64 = await inv('bag_read_bytes', { path: abs })
    await inv('bag_write_bytes', { path: `${bag}/${dir}/${fileName}`, contents: b64 })
    if (sidecar) {
      const folderName = sidecar.split('/').pop()
      const bytes = await inv('bag_copy_dir', { from: sidecar, to: `${bag}/${dir}/${folderName}` })
      if (bytes > 25 * 1024 * 1024) {
        toast.warning(`Copied ${Math.round(bytes / 1024 / 1024)}MB of page assets into your Bag.`)
      }
    }
    return { rel: `${dir}/${fileName}`, bundled: !!sidecar }
  } catch {
    return null
  }
}

// Shared pick → read → copy-into-Bag → markdown-link flow for document
// attachments. Returns { path, name, markdown } | null; `path` is Bag-relative.
async function attachDocViaPicker({ title, label, extensions, test, noun, fallbackName }) {
  if (!isLocalOpen() || !isTauri()) { toast.error('Open a Bag first'); return null }
  const abs = await pickFile(title, [{ name: label, extensions }])
  if (!abs) return null
  if (!test.test(abs)) { toast.error(`Only ${label} files can be attached`); return null }
  const file = await fileFromLocalPath(abs)
  if (!file) { toast.error(`Could not read the ${noun}`); return null }
  const rel = await saveAttachment(file)
  if (!rel) { toast.error(`Could not save the ${noun}`); return null }
  const name = abs.split('/').pop() || fallbackName
  // A plain markdown link so the attachment persists in the note and can be reopened.
  const markdown = `[${name.replace(/[[\]()\n\r]/g, '')}](${encodeMd(rel)})`
  return { path: rel, name, markdown }
}

// Pick a PDF and copy it into the active note's Bag attachments. → { path, name } | null.
export function attachPdfViaPicker() {
  return attachDocViaPicker({
    title: 'Attach a PDF', label: 'PDF', extensions: ['pdf'],
    test: /\.pdf$/i, noun: 'PDF', fallbackName: 'document.pdf',
  })
}

// Pick a local HTML page and copy it in. Single file only for now: a saved page's
// sibling assets folder is not copied, so we warn when one is present.
export async function attachHtmlViaPicker() {
  const abs = await pickFile('Attach an HTML page', [{ name: 'HTML', extensions: ['html', 'htm'] }])
  if (!abs) return null
  if (!isLocalOpen() || !isTauri()) { toast.error('Open a Bag first'); return null }
  if (!/\.html?$/i.test(abs)) { toast.error('Only HTML files can be attached'); return null }
  const name = abs.split('/').pop() || 'page.html'
  return attachHtmlFromPath(abs, name)
}

// Shared by the picker and the drag-drop handler.
export async function attachHtmlFromPath(abs, name) {
  const saved = await saveHtmlBundle(abs, name)
  if (!saved) { toast.error('Could not save the page'); return null }
  const markdown = `[${name.replace(/[[\]()\n\r]/g, '')}](${encodeMd(saved.rel)})`
  return { path: saved.rel, name, markdown, bundled: saved.bundled }
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

// Read a Bag-relative attachment as text. Used by the HTML viewer, which needs the
// page's source (not just a URL) so it can inject a per-file CSP before display.
export async function readAttachmentText(rel) {
  const bag = getBagPath()
  const inv = typeof window !== 'undefined' && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)
  if (!bag || !inv || !rel) return null
  // Markdown link targets are percent-encoded; the path on disk is not.
  let path = rel
  try { path = rel.split('/').map(decodeURIComponent).join('/') } catch { /* keep raw */ }
  try { return await inv('bag_read_text', { path: `${bag}/${path}` }) } catch { return null }
}

// Convert an HTML file into markdown for insertion into the current note.
//
// The counterpart to attaching: attaching keeps a page as a foreign document behind
// a sandbox, importing makes it yours — editable, searchable, and plain text in the
// vault. Nothing is copied into the Bag, so the file itself is untouched.
export async function importHtmlAsMarkdownViaPicker() {
  const abs = await pickFile('Import an HTML page as markdown', [{ name: 'HTML', extensions: ['html', 'htm'] }])
  if (!abs) return null
  if (!isLocalOpen() || !isTauri()) { toast.error('Open a Bag first'); return null }
  const inv = invoker()
  let html = null
  try { html = await inv('bag_read_text', { path: abs }) } catch { /* handled below */ }
  if (html == null) { toast.error('Could not read that page'); return null }

  const markdown = htmlToMarkdown(html)
  if (!markdown) { toast.error('Nothing to import — the page had no readable content'); return null }

  // A page that builds itself with JavaScript has almost no text in the file — you
  // get a near-empty note and no idea why. Importing captures what is written in the
  // HTML; anything the page draws at runtime isn't there to capture.
  if (markdown.length < 600 && html.length > 15000) {
    toast.warning('That page builds most of its content with JavaScript, so there was little text to import — attach it instead to view it as a page.')
  }

  const name = abs.split('/').pop() || 'page.html'
  const heading = titleFromHtml(html) || name.replace(/\.html?$/i, '')

  // Images the page loaded from its own folder won't resolve — that folder isn't in
  // the Bag, and the asset scope only covers the Bag. Remote images still work. Say
  // so rather than let them silently appear broken.
  if (/!\[[^\]]*\]\((?!https?:)/.test(markdown)) {
    toast.warning("Imported. Images stored beside the original file won't display — attach the page instead if you need them.")
  }

  return { markdown: `# ${heading}\n\n${markdown.replace(/^#\s+.*\n+/, '')}`, name, heading }
}
