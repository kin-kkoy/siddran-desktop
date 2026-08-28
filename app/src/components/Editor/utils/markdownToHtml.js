import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import { remarkSpoiler } from './remarkSpoiler'
import { remarkUnderline } from './remarkUnderline'
import { remarkBr } from './remarkBr'
import { remarkHighlight } from './remarkHighlight'
import { remarkHashtag } from './remarkHashtag'
import { remarkWikilinks } from './remarkWikilinks'
import { normalizeCalloutWithMap } from './calloutBlocks'
import { resolveImageUrl } from '../../../utils/imageUpload'
import { parseDiagram, DIAGRAM_LANG } from '../../../utils/diagramBlock'
import { diagramToSvg } from '../../../utils/diagramSvg'
import { isAttachmentHref, hrefKind, isExternalHref } from '../../../utils/attachmentLinks'
import logger from '../../../utils/logger'

// Markdown → HTML for the reading view. Reuses the same remark plugins the
// editor uses (gfm + the custom spoiler/underline) so notes render identically;
// images go through resolveImageUrl and `#w=NNN` becomes a width; fenced code is
// highlighted by rehype-highlight (highlight.js classes — theme CSS imported by
// ReadingView). Raw HTML other than the handled spoiler/underline nodes is
// dropped (safe default), since these are the user's own notes.

// An <svg> DOM tree → hast, so a diagram can be handed to rehype as real nodes
// rather than raw HTML. The pipeline drops raw HTML by design (see the note
// above), and carving an exception for it would open that door for note content
// too — this keeps the safe default intact.
function domToHast(node) {
  if (node.nodeType === 3) return { type: 'text', value: node.nodeValue }
  if (node.nodeType !== 1) return null
  const properties = {}
  for (const attr of node.attributes) properties[attr.name] = attr.value
  return {
    type: 'element',
    tagName: node.tagName,
    properties,
    children: Array.from(node.childNodes).map(domToHast).filter(Boolean),
  }
}

const handlers = {
  // A `siddran-diagram` fence becomes the picture it encodes. remarkDiagrams
  // below marks the node; this turns it into SVG.
  diagram(state, node) {
    const svg = node.items ? diagramToSvg(node.items) : null
    const inner = svg ? domToHast(svg) : null
    return {
      type: 'element',
      tagName: 'figure',
      properties: { className: ['rv-diagram'] },
      children: inner ? [inner] : [],
    }
  },
  spoiler(state, node) {
    return { type: 'element', tagName: 'span', properties: { className: ['rv-spoiler'] }, children: state.all(node) }
  },
  underline(state, node) {
    return { type: 'element', tagName: 'u', properties: {}, children: state.all(node) }
  },
  highlight(state, node) {
    return { type: 'element', tagName: 'mark', properties: {}, children: state.all(node) }
  },
  hashtag(state, node) {
    return {
      type: 'element',
      tagName: 'span',
      properties: { className: ['rv-hashtag'], 'data-tag': node.tag },
      children: state.all(node),
    }
  },
  wikilink(state, node) {
    const wl = node.wl || {}
    const props = { className: ['rv-link', 'rv-link-' + wl.kind] }
    if (wl.kind === 'note') props['data-target'] = wl.target
    else { props['data-link-kind'] = wl.kind; props['data-link-id'] = wl.id }
    return { type: 'element', tagName: 'span', properties: props, children: state.all(node) }
  },
}

// Resolve image src through the R2 helper and lift the `#w=NNN` (+ optional
// `#h=NNN`) fragment into width/height styles.
function rehypeCinderImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img' || !node.properties) return
      let src = String(node.properties.src || '')
      const fm = /#w=(\d+)(?:#h=(\d+))?$/.exec(src)
      if (fm) {
        src = src.slice(0, fm.index)
        const dims = [`width:${fm[1]}px`]
        if (fm[2]) dims.push(`height:${fm[2]}px`)
        const style = dims.join(';')
        node.properties.style = node.properties.style ? `${node.properties.style};${style}` : style
      }
      node.properties.src = resolveImageUrl(src)
      node.properties.loading = 'lazy'
    })
  }
}

// Take the real `href` off EVERY anchor and say what the link is instead.
//
// The reading view's click handler routes `.rv-link`; anything else falls through
// to the browser, and for an `<a href>` that means the webview navigates and the
// whole app — unsaved editor state included — is replaced by the page, with no way
// back. Dropping the href is what makes that impossible by construction rather
// than by remembering to bind a handler on every surface that renders a note.
//
// Three destinations, and the order matters: a REMOTE pdf is still an attachment
// (isAttachmentHref only excludes remote *html*), so it keeps going to the side
// viewer rather than out to the browser.
function rehypeCinderLinks() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a' || !node.properties) return
      const href = String(node.properties.href || '')
      const kind = isAttachmentHref(href)
        ? `rv-link-${hrefKind(href)}`   // side viewer
        : isExternalHref(href)
          ? 'rv-link-external'          // confirm, then the real browser
          : 'rv-link-inert'             // a bare relative path — nothing to open
      const cls = Array.isArray(node.properties.className) ? node.properties.className : []
      node.properties.className = [...cls, 'rv-link', kind]
      node.properties['data-href'] = href
      delete node.properties.href
    })
  }
}

