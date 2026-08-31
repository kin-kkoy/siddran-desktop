# Siddran Desktop — Feature Progress & TODO

A running list of what's implemented and what's planned. Add freely.

> Legend: `[x]` done · `[~]` partially done / needs verification · `[ ]` not started · `⚠️` known issue

> **Queued work lives in `references/next/`** — one brief per task, written to be
> handed straight to a session. This file is the record of what was built; that
> directory is the queue of what has not been.

---

## ✅ Implemented this session (2026-07-10)

### Calendar refinements — round 2 (2026-07-11)
- [x] **Rebalance button moved** — now lives in the DayView dock, left of the Unscheduled toggle
  (TimeGrid reports availability via `onRebalanceAvailable`); removed the floating one.
- [x] **No text-selection while dragging** — `user-select:none` on the grid (`.wrap`) + drawer, and
  `e.preventDefault()` on block/drawer pointer-down, so dragging no longer starts a stuttery highlight.
- [x] **Empty end-time placeholder** — WebKitGTK renders a phantom time in an empty `<input type=time>`;
  a `TimeField` overlay shows a real "--:--" while empty (still saves `null`). Applied to start+end.
- [x] **Now-line centering on Week** — already covered (the center-scroll lives in shared TimeGrid, runs
  for Week too when today is in view).
- [x] **Now-time hover hint** — hovering the gutter now-time read-out shows a "Current Time: h:mm AM/PM"
  pop-over above it (`.nowTip`; `.nowLabel` made hoverable).

### Calendar refinements (2026-07-11)
- [x] **New block end time empty** — verified: all create paths already seed `endTime: ''` (saves
  `end_at: null`); no code change, empty after rebuild.
- [x] **Day blocks show end time** — Day-view blocks render `start–end` (Week keeps start only),
  via `endMinutesOf` in `TimeGrid.renderBlock`.
- [x] **Calendar view persistence** — `CalendarViewContext` now persists `day2col`
  (`cinder_cal_day_2col`) + `dayBalanced` (`cinder_cal_day_balanced`), mirroring `view`/`tall`.
- [x] **Hidden-hours → pop-over** (Day + Week) — removed the "Xh hidden" bar; the gutter-corner eye
  button opens a pop-over listing hidden hours (click one to reveal) + "Show all hours".
- [x] **Now-line center setting** — `centerNowLine` (default ON) in Settings; `TimeGrid` auto-scroll
  centers the now-line when today is visible. Now-line already rendered in Day (was just off-screen).
- [x] **2-column Day view** — toolbar toggle (Day only) → whole day as two side-by-side timelines
  sized to fit the viewport (no scroll). Geometry got a dynamic `setHourPx` (fit) + `data-row-offset`
  so each half renders a slice and click-create/drag/resize keep working across halves. Default noon
  split; a **rebalance** button appears when hidden hours make the halves unequal and equalizes the
  column heights. Unscheduled drawer becomes a toggle pop-over in this mode (single-column keeps the
  side column). Files: `views/timeGridGeom.js`, `views/TimeGrid.{jsx,module.css}`,
  `views/DayView.{jsx,module.css}`, `pages/Calendar/Calendar.jsx`, `contexts/CalendarViewContext.jsx`,
  `contexts/SettingsContext.jsx`, `components/Settings/SettingsPopup.jsx`.

### Editor / UX
- [x] **In-note search (Ctrl+F)** — a per-note find bar: search button after the outline button
  (and Ctrl/Cmd+F), a wide sticky input + scrollable results list (line-snippet with the match).
  Works in BOTH edit and read mode; all matches highlight (amber), clicking a result scrolls to
  it and emphasizes it (edit = CM `Decoration.mark` via new `cm/search.js` StateField + doc
  selection/scroll; read = DOM text-walker wrapping `.rv-search-hit` spans, like the comment
  highlighter). In split view only the focused note is searched (button/panel live in the pane
  that owns the controls; per-pane `searchApiRef`). Enter/Shift+Enter/↑↓ step matches, Esc closes.
  Files: `components/Editor/cm/search.js`, `components/Notes/NoteSearch.{jsx,module.css}`,
  imperative `searchApiRef` in `CodeMirrorEditor.jsx`, wired in `NotePane.jsx`.
