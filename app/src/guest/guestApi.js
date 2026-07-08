// In-memory mock of the Ember backend for guest ("try it free") demo mode.
//
// authFetch routes here instead of to the network when a guest is active, so
// every notes/tasks/calendar/sandbox/settings request the app makes is served
// from a plain JavaScript object that lives only in this tab's heap. Nothing is
// persisted anywhere — a refresh reloads this module, reseeds, and the guest is
// dropped back to the login page with a clean slate.
//
// The contract here must match what the real hooks expect (response wrapping,
// bare-array vs wrapped, row field names). See the endpoint list at each
// section. This is not a real server: pagination is a no-op (seed data is small,
// so every list returns in full with hasNextPage:false), and auth/uploads are
// never reached because guests bypass login and image uploads short-circuit to
// data URLs upstream.

// ── id + time helpers ──────────────────────────────────────────────
let seq = 1000
const nextId = () => ++seq
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${nextId()}-${Date.now()}`)
const now = () => new Date().toISOString()

// Today-relative timestamp so seeded calendar blocks always land in the visible week.
const at = (dayOffset, h, m = 0) => {
  const x = new Date()
  x.setDate(x.getDate() + dayOffset)
  x.setHours(h, m, 0, 0)
  return x.toISOString()
}
const endOfToday = () => { const x = new Date(); x.setHours(23, 59, 59, 999); return x.toISOString() }

// ── the in-memory database ─────────────────────────────────────────
let db

function seed() {
  db = {
    notes: [],
    notebooks: [],
    tasks: [],
    dailies: [],
    completions: [],       // { daily_task_id, date }
    projects: [],          // each: { ...row, tasks: [] }
    events: [],
    schedules: [],
    sandboxes: [],
    sandboxItems: {},      // boardId -> [item]
    settings: {},
  }

  // ── a friendly "welcome tour" set ─────────────────────────────────
  const t = now()
  const note = (title, body, extra = {}) => {
    const n = { id: nextId(), title, body, is_favorite: false, color: null, tags: '', notebook_id: null, created_at: t, updated_at: t, ...extra }
    db.notes.push(n)
    return n
  }

  const welcome = note(
    '👋 Welcome to the Cinder demo',
    [
      "You're in **demo mode** — poke around freely. Nothing here is saved, and the",
      "moment you refresh the page everything resets to zero. No account, no",
      "install, no data collected.",
      '',
      '### What to try',
      '- Open the **note editor** and type some `**markdown**` — it live-previews as you go',
      '- Switch a note to **reading view** to see it rendered',
      '- Create a **task** or a recurring **daily** over in Tasks',
      '- Press **Ctrl/Cmd + ;** to peek the **Calendar**, then drag blocks around',
      '- Scribble on a **Sandbox** board',
      '',
      "> When you're ready to keep your work, hit **Sign up** in the banner up top.",
    ].join('\n'),
    { is_favorite: true },
  )
  const mdNote = note(
    '✍️ Markdown cheatsheet',
    [
      '# Headings with `#`',
      '',
      'Inline **bold**, *italic*, ~~strikethrough~~, <u>underline</u>, and `code`.',
      '',
      '- bullet lists',
      '- [ ] task checkboxes',
      '- [x] that you can tick',
      '',
      '1. numbered too',
      '2. and so on',
      '',
      '```js',
      "console.log('fenced code blocks')",
      '```',
      '',
      'Escape a character with a backslash: \\*not italic\\*.',
    ].join('\n'),
    { tags: 'guide' },
  )
  const ideasNote = note('💡 A note in a notebook', 'Notes can be grouped into notebooks. This one lives in **Getting Started**.', { tags: 'demo' })

  // A notebook grouping a couple of the notes.
  // `welcome` stays a standalone favorite so it's the first thing a visitor sees;
  // the notebook groups the cheatsheet + a demo note to show off notebooks.
  const nb = { id: nextId(), name: 'Getting Started', color: null, tags: 'demo', is_favorite: false, created_at: t, updated_at: t }
  db.notebooks.push(nb)
  mdNote.notebook_id = nb.id
  ideasNote.notebook_id = nb.id
  void welcome

  // Tasks — a mix of priorities, one done, some dated so they show on the calendar.
  const task = (title, priority, opts = {}) => {
    const tk = { id: nextId(), title, description: opts.description || '', priority, due_date: opts.due_date || null, is_completed: !!opts.is_completed, created_at: t, updated_at: t }
    db.tasks.push(tk)
    return tk
  }
  task('Explore the note editor', 'high', { due_date: at(0, 17) })
  task('Drag a block on the calendar', 'normal', { due_date: at(2, 12) })
  task('Read the markdown cheatsheet', 'low')
  task('Signed up? (you did it!)', 'normal', { is_completed: true })

  // Dailies — one recurring (shows on the calendar every day) + one ephemeral "today".
  db.dailies.push({ id: nextId(), title: 'Take a mindful breath', priority: 'normal', is_completed: false, created_at: t, updated_at: t, expires_at: null, recurrence: 'every-day', time: '09:00' })
  db.dailies.push({ id: nextId(), title: "Try today's-tasks list", priority: 'low', is_completed: false, created_at: t, updated_at: t, expires_at: endOfToday(), recurrence: null, time: null })

  // A project / bundle.
  const proj = { id: nextId(), title: 'Ship the demo', priority: 'normal', is_completed: false, color: '#5a9cf0', created_at: t, updated_at: t, tasks: [] }
  const ptask = (title, priority, done = false) => proj.tasks.push({ id: nextId(), project_id: proj.id, title, priority, is_completed: done, created_at: t, updated_at: t })
  ptask('Sketch the idea', 'normal', true)
  ptask('Build it', 'high')
  ptask('Show a friend', 'low')
  proj.priority = bucketPriority(proj.tasks)
  db.projects.push(proj)

  // Calendar blocks this week.
  const ev = (title, start_at, end_at, extra = {}) => db.events.push({ id: nextId(), title, description: extra.description || null, start_at, end_at: end_at || null, all_day: !!extra.all_day, color: extra.color || null, ref_type: null, ref_id: null, schedule_id: null, created_at: t, updated_at: t })
  ev('🎉 You are in demo mode', at(0, 0), null, { all_day: true, color: '#52c47a' })
  ev('Explore the Calendar', at(0, 14), at(0, 15), { description: 'Drag me to another time.' })
  ev('Plan-mode demo', at(1, 10), at(1, 11, 30), { color: '#f0b840' })

  // An empty sandbox board to draw on.
  const boardId = uuid()
  db.sandboxes.push({ id: boardId, title: 'Doodle here', item_count: 0, created_at: t, updated_at: t })
  db.sandboxItems[boardId] = []
}

