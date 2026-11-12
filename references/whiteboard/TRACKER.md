# Whiteboard (Sandbox) upgrade — tracker

One section per chat session. Point a fresh session at this file plus the
section number: *"Implement section N of references/whiteboard/TRACKER.md"*.
Tick the boxes as you go and add a dated line under **Log** when a section is
done, so the next session knows where things stand.

## Shared context (read first)

- **Where:** worktree `../Siddran-Desktop-whiteboard`, branch `whiteboard`.
  `master` and the installed app are untouched until the user says "keep it".
- **Source spec:** `~/Downloads/whiteboard-app-spec/PRODUCT-SPEC.md` (Miro-scale;
  we take what helps, not all of it). The user draws inspiration from Miro and
  sends screenshots — when one is attached, it is the requirement.
- **Code map** (all under `app/src/`):
  - `pages/Sandbox/SandBoxPage.jsx` — wiring, keyboard, commands
  - `components/Sandbox/Canvas/SandboxCanvas.jsx` — pointer gestures, hit-testing, layers
  - `components/Sandbox/selection/SelectionOverlay.jsx` — handles, connection dots, connector drags
  - `components/Sandbox/selection/ContextToolbar.jsx` — the floating bar
  - `components/Sandbox/shapes/registry.js` — every shape kind
  - `components/Sandbox/connectors/` — routing, heads, line styles
  - `components/Sandbox/text/textStyle.js`, `frames/`, `templates/`
- **Data rules:**
  - Boards are `<Bag>/sandboxes/<id>.siddran`, written byte-exact (`JSON.stringify(_, null, 2)`).
  - siddran-cli (`../Siddran-CLI`) round-trips unknown fields raw.
  - **Never add a new item `type`.** The installed app sends unknown types to
    the stroke renderer and can crash. Add a `payload.kind` on `type:'shape'`
    instead (that is how stickies and frames work).
  - New payload fields must be optional, with old behaviour when absent.
- **Verify loop:**
  - In `app/`: `npm test`, `npx eslint .` (baseline: exactly 25 problems) and `npm run build`.
  - In `src-tauri/`: `cargo check`.
  - Look at it running: headless Hyprland output, on a *copy* of the test Bag,
    never the real Bag. See the memory notes `reference-headless-testing` and
    `reference-verifying-persisted-state`.
  - Use `pgrep -x siddran` to stop the app, never `pkill -f` (it kills its own shell).
- **Run it:** from the worktree root, `npm run tauri:dev`.

## Parallel or sequential?

Sections 1–4 all edit the same hot files (the page, canvas, overlay and
toolbar), so they run **one after another**. Running them in parallel would
mean constant merge conflicts.

Section 5 builds the Format shell. Once it has landed, sections 6–11 each live
mostly in their own new folder, so those **can** run in parallel: one worktree
per section, merged back into `whiteboard` one at a time.

---

## Section 1 — Canvas polish & fixes  ✅ built (session 1) — awaiting the user's hands-on check

- [x] Floating bar centred on the selection. Bug: the fade-in animation's
      `transform` overrode `translate(-50%)`, so the left edge sat at centre.
- [x] Floating bar about 2× bigger: larger icons, more spacing, a bigger gap
      from the shape. Constant size at any zoom.
- [x] Press-and-drag moves an unselected shape, stroke or image in one motion.
      Connectors keep click-then-drag.
- [x] Magnetic connection dots: they appear when the pointer is within a
      radius around the shape (larger than the shape); the nearest dot "pulls"
      the pointer, and pressing within its catch radius starts an arrow.
- [x] Connector bend handle: a midpoint dot on every arrow (straight, elbow,
      curved) that can be dragged to bend or move the middle.
- [x] Custom colour with alpha (transparency) in every colour menu.
- [x] Shift while drawing a line or arrow snaps to 0/45/90°. It used to
      constrain to a square, which gave diagonals only.
- [x] Hand tool button removed. Press `V` again to toggle Select ⇄ Pan, and show
      a hint (Space / middle-drag / two fingers to pan).