- [x] **Fold/chevron memory on by default** — `rememberNoteState` now defaults to ON
  (`contexts/SettingsContext.jsx`), so collapsed headings/bullets/checklists persist per note
  across navigation and read/write modes without touching Settings. Includes a one-time
  localStorage migration (`cinder_folds_default_on`) so existing installs flip on once (still
  user-toggleable afterwards). The persistence machinery (`hooks/noteFoldsCache.js`,
  `applyFolds`, read-view `data-line`) already existed — only the default changed.
- [x] **Formatting keyboard shortcuts** — Ctrl+B/I/U/H/= → Bold `**`, Italic `*`,
  Underline `<u></u>`, Hidden/Spoiler `||`, Highlight `==`. New shared `components/Editor/cm/
  formatting.js` (`wrapSelection` + `formattingKeymap`) is used by BOTH the dock buttons and
  the keymap, so a button and its shortcut stay identical. Wired at `Prec` above defaultKeymap
  in `CodeMirrorEditor.jsx`; inert in read mode.
- [x] **⚡ Fixed scroll lag/stutter in long, format-heavy notes** — the live-preview builder
  was calling unbounded forward document scans (`listFoldRange`/`headingFoldRange`) once per
  visible line on every scroll recompute (bit hard on nested-bullet blocks). Added O(1)
  `listFoldState`/`headingFoldState`/`foldedAtLineEnd` to `cm/fold.js` (foldability decided by
  the first following line; folded-state via an `foldedRanges` lookup) and swapped the per-line
  chevron passes in `cm/livePreview.js` + the heading gutter `lineMarker` to use them. The full
  scan is now only run on an actual fold click. No rendering/behavior change.

### Bug fixes
- [x] **Read-mode commenting crash** — `CodeMirrorEditor.jsx` called `anchorFromRange` (to
  anchor a comment started from a reading-view text selection) without importing it, throwing
  `ReferenceError` on that path. Added the missing import. Edit-mode commenting was unaffected.

### Launch / shell
- [x] **Sidebar profile = Bag switcher** — the top-of-sidebar profile (avatar · Bag name ·
  "star chaser") now opens a menu with a **scrollable list of your Bags** (social-style profile
  swap); the current Bag is checked, clicking another flushes the current to disk and loads it
  (`App.jsx` `switchBag` briefly unmounts the shell + resets the route so the new Bag's data
  refetches). Profile moved from the footer to the top; menu opens downward.
- [x] **Landing (BagPicker) list polish** — each Recent-Bag row is now a card with a mini
  amber-zipper bag chip, gradient fill, hover lift/glow + sliding arrow — matches the pack
  aesthetic. Kept minimal.
- [x] **Bag-unzip launch splash** — `components/Splash/SplashScreen.{jsx,module.css}`: a
  zippered amber SVG bag drops in, the zipper pull slides across, the mouth opens onto a glowing
  interior with the Siddran sparkle rising, then the camera dives into the bag to reveal the
  app (~3.6s, CSS-keyframe driven). Plays **once per app session** (sessionStorage
  `siddran_splash_shown`), Esc-skippable, honors `prefers-reduced-motion`. Rendered as an early
  return in `App.jsx` so boot effects run underneath while it plays.
- [x] **Sidebar header shows the open Bag's name** — replaced the hardcoded "SIDDRAN" /
  "space drifting" brand with the Bag name (`Sidebar.jsx`, using the existing `username` prop).
  New shared `--header-height: 48px` token (`index.css`) fixes the sidebar brand height and the
  note tab bar to the same height (tab bar also made a touch taller), so their bottom borders
  line up. (Bottom `ProfileDropdown` still carries the Bag name for its menu.)

## ✅ Implemented earlier session (2026-07-09)

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

## ✅ Implemented this session (2026-08-26) — OS integration

Both from `references/next/` (06 + 07); they shared one blocker — the app had no way
to hand anything to the OS — so they were done together.