const PRIO_W = { low: 1, normal: 2, high: 3 }
function bucketPriority(tasks) {
  const active = tasks.filter(t => !t.is_completed)
  if (!active.length) return 'normal'
  const avg = active.reduce((s, t) => s + (PRIO_W[t.priority] || 2), 0) / active.length
  if (avg <= 1.2) return 'very_low'
  if (avg <= 1.5) return 'quite_low'
  if (avg <= 1.8) return 'low'
  if (avg <= 2.2) return 'normal'
  if (avg <= 2.5) return 'high'
  if (avg <= 2.8) return 'quite_high'
  return 'very_high'
}

seed()
export function resetGuestData() { seed() }

// ── response + routing plumbing ─────────────────────────────────────
const res = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
})
const ok = (data) => res(200, data)
const created = (data) => res(201, data)
const notFound = () => res(404, { error: 'Not found' })

const paginate = (rows, key, q) => ({ [key]: rows, pagination: { hasNextPage: false, nextCursor: null, limit: Number(q.get('limit')) || 20 } })
const pick = (obj, keys) => keys.filter(k => k in obj).reduce((o, k) => (o[k] = obj[k], o), {})
const touch = (row) => { row.updated_at = now(); return row }

/**
 * Serve a request from the in-memory db. Returns a fetch-Response-like object.
 * @param {string} url   full URL (e.g. `${API}/notes?limit=20`)
 * @param {object} reqProps  { method, body } as passed to fetch/authFetch
 */
