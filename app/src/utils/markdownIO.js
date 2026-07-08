export const MAX_IMPORT_BYTES = 1024 * 1024
export const IMPORTED_TAG = 'Imported'

const KNOWN_KEYS = new Set(['title', 'tags', 'color', 'is_favorite', 'created_at'])

const stripQuotes = (raw) => {
    const v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1)
    }
    return v
}

const parseFrontmatter = (text) => {
    if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
        return { fields: {}, body: text }
    }
    const after = text.replace(/^---\r?\n/, '')
    const closeIdx = after.search(/\r?\n---\r?\n/)
    if (closeIdx === -1) return { fields: {}, body: text }

    const block = after.slice(0, closeIdx)
    const body = after.slice(closeIdx).replace(/^\r?\n---\r?\n/, '')

    const fields = {}
    for (const line of block.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const colon = line.indexOf(':')
        if (colon === -1) continue
        const key = line.slice(0, colon).trim()
        const rawVal = line.slice(colon + 1)
        if (!KNOWN_KEYS.has(key)) continue
        fields[key] = stripQuotes(rawVal)
    }
    return { fields, body }
}

const mergeTags = (existing) => {
    const parts = (existing || '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
    const lower = new Set(parts.map(t => t.toLowerCase()))
    if (!lower.has(IMPORTED_TAG.toLowerCase())) parts.push(IMPORTED_TAG)
    return parts.join(', ')
}

export const parseMarkdownFile = (text, filename) => {
    const warnings = []
    const { fields, body: afterFrontmatter } = parseFrontmatter(text)

    let body = afterFrontmatter
    let title = fields.title || ''

    if (!title) {
        const h1Match = body.match(/^\s*#\s+(.+?)\s*$/m)
        if (h1Match) {
            title = h1Match[1].trim()
            body = body.replace(h1Match[0], '').replace(/^\r?\n+/, '')
        } else {
            title = (filename || 'Untitled').replace(/\.md$/i, '').trim() || 'Untitled'
        }
    }

    const tags = mergeTags(fields.tags)
    const color = fields.color || null
    const isFavorite = fields.is_favorite === 'true' || fields.is_favorite === true

    if (/!\[[^\]]*\]\([^)]+\)/.test(body)) {
        warnings.push("Images render only when uploaded through the editor; external/relative paths from imported files won't load")
    }
    if (/\[\[[^\]]+\]\]/.test(body)) {
        warnings.push("Contains [[wiki-links]] which won't resolve")
    }

    return { title, body: body.trim(), tags, color, isFavorite, warnings }
}

const needsQuoting = (str) => /[:#]/.test(str) || str !== str.trim()

const formatValue = (value) => {
    const str = String(value)
    if (needsQuoting(str)) return `'${str.replace(/'/g, "\\'")}'`
    return str
}

export const serializeNoteToMarkdown = (note) => {
    const lines = ['---']
    if (note.title) lines.push(`title: ${formatValue(note.title)}`)
    if (note.tags) lines.push(`tags: ${formatValue(note.tags)}`)
    if (note.color) lines.push(`color: ${formatValue(note.color)}`)
    if (note.is_favorite) lines.push(`is_favorite: true`)
    if (note.created_at) lines.push(`created_at: ${formatValue(note.created_at)}`)
    lines.push('---', '')
    return lines.join('\n') + (note.body || '')
}

export const slugifyForFilename = (title) => {
    const slug = (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return slug || 'untitled'
}

export const downloadMarkdown = (filename, contents) => {
    const blob = new Blob([contents], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export const readFileAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
})