### External links no longer navigate the app away (`06-external-links.md`)
- [x] **The bug** — a `http(s)` link in a note's reading view reached the DOM as a real
  `<a href>`; clicking it replaced the whole SPA, unsaved editor state included, with
  no back affordance. `markdownToHtml` stripped `href` off *attachment* links only.
- [x] **The fix, at the source** — `rehypeCinderLinks` (was `rehypeCinderPdfLinks`) now
  drops `href` off **every** anchor and classifies it onto `data-href`: attachment →
  side viewer, web/mail → browser, anything else → inert. Safe by construction rather
  than by remembering to bind a handler on each surface.
- [x] **Confirm, then the real browser** — `ExternalLinkGate` (app-level, beside
  `ToastContainer`) shows the full URL and Open/Cancel. Chosen behaviour: prompt then
  system browser; the side-pane option was rejected (that viewer serves local files
  under its own CSP — pointing it at the internet is a different security question).
- [x] **Backstop** — `desktop/linkGuard.js`, a capture-phase click guard installed from
  `main.jsx` beside `dropGuard`, catches any live remote `href` from a surface the
  renderer doesn't own (e.g. the sandbox's `AttachedNoteCard`, which has no handler).
- [x] **Edit mode too** — `cm/wikilinks.js` routes an external `.cm-external-link` to the
  same gate. Only the display text is decorated, so a link stays editable.
- [x] **Rust** — `open_external_url`, with an **allowlist** of `http`/`https`/`mailto`.
  Anything else is refused before it reaches the OS; handing an arbitrary scheme to the
  platform opener is how `file://` or a `.desktop` launcher becomes code execution.

### Show a note in the file manager (`07-reveal-in-file-manager.md`)
- [x] **`reveal_in_file_manager`** — pre-selects the file via the D-Bus `ShowItems` call
  the opener plugin makes, falling back to opening the containing folder. Verified in
  Dolphin: the `.md` comes up already selected, not just its folder.
- [x] **Confined to the Bag** — canonicalize-then-`starts_with`, the same check
  `serve_viewer` uses, against the canonical Bag root already in `ViewerState.bag`.
- [x] **Entry points** — the note card kebab (grid + list), right-click on a sidebar note
  row, on the Opened Notes rows, and on a notebook header (a notebook is a directory).
  `RowContextMenu` is new — the app had no context menu anywhere before this.
- [x] **Fails loudly** — a note whose file moved or was deleted outside the app toasts;
  a note not yet flushed to disk (1.5 s debounce) says so rather than doing nothing.

### Split-view panes: keyboard focus + a lock (2026-08-27)

Both from `references/next/` (01 + 02); they touch the same three contexts and the
same `NotePage` layout ladder, so they were done together.

- [x] **Ctrl+1 / Ctrl+2 move focus between the two columns** (`01-pane-cycling.md`) —
  direct, not cycling: there are only ever two sides, so pressing the same key twice
  is idempotent rather than bouncing you back. Ctrl+Alt+←/→ was rejected because most
  Linux desktops grab it for workspace switching before the app sees it.
- [x] **The caret comes back with you** — CodeMirror keeps the selection in the
  `EditorView`, so `view.focus()` alone returns you to where you were on that side.
  A PDF / HTML / sandbox / picker pane has no caret, so its container is focused and
  `onFocusCapture` moves the ring. `leftViewRef` is now passed in every layout, not
  just the split branch. ⚠️ Does not fire from inside a rendered table cell — the
  cell editor calls `stopPropagation()` to own its keys (`cm/tables.js`).
- [x] **Pane lock, off by default** (`02-split-lock.md`) — unlocked is the original
  behaviour (the right column is global and follows you); locked binds it to the note
  it was opened from, so it appears there and nowhere else.
- [x] **One extra field, no new storage key** — `sessionRouteCache` already kept
  `panes: { noteId -> snapshot }`, so the lock is `locked: true` on the existing
  snapshot and inherits Bag scoping, normalisation and eviction. `setPaneFor` now
  evicts **unlocked** entries first: a lock was set deliberately, and losing it after
  twenty other notes would look like it had quietly failed.