export async function guestFetch(url, reqProps = {}) {
  let u
  try { u = new URL(url, (typeof window !== 'undefined' && window.location?.origin) || 'http://localhost') }
  catch { return res(400, { error: 'bad url' }) }

  const seg = u.pathname.split('/').filter(Boolean)
  const q = u.searchParams
  const method = (reqProps.method || 'GET').toUpperCase()
  let body = null
  if (reqProps.body && typeof reqProps.body === 'string') {
    try { body = JSON.parse(reqProps.body) } catch { body = null }
  }

  try {
    switch (seg[0]) {
      case 'notes':      return handleNotes(method, seg, q, body)
      case 'notebooks':  return handleNotebooks(method, seg, q, body)
      case 'tasks':      return handleTasks(method, seg, q, body)
      case 'daily-tasks': return handleDailies(method, seg, q, body)
      case 'projects':   return handleProjects(method, seg, q, body)
      case 'events':     return handleEvents(method, seg, q, body)
      case 'schedules':  return handleSchedules(method, seg, q, body)
      case 'sandboxes':  return handleSandboxes(method, seg, q, body)
      case 'settings':   return handleSettings(method, seg, q, body)
      default:
        console.warn('guestApi: unhandled route', method, u.pathname)
        return notFound()
    }
  } catch (err) {
    console.error('guestApi: handler threw', method, u.pathname, err)
    return res(500, { error: 'guest mock error' })
  }
}