// Tag each heading and list item with its 1-based source line (`data-line`) so the
// reading view can restore/persist folds keyed by the same line number the CM6
// editor uses. Positions come from remark-parse and survive into hast — but for a
// note with callouts they're in the post-normalize coordinate space (blank lines
// were inserted), so we translate them back to the original editor line via
// `activeLineMap` (set per-call below; processSync is synchronous so this is safe).
const LINE_TAGGED = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])
let activeLineMap = null
function rehypeLineNumbers() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (!LINE_TAGGED.has(node.tagName)) return
      let line = node.position?.start?.line
      if (!line) return
      if (activeLineMap) {
        const orig = activeLineMap[line - 1] // normalized line (1-based) → map index (0-based)
        if (orig == null || orig < 0) return  // inserted blank / unknown → no stable line
        line = orig + 1                        // back to the 1-based original editor line
      }
      node.properties = node.properties || {}
      node.properties['data-line'] = String(line)
    })
  }
}

// Turn a blockquote whose first line is `[!type] …` into a callout card. Callout
// boundaries are already correct here because normalizeCalloutSource() split the
// source so each callout is its own blockquote (no merges, no absorbed lazy lines).
function rehypeCallouts() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'blockquote') return
      const firstP = node.children.find(c => c.type === 'element' && c.tagName === 'p')
      const firstText = firstP?.children?.[0]
      if (!firstText || firstText.type !== 'text') return
      const m = /^\[!(\w+)\]/.exec(firstText.value)
      if (!m) return
      const prev = node.properties?.className || []
      node.properties = node.properties || {}
      node.properties.className = [
        ...(Array.isArray(prev) ? prev : [prev]).filter(Boolean),
        'rv-callout', 'rv-callout-' + m[1].toLowerCase(),
      ]
      firstText.value = firstText.value.replace(/^\[!\w+\][ \t]*/, '') // drop the marker, keep the rest
    })
  }
}

function remarkDisableSetext() {
  const ext = this.data('micromarkExtensions') || []
  ext.push({ disable: { null: ['setextUnderline', 'codeIndented'] } })
  this.data('micromarkExtensions', ext)
}

function remarkPreserveBlankLines() {
  return (tree) => {
    preserveBlanks(tree)
  }
}

function preserveBlanks(node) {
  if (!node.children || node.children.length < 2) return
  for (const child of node.children) preserveBlanks(child)
  if (node.type !== 'root' && node.type !== 'blockquote' && node.type !== 'listItem') return
  const out = []
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (i > 0) {
      const prev = node.children[i - 1]
      const extra = (child.position?.start?.line || 0) - (prev.position?.end?.line || 0) - 2
      for (let j = 0; j < extra; j++) {
        out.push({ type: 'paragraph', data: { hProperties: { className: ['rv-blank'] } }, children: [{ type: 'break' }] })
      }
    }
    out.push(child)
  }
  node.children = out
}

function preserveIndent(md) {
  const lines = md.split('\n')
  let inCode = false
  let inBlock = false
  return lines.map(line => {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) { inCode = !inCode; return line }
    if (inCode) return line
    if (/^\s*>/.test(line)) { inBlock = true; return line }
    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+[.)]\s/.test(line)) { inBlock = true; return line }
    if (line.trim() === '') { inBlock = false; return line }
    if (inBlock) return line
    return line.replace(/^( +)(?=\S)/, m => '\u00A0'.repeat(m.length))
  }).join('\n')
}

// Retag `siddran-diagram` fences before remark-rehype sees them, so they are
// never rendered as a code block. An unparseable payload is left alone: it stays
// a normal code block, which is the same escape hatch the editor gives.
function remarkDiagrams() {
  return (tree) => {
    visit(tree, 'code', (node) => {
      if ((node.lang || '').toLowerCase() !== DIAGRAM_LANG) return
      const doc = parseDiagram(node.value)
      if (!doc) return
      node.type = 'diagram'
      node.items = doc.items
    })
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkDisableSetext)
  .use(remarkGfm)
  // Render a single newline as a hard line break (<br>), matching how the editor
  // shows each line separately. Two newlines still make a new paragraph.
  .use(remarkBreaks)
  .use(remarkPreserveBlankLines)
  .use(remarkSpoiler)
  .use(remarkUnderline)
  .use(remarkBr)
  .use(remarkWikilinks)
  .use(remarkHighlight)
  .use(remarkHashtag)
  .use(remarkDiagrams)
  .use(remarkRehype, { handlers })
  .use(rehypeLineNumbers)
  .use(rehypeCallouts)
  .use(rehypeCinderImages)
  .use(rehypeCinderLinks)
  .use(rehypeHighlight, { ignoreMissing: true })
  .use(rehypeStringify)

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// Wrap image/link destinations that contain a space in <> so CommonMark parses
// them. An unencoded space (e.g. an attachment in a note-titled folder like
// `attachments/another test/…`) otherwise ends the destination early, and the
// whole `![alt](path)` falls back to literal text — which is why an image could
// render as its raw markdown. Skips already-bracketed dests and ones with a title.
const bracketSpacedUrls = (md) =>
  md.replace(/(\]\()([^()\n<>"]*?)(\))/g, (m, open, dest, close) =>
    (/\s/.test(dest) ? `${open}<${dest.trim()}>${close}` : m))

export function markdownToHtml(md) {
  if (!md) return ''
  try {
    const { text, map } = normalizeCalloutWithMap(bracketSpacedUrls(md))
    activeLineMap = map // consumed by rehypeLineNumbers; preserveIndent keeps line count
    return String(processor.processSync(preserveIndent(text)))
  } catch (err) {
    // A render-time parser throw must never crash the note view — fall back to the
    // raw markdown, escaped, so the note still shows its content.
    logger.error('markdownToHtml failed; showing raw text', err)
    return `<pre class="rv-fallback">${escapeHtml(md)}</pre>`
  } finally {
    activeLineMap = null
  }
}