- [x] **`PaneLockContext`, mounted outside all three panes** — the lock has to cover
  both `NoteSplitContext` and `SidePaneContext`, and SidePane is nested inside
  NoteSplit, so it could not live in either. Holds a note id and nothing else.
- [x] **The lock is a new effect, not the restore** — `RightPaneMemory`'s restore is
  guarded by `settledRef` and runs once per mount, and switching notes in-session
  doesn't remount `NotePage`, so nothing reacted to a note change. A second effect
  keyed on `noteId` reopens an arriving note's locked pane (via the existing
  `sidePane.restore` bypass, no confirm modal) and clears a locked pane you leave.
- [x] **Unlock keeps the pane open** and reverts it to following you — a change of
  policy, not a close. Two locked notes each show their own.
- [x] **Locks persist even with `rememberNoteState` off** — deliberate: locking is an
  explicit act, and the one thing it exists to survive is a relaunch.
- [x] **A pin, not a padlock** — `AttachmentPane`'s header already has a lock icon
  meaning HTML page *trust*; two padlocks there would be confusing. `PaneLockButton`
  uses `LuPin`/`LuPinOff` and keeps the word "lock" in its tooltip. It appears on the
  split tab, the sandbox split, the attachment header and the half-sandbox dock.

### Reload Bag (2026-08-27)
- [x] **Profile menu ▸ Reload Bag** — re-reads the Bag folder without restarting, so a
  note renamed/edited/added from outside (file manager, sync tool, hand-edited `.md`)
  becomes visible. Sits with Switch Bag / Close Bag because it is about *this* Bag.
- [x] **Flushes first, and that is deliberate** — an edit you just made is yours and
  newer, so it reaches disk before disk is read back. `flushNow()` writes nothing when
  nothing is dirty, which is the common case for a reload.
- [x] **`reloadKey` on the data hooks** — nothing else in `useNotes`/`useTasks`'
  dependencies changes when the same Bag is reloaded in place, so without it they keep
  showing the old picture. It also clears the notebook prefetch cache.
- ⚠️ **What reload does NOT fix.** `reconcileNotes` prunes any `.md` under `notes/` it
  doesn't recognise, so if you rename a note's file outside the app *while edits are
  pending*, the next flush deletes the renamed file and recreates the old name. That
  is a pre-existing hazard of editing a Bag from two places at once — reload neither
  adds to it nor undoes it. Worth its own brief.

### Notes for whoever is next
- ⚠️ **The `bag_*` commands do no path confinement at all** — they take an absolute path
  from the webview and hand it to `std::fs` (deliberate: a Bag lives anywhere). Brief 07
  assumed otherwise. Anything new that reaches the OS must bring its own check.
- **No new capability was granted.** `tauri-plugin-opener` is called as a plain Rust
  library from our own commands, so the plugin is never registered and
  `capabilities/default.json` still grants only `core:default` + `dialog:default`.
- **Window navigation guard:** Tauri v2 does offer
  `WebviewWindowBuilder::on_navigation`, but it needs the window built in Rust rather
  than declared in `tauri.conf.json` — a structural change. Deferred; the capture-phase
  JS guard covers the same ground. Don't re-investigate.

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

---

## 🔜 Requested 2026-07-21 — deferred until after the Android app

Queued deliberately: all four are Notes/theme features, and Notes are out of scope
for mobile (tasks + calendar only), so none of them block or are blocked by the
phone work.

- [ ] **Notes list as a sidebar accordion** — when in NotesHub, the note list shows
      as a dropdown/accordion in the sidebar; expanding it gives the same view you
      get inside a NotePage.
- [ ] **Draggable / re-orderable note tabs** in NotePage. (`useDragReorder.js`
      already exists and is used by NotesHub — likely reusable here.)
- [ ] **Persist accordion expand/collapse state** across remount *and* app restart.
- [ ] **Background-brightness slider** in the Settings modal themes section,
      applying on every page (NotesHub, NotePage, TasksHub, Calendar, …).

