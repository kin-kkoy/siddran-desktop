// Push/pull against the sync Worker. Explicit — never runs on a timer, never sits
// in the path of a tap. Design: ../../../../references/sync-design.md
//
// fetchImpl is injectable so the whole flow can be tested against a fake server.

import { mergeVault } from './merge.js'
import { exportVault, importVault, flushNow, readVaultFile, writeVaultFile, isOpen } from '../localStore.js'

// The last successfully-synced snapshot. Lives in the Bag so it travels with the
// vault; without it a delete is indistinguishable from a row we've never seen.
export const BASE_FILE = '.siddran-sync-base.json'

const EMPTY = {
  tasks: { tasks: [], dailies: [], completions: [], projects: [] },
  calendar: { events: [], schedules: [] },
}

export class SyncError extends Error {
  constructor(code, message) { super(message); this.name = 'SyncError'; this.code = code }
}

const trimSlash = (s) => String(s || '').replace(/\/+$/, '')

async function getRemote(endpoint, token, fetchImpl) {
  const res = await fetchImpl(`${trimSlash(endpoint)}/v1/vault`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return { remote: null, etag: null }   // never pushed
  if (res.status === 401) throw new SyncError('unauthorized', 'Sync token rejected')
  if (!res.ok) throw new SyncError('server', `Pull failed (${res.status})`)
  return { remote: await res.json(), etag: res.headers.get('etag') }
}

async function putRemote(endpoint, token, snapshot, etag, fetchImpl) {
  const res = await fetchImpl(`${trimSlash(endpoint)}/v1/vault`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // '*' means "I believe nothing is there yet"; the server 412s if that's wrong.
      'if-match': etag || '*',
    },
    body: JSON.stringify(snapshot),
  })
  if (res.status === 412) return { ok: false }
  if (res.status === 401) throw new SyncError('unauthorized', 'Sync token rejected')
  if (!res.ok) throw new SyncError('server', `Push failed (${res.status})`)
  return { ok: true }
}

/**
 * Pull, merge, write locally, push. Safe to re-run: merge is idempotent.
 * @returns {Promise<{conflicts: any[], firstPush: boolean, attempts: number}>}
 */
export async function syncNow({ endpoint, token, fetchImpl, maxAttempts = 4 } = {}) {
  if (!isOpen()) throw new SyncError('no-bag', 'No Bag is open')
  if (!endpoint || !token) throw new SyncError('not-configured', 'Sync endpoint and token are required')
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) throw new SyncError('no-fetch', 'No fetch implementation available')

  // base and local are captured once and held fixed across retries — a 412 means
  // the remote moved, not that our side did.
  const base = (await readVaultFile(BASE_FILE)) || null
  const local = exportVault()

  let attempts = 0
  let merged = null
  let firstPush = false
  let conflicts = []

  while (attempts < maxAttempts) {
    attempts++
    const { remote, etag } = await getRemote(endpoint, token, doFetch)
    firstPush = remote === null

    const result = mergeVault(base || EMPTY, local, remote || EMPTY)
    merged = result.merged
    conflicts = result.conflicts

    const put = await putRemote(endpoint, token, merged, etag, doFetch)
    if (put.ok) {
      // Only commit locally once the server has accepted — otherwise a failed push
      // would leave base ahead of what's actually stored, and the next sync would
      // read our own un-pushed deletions as remote deletions.
      importVault(merged)
      await flushNow()
      await writeVaultFile(BASE_FILE, merged)
      return { conflicts, firstPush, attempts }
    }
    // 412: someone pushed between our GET and PUT. Loop — re-GET, re-merge.
  }

  throw new SyncError('conflict-retry', `Remote kept changing; gave up after ${maxAttempts} attempts`)
}

/** Cheap "is there anything new?" probe — for app-foreground checks. */
export async function remoteMeta({ endpoint, token, fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch
  const res = await doFetch(`${trimSlash(endpoint)}/v1/vault/meta`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SyncError('unauthorized', 'Sync token rejected')
  if (!res.ok) throw new SyncError('server', `Meta failed (${res.status})`)
  return res.json()
}
