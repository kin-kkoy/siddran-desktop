// Siddran sync endpoint. Deliberately dumb: it stores one opaque snapshot and
// refuses stale writes. All merging happens in the client (app/src/desktop/sync/).
// Design: ../../references/sync-design.md
//
// R2 does the concurrency check itself via conditional writes, which is the whole
// reason this file can stay this short.

const KEY = 'vault.json'

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  })

// Constant-time-ish compare so the token can't be recovered by timing the response.
function tokenOk(header, secret) {
  if (!secret) return false
  const got = (header || '').replace(/^Bearer\s+/i, '')
  if (got.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i)
  return diff === 0
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (!tokenOk(request.headers.get('authorization'), env.SYNC_TOKEN)) {
      return new Response(null, { status: 401 })
    }

    // Cheap "is there anything new?" probe for app-foreground checks.
    if (url.pathname === '/v1/vault/meta' && request.method === 'GET') {
      const head = await env.VAULT.head(KEY)
      if (!head) return json({ etag: null, updated_at: null })
      return json({ etag: head.etag, updated_at: head.uploaded.toISOString() })
    }

    if (url.pathname !== '/v1/vault') return new Response(null, { status: 404 })

    if (request.method === 'GET') {
      const obj = await env.VAULT.get(KEY)
      // 404 means nothing has ever been pushed — the client treats that as an
      // empty remote and uploads its whole vault as the initial state.
      if (!obj) return new Response(null, { status: 404 })
      return new Response(obj.body, {
        headers: { 'content-type': 'application/json', etag: obj.httpEtag },
      })
    }

    if (request.method === 'PUT') {
      const ifMatch = request.headers.get('if-match')
      const existing = await env.VAULT.head(KEY)

      // Refuse blind overwrites. First-ever push uses If-Match: * against an empty
      // bucket; everything after must carry the etag from the GET it merged against.
      if (!ifMatch) return json({ error: 'If-Match required' }, { status: 428 })
      if (existing && ifMatch === '*') {
        return json({ error: 'vault already exists; pull first' }, { status: 412 })
      }

      const body = await request.text()
      try { JSON.parse(body) } catch { return json({ error: 'body must be JSON' }, { status: 400 }) }

      const put = await env.VAULT.put(KEY, body, {
        httpMetadata: { contentType: 'application/json' },
        onlyIf: existing ? { etagMatches: ifMatch.replace(/"/g, '') } : undefined,
      })
      // R2 returns null when the precondition failed — someone else pushed since
      // our GET. The client pulls, re-merges (idempotent) and retries.
      if (!put) return json({ error: 'etag mismatch; pull and retry' }, { status: 412 })

      return json({ ok: true }, { headers: { etag: put.httpEtag } })
    }

    return new Response(null, { status: 405 })
  },
}