// ── notes / notebooks ───────────────────────────────────────────────
function handleNotes(method, seg, q, body) {
  const id = seg[1] != null ? Number(seg[1]) : null
  if (method === 'GET' && seg.length === 1) return ok(paginate(db.notes, 'notes', q))
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const n = { id: nextId(), title: body?.title ?? 'Untitled', body: body?.body ?? '', is_favorite: false, color: null, tags: '', notebook_id: null, created_at: t, updated_at: t }
    db.notes.push(n)
    return created(n)
  }
  if (seg.length === 2 && id != null) {
    const n = db.notes.find(x => x.id === id)
    if (!n) return notFound()
    if (method === 'PUT') { Object.assign(n, pick(body || {}, ['title', 'body', 'is_favorite', 'color', 'tags'])); return ok(touch(n)) }
    if (method === 'DELETE') { db.notes = db.notes.filter(x => x.id !== id); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

function notebookRow(nb) {
  return { ...nb, note_count: db.notes.filter(n => n.notebook_id === nb.id).length }
}

function handleNotebooks(method, seg, q, body) {
  // GET /notebooks/notes-batch?ids=1,2,3
  if (method === 'GET' && seg[1] === 'notes-batch') {
    const ids = (q.get('ids') || '').split(',').map(Number).filter(Boolean)
    const notesByNotebook = {}
    for (const nbId of ids) notesByNotebook[nbId] = db.notes.filter(n => n.notebook_id === nbId)
    return ok({ notesByNotebook })
  }
  if (method === 'GET' && seg.length === 1) return ok(paginate(db.notebooks.map(notebookRow), 'notebooks', q))
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const nb = { id: nextId(), name: body?.name || 'Untitled', color: null, tags: body?.tags || '', is_favorite: false, created_at: t, updated_at: t }
    db.notebooks.push(nb)
    const noteIds = new Set((body?.noteIds || []).map(Number))
    const updatedNotes = []
    for (const n of db.notes) if (noteIds.has(n.id)) { n.notebook_id = nb.id; touch(n); updatedNotes.push(n) }
    return created({ notebook: notebookRow(nb), updatedNotes })
  }

  const nbId = seg[1] != null ? Number(seg[1]) : null
  // /notebooks/:id/notes  (POST add)  and  /notebooks/:id/notes/:noteId (DELETE remove)
  if (seg[2] === 'notes') {
    const nb = db.notebooks.find(x => x.id === nbId)
    if (!nb) return notFound()
    if (method === 'POST' && seg.length === 3) {
      const noteIds = new Set((body?.noteIds || []).map(Number))
      const updatedNotes = []
      for (const n of db.notes) if (noteIds.has(n.id)) { n.notebook_id = nb.id; touch(n); updatedNotes.push(n) }
      return ok({ updatedNotes })
    }
    if (method === 'DELETE' && seg.length === 4) {
      const noteId = Number(seg[3])
      const n = db.notes.find(x => x.id === noteId)
      if (n && n.notebook_id === nb.id) { n.notebook_id = null; touch(n) }
      return ok({ message: 'removed' })
    }
  }

  if (seg.length === 2 && nbId != null) {
    const nb = db.notebooks.find(x => x.id === nbId)
    if (!nb) return notFound()
    if (method === 'PUT') { Object.assign(nb, pick(body || {}, ['name', 'color', 'tags', 'is_favorite'])); return ok(touch(nb)) }
    if (method === 'DELETE') {
      db.notebooks = db.notebooks.filter(x => x.id !== nbId)
      for (const n of db.notes) if (n.notebook_id === nbId) n.notebook_id = null
      return ok({ message: 'deleted' })
    }
  }
  return notFound()
}

// ── tasks ───────────────────────────────────────────────────────────
function handleTasks(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) {
    if (q.get('picker')) return ok({ items: db.tasks.map(t => ({ id: t.id, title: t.title })) })
    if (q.get('dated')) return ok({ tasks: db.tasks.filter(t => t.due_date) })
    if (q.get('undated')) return ok({ tasks: db.tasks.filter(t => !t.due_date && !t.is_completed) })
    if (q.get('dueFrom') || q.get('dueTo')) {
      const from = q.get('dueFrom'), to = q.get('dueTo')
      return ok({ tasks: db.tasks.filter(t => t.due_date && (!from || t.due_date >= from) && (!to || t.due_date <= to)) })
    }
    return ok(paginate(db.tasks, 'tasks', q))
  }
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const tk = { id: nextId(), title: body?.title ?? 'Untitled', description: body?.description ?? '', priority: body?.priority || 'normal', due_date: body?.due_date ?? null, is_completed: false, created_at: t, updated_at: t }
    db.tasks.push(tk)
    return created(tk)
  }
  const id = seg[1] != null ? Number(seg[1]) : null
  if (seg.length === 2 && id != null) {
    const tk = db.tasks.find(x => x.id === id)
    if (method === 'GET') return tk ? ok(tk) : notFound()
    if (!tk) return notFound()
    if (method === 'PUT') { Object.assign(tk, pick(body || {}, ['title', 'description', 'is_completed', 'priority', 'due_date'])); return ok(touch(tk)) }
    if (method === 'DELETE') { db.tasks = db.tasks.filter(x => x.id !== id); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// ── daily tasks ─────────────────────────────────────────────────────
function handleDailies(method, seg, q, body) {
  if (seg[1] === 'completions' && method === 'GET') {
    const from = q.get('from'), to = q.get('to')
    const rows = db.completions.filter(c => (!from || c.date >= from) && (!to || c.date <= to))
    return ok({ completions: rows })
  }
  if (seg[1] === 'batch-complete' && method === 'PATCH') {
    const updated = []
    for (const { id, is_completed } of (body?.tasks || [])) {
      const d = db.dailies.find(x => x.id === Number(id))
      if (d) { d.is_completed = !!is_completed; touch(d); updated.push(d) }
    }
    return ok(updated)
  }
  if (seg[1] === 'batch-delete' && method === 'DELETE') {
    const ids = new Set((body?.tasks || []).map(t => Number(t.id)))
    db.dailies = db.dailies.filter(d => !ids.has(d.id))
    return ok({ message: 'deleted' })
  }
  if (method === 'GET' && seg.length === 1) {
    if (q.get('recurring')) return ok({ dailyTasks: db.dailies.filter(d => d.recurrence != null) })
    if (q.get('picker')) return ok({ items: db.dailies.map(d => ({ id: d.id, title: d.title })) })
    return ok(paginate(db.dailies, 'dailyTasks', q))
  }
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const rows = (body?.tasks || []).map(spec => {
      const d = { id: nextId(), title: spec.title || 'Untitled', priority: spec.priority || 'normal', is_completed: false, created_at: t, updated_at: t, expires_at: spec.recurrence != null ? null : endOfToday(), recurrence: spec.recurrence ?? null, time: spec.time ?? null }
      db.dailies.push(d)
      return d
    })
    return created(rows)
  }
  // /daily-tasks/:id/completions  (POST toggle)  and  /daily-tasks/:id (GET/PUT/DELETE)
  const id = seg[1] != null ? Number(seg[1]) : null
  if (seg[2] === 'completions' && method === 'POST') {
    const date = body?.date, done = !!body?.done
    db.completions = db.completions.filter(c => !(c.daily_task_id === id && c.date === date))
    if (done) db.completions.push({ daily_task_id: id, date })
    return ok({ daily_task_id: id, date, done })
  }
  if (seg.length === 2 && id != null) {
    const d = db.dailies.find(x => x.id === id)
    if (method === 'GET') return d ? ok(d) : notFound()
    if (!d) return notFound()
    if (method === 'PUT') { Object.assign(d, pick(body || {}, ['title', 'priority', 'is_completed', 'recurrence', 'time'])); return ok(touch(d)) }
    if (method === 'DELETE') { db.dailies = db.dailies.filter(x => x.id !== id); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// ── projects / bundles ──────────────────────────────────────────────
const projRow = (p) => pick(p, ['id', 'title', 'priority', 'is_completed', 'color', 'created_at', 'updated_at'])
function handleProjects(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) {
    if (q.get('picker')) return ok({ items: db.projects.map(p => ({ id: p.id, title: p.title })) })
    return ok(paginate(db.projects, 'projects', q))
  }
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const p = { id: nextId(), title: body?.title || 'Untitled', priority: 'normal', is_completed: false, color: body?.color || null, created_at: t, updated_at: t, tasks: [] }
    p.tasks = (body?.tasks || []).map(spec => ({ id: nextId(), project_id: p.id, title: spec.title || 'Untitled', priority: spec.priority || 'normal', is_completed: false, created_at: t, updated_at: t }))
    p.priority = bucketPriority(p.tasks)
    db.projects.push(p)
    return created(p)
  }
  const pid = seg[1] != null ? Number(seg[1]) : null
  const p = db.projects.find(x => x.id === pid)

  // /projects/:pid/tasks  and  /projects/:pid/tasks/:tid
  if (seg[2] === 'tasks') {
    if (!p) return notFound()
    const t = now()
    if (method === 'POST' && seg.length === 3) {
      const added = (body?.tasks || []).map(spec => ({ id: nextId(), project_id: p.id, title: spec.title || 'Untitled', priority: spec.priority || 'normal', is_completed: false, created_at: t, updated_at: t }))
      p.tasks.push(...added)
      p.priority = bucketPriority(p.tasks)
      touch(p)
      return created({ id: p.id, title: p.title, priority: p.priority, is_completed: p.is_completed, updated_at: p.updated_at, tasks: p.tasks })
    }
    if (method === 'PUT' && seg.length === 3) {
      for (const patch of (body?.tasks || [])) {
        const tk = p.tasks.find(x => x.id === Number(patch.id))
        if (tk) { Object.assign(tk, pick(patch, ['title', 'priority', 'is_completed'])); touch(tk) }
      }
      p.priority = bucketPriority(p.tasks)
      touch(p)
      return ok({ ...projRow(p), allTasks: p.tasks })
    }
    if (method === 'DELETE' && seg.length === 3) {
      const ids = new Set((body?.tasks || []).map(x => Number(x.id)))
      p.tasks = p.tasks.filter(x => !ids.has(x.id))
      p.priority = bucketPriority(p.tasks)
      touch(p)
      return ok({ message: 'deleted' })
    }
    if (method === 'PUT' && seg.length === 4) {
      const tid = Number(seg[3])
      const tk = p.tasks.find(x => x.id === tid)
      if (!tk) return notFound()
      tk.is_completed = !!body?.is_completed
      touch(tk)
      p.priority = bucketPriority(p.tasks)
      return ok({ id: tk.id, title: tk.title, priority: tk.priority, is_completed: tk.is_completed, updated_at: tk.updated_at })
    }
  }

  if (seg.length === 2 && pid != null) {
    if (method === 'GET') return p ? ok(p) : notFound()
    if (!p) return notFound()
    if (method === 'PUT') { Object.assign(p, pick(body || {}, ['title', 'color', 'is_completed'])); touch(p); return ok(projRow(p)) }
    if (method === 'DELETE') { db.projects = db.projects.filter(x => x.id !== pid); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// ── calendar events ─────────────────────────────────────────────────
function handleEvents(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) {
    const from = q.get('from'), to = q.get('to')
    const rows = db.events.filter(e => (!from || (e.end_at || e.start_at) >= from) && (!to || e.start_at <= to))
    return ok({ events: rows })
  }
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const e = { id: nextId(), title: body?.title ?? '', description: body?.description ?? null, start_at: body?.start_at, end_at: body?.end_at ?? null, all_day: !!body?.all_day, color: body?.color ?? null, ref_type: body?.ref_type ?? null, ref_id: body?.ref_id ?? null, schedule_id: null, created_at: t, updated_at: t }
    db.events.push(e)
    return created(e)
  }
  const id = seg[1] != null ? Number(seg[1]) : null
  if (seg.length === 2 && id != null) {
    const e = db.events.find(x => x.id === id)
    if (!e) return notFound()
    if (method === 'PUT') {
      Object.assign(e, pick(body || {}, ['title', 'description', 'start_at', 'end_at', 'all_day', 'color', 'ref_type', 'ref_id']))
      if (body && body.ref_type === null) e.ref_id = null
      return ok(touch(e))
    }
    if (method === 'DELETE') { db.events = db.events.filter(x => x.id !== id); return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// ── schedules ───────────────────────────────────────────────────────
const scheduleListRow = (s) => ({ id: s.id, name: s.name, color: s.color, template: s.template, created_at: s.created_at, block_count: db.events.filter(e => e.schedule_id === s.id).length })
function makeScheduleEvents(scheduleId, events) {
  const t = now()
  return (events || []).map(b => ({ id: nextId(), title: b.title ?? '', description: b.description ?? null, start_at: b.start_at, end_at: b.end_at ?? null, all_day: !!b.all_day, color: b.color ?? null, ref_type: b.ref_type ?? null, ref_id: b.ref_id ?? null, schedule_id: scheduleId, created_at: t, updated_at: t }))
}
function handleSchedules(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ schedules: db.schedules.map(scheduleListRow) })
  if (method === 'POST' && seg.length === 1) {
    const t = now()
    const s = { id: nextId(), name: body?.name || 'Schedule', color: body?.color ?? null, template: body?.template ?? null, created_at: t }
    db.schedules.push(s)
    const evs = makeScheduleEvents(s.id, body?.events)
    db.events.push(...evs)
    return created({ schedule: scheduleListRow(s), events: evs })
  }
  const id = seg[1] != null ? Number(seg[1]) : null
  if (seg[2] === 'restamp' && method === 'PUT' && id != null) {
    const s = db.schedules.find(x => x.id === id)
    if (!s) return notFound()
    Object.assign(s, pick(body || {}, ['name', 'color', 'template']))
    db.events = db.events.filter(e => e.schedule_id !== id)  // replace all blocks
    const evs = makeScheduleEvents(id, body?.events)
    db.events.push(...evs)
    return ok({ schedule: scheduleListRow(s), events: evs })
  }
  if (seg.length === 2 && id != null) {
    const s = db.schedules.find(x => x.id === id)
    if (!s) return notFound()
    if (method === 'PUT') {
      Object.assign(s, pick(body || {}, ['name', 'color']))
      if (body && 'color' in body) for (const e of db.events) if (e.schedule_id === id) e.color = body.color
      return ok({ schedule: { id: s.id, name: s.name, color: s.color, created_at: s.created_at } })
    }
    if (method === 'DELETE') {
      db.schedules = db.schedules.filter(x => x.id !== id)
      db.events = db.events.filter(e => e.schedule_id !== id)
      return ok({ message: 'deleted', id })
    }
  }
  return notFound()
}

// ── sandboxes ───────────────────────────────────────────────────────
function handleSandboxes(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ sandboxes: [...db.sandboxes].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')) })
  if (method === 'POST' && seg.length === 1) {
    const bid = body?.id || uuid()
    let board = db.sandboxes.find(s => s.id === bid)
    if (board) return ok(board)  // idempotent
    const t = now()
    board = { id: bid, title: body?.title || 'Untitled Sandbox', item_count: 0, created_at: t, updated_at: t }
    db.sandboxes.push(board)
    db.sandboxItems[bid] = []
    return created(board)
  }
  const bid = seg[1]
  const board = db.sandboxes.find(s => s.id === bid)
  // /sandboxes/:id/items/batch
  if (seg[2] === 'items' && seg[3] === 'batch' && method === 'POST') {
    if (!board) return notFound()
    const items = db.sandboxItems[bid] || (db.sandboxItems[bid] = [])
    const byId = new Map(items.map(it => [it.id, it]))
    const t = now()
    for (const up of (body?.upserts || [])) {
      const existing = byId.get(up.id)
      if (existing) Object.assign(existing, up, { updated_at: t })
      else { const it = { rotation: 0, z_index: 0, payload: {}, ...up, created_at: t, updated_at: t }; byId.set(up.id, it) }
    }
    for (const delId of (body?.deletes || [])) byId.delete(delId)
    db.sandboxItems[bid] = Array.from(byId.values())
    board.item_count = db.sandboxItems[bid].length
    board.updated_at = t
    return ok({ item_count: board.item_count, updated_at: t })
  }
  if (seg.length === 2 && bid) {
    if (method === 'GET') return board ? ok({ sandbox: board, items: db.sandboxItems[bid] || [] }) : notFound()
    if (!board) return notFound()
    if (method === 'PUT') { board.title = body?.title ?? board.title; board.updated_at = now(); return ok(board) }
    if (method === 'DELETE') { db.sandboxes = db.sandboxes.filter(s => s.id !== bid); delete db.sandboxItems[bid]; return ok({ message: 'deleted' }) }
  }
  return notFound()
}

// ── settings ────────────────────────────────────────────────────────
function handleSettings(method, seg, q, body) {
  if (method === 'GET' && seg.length === 1) return ok({ settings: db.settings })
  if (method === 'PUT' && seg.length === 1) { db.settings = body?.settings || {}; return ok({ settings: db.settings }) }
  return notFound()
}
