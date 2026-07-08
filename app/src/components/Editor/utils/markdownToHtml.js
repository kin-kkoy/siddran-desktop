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
import { remarkHighlight } from './remarkHighlight'
import { remarkHashtag } from './remarkHashtag'
import { remarkWikilinks } from './remarkWikilinks'
import { normalizeCalloutWithMap } from './calloutBlocks'
import { resolveImageUrl } from '../../../utils/imageUpload'
import logger from '../../../utils/logger'

// Markdown → HTML for the reading view. Reuses the same remark plugins the
// editor uses (gfm + the custom spoiler/underline) so notes render identically;
// images go through resolveImageUrl and `#w=NNN` becomes a width; fenced code is
// highlighted by rehype-highlight (highlight.js classes — theme CSS imported by
// ReadingView). Raw HTML other than the handled spoiler/underline nodes is
// dropped (safe default), since these are the user's own notes.

const handlers = {
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

// Resolve image src through the R2 helper and lift `#w=NNN` into a width style.
function rehypeCinderImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img' || !node.properties) return
      let src = String(node.properties.src || '')
      const wm = /#w=(\d+)$/.exec(src)
      if (wm) {
        src = src.slice(0, wm.index)
        const w = `width:${wm[1]}px`
        node.properties.style = node.properties.style ? `${node.properties.style};${w}` : w
      }
      node.properties.src = resolveImageUrl(src)
      node.properties.loading = 'lazy'
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
  .use(remarkWikilinks)
  .use(remarkHighlight)
  .use(remarkHashtag)
  .use(remarkRehype, { handlers })
  .use(rehypeLineNumbers)
  .use(rehypeCallouts)
  .use(rehypeCinderImages)
  .use(rehypeHighlight, { ignoreMissing: true })
  .use(rehypeStringify)

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

export function markdownToHtml(md) {
  if (!md) return ''
  try {
    const { text, map } = normalizeCalloutWithMap(md)
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

