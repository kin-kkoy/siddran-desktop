// Turn an HTML page into markdown a note can hold.
//
// The reverse of components/Editor/utils/markdownToHtml.js, and the counterpart to
// the side-pane viewer: viewing keeps a page as a foreign document, importing makes
// it yours — editable, searchable, and stored as plain text in the vault.
//
// Sanitising is not optional here. The viewer can be careless with a page's script
// because it runs behind a sandbox and a CSP; imported markdown is rendered by the
// note reader with no such walls, so anything executable has to be gone before it
// lands. rehype-sanitize runs on an allow-list, which is why it sits between the
// parse and the markdown conversion rather than after it.
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeRemark from 'rehype-remark'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'

// GitHub's default allow-list, plus the bits markdown can actually represent.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'figure', 'figcaption', 'del', 's'],
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'title'],
    a: [...(defaultSchema.attributes?.a || []), 'href', 'title'],
  },
  // Removing a tag is not the same as removing its CONTENT: by default only
  // <script> is stripped outright, so a <style> block lost its tag and dumped raw
  // CSS into the note as prose. These carry payloads, not prose — drop them whole.
  strip: ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed'],
  // `javascript:` and `data:` hrefs survive a naive tag filter and still execute
  // when clicked, so restrict link protocols explicitly.
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', '#'],
    src: ['http', 'https'],
  },
}

const processor = unified()
  .use(rehypeParse, { fragment: false })
  .use(rehypeSanitize, schema)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    fences: true,
    rule: '-',
    // The editor writes `*text*`; matching it keeps imported notes consistent with
    // hand-written ones.
    emphasis: '*',
    strong: '*',
  })

export function htmlToMarkdown(html) {
  if (typeof html !== 'string' || !html.trim()) return ''
  try {
    return String(processor.processSync(html)).trim()
  } catch {
    return ''
  }
}

// A sensible note title: the document's <title>, else its first heading, else null
// so the caller can fall back to the file name.
export function titleFromHtml(html) {
  if (typeof html !== 'string') return null
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
  if (!t) return null
  const clean = t.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 120) : null
}