**Decide once, when starting these:** put the new persisted UI state (accordion
open/closed, tab order, brightness) in **localStorage**, not `settings.siddran`.
Rationale: `exportVault()` deliberately excludes settings from sync, and per-device
UI state *should* stay per-device — a phone and a laptop want different tab sets and
different screen brightness. This matches the existing pattern (`noteFoldsCache.js`,
`cinder_cal_day_2col`, `tasksLayoutMode`).

---

## 💡 Idea parked 2026-07-21 — "Landscape view" (book/paginated note layout)

User's idea, to design & build AFTER the table work and the current desktop backlog
(before or around the mobile port — discuss timing later):

- A reading/writing layout that, instead of one continuously-scrolling column, lays
  the note out like an open **book**: two columns = a left "page" and a right "page".
- **Prev/Next page arrows** at the bottom-left and bottom-right to page through the note.
- Applies to reading and (ideally) writing.
- NOT yet implemented — user flagged it early so it isn't forgotten. Talk through the
  details (how pagination maps to a continuous markdown doc, where the editor caret
  goes across page breaks, print/PDF interplay) before building.

### Flowcharts and diagrams inside a note (2026-08-28)

From `references/next/08-diagrams-in-notes.md`. The three design questions were
asked up front: the diagram lives in a fenced block in the `.md`, editing happens
in an overlay reusing the Sandbox canvas, and the tool set is the flowchart subset.

