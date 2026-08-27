// LocalProvider — the file-backed data layer for the desktop app. It hydrates a
// Bag folder into an in-memory model, serves the same REST-shaped contract the
// app's hooks expect (so `authFetch` just routes here), and writes changes back
// to disk (debounced) as: notes → `.md` files with folder-style notebooks, and
// tasks/calendar/sandboxes/settings → `.siddran` JSON.
//
// The filesystem is abstracted (see fs/memFs.js, fs/tauriFs.js) so the whole
// thing is testable against a fake fs and swaps to real disk under Tauri.

// ── id + time ───────────────────────────────────────────────────────
let seq = 1000
const nextId = () => ++seq
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${nextId()}`)
// Ids arrive as strings (URL segments, drag payloads, JSON bodies). Legacy rows use
// numeric ids; rows created from now on use uuids. Coerce digit-only strings back to
// Number so `row.id === parseId(seg[1])` keeps matching both kinds.
const parseId = (v) => (v == null ? null : (typeof v === 'number' ? v : (/^\d+$/.test(String(v)) ? Number(v) : String(v))))
const nowISO = () => new Date().toISOString()

// ── module state ────────────────────────────────────────────────────
let db = emptyDb()
let _fs = null
let _bag = null
let flushTimer = null
const FLUSH_MS = 1500

function emptyDb() {
  return { notes: [], notebooks: [], tasks: [], dailies: [], completions: [], projects: [], events: [], schedules: [], sandboxes: [], sandboxItems: {}, settings: {}, comments: {} }
}

const dirty = { tasks: false, calendar: false, settings: false, notesTouched: false, notes: new Set(), notebooks: new Set(), comments: new Set(), sandboxes: new Set(), rmSandbox: new Set() }
function resetDirty() { dirty.tasks = dirty.calendar = dirty.settings = dirty.notesTouched = false; dirty.notes.clear(); dirty.notebooks.clear(); dirty.comments.clear(); dirty.sandboxes.clear(); dirty.rmSandbox.clear() }

// ── (de)serialization ───────────────────────────────────────────────
const RESERVED = /[\\/:*?"<>|]/g
export const safeName = (s) => (String(s || 'Untitled').replace(RESERVED, '_').replace(/\s+/g, ' ').trim().slice(0, 120)) || 'Untitled'

function noteToMd(note) {
  const fm = [
    '---',
    `id: ${note.id}`,
    `title: ${(note.title || '').replace(/\n/g, ' ')}`,
    `tags: ${note.tags || ''}`,
    `favorite: ${!!note.is_favorite}`,
    `color: ${note.color || ''}`,
    ...(typeof note.order === 'number' ? [`order: ${note.order}`] : []),
    `created: ${note.created_at || ''}`,
    `updated: ${note.updated_at || ''}`,
    '---',
    '',
  ].join('\n')
  return fm + (note.body || '')
}

function mdToNote(text, fallbackTitle) {
  let body = text
  const fm = {}
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':')
      if (i === -1) continue
      fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    body = text.slice(m[0].length)
  }
  return {
    id: fm.id ? Number(fm.id) : null,
    title: fm.title || fallbackTitle || 'Untitled',
    body,
    tags: fm.tags || '',
    is_favorite: fm.favorite === 'true',
    color: fm.color || null,
    order: fm.order !== undefined && fm.order !== '' ? Number(fm.order) : null,
    created_at: fm.created || nowISO(),
    updated_at: fm.updated || nowISO(),
    notebook_id: null,
  }
}

// ── hydrate ─────────────────────────────────────────────────────────
async function readJson(fs, path, apply) {
  if (!(await fs.exists(path))) return
  try { apply(JSON.parse(await fs.readText(path))) } catch { /* corrupt file — skip */ }
}

// Read a note's comment sidecar (`<note>.comments.json`, next to its `.md`).
async function readCommentsSidecar(fs, mdPath, noteId) {
  const p = mdPath.replace(/\.md$/, '.comments.json')
  if (!(await fs.exists(p))) return
  try {
    const d = JSON.parse(await fs.readText(p))
    if (d && Array.isArray(d.threads) && d.threads.length) db.comments[noteId] = { threads: d.threads }
  } catch { /* corrupt sidecar — skip */ }
}

async function hydrate(fs, bag) {
  db = emptyDb()
  seq = 1000
  await readJson(fs, `${bag}/tasks.siddran`, (d) => { db.tasks = d.tasks || []; db.dailies = d.dailies || []; db.completions = d.completions || []; db.projects = d.projects || [] })
  await readJson(fs, `${bag}/calendar.siddran`, (d) => { db.events = d.events || []; db.schedules = d.schedules || [] })
  await readJson(fs, `${bag}/settings.siddran`, (d) => { db.settings = d.settings || {} })

  const notesDir = `${bag}/notes`
  if (await fs.exists(notesDir)) {
    for (const entry of await fs.readDir(notesDir)) {
      const p = `${notesDir}/${entry.name}`
      if (entry.isDir) {
        let meta = null
        const metaPath = `${p}/.siddran-notebook.json`
        if (await fs.exists(metaPath)) { try { meta = JSON.parse(await fs.readText(metaPath)) } catch { /* */ } }
        const nb = { id: meta?.id ?? nextId(), name: entry.name, color: meta?.color ?? null, tags: meta?.tags ?? '', is_favorite: !!meta?.is_favorite, order: typeof meta?.order === 'number' ? meta.order : null, created_at: meta?.created_at ?? nowISO(), updated_at: meta?.updated_at ?? nowISO() }
        db.notebooks.push(nb)
        for (const f of await fs.readDir(p)) {
          if (!f.isDir && f.name.endsWith('.md')) {
            const note = mdToNote(await fs.readText(`${p}/${f.name}`), f.name.replace(/\.md$/, ''))
            note.id = note.id ?? nextId(); note.notebook_id = nb.id; note._path = `${p}/${f.name}`
            db.notes.push(note)
            await readCommentsSidecar(fs, `${p}/${f.name}`, note.id)
          }
        }
      } else if (entry.name.endsWith('.md')) {
        const note = mdToNote(await fs.readText(p), entry.name.replace(/\.md$/, ''))
        note.id = note.id ?? nextId(); note.notebook_id = null; note._path = p
        db.notes.push(note)
        await readCommentsSidecar(fs, p, note.id)
      }
    }
  }

  const sbDir = `${bag}/sandboxes`
  if (await fs.exists(sbDir)) {
    for (const f of await fs.readDir(sbDir)) {
      if (!f.isDir && f.name.endsWith('.siddran')) {
        await readJson(fs, `${sbDir}/${f.name}`, (d) => { if (d.sandbox) { db.sandboxes.push(d.sandbox); db.sandboxItems[d.sandbox.id] = d.items || [] } })
      }
    }
  }

  // continue ids above anything already on disk
  const ids = []
  // Number.isFinite, not `typeof === 'number'`: a hand-edited `id:` in note
  // frontmatter parses to NaN, which passes the typeof check and then poisons
  // Math.max — permanently wedging nextId() at NaN for the rest of the session.
  for (const c of [db.notes, db.notebooks, db.tasks, db.dailies, db.projects, db.events, db.schedules]) for (const r of c) if (Number.isFinite(r.id)) ids.push(r.id)
  for (const p of db.projects) for (const t of (p.tasks || [])) if (Number.isFinite(t.id)) ids.push(t.id)
  seq = Math.max(seq, ...ids, 1000)
}

// ── flush (write-back) ──────────────────────────────────────────────
async function reconcileNotes(fs, bag) {
  const notesDir = `${bag}/notes`
  await fs.mkdirp(notesDir)
  const nbById = new Map(db.notebooks.map((n) => [n.id, n]))
  const nbFolders = new Set(db.notebooks.map((n) => safeName(n.name)))
  const keep = new Set()

  for (const nb of db.notebooks) {
    const folder = `${notesDir}/${safeName(nb.name)}`
    await fs.mkdirp(folder)
    const metaPath = `${folder}/.siddran-notebook.json`
    keep.add(metaPath)
    if (dirty.notebooks.has(nb.id) || !(await fs.exists(metaPath))) {
      await fs.writeText(metaPath, JSON.stringify({ id: nb.id, color: nb.color, tags: nb.tags, is_favorite: nb.is_favorite, order: nb.order ?? null, created_at: nb.created_at, updated_at: nb.updated_at }, null, 2))
    }
  }

  const usedNames = new Map()
  for (const note of db.notes) {
    const nb = note.notebook_id != null ? nbById.get(note.notebook_id) : null
    const folder = nb ? `${notesDir}/${safeName(nb.name)}` : notesDir
    const used = usedNames.get(folder) || usedNames.set(folder, new Set()).get(folder)
    let fname = `${safeName(note.title)}.md`
    if (used.has(fname)) fname = `${safeName(note.title)}-${note.id}.md`
    used.add(fname)
    const path = `${folder}/${fname}`
    keep.add(path)
    const moved = note._path !== path
    if (dirty.notes.has(note.id) || moved) {
      await fs.writeText(path, noteToMd(note))
      note._path = path
    }
    // Comment sidecar rides alongside the note file (written/moved/pruned with it).
    const sidecar = path.replace(/\.md$/, '.comments.json')
    const threads = db.comments[note.id]?.threads || []
    if (threads.length) {
      keep.add(sidecar)
      if (dirty.comments.has(note.id) || dirty.notes.has(note.id) || moved || !(await fs.exists(sidecar))) {
        await fs.writeText(sidecar, JSON.stringify({ version: 1, threads }, null, 2))
      }
    }
  }

  // prune orphaned files/folders
  for (const entry of await fs.readDir(notesDir)) {
    const p = `${notesDir}/${entry.name}`
    if (entry.isDir) {
      if (!nbFolders.has(entry.name)) { await fs.remove(p); continue }
      for (const f of await fs.readDir(p)) {
        const fp = `${p}/${f.name}`
        if (!f.isDir && !keep.has(fp)) await fs.remove(fp)
      }
    } else if ((entry.name.endsWith('.md') || entry.name.endsWith('.comments.json')) && !keep.has(p)) {
      await fs.remove(p)
    }
  }
}

// Rows go to disk in a stable id order so the `.siddran` files diff cleanly and
// two devices appending different rows land in different places in the file
// instead of colliding at the end of the same array. Sorting by id rather than by
// date also means editing a row never moves it — an edit stays a one-line diff.
// These sort copies: in-memory order is left alone, since the UI reads db directly.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const byId = (rows) => [...rows].sort((a, b) => cmp(String(a.id), String(b.id)))
// completions have no id of their own — (daily_task_id, date) is their identity.
const byCompletion = (rows) => [...rows].sort((a, b) =>
  cmp(String(a.daily_task_id), String(b.daily_task_id)) || cmp(String(a.date), String(b.date)))
// NOTE: project subtasks (`p.tasks`) are deliberately left in insertion order —
// they're append-only, so already diff-stable, and not every render path sorts them.

export async function flushNow() {
  if (!_fs || !_bag) return
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  const fs = _fs, bag = _bag
  if (dirty.tasks) await fs.writeText(`${bag}/tasks.siddran`, JSON.stringify({ tasks: byId(db.tasks), dailies: byId(db.dailies), completions: byCompletion(db.completions), projects: byId(db.projects) }, null, 2))
  if (dirty.calendar) await fs.writeText(`${bag}/calendar.siddran`, JSON.stringify({ events: byId(db.events), schedules: byId(db.schedules) }, null, 2))
  if (dirty.settings) await fs.writeText(`${bag}/settings.siddran`, JSON.stringify({ settings: db.settings }, null, 2))
  if (dirty.notesTouched) await reconcileNotes(fs, bag)
  for (const id of dirty.sandboxes) {
    const sb = db.sandboxes.find((s) => s.id === id)
    if (sb) await fs.writeText(`${bag}/sandboxes/${id}.siddran`, JSON.stringify({ sandbox: sb, items: db.sandboxItems[id] || [] }, null, 2))
  }
  for (const id of dirty.rmSandbox) await fs.remove(`${bag}/sandboxes/${id}.siddran`)
  resetDirty()
}

function scheduleFlush() {
  if (!_fs) return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushTimer = null; flushNow().catch((e) => console.error('localStore flush failed', e)) }, FLUSH_MS)
}

// ── open / close ────────────────────────────────────────────────────
export async function openBagStore(fs, bagPath) {
  _fs = fs
  _bag = bagPath
  await fs.mkdirp(`${bagPath}/notes`)
  await fs.mkdirp(`${bagPath}/sandboxes`)
  await hydrate(fs, bagPath)
  resetDirty()
}
// Re-read the Bag from disk, discarding the in-memory picture of it.
//
// The app reads the folder once, at open, and owns it from then on — so a note
// renamed, edited or added by anything else (your file manager, a sync tool, a
// script) is invisible until this runs. Worse, the app would keep writing to the
// path it still believes in.
//
// flushNow() first, and it matters that it's a no-op when nothing is dirty: any
// edit you have just made is yours and newer, so it goes to disk before we read
// disk back. What this canNOT rescue is an outside rename that happened while
// edits were pending — reconcileNotes prunes files it doesn't recognise, so that
// flush deletes the renamed file. That is a pre-existing hazard of editing a Bag
// from two places at once; reloading does not add to it, but it does not undo it.
export async function reloadBagStore() {
  if (!_fs || !_bag) return false
  await flushNow()
  await hydrate(_fs, _bag)
  resetDirty()
  return true
}

export async function closeBagStore() {
  await flushNow()
  _fs = null; _bag = null; db = emptyDb()
}

// ── sync surface ────────────────────────────────────────────────────
// The syncable slice of the vault: tasks + calendar only. Notes are markdown on
// disk and out of scope; settings are device-local (window sizes, view prefs) and
// syncing them would fight between machines.
export function exportVault() {
  return {
    tasks: { tasks: db.tasks, dailies: db.dailies, completions: db.completions, projects: db.projects },
    calendar: { events: db.events, schedules: db.schedules },
  }
}

// Replace the syncable collections wholesale with a merged snapshot. Marks both
// files dirty; the caller flushes. Rows are trusted — merge already validated them.
export function importVault(snapshot) {
  if (!snapshot) return
  const t = snapshot.tasks || {}, c = snapshot.calendar || {}
  db.tasks = t.tasks || []
  db.dailies = t.dailies || []
  db.completions = t.completions || []
  db.projects = t.projects || []
  db.events = c.events || []
  db.schedules = c.schedules || []
  dirty.tasks = true
  dirty.calendar = true
}

// Raw vault-file access for the sync layer's base snapshot.
export async function readVaultFile(name) {
  if (!_fs || !_bag) return null
  const p = `${_bag}/${name}`
  if (!(await _fs.exists(p))) return null
  try { return JSON.parse(await _fs.readText(p)) } catch { return null }
}
export async function writeVaultFile(name, data) {
  if (!_fs || !_bag) return
  await _fs.writeText(`${_bag}/${name}`, JSON.stringify(data, null, 2))
}

// True while a Bag is open — authFetch routes here when so.
export const isOpen = () => !!_fs
export const getBagPath = () => _bag

// ── attachments ─────────────────────────────────────────────────────
// The editor tells us which note is active (set from App on note change) so
// pasted images land in a per-note folder: attachments/<Note title>/<file>.
let activeNoteId = null
export function setActiveNote(id) { activeNoteId = id }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('could not read attachment'))
    r.readAsDataURL(file)
  })
}
function attachmentName(file) {
  const short = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : String(Math.floor(performance.now()))
  let base = safeName(file.name || '').replace(/\s+/g, '-')
  if (!base || base === 'Untitled') {
    const ext = (file.type && file.type.split('/')[1]) || 'png'
    base = `pasted.${ext}`
  }
  return `${short}-${base}`
}

// Save a pasted/dropped image into the active note's attachments folder. Returns
// the Bag-relative path to embed in the markdown, or null if no Bag is open.
export async function saveAttachment(file) {
  if (!_fs || !_bag) return null
  const note = db.notes.find(n => String(n.id) === String(activeNoteId))
  const relDir = `attachments/${safeName(note?.title || 'Untitled')}`
  const filename = attachmentName(file)
  const b64 = await fileToBase64(file)
  await _fs.writeBytes(`${_bag}/${relDir}/${filename}`, b64)
  return `${relDir}/${filename}`
}

// ── request routing (mirrors the Ember/guestApi contract) ───────────
const res = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) })
const ok = (d) => res(200, d)
const created = (d) => res(201, d)
const notFound = () => res(404, { error: 'Not found' })
const pick = (o, keys) => keys.filter((k) => k in o).reduce((a, k) => (a[k] = o[k], a), {})
const touch = (r) => { r.updated_at = nowISO(); return r }
const paginate = (rows, key, q) => ({ [key]: rows, pagination: { hasNextPage: false, nextCursor: null, limit: Number(q.get('limit')) || 20 } })

const PRIO_W = { low: 1, normal: 2, high: 3 }
function bucketPriority(tasks) {
  const a = tasks.filter((t) => !t.is_completed)
  if (!a.length) return 'normal'
  const avg = a.reduce((s, t) => s + (PRIO_W[t.priority] || 2), 0) / a.length
  if (avg <= 1.2) return 'very_low'; if (avg <= 1.5) return 'quite_low'; if (avg <= 1.8) return 'low'
  if (avg <= 2.2) return 'normal'; if (avg <= 2.5) return 'high'; if (avg <= 2.8) return 'quite_high'; return 'very_high'
}

export async function localFetch(url, reqProps = {}) {
  let u
  try { u = new URL(url, (typeof window !== 'undefined' && window.location?.origin) || 'http://localhost') } catch { return res(400, { error: 'bad url' }) }
  const seg = u.pathname.split('/').filter(Boolean)
  const q = u.searchParams
  const method = (reqProps.method || 'GET').toUpperCase()
  let body = null
  if (reqProps.body && typeof reqProps.body === 'string') { try { body = JSON.parse(reqProps.body) } catch { body = null } }

  let out
  try {
    switch (seg[0]) {
      case 'notes': out = handleNotes(method, seg, q, body); break
      case 'notebooks': out = handleNotebooks(method, seg, q, body); break
      case 'tasks': out = handleTasks(method, seg, q, body); break
      case 'daily-tasks': out = handleDailies(method, seg, q, body); break
      case 'projects': out = handleProjects(method, seg, q, body); break
      case 'events': out = handleEvents(method, seg, q, body); break
      case 'schedules': out = handleSchedules(method, seg, q, body); break
      case 'sandboxes': out = handleSandboxes(method, seg, q, body); break
      case 'settings': out = handleSettings(method, seg, q, body); break
      default: console.warn('localStore: unhandled', method, u.pathname); return notFound()
    }
  } catch (e) { console.error('localStore handler threw', method, u.pathname, e); return res(500, { error: 'local store error' }) }
  if (method !== 'GET') scheduleFlush()
  return out
}

// notes / notebooks
function handleNotes(method, seg, q, body) {
  const id = parseId(seg[1])
  if (method === 'GET' && seg.length === 1) return ok(paginate(db.notes, 'notes', q))
  if (method === 'POST' && seg.length === 1) {
    const t = nowISO()
    const n = { id: nextId(), title: body?.title ?? 'Untitled', body: body?.body ?? '', is_favorite: false, color: null, tags: '', notebook_id: null, created_at: t, updated_at: t }
    db.notes.push(n); dirty.notesTouched = true; dirty.notes.add(n.id)
    return created(n)
  }
  if (seg.length === 2 && id != null) {
    const n = db.notes.find((x) => x.id === id)
    if (!n) return notFound()
    if (method === 'PUT') { Object.assign(n, pick(body || {}, ['title', 'body', 'is_favorite', 'color', 'tags', 'order'])); touch(n); dirty.notesTouched = true; dirty.notes.add(id); return ok(n) }
    if (method === 'DELETE') { db.notes = db.notes.filter((x) => x.id !== id); delete db.comments[id]; dirty.notesTouched = true; return ok({ message: 'deleted' }) }
  }
  // Per-note comment threads → sidecar `<note>.comments.json`.
  if (seg.length === 3 && seg[2] === 'comments' && id != null) {
    if (!db.notes.some((x) => x.id === id)) return notFound()
    if (method === 'GET') return ok({ threads: db.comments[id]?.threads || [] })
    if (method === 'PUT') {
      const threads = Array.isArray(body?.threads) ? body.threads : []
      if (threads.length) db.comments[id] = { threads }
      else delete db.comments[id]
      dirty.notesTouched = true; dirty.comments.add(id)
      return ok({ threads })
    }
  }
  return notFound()
}

const notebookRow = (nb) => ({ ...nb, note_count: db.notes.filter((n) => n.notebook_id === nb.id).length })
function handleNotebooks(method, seg, q, body) {
  if (method === 'GET' && seg[1] === 'notes-batch') {
    const ids = (q.get('ids') || '').split(',').map(Number).filter(Boolean)
    const notesByNotebook = {}
    for (const nbId of ids) notesByNotebook[nbId] = db.notes.filter((n) => n.notebook_id === nbId)
    return ok({ notesByNotebook })
  }
  if (method === 'GET' && seg.length === 1) return ok(paginate(db.notebooks.map(notebookRow), 'notebooks', q))
  if (method === 'POST' && seg.length === 1) {
    const t = nowISO()
    const nb = { id: nextId(), name: body?.name || 'Untitled', color: null, tags: body?.tags || '', is_favorite: false, created_at: t, updated_at: t }
    db.notebooks.push(nb)
    const ids = new Set((body?.noteIds || []).map(Number)); const updated = []
    for (const n of db.notes) if (ids.has(n.id)) { n.notebook_id = nb.id; touch(n); updated.push(n) }
    dirty.notesTouched = true; dirty.notebooks.add(nb.id); updated.forEach((n) => dirty.notes.add(n.id))
    return created({ notebook: notebookRow(nb), updatedNotes: updated })
  }
  const nbId = seg[1] != null ? Number(seg[1]) : null
  if (seg[2] === 'notes') {
    const nb = db.notebooks.find((x) => x.id === nbId)
    if (!nb) return notFound()
    if (method === 'POST' && seg.length === 3) {
      const ids = new Set((body?.noteIds || []).map(Number)); const updated = []
      for (const n of db.notes) if (ids.has(n.id)) { n.notebook_id = nb.id; touch(n); updated.push(n); dirty.notes.add(n.id) }
      dirty.notesTouched = true
      return ok({ updatedNotes: updated })
    }
    if (method === 'DELETE' && seg.length === 4) {
      const n = db.notes.find((x) => x.id === Number(seg[3]))
      if (n && n.notebook_id === nb.id) { n.notebook_id = null; touch(n); dirty.notes.add(n.id) }
      dirty.notesTouched = true
      return ok({ message: 'removed' })
    }
  }
  if (seg.length === 2 && nbId != null) {
    const nb = db.notebooks.find((x) => x.id === nbId)
    if (!nb) return notFound()
    if (method === 'PUT') {
      const renamed = 'name' in (body || {}) && body.name !== nb.name
      Object.assign(nb, pick(body || {}, ['name', 'color', 'tags', 'is_favorite', 'order'])); touch(nb)
      dirty.notesTouched = true; dirty.notebooks.add(nb.id)
      if (renamed) for (const n of db.notes) if (n.notebook_id === nb.id) dirty.notes.add(n.id) // folder moves
      return ok(nb)
    }
    if (method === 'DELETE') {
      db.notebooks = db.notebooks.filter((x) => x.id !== nbId)
      for (const n of db.notes) if (n.notebook_id === nbId) { n.notebook_id = null; dirty.notes.add(n.id) }
      dirty.notesTouched = true
      return ok({ message: 'deleted' })
    }
  }
  return notFound()
}

// tasks
function handleTasks(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) {
    if (q.get('picker')) return ok({ items: db.tasks.map((t) => ({ id: t.id, title: t.title })) })
    if (q.get('dated')) return ok({ tasks: db.tasks.filter((t) => t.due_date) })
    if (q.get('undated')) return ok({ tasks: db.tasks.filter((t) => !t.due_date && !t.is_completed) })
    if (q.get('dueFrom') || q.get('dueTo')) { const f = q.get('dueFrom'), to = q.get('dueTo'); return ok({ tasks: db.tasks.filter((t) => t.due_date && (!f || t.due_date >= f) && (!to || t.due_date <= to)) }) }
    return ok(paginate(db.tasks, 'tasks', q))
  }
  if (method === 'POST' && seg.length === 1) {
    const t = nowISO()
    const tk = { id: uuid(), title: body?.title ?? 'Untitled', description: body?.description ?? '', priority: body?.priority || 'normal', due_date: body?.due_date ?? null, is_completed: false, order: null, created_at: t, updated_at: t }
    db.tasks.push(tk); dirty.tasks = true; return created(tk)
  }
  const id = parseId(seg[1])
  if (seg.length === 2 && id != null) {
    const tk = db.tasks.find((x) => x.id === id)
    if (method === 'GET') return tk ? ok(tk) : notFound()
    if (!tk) return notFound()
    if (method === 'PUT') { Object.assign(tk, pick(body || {}, ['title', 'description', 'is_completed', 'priority', 'due_date', 'order'])); touch(tk); dirty.tasks = true; return ok(tk) }
    if (method === 'DELETE') { db.tasks = db.tasks.filter((x) => x.id !== id); dirty.tasks = true; return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// daily tasks
function handleDailies(method, seg, q, body) {
  if (seg[1] === 'completions' && method === 'GET') { const f = q.get('from'), to = q.get('to'); return ok({ completions: db.completions.filter((c) => (!f || c.date >= f) && (!to || c.date <= to)) }) }
  if (seg[1] === 'batch-complete' && method === 'PATCH') { const up = []; for (const { id, is_completed } of (body?.tasks || [])) { const d = db.dailies.find((x) => x.id === parseId(id)); if (d) { d.is_completed = !!is_completed; touch(d); up.push(d) } } dirty.tasks = true; return ok(up) }
  if (seg[1] === 'batch-delete' && method === 'DELETE') { const ids = new Set((body?.tasks || []).map((t) => parseId(t.id))); db.dailies = db.dailies.filter((d) => !ids.has(d.id)); dirty.tasks = true; return ok({ message: 'deleted' }) }
  if (method === 'GET' && seg.length === 1) {
    if (q.get('recurring')) return ok({ dailyTasks: db.dailies.filter((d) => d.recurrence != null) })
    if (q.get('picker')) return ok({ items: db.dailies.map((d) => ({ id: d.id, title: d.title })) })
    return ok(paginate(db.dailies, 'dailyTasks', q))
  }
  if (method === 'POST' && seg.length === 1) {
    const t = nowISO()
    const rows = (body?.tasks || []).map((s) => { const d = { id: uuid(), title: s.title || 'Untitled', priority: s.priority || 'normal', is_completed: false, created_at: t, updated_at: t, expires_at: s.recurrence != null ? null : eod(), recurrence: s.recurrence ?? null, time: s.time ?? null }; db.dailies.push(d); return d })
    dirty.tasks = true; return created(rows)
  }
  const id = parseId(seg[1])
  if (seg[2] === 'completions' && method === 'POST') { const date = body?.date, done = !!body?.done; db.completions = db.completions.filter((c) => !(c.daily_task_id === id && c.date === date)); if (done) db.completions.push({ daily_task_id: id, date }); dirty.tasks = true; return ok({ daily_task_id: id, date, done }) }
  if (seg.length === 2 && id != null) {
    const d = db.dailies.find((x) => x.id === id)
    if (method === 'GET') return d ? ok(d) : notFound()
    if (!d) return notFound()
    if (method === 'PUT') { Object.assign(d, pick(body || {}, ['title', 'priority', 'is_completed', 'recurrence', 'time'])); touch(d); dirty.tasks = true; return ok(d) }
    if (method === 'DELETE') { db.dailies = db.dailies.filter((x) => x.id !== id); dirty.tasks = true; return ok({ message: 'deleted' }) }
  }
  return notFound()
}
const eod = () => { const x = new Date(); x.setHours(23, 59, 59, 999); return x.toISOString() }

// projects
const projRow = (p) => pick(p, ['id', 'title', 'priority', 'is_completed', 'color', 'created_at', 'updated_at'])
function handleProjects(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) { if (q.get('picker')) return ok({ items: db.projects.map((p) => ({ id: p.id, title: p.title })) }); return ok(paginate(db.projects, 'projects', q)) }
  if (method === 'POST' && seg.length === 1) {
    const t = nowISO()
    const p = { id: uuid(), title: body?.title || 'Untitled', priority: 'normal', is_completed: false, color: body?.color || null, created_at: t, updated_at: t, tasks: [] }
    p.tasks = (body?.tasks || []).map((s) => ({ id: uuid(), project_id: p.id, title: s.title || 'Untitled', priority: s.priority || 'normal', is_completed: false, created_at: t, updated_at: t }))
    p.priority = bucketPriority(p.tasks); db.projects.push(p); dirty.tasks = true; return created(p)
  }
  const pid = parseId(seg[1])
  const p = db.projects.find((x) => x.id === pid)
  if (seg[2] === 'tasks') {
    if (!p) return notFound()
    const t = nowISO()
    if (method === 'POST' && seg.length === 3) { const add = (body?.tasks || []).map((s) => ({ id: uuid(), project_id: p.id, title: s.title || 'Untitled', priority: s.priority || 'normal', is_completed: false, created_at: t, updated_at: t })); p.tasks.push(...add); p.priority = bucketPriority(p.tasks); touch(p); dirty.tasks = true; return created({ id: p.id, title: p.title, priority: p.priority, is_completed: p.is_completed, updated_at: p.updated_at, tasks: p.tasks }) }
    if (method === 'PUT' && seg.length === 3) { for (const patch of (body?.tasks || [])) { const tk = p.tasks.find((x) => x.id === parseId(patch.id)); if (tk) { Object.assign(tk, pick(patch, ['title', 'priority', 'is_completed'])); touch(tk) } } p.priority = bucketPriority(p.tasks); touch(p); dirty.tasks = true; return ok({ ...projRow(p), allTasks: p.tasks }) }
    if (method === 'DELETE' && seg.length === 3) { const ids = new Set((body?.tasks || []).map((x) => parseId(x.id))); p.tasks = p.tasks.filter((x) => !ids.has(x.id)); p.priority = bucketPriority(p.tasks); touch(p); dirty.tasks = true; return ok({ message: 'deleted' }) }
    if (method === 'PUT' && seg.length === 4) { const tk = p.tasks.find((x) => x.id === parseId(seg[3])); if (!tk) return notFound(); tk.is_completed = !!body?.is_completed; touch(tk); p.priority = bucketPriority(p.tasks); dirty.tasks = true; return ok({ id: tk.id, title: tk.title, priority: tk.priority, is_completed: tk.is_completed, updated_at: tk.updated_at }) }
  }
  if (seg.length === 2 && pid != null) {
    if (method === 'GET') return p ? ok(p) : notFound()
    if (!p) return notFound()
    if (method === 'PUT') { Object.assign(p, pick(body || {}, ['title', 'color', 'is_completed'])); touch(p); dirty.tasks = true; return ok(projRow(p)) }
    if (method === 'DELETE') { db.projects = db.projects.filter((x) => x.id !== pid); dirty.tasks = true; return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// events
function handleEvents(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) { const f = q.get('from'), to = q.get('to'); return ok({ events: db.events.filter((e) => (!f || (e.end_at || e.start_at) >= f) && (!to || e.start_at <= to)) }) }
  if (method === 'POST' && seg.length === 1) { const t = nowISO(); const e = { id: uuid(), title: body?.title ?? '', description: body?.description ?? null, start_at: body?.start_at, end_at: body?.end_at ?? null, all_day: !!body?.all_day, color: body?.color ?? null, ref_type: body?.ref_type ?? null, ref_id: body?.ref_id ?? null, schedule_id: null, created_at: t, updated_at: t }; db.events.push(e); dirty.calendar = true; return created(e) }
  const id = parseId(seg[1])
  if (seg.length === 2 && id != null) {
    const e = db.events.find((x) => x.id === id)
    if (!e) return notFound()
    if (method === 'PUT') { Object.assign(e, pick(body || {}, ['title', 'description', 'start_at', 'end_at', 'all_day', 'color', 'ref_type', 'ref_id'])); if (body && body.ref_type === null) e.ref_id = null; touch(e); dirty.calendar = true; return ok(e) }
    if (method === 'DELETE') { db.events = db.events.filter((x) => x.id !== id); dirty.calendar = true; return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// schedules
const scheduleListRow = (s) => ({ id: s.id, name: s.name, color: s.color, template: s.template, created_at: s.created_at, block_count: db.events.filter((e) => e.schedule_id === s.id).length })
function makeScheduleEvents(sid, events) { const t = nowISO(); return (events || []).map((b) => ({ id: uuid(), title: b.title ?? '', description: b.description ?? null, start_at: b.start_at, end_at: b.end_at ?? null, all_day: !!b.all_day, color: b.color ?? null, ref_type: b.ref_type ?? null, ref_id: b.ref_id ?? null, schedule_id: sid, created_at: t, updated_at: t })) }
function handleSchedules(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ schedules: db.schedules.map(scheduleListRow) })
  if (method === 'POST' && seg.length === 1) { const s = { id: uuid(), name: body?.name || 'Schedule', color: body?.color ?? null, template: body?.template ?? null, created_at: nowISO() }; db.schedules.push(s); const evs = makeScheduleEvents(s.id, body?.events); db.events.push(...evs); dirty.calendar = true; return created({ schedule: scheduleListRow(s), events: evs }) }
  const id = parseId(seg[1])
  if (seg[2] === 'restamp' && method === 'PUT' && id != null) { const s = db.schedules.find((x) => x.id === id); if (!s) return notFound(); Object.assign(s, pick(body || {}, ['name', 'color', 'template'])); db.events = db.events.filter((e) => e.schedule_id !== id); const evs = makeScheduleEvents(id, body?.events); db.events.push(...evs); dirty.calendar = true; return ok({ schedule: scheduleListRow(s), events: evs }) }
  if (seg.length === 2 && id != null) {
    const s = db.schedules.find((x) => x.id === id)
    if (!s) return notFound()
    if (method === 'PUT') { Object.assign(s, pick(body || {}, ['name', 'color'])); if (body && 'color' in body) for (const e of db.events) if (e.schedule_id === id) e.color = body.color; dirty.calendar = true; return ok({ schedule: { id: s.id, name: s.name, color: s.color, created_at: s.created_at } }) }
    if (method === 'DELETE') { db.schedules = db.schedules.filter((x) => x.id !== id); db.events = db.events.filter((e) => e.schedule_id !== id); dirty.calendar = true; return ok({ message: 'deleted', id }) }
  }
  return notFound()
}

// sandboxes
function handleSandboxes(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ sandboxes: [...db.sandboxes].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')) })
  if (method === 'POST' && seg.length === 1) { const bid = body?.id || uuid(); let board = db.sandboxes.find((s) => s.id === bid); if (board) return ok(board); const t = nowISO(); board = { id: bid, title: body?.title || 'Untitled Sandbox', item_count: 0, created_at: t, updated_at: t }; db.sandboxes.push(board); db.sandboxItems[bid] = []; dirty.sandboxes.add(bid); return created(board) }
  const bid = seg[1]
  const board = db.sandboxes.find((s) => s.id === bid)
  if (seg[2] === 'items' && seg[3] === 'batch' && method === 'POST') {
    if (!board) return notFound()
    const items = db.sandboxItems[bid] || (db.sandboxItems[bid] = [])
    const byId = new Map(items.map((it) => [it.id, it])); const t = nowISO()
    for (const up of (body?.upserts || [])) { const ex = byId.get(up.id); if (ex) Object.assign(ex, up, { updated_at: t }); else byId.set(up.id, { rotation: 0, z_index: 0, payload: {}, ...up, created_at: t, updated_at: t }) }
    for (const del of (body?.deletes || [])) byId.delete(del)
    db.sandboxItems[bid] = [...byId.values()]; board.item_count = db.sandboxItems[bid].length; board.updated_at = t; dirty.sandboxes.add(bid)
    return ok({ item_count: board.item_count, updated_at: t })
  }
  if (seg.length === 2 && bid) {
    if (method === 'GET') return board ? ok({ sandbox: board, items: db.sandboxItems[bid] || [] }) : notFound()
    if (!board) return notFound()
    if (method === 'PUT') { board.title = body?.title ?? board.title; board.updated_at = nowISO(); dirty.sandboxes.add(bid); return ok(board) }
    if (method === 'DELETE') { db.sandboxes = db.sandboxes.filter((s) => s.id !== bid); delete db.sandboxItems[bid]; dirty.rmSandbox.add(bid); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// settings
function handleSettings(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ settings: db.settings })
  if (method === 'PUT' && seg.length === 1) { db.settings = body?.settings || {}; dirty.settings = true; return ok({ settings: db.settings }) }
  return notFound()
}
