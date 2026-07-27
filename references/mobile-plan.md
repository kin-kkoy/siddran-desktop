# Siddran Mobile — plan

Status: **planned, not started.** Blocked on two setup steps the user must do (below).
Last updated 2026-07-28.

---

## Goal & scope

An **Android-only** companion app (sideloaded APK — no Play Store, no iOS), sharing
the desktop codebase via Tauri 2's Android target.

**Why it exists:** the draw is *not* note-taking on a phone. It's:
- **Tasks + calendar** on the go
- **Notifications** for due tasks / events (mobile-exclusive)
- A **task timer** (mobile-exclusive)

**In scope**
- Tasks (incl. dailies, projects) and Calendar
- Notes: **read + light edit** (reversed from the original "no notes" decision — the
  user often needs to reference/update a note mid-task)

**Out of scope**
- The Konva **Sandbox** (canvas) — deliberately dropped
- Split panes, the calendar Schedule Designer, PDF pane, and other desktop-only surfaces

---

## Key architectural decisions (already made)

| Decision | Outcome |
|---|---|
| Shell | **Tauri 2** Android target (same React app, new shell) |
| Sync transport | **Cloudflare Worker + R2** — Ember and Git-as-remote both ruled out |
| Sync model | Local-first on both devices; **explicit** push/pull, never in the path of a tap |
| IDs | **UUIDs** (done 2026-07-20) so two offline devices can't collide |
| Conflict rule | **Last-write-wins** on `updated_at`, per row; discarded side is reported |
| Note editing on mobile | **Do NOT ship desktop CM6.** See "Mobile note editor" below |

### Why not CodeMirror 6 on mobile
CM6 + the Android soft keyboard is the single riskiest unknown (IME composition,
viewport resize, selection handles), and the desktop editor stacks live-preview
decorations on top of that. **Plan:** a plain `<textarea>` + a small markdown toolbar
for editing, and reuse the existing reading-view renderer (`markdownToHtml`) for
reading. The toolbar buttons can reuse `cm/formatting.js`'s string logic, which is
pure string manipulation and doesn't require CodeMirror.

Toolbar set (user's list): bold, italic, headings, bullets, checkboxes, underline,
strikethrough, highlight, quote, horizontal rule, media, comments, and wikilinks
limited to **notes + tasks**.

---

## What already exists (built on desktop, reusable as-is)

- `app/src/desktop/sync/merge.js` — pure three-way merge (base/local/remote), row-level,
  UUID-keyed, LWW conflicts, correct deletion handling. Convergence + mutation tested.
- `app/src/desktop/sync/client.js` — `syncNow()`: pull → merge → write → push, 412 retry.
- `sync-worker/` — the Cloudflare Worker (`GET/PUT /v1/vault`, `/v1/vault/meta`),
  R2-backed with ETag concurrency.
- `app/src/hooks/syncConfig.js` + the **Sync tab** in Settings (endpoint, token, "Sync now").
- `app/src/desktop/fs/` — the storage adapter seam (`tauriFs` / `memFs`), which is what
  makes a different platform backend possible at all.

---

## Blockers (user action required)

1. **Deploy the Worker**
   ```sh
   cd sync-worker
   npx wrangler login
   npx wrangler r2 bucket create siddran-vault
   npx wrangler secret put SYNC_TOKEN     # any long random string
   npx wrangler deploy
   ```
   Then paste the URL + token into **Settings → Sync** and hit *Sync now*.

2. **Android toolchain** (not installed on this machine as of 2026-07-28)
   - Android Studio → SDK + **NDK**
   - `rustup target add aarch64-linux-android armv7-linux-androideabi`
   - Then `npm run tauri android init` / `... android build --apk`

---

## Open problems to solve when starting

### 1. Storage — the Bag model does not survive Android
A Bag is "any folder the user picks", read via raw `std::fs` paths in
`src-tauri/src/main.rs`. Android's **scoped storage** means:
- The app can freely touch only its own private directory.
- Arbitrary folders need **SAF** (Storage Access Framework) with `content://` URIs,
  not file paths — and `plugin:dialog|open({directory:true})` doesn't work on Android.

**Options:** (a) app-private storage — easy, but the vault is an island only reachable
via sync; (b) a Kotlin SAF bridge + rewriting `tauriFs.js` around URI handles — real work.
**Undecided.** This also gates where any local vault copy can live.

### 2. Notifications must be OS-scheduled, not JS timers
Android Doze / background limits kill a JS `setInterval`. So:
- **Refetch on app-foreground**, not on a timer.
- Reminders must be **pre-registered with the OS ahead of time** (AlarmManager via
  Tauri's notification plugin) so they fire even when the app is dead.
- **Spike this before committing** — verify a scheduled notification survives app-kill
  on the current plugin version.

### 3. The task timer needs a foreground service
A running timer that survives backgrounding requires an **Android foreground service**
with a persistent notification. That's platform work beyond Tauri's JS surface —
budget it separately from notifications.

### 4. Notes in sync scope
`exportVault()` currently covers **tasks + calendar only**. Shipping note editing on
mobile means notes must join the sync payload — and notes aren't JSON rows, they're
markdown files with frontmatter (`id`, `updated_at`) plus `.comments.json` sidecars.
They'd merge as "one row per note keyed by id, `updated_at` from frontmatter", with
comments as their own collection. The merge engine handles this shape fine, but it IS
a real extension of scope, not automatic.

### 5. UI is desktop-shaped
Only ~10 of ~178 source files have any `@media` query; 56 CSS files use `:hover`; the
Tauri window declares `minWidth: 900`. Mobile needs its own layout for the surfaces in
scope — reusing the hooks (`useTasks`, `useCalendar`) and storage layer, but not the
desktop views.

---

## Suggested build order

1. Deploy the Worker; verify desktop ↔ Worker sync end-to-end with real R2.
2. Spike the two Android unknowns (**storage**, **scheduled notifications**) — both are
   yes/no answers that change the plan.
3. Tauri Android shell → first APK that boots the app at all.
4. Decide storage; implement the Android fs adapter behind the existing seam.
5. Mobile UI for tasks + calendar.
6. Notes: reader first, then the textarea editor; extend sync scope to notes.
7. Timer (foreground service) last — it's the most platform-specific piece.