- [x] **A ```siddran-diagram fence holds the drawing**, so the note stays ONE
  self-contained file — copy or move the `.md` and the diagram travels, and nothing
  can be orphaned by deleting a board. Items are stored in the Sandbox's own item
  shape rather than a prettier private schema, because the overlay editor IS the
  Sandbox canvas and a translation layer would be two more places to disagree.
- [x] **Rendered as SVG, in the editor and the reading view.** `ReadingView.jsx`
  renders notes through `dangerouslySetInnerHTML` and already warns that a React
  re-render wipes DOM mutations underneath it, so mounting Konva roots there fights
  the architecture. An `<svg>` does not, and comes along in the PDF export free.
- [x] **The shape geometry is NOT written twice.** `shapes/registry.js` draws every
  shape by calling moveTo/lineTo/arcTo/ellipse/closePath on a canvas context, so
  `diagramSvg.js` hands it a recorder that emits an SVG path instead. One shape
  vocabulary, two backends — a shape added to the Sandbox appears in notes for free.
  Arcs are flattened to short segments rather than converted to SVG arc commands:
  invisible at note scale, and far harder to get subtly wrong.
- [x] **Editing reuses the real canvas.** `useDiagramItems` is an in-memory stand-in
  for `useSandbox(id)` exposing the same add/update/remove/getItemById contract, so
  `SandboxCanvas`, `SelectionOverlay`, `ContextToolbar`, connectors and undo never
  learn there is no board behind them.
- [x] **The flowchart subset only** — shapes, connectors, text-in-shape. The Sandbox's
  text TOOL is deliberately absent: it places a DOM text card, which is outside the
  subset and which the SVG renderer cannot draw, so offering it would let a note hold
  a diagram that renders with pieces missing. Enter (or double-click) labels a shape.
- [x] **Insert from the editor dock**, which creates an empty block reading "Empty
  diagram — click to edit" — creating and filling stay two deliberate steps.
- [x] **`view.focus()` after writing back.** The editor persists on blur, on unmount
  and on a 2-minute interval; for typing that is fine because you are focused there
  and a blur always comes. The overlay took focus away BEFORE the change existed, so
  without this an edit could sit unsaved until the interval fired.
- [x] **The widget's `ignoreEvent()` returns false**, unlike the table widget's. A
  table attaches its own listeners and wants CM out; this one is handled by
  `domEventHandlers`, and those never see an event the widget told CM to ignore.
- [x] **`ShapePicker` raised to z-index 1300** — it portals to `document.body`, so
  inside the overlay it is a SIBLING of it, and at 50 it rendered behind the panel
  that opened it.
- [x] **Cylinder shape fixed** (`registry.js`) — the two halves of the top rim were
  swapped, so the silhouette followed the rim's NEAR edge, which dips into the body.
  That is what made it look chopped flat. One fix, three surfaces: the Sandbox
  canvas, the shape-picker thumbnail and note diagrams all draw from the registry.
- [x] **25 tests** over the fence format and the path recorder (`diagramBlock.test.js`,
  `diagramSvg.test.js`). The DOM half has no unit tests — this repo's vitest runs in
  the node environment with no jsdom — so it was driven by hand in the app instead:
  insert, draw two shapes, connect them, label one, move a shape and watch the
  connector re-route, Done, Cancel-discards, and the result surviving to disk.

### Inline calculation suggestions in the editor (2026-08-28)

Write a sum, end the line with `=`, and the result is offered as a completion.

- [x] **Suggested inline as greyed ghost text**, accepted with **Tab or Right
  arrow** and dismissed by simply typing on. Never inserted on its own: a note is
  the user's text, and an editor that silently rewrites it while they type is a
  worse editor. Ghost text rather than the completion popup because a calculation
  has exactly one answer — a list to choose from is the wrong shape, and a popup
  covers the lines you are checking the sum against.
- [x] **No `eval`.** `cm/calc.js` is a hand-written tokenizer + shunting-yard
  parser. Note bodies are arbitrary text and a note can arrive from a synced or
  hand-edited file, so nothing in a note is handed to the JS engine.
- [x] **Float error is rounded off.** `10 + 12 + 93 + 100.11` is literally
  215.10999999999999; offering that would read as a bug. `formatResult` rounds to
  12 significant digits and strips the trailing zeros.
- [x] **Quiet unless it is really a sum** — declines a lone number (`42 =`),
  prose (`const total =`), trailing operators, unbalanced parens, implicit
  multiplication, and division by zero. It reads only the expression at the END of
  a line, so `Lunch and coffee: 12.50 + 3.75 =` works.
- [x] **A decoration, not a completion source.** It was briefly built as one, which
  forced a shared assembly point: `autocompletion({ override })` REPLACES every
  source, so a second `autocompletion()` would have silently disabled the wikilink
  suggestions. Ghost text has no such coupling, so `cm/wikilinks.js` keeps owning
  its own registration and that shared file was removed again.
- [x] **Tab and Right arrow fall through when nothing is showing** — the accept
  command returns false, so Tab still indents a list and moves between table cells,
  and Right still moves the caret. A table row cannot produce a ghost anyway: the
  suggestion requires the caret at end of line with `=` before it, and a row ends
  in `|`.
- [x] **19 tests** in `cm/calc.test.js`, and verified in the app: the ghost shows
  greyed after the caret without touching the line, Tab accepts it, Right arrow
  accepts it, Right still moves the caret on a line with no ghost, and Tab still
  indents a list item.
- Accepts `×`, `÷`, `x`, `−` as well as the ASCII operators. Deliberately NOT
  supported: variables, units, `%` (percent in a budget, modulo in code — guessing
  wrong is worse than declining) and thousands separators (`1,000` is ambiguous).

### Sidebar: tighter rows, and drag a note into a notebook (2026-08-28)

From `references/next/` (03 + 04), done together — tightening the rows makes them
smaller drag targets, so the two could not be judged apart.

- [x] **Tighter spacing** (`03-sidebar-density.md`) — the visible gap was the sum of
  five values, not one: the list gap (8→4), the notebook group's margin (7→3) and
  padding, the gap inside a group (6→4), the page-block gap (2→1) and padding (4→3),
  and the row's own padding (6px→4px). About two more rows per screen.
- [x] **Standalone notes match notes inside a notebook** — one row height everywhere.
  The notebook's cover, border and page block already say "these are grouped"; extra
  space to say it again was what made the list long.
- [x] **`SidebarOpenNotes.module.css` moved with it** — the two lists appear in the
  same slot, and tightening only one would have read as a bug.
- [x] **Drag a note onto a notebook to file it** (`04-sidebar-drag-to-notebook.md`) —
  pointer-based via the existing `useDragReorder`, the same gesture and the same
  `fileNote` shape as NotesHub. Remove-then-add, so the old notebook's count is right.
- [x] **Drag it onto the loose notes to take it out** — the standalone notes are a
  drop zone of their own, rendered even when empty (with a dashed "Drop here to take
  out" hint that only appears while a filed note is in the air) — otherwise the case
  that most needs the target, every note filed, would have nothing to aim at.
- [x] **Reorder works too, scoped to one group.** `reorderNotes` renumbers whatever
  it is handed 0..n and the hub numbers each notebook — and the unfiled set — as its
  own 0..n, which is exactly why the hub refuses to reorder "Everything". The sidebar
  IS an Everything view, so only the dragged note's own group is committed. Verified
  in the app: reordering inside one notebook left the other notebook and the loose
  notes untouched, and the hub shows the same order.
- [x] **`ignoreZone` on `useDragReorder`** (new) — a notebook wraps its own notes in
  its own drop zone, so without it every hit test found the zone the note already
  lived in and reordering inside a notebook could never happen. Where the note is
  RELEASED is what tells the two gestures apart: own group → reorder, anywhere else
  → re-file.
- [x] **`scrollContainer` on `useDragReorder`** (new) — holding a drag near the top or
  bottom edge scrolls the list, on a rAF loop so it keeps going while the pointer is
  still. Without it the feature only worked when everything already fit. Both
  directions verified against the 35-note test Bag.
- [x] **Collapsed notebooks open on hover** (550 ms) and stay open after the drop —
  you opened it to put something in it, and closing it again would hide the result.
- [x] **NotesHub and NoteTabBar are untouched** — both new options default off.

### Completed tasks hidden by default (2026-08-28)

From `references/next/05-hide-completed-default.md`.

- [x] **Completed tasks start hidden** — `showCompleted` in `pages/Tasks/TasksHub.jsx`
  defaulted to `true` and lived in plain component state, so leaving the Tasks page
  unmounted it and coming back showed completed tasks again. The reported "hiding
  un-hides itself" bug was the same fault: the click was never forgotten, it was
  never remembered.
- [x] **Remembered in `localStorage` under `tasksShowCompleted`** — device-local view
  state, alongside `tasksViewMode` / `notesDensity`, not a Settings row. Settings is
  global `cinder_settings` and would have put one thing in two places; the toolbar
  button stays the only control.
- [x] **Read in the `useState` initialiser**, not an effect — `showCompleted` is a
  dependency of `useRowMasonry`, and a default-then-correct would have reflowed the
  grid once on entry and read as a flicker.
- [x] **Both views follow it** — kanban derives its columns from the same
  `filteredTasks` → `sortedTasks` chain as the card grid, so the filter is shared
  even though sort state (`sortByView`) is per view.
- ⚠️ Anyone who has never touched the button now sees completed tasks hidden. That is
  the request, but it is a behaviour change for existing users.

## 🎨 Queued after Book view — icon / SVG work (raised 2026-07-28)

- [ ] **Bag icon on the landing / Bag-picker page** — currently reads as loose,
      disconnected lines rather than a bag. Make the shape properly *connected*.
      **Remove the hover animation**: the zipper slides left but doesn't follow its
      own line, which looks broken.
- [ ] **Loading-screen icon** — janky and hard to read; wants a cleaner mark.
- [ ] Direction: lean into the **bag** metaphor, away from the star / space theme.
- [ ] **Tooling question (open):** find a free SVG/animation editor, OR build a small
      standalone HTML tool in `references/` for editing these icons — user is open to
      either. Decide before starting.

## ⏰ Deadline alarms + 🗺️ Mission Board (built 2026-08-31)

Two features in one pass. Plan: `~/.claude/plans/i-just-realized-that-generic-moth.md`.

### Part 1 — notifications and alarms

- [x] **The scheduler is JS in the webview, and closing the window HIDES it.** A Rust
  scheduler would have needed a second implementation of the recurrence grammar,
  the completions join and the local-day boundary — the single most expensive
  duplication available here. `main.rs` gained one branch in the *existing*
  `CloseRequested` handler; the flush handshake and its 2.5s watchdog are untouched.
- [x] **Tray icon (Show / Quit), with a `tray_ok` interlock.** If `TrayIconBuilder`
  fails — no StatusNotifier host — close-to-tray is refused and the ordinary close
  path runs. Without that, `decorations:false` plus a hidden window means no way back.
- [x] **Zero new capability surface.** `capabilities/default.json` is unchanged: the
  notification plugin is registered in Rust and reached through one command, the same
  stance `main.rs` already documents for `tauri_plugin_opener`. No new npm dep either.
- [x] **The sweep is stateless** — one 15s interval recomputing every fire time against
  the wall clock. Suspend, clock jumps and hidden-page throttling can delay an alarm
  by a tick, never skip or double-fire one.
- [x] **The fired ledger is append-only** (`siddran_alarms_fired:<bag>`), pruned only by
  age. Nothing removes an entry because a task "wasn't found", so an unloaded `[]`
  cannot wipe it — the trap that has bitten three times, dodged structurally.
  The fire time is baked into the key, so rescheduling re-arms for free.
- [x] **12h grace window** — anything older is ledgered silently with one summary toast,
  so a two-week-old deadline doesn't scream on launch.
- [x] **Two tiers**: `remind_at` is a toast + one chime; the deadline is a modal that
  ignores Escape and backdrop clicks, with a looping sound.
- [x] **Sound is an `<audio>` element with `loop`, not a WebAudio synth** — the loop must
  be the media pipeline's job, not a JS timer's. Four alarm tones + four chimes,
  previewable in Settings. WebKitGTK's autoplay gate is dodged by priming on the
  session's first gesture.
- [x] **`remind_at` and `due_all_day` on tasks** — both needed adding in five places or
  they are silently dropped (localStore create + PUT whitelist, `useTasks` add + update).

### Part 2 — the Mission Board

- [x] **Masonry is legacy**, behind `legacyViews` in Settings. Views cycle Board → Kanban
  (→ Cards). A remembered `card` falls back to kanban, not the board.
- [x] **Placement lives in `hooks/missionBoard.js`**, the sibling of `kanbanBoard.js`:
  bag-scoped localStorage, x/y as percentages so a resize keeps the arrangement.
  Unlocked = one scatter per *launch*, held in a module singleton so navigating away
  and back does not reshuffle. Locked = written down, and every drag persists.
- [x] **Scatter separates on each axis, not by radius** — papers are boxes, and a circular
  test buried titles. A test asserts no paper is >60% covered across 40 random boards.
- [x] **Priority cycle button (All → Low → Normal → High).** It filters *rendering only*;
  layout is computed from every item, or hidden papers would be pruned and cycling
  back to All would deal them new spots — the board would reshuffle on every click.

### Things learned the hard way

- ⚠️ **`filter` on hover blurs text on a rotated card.** It promotes the element to its own
  compositing layer and re-rasterises it; the paper appears to shift and the type goes
  soft. Hover is a border/background change only. Same family as the `transform: scale()`
  blur that `OverlayLayer.jsx` already avoids by using CSS `zoom`.
- ⚠️ **WebKitGTK needs `-webkit-user-select: none`.** The unprefixed property alone let the
  browser start a text selection that fought the drag on every pointermove — it read as lag.
- ⚠️ **A date-only deadline is stored at LOCAL MIDNIGHT, not 23:59.** "End of Tuesday" reads
  better, but `useCalendar` decides all-day by checking for midnight, so 23:59 would have
  drawn every dateless task as a late-night appointment. `due_all_day` is authoritative;
  midnight is the legacy fallback for rows written before the flag existed.
- ⚠️ **Persist on pointerup, never per frame.** Writing the arrangement to localStorage on
  every rAF commit is the obvious way to make a board feel heavy.
- 🚫 **Infinite pan/zoom canvas — considered and declined.** It fixes *fitting* many tasks,
  not *finding* one among them, and a board you pan around stops being a bulletin board.
  The priority filter, hide-completed and the deadline filters keep it bounded. If density
  bites later, shrink the papers before reaching for panning.

### Not verified in the running app

Alarms, the OS notification and the ledger were confirmed end-to-end (including the silent
catch-up for stale deadlines). **Not** clicked through: drag, lock persistence, the Scatter
and priority buttons, `boardDressing: 'guild'`, tray Show/Quit, and snooze.
