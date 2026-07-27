# Sync design — Cloudflare Worker + R2

Status: **design, not built.** Decided 2026-07-21.

## Shape: dumb server, smart client

The Worker stores one opaque blob and enforces optimistic concurrency. It knows
nothing about tasks, events, or merging. All the intelligence lives in the client,
where it can be tested without a network.

Why this way:
- Two endpoints is a surface small enough to get right and never touch again.
- Merge logic in JS is unit-testable against `memFs`, exactly like `localStore`.
- Both platforms (desktop Tauri, Android Tauri) speak plain `fetch` — no Git
  cross-compilation, no platform-specific sync code.

## Endpoints

Base: `https://siddran-sync.<subdomain>.workers.dev`

Auth on every request: `Authorization: Bearer <token>`, compared against a Worker
secret (`wrangler secret put SYNC_TOKEN`). Single user, so one shared token is
proportionate. Reject with 401 and no body.

### `GET /v1/vault`

Returns the current remote snapshot.

```
200 OK
ETag: "<r2 etag>"
{
  "version": 1,
  "tasks":    { "tasks": [...], "dailies": [...], "completions": [...], "projects": [...] },
  "calendar": { "events": [...], "schedules": [...] }
}
```

`404` if nothing has ever been pushed — the client treats that as an empty remote
and pushes its whole vault as the initial state.

### `PUT /v1/vault`

Replaces the snapshot. Requires `If-Match: "<etag>"` from the last GET.

```
200 OK   ETag: "<new etag>"     — accepted
412      — remote moved since your GET; pull, re-merge, retry
428      — If-Match header missing (refuse blind overwrites)
```

R2 supports conditional writes natively (`onlyIf: { etagMatches }`), so the
concurrency check is R2's job, not ours. This is the whole reason the server can
stay dumb: it never merges, it just refuses stale writes.

### `GET /v1/vault/meta` (optional, cheap)

Returns `{ etag, updated_at }` with no body. For a "is there anything new?" check
on app foreground without transferring the full snapshot.

## Client sync algorithm

Three snapshots, per collection, keyed by row id:

- `base`   — what we last successfully synced (stored locally, e.g. `.siddran-sync/base.json`)
- `local`  — current on-disk vault
- `remote` — what `GET /v1/vault` just returned

For each row id in the union of all three:

| in base | local vs base | remote vs base | result |
|---|---|---|---|
| yes | unchanged | unchanged | keep |
| yes | changed | unchanged | take local |
| yes | unchanged | changed | take remote |
| yes | changed | changed | **conflict** → higher `updated_at` wins |
| yes | deleted | unchanged | delete |
| yes | unchanged | deleted | delete |
| yes | deleted | changed | keep remote (deletion loses to an edit) |
| no | present | absent | take local (new here) |
| no | absent | present | take remote (new there) |

Then: write merged → local vault, `PUT` it, and on success store merged as the new
`base`. On `412`, re-`GET` and redo — the loop is safe because merge is idempotent.

Notes:
- Deletion needs care. Right now a deleted row simply vanishes from the array, which
  is indistinguishable from "not yet seen" without `base`. `base` is what makes
  deletes work at all — it is not optional.
- `updated_at` is already stamped on every row by `touch()`.
- Row ids are uuids as of 2026-07-20, so two devices can create rows offline without
  collision — this is the change that made any of this possible.
- `.siddran` files are written id-sorted, so the merged output is a pure function of
  its row set.

## Why last-write-wins is probably fine here

Single user, two devices, explicit sync. The realistic conflict is "I edited the same
task on my phone and laptop within one sync interval," which is rare and low-stakes.
Surfacing a conflict UI is real work for a case that mostly won't happen. Start with
LWW; if it ever loses something that matters, revisit.

The one place to be careful: `is_completed` toggles. Two devices toggling the same
task both look like edits, and LWW silently picks one. Acceptable, but worth knowing.

## Free-tier headroom

Vault today: `tasks.siddran` 785 B, `calendar.siddran` 138 KB.

| | free tier | our usage |
|---|---|---|
| Worker requests | 100k/day | a few dozen/day |
| R2 storage | 10 GB | ~140 KB |
| R2 writes | 1M/month | a few hundred/month |

Not close to any limit. R2 chosen over KV because KV's 1k writes/day is the only
limit we could plausibly brush, and R2 is strongly consistent (KV is eventual,
which would make the ETag dance unreliable).

## Build order

1. Merge function in the app, pure and unit-tested against fixtures. No network.
2. Worker + R2 with the two endpoints; `wrangler dev` locally.
3. Wire desktop push/pull to it. Prove two vaults converge.
4. Only then: Android shell over already-proven plumbing.

Steps 1–3 need no Android toolchain, which is currently not installed on this machine.