- [x] Tapered arrow (the user's screenshot): a filled arrow whose shaft widens
      to the head. Available as a shape and as a connector body.
- [x] Sticky-note dock icon that doesn't look like a document.

## Section 2 — Drawing tools flyout (Miro-style)

Screenshot reference: clicking the pen opens a second column, top to bottom:

- [ ] Pen, Highlighter, Smart drawing, Eraser, Precision eraser, Lasso.
- [ ] Three preset circles under the tools. Each preset is a thickness plus a
      colour. Clicking an active preset opens its editor (size, colour,
      smoothing). The pen and the highlighter each have their own three.
- [ ] Highlighter: translucent (~35%), flat caps, drawn beneath text
      (spec §10.3). Store as a stroke with `payload.highlighter: true`.
- [ ] Precision eraser: removes only the part of a stroke under it, splitting
      the stroke. Re-run `strokeOutline` on each piece. The ordinary eraser
      still removes whole strokes.
- [ ] Move the dock's stroke colour into the pen flyout. Give the fill bucket
      its own fill colour.
- [ ] Shapes: the shape picker shows border and fill colour choices. The user
      said "by default black", but the board is dark, so confirm the default
      with the user before choosing.
- [ ] Smart drawing (spec §10.4): a rough stroke becomes a clean
      rectangle/ellipse/triangle/diamond/arrow, keeping the source ink for
      undo. Rule-based recogniser first. This could be its own session if it
      runs long.

## Section 3 — Diagram from nodes (node editor)

The user loves "Diagram from text" (Mermaid) but wants a **human, node-based**
way to build the same thing. Keep the text mode for AI and paste.

- [ ] A node-editor panel/mode: add nodes, drag from a node's port to another
      to link, label edges, pick a node's kind (box/decision/start-end/
      data/database). Live preview using `flow/flowText.js` layout, then insert.
- [ ] Two-way: open an existing diagram selection in the node editor, and
      round-trip with `itemsToFlow`.
- [ ] Decide with the user whether this is a modal, a side panel, or a "diagram
      container" on the canvas (spec §13.8 calls it a Diagram format, which
      could fold into section 5).
- [ ] Give it its own dock icon. The user asked for a new look; it's now
      `LuWaypoints` as a stopgap. Pick one that reads as "node graph" once
      the node editor exists.
- [ ] `flowText.js` mirrors the CLI's `core::diagram`. Change one and you must
      change both.

## Section 4 — CLI follow-ups (repo `../Siddran-CLI`)

- [ ] `sandbox_read`: list frames as frames (title plus contents), not as empty
      boxes. Stickies read as sticky notes.
- [ ] `sandbox_edit`/`sandbox_diagram`: accept the new shape kinds, `headStart`,
      `lineStyle` and `routing: "curved"`.
- [ ] Keep the parity tests between `flowText.js` and `diagram.rs` green.

## Section 5 — Format shell + shared record model (prerequisite for 6–11)

The spec's §5.13 and §13.1–13.2: a "Format" is a structured widget on the
canvas. It is stored as `type:'shape', kind:'format'` with `payload.format`
(`table` | `kanban` | …), per the "no new types" rule.

- [ ] Window chrome on the canvas: a title bar, resize, and focus mode
      (fullscreen) as an overlay.
- [ ] Shared dataset model. Records and fields live in the board file (or a
      sibling file; decide with the user). Table, Timeline, Kanban and Matrix
      are views of one dataset.
- [ ] Undo, merge (`mergeRows` is per item; a dataset may need per-record
      merging) and CLI round-trip.
- [ ] Decide with the user how this relates to Siddran's existing Tasks and
      kanban (TasksHub). Reusing tasks as records may be far better than a
      second task system.

## Sections 6–11 — Formats (can run in parallel after section 5)

- [ ] **6 · Table:** field types, sort, filter, group (spec §13.4).
- [ ] **7 · Timeline + Kanban + Matrix:** views over the same records
      (§13.5–13.7).
- [ ] **8 · Doc:** a rich-text block on the canvas. Consider reusing the notes
      editor (CodeMirror), or embedding a real note as the Doc (§13.3).
- [ ] **9 · Slides:** frames as slides plus a presentation mode with
      F5/arrows/Esc (§11.8, §13.10).
- [ ] **10 · Prototype:** screens with click-through hotspots and a preview
      mode (§13.11).
- [ ] **11 · Engage activities + Talktrack:** Kahoot-style polls, quizzes and
      word clouds; screen and camera recording with chapters. Siddran is
      single-user and local, so ask the user what "participants" means here
      before building (§13.12–13.13).

## Not planned (user decision, 2026-11-12)

- Stickers and emojis. They need an asset library; dropped for now.

## Log

- 2026-11-12 · session 1 · base upgrade committed (c516ea6, 5f92dc7): text
  typography, 35 shapes, curved connectors and heads, stickies, frames,
  10 templates, group/lock, copy style, connection-dot hover fix.
- 2026-11-12 · session 1 · section 1 built. Logic is unit-tested: hover/magnet
  (`selection/hover.js`), bend routing, tapered geometry. The pointer gestures
  (press-drag, magnet press, bend drag) could NOT be driven headlessly, because
  there is no click/move dispatcher. The user is checking them by hand.
- 2026-11-12 · session 1 · user feedback round. The floating bar was too big:
  now ~10% smaller (36 px buttons). It wrapped near the right edge: now
  `width: max-content` with no wrapping. The sticky now looks like paper (gradient,
  adhesive strip, lifted shadow, folded corner). Dock icons are bigger (44 px
  buttons). The diagram icon is now `LuWaypoints`.
