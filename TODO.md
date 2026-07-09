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

### High priority
- [ ] **Sandbox PDF Previews** — Allow PDFs to be attached directly within the Sandbox, rendering an inline preview similar to images. The preview will act as a scrollable container so users can scroll through pages directly within the Sandbox card/view.
- [ ] **Comments** (Google-Docs style) — select text → add a comment; a comments view toggled by the comment button. Storage = sidecar `<note>.comments.json` per note; anchors tracked **live** (remap through edits) so editing a commented region keeps it attached (only detaches if the whole anchored text is deleted).

### PDF follow-ups
- [ ] **Drag-drop a `.pdf`** onto the note to attach (extend the Tauri file-drop handler).
- [ ] **Persist / re-open PDFs** — save the attachment as a clickable reference in the note so it can be re-opened later (regular markdown links aren't routed through the note's link handler yet).

### Resizable panes (requested — later)
- [ ] **PDF view** column resizable (drag the divider).
- [ ] **Split view** columns resizable.
- [ ] **Sandbox (when in split/half)** column resizable.

### Outline polish (optional)
- [ ] Update the outline **live as you type** (currently refreshes on save).
- [ ] Remember outline open/closed **per note** across sessions.

### Other / ideas
- [ ] (Optional) Restore **favorites floating to the top** as a two-level sort, if wanted alongside manual order.
- [x] TasksHub: Kanban view (noted earlier as "later").

---

## ❓ Things to verify in `tauri:dev`
- [x] PDF renders in the iframe (✅ confirmed working) — if a future PDF fails, may need pdf.js.
- [ ] Rust `bag_read_bytes` compiles + reads (used by PDF/image picker attach).
