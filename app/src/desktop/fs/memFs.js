// In-memory filesystem adapter — used by the round-trip tests (and as a browser
// fallback so the app doesn't crash when there's no Tauri backend). Mirrors the
// async adapter interface that localStore depends on.
//
// Interface: exists, mkdirp, readDir([{name,isDir}]), readText, writeText
// (creates parents), remove (file/dir), rename.

export function createMemFs(seed = {}) {
  // path -> string content. Directories are implied by file paths + explicit set.
  const files = new Map(Object.entries(seed))
  const dirs = new Set(['/'])

  const norm = (p) => p.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  const parent = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i) }
  const addDirs = (p) => { let cur = ''; for (const seg of norm(p).split('/')) { cur = norm(cur + '/' + seg); if (cur) dirs.add(cur) } }

  // seed dirs from seeded files
  for (const p of files.keys()) addDirs(parent(p))

  return {
    async exists(p) { p = norm(p); return files.has(p) || dirs.has(p) },
    async mkdirp(p) { addDirs(p) },
    async readDir(p) {
      p = norm(p)
      const out = new Map()
      const prefix = p === '/' ? '/' : p + '/'
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length)
          const name = rest.split('/')[0]
          out.set(name, { name, isDir: rest.includes('/') })
        }
      }
      for (const d of dirs) {
        if (d !== p && d.startsWith(prefix)) {
          const name = d.slice(prefix.length).split('/')[0]
          if (name) out.set(name, { name, isDir: true })
        }
      }
      return [...out.values()]
    },
    async readText(p) {
      p = norm(p)
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
      return files.get(p)
    },
    async writeText(p, content) { p = norm(p); addDirs(parent(p)); files.set(p, String(content)) },
    async writeBytes(p, base64) { p = norm(p); addDirs(parent(p)); files.set(p, `base64:${base64}`) },
    async remove(p) {
      p = norm(p)
      files.delete(p)
      const prefix = p + '/'
      for (const f of [...files.keys()]) if (f.startsWith(prefix)) files.delete(f)
      for (const d of [...dirs]) if (d === p || d.startsWith(prefix)) dirs.delete(d)
    },
    async rename(from, to) {
      from = norm(from); to = norm(to)
      if (files.has(from)) { files.set(to, files.get(from)); files.delete(from); addDirs(parent(to)); return }
      // directory rename
      const prefix = from + '/'
      for (const f of [...files.keys()]) if (f.startsWith(prefix)) { files.set(to + f.slice(from.length), files.get(f)); files.delete(f) }
      for (const d of [...dirs]) if (d === from || d.startsWith(prefix)) { dirs.add(to + d.slice(from.length)); dirs.delete(d) }
      addDirs(to)
    },
    // test helper
    _dump() { return Object.fromEntries(files) },
  }
}
