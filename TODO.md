# Siddran Desktop — Feature Progress & TODO

A running list of what's implemented and what's planned. Add freely.

> Legend: `[x]` done · `[~]` partially done / needs verification · `[ ]` not started · `⚠️` known issue

---

## ✅ Implemented this session (2026-07-09)

### Note editor / UI polish
- [x] **Full-width ZenNotes-style toolbar** — tabs + controls span the content area edge-to-edge (sticky), replacing the old card-width "connected" bar.
- [x] **Edge/Obsidian curved tabs** — active tab has rounded top + radial-gradient "ears" that flare into the bar; inactive tabs are plain.
- [x] **"Paper" box removed** — note text sits directly on the page background (no bordered card), like Obsidian/ZenNotes.
- [x] **Stars removed on the Note page** (and the toggle for it).
- [x] **Less-distraction mode removed** (obsolete once stars were gone).
- [x] **Control buttons de-boxed** — read/split/comment/outline/kebab are just icons (background on hover only).
- [x] **Note column stays centered in the pane** and doesn't jump/wobble when toggling the sidebar.
- [x] **Sidebar fully hides when collapsed** + a contextual **"show sidebar"** button (in the tab bar on notes, beside the sandbox title, floating on hubs/calendar).
- [x] **Sticky Note Dock** — The dock is no longer floating; it is now sticky at the bottom-center of the page (shifting relative to the sidebar layout just like the note column).
- [x] **Dock visibility overhaul** — Auto-hide and the pin icon have been removed. It now features a dedicated show/hide toggle button. The dock remains entirely hidden during read mode.
- [x] **Manual sort of notes & notebooks** — Drag-to-reorder now works in NotesHub for standalone notes and notebooks, with live reflow feedback while dragging. The sidebar mirrors the persisted order.

### Outline
- [x] **Outline panel** — per-note right sidebar of headings; click to jump/scroll (edit + read mode). Per split pane (each can have its own). Toggled by the outline button.
- [x] **Level-styled** — headings step down in size/weight/color with an accent marker on top-level, so the hierarchy is obvious.
- [x] **Read-mode jump** lands the clicked heading below the sticky toolbar.

### Pin / attachments
- [x] **"Favorite" → "Pin"** everywhere (thumbtack icon + Pin/Unpin labels). Internal field kept as `is_favorite`.
- [x] **Sandbox grid card delete button** now visible/clickable (was hidden behind the preview).
- [x] **PDF side-view (core)** — attach a PDF (copied into the Bag's `attachments/`), opens in the **right column** viewer (iframe). If the right column is occupied (split note / sandbox), a **replace-confirm popover** appears.
- [x] **"Attach media" dock button** — opens a small menu to attach an **Image** or a **PDF** (moved out of the kebab menu).

---

## 🔜 To implement / deferred

### Task deadline
- [x] **Custom date picker** — replaced the native `datetime-local` (buried clear button + clipped AM/PM) with `components/Common/DateTimePicker.jsx`: a calendar-button + popup, high-contrast clear buttons, full-width time row. Used in `AddTaskCard` + `TaskDetailsModal`.
- [ ] **Optional deadline TIME (blank by default / date-only deadlines)** — needs the "no time ⇒ end of day, remembered as date-only" decision. Details + recommended approach in [references/deadline-and-calendar.md](references/deadline-and-calendar.md). (Calendar confirmed working like the web build — same doc.)

### High priority
- [x] **Sandbox PDF Previews** — Insert → **PDF** copies a PDF into the Bag and drops a `pdf` **card** (`SandboxPdfCard`) with a scrollable `<iframe>` preview; drag by the header, resize/rotate via the shared selection handles. Added a transparent **drag-shield** during transform gestures so dragging over the iframe doesn't break the resize.
- [x] **Comments** (Google-Docs style) — select text (edit or read mode) → comment button starts a thread; the right-rail **CommentsPanel** shows threads with replies, **resolve/reopen**, delete, and a show-resolved toggle. Highlights render in **both** the editor (CM6 mark decorations) and the reading view (quote-matched spans); clicking a highlight focuses its thread, clicking a thread scrolls the editor to it.
  - **Anchoring:** a CM6 StateField maps each anchor's `[from,to)` live through edits, so a commented region stays attached as you type and **detaches (orphaned)** only when its whole text is deleted. React owns thread *content*; the editor owns *positions* and feeds remaps back via `onCommentsRemap`. Cross-session re-anchoring uses a stored **text quote + prefix/suffix** (offsets are just a hint), so it survives body edits between sessions.
  - **Storage:** sidecar `<note>.comments.json` next to the note's `.md` (written/moved/pruned alongside it by `localStore` reconcile); served via `GET/PUT /notes/:id/comments`.
  - Files: `hooks/useComments.js`, `components/Editor/cm/comments.js`, `components/Comments/CommentsPanel.{jsx,module.css}`; wired through `NotePane` → `CodeMirrorEditor` → `ReadingView`. No author names (local single-user), timestamps only.

### PDF follow-ups
- [x] **Drag-drop a `.pdf`** onto the note to attach — extends the Tauri file-drop handler: the PDF is copied into the Bag, a clickable `[name](attachments/…)` link is inserted at the drop point, and it opens in the viewer pane.
- [x] **Persist / re-open PDFs** — PDFs are saved as a plain markdown link in the note; clicking a `.pdf` link (editor live-preview or reading view) opens it in the side viewer instead of navigating. Attaching via the dock also inserts the link.

### Resizable panes (requested — later)
- [x] **PDF view** column resizable (drag the divider).
- [x] **Split view** columns resizable.
- [x] **Sandbox (when in split/half)** column resizable.

### Outline polish (optional)
- [x] Update the outline **live as you type** — while the outline is open, headings mirror the editor's current text (250 ms debounce); falls back to the saved body when closed.
- [x] Remember outline open/closed **per note** across sessions — persisted in `noteOutlineCache` (localStorage), restored on open/remount.

### Other / ideas
- [x] Restore **favorites floating to the top** as a two-level sort (`compareByFavoriteThenOrder`): pinned notes float up, manual drag order preserved within each group — applied in NotesHub and the sidebar.
- [x] TasksHub: Kanban view (noted earlier as "later").

---

## ❓ Things to verify in `tauri:dev`
- [x] PDF renders in the iframe (✅ confirmed working) — if a future PDF fails, may need pdf.js.
- [ ] Rust `bag_read_bytes` compiles + reads (used by PDF/image picker attach).
