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

## Decisions already made by the user (2026-11-12) — don't re-ask

1. **Default shape and pen colour (section 2):** light cream `#e2ddf5`, today's
   default. It's readable on the dark board, and black stays available in the
   presets.
2. **Node editor (section 3):** a **pop-up window**, like today's "Diagram from
   text". Text mode stays as a tab in the same pop-up. Insert puts the diagram
   on the board.
3. **Format data (section 5): both, chosen per widget.**
   - Each Kanban/Table/Timeline/Matrix is either *linked to Siddran tasks*
     (shows and edits real tasks, filtered by tag or project) or uses *its own
     records* stored in the board.
   - Design one view layer over two data sources (an adapter interface).
     Don't build two copies of each view.
   - Linked mode must go through the existing tasks store and the live-sync
     path (`desktop/localStore.js`), never write `tasks.siddran` directly.
4. **Engage and Talktrack (section 11): solo versions.**
   - Engage means self-quizzes, flashcards, and polls or votes you fill in yourself.
   - Talktrack means recording your screen and voice over the board, saved
     as a video in the Bag.
   - No multi-user server.

**Check-ins:** the user reviews by hand after **section 2** and after
**section 5**. Stop at those points and ask them to try it. Other sections can
run straight on, and the user reviews them at the end.

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

## Section 2 — Drawing tools flyout (Miro-style)  ✅ done (session 2) — checked by the user, committed

Screenshot reference: clicking the pen opens a second column, top to bottom:

- [x] Pen, Highlighter, Smart drawing, Eraser, Precision eraser, Lasso.
- [x] Three preset circles under the tools. Each preset is a thickness plus a
      colour. Clicking an active preset opens its editor (size, colour,
      smoothing). The pen and the highlighter each have their own three.
- [x] Highlighter: translucent (~35%), flat caps, drawn beneath text
      (spec §10.3). Store as a stroke with `payload.highlighter: true`.
- [x] Precision eraser: removes only the part of a stroke under it, splitting
      the stroke. Re-run `strokeOutline` on each piece. The ordinary eraser
      still removes whole strokes.
- [x] Move the dock's stroke colour into the pen flyout. Give the fill bucket
      its own fill colour.
- [x] Shapes: the shape picker shows border and fill colour choices. The default
      is cream `#e2ddf5` (decided).
- [x] Smart drawing (spec §10.4): a rough stroke becomes a clean
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
- [ ] Build it as a **pop-up window** (decided), with Nodes and Text tabs.
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

- [ ] **First, before any Format work: measure drag smoothness.** The user
      felt dragging shapes was a bit laggy (2026-11-12). It was unmeasured, and
      likely the dev build plus a nearly full RAM (7.1 GB, ~1.6 GB free, video
      playing). It is not the WebKit flicker workaround: 2.54.2 is installed,
      so the workaround is off. Formats are heavy canvas widgets, so settle this
      first. With the dev app CLOSED, use the perf-probe recipe in the memory
      note `reference-webkit-render-mode` to sample frame times while moving a
      selection on a busy board. Compare against a release build. If the app
      code is at fault: each pointer move re-renders the page, the overlay and
      the floating bar.

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
- [ ] Data source per widget, **linked tasks or own records** (decided: both).
      One adapter interface, one set of views.

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
- [ ] **11 · Engage activities + Talktrack, solo versions (decided):**
      self-quizzes, flashcards, polls and votes; screen and voice recording of
      the board, saved as video in the Bag (§13.12–13.13).

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
- 2026-11-12 · session 1 · blurry toolbars: the user's HDMI monitor is scaled
  0.83. Composited layers (backdrop-filter, translate(-50%), lingering
  animations) rasterise soft there. They were removed and the bar is now
  placed on whole pixels. **Don't reintroduce backdrop-filter or transform-based
  centring on these bars.** Not yet confirmed by the user on the real display.
  Next: section 2.
- 2026-11-12 · session 2 · section 2 built and committed after the user's check. New
  `components/Sandbox/ink/`: `presets.js` (tools, 3 presets each for pen and
  highlighter, persisted at `siddran_sandbox_ink_v1`; the old brush migrates to
  the pen's middle preset), `precisionErase.js`, `recognize.js`,
  `highlighterZ.js`, all unit-tested. UI: `Toolbar/DrawFlyout.jsx`, plus
  `Toolbar/ColorMenu.jsx` (shared Popover and CustomColor; `BrushSettings` and
  `ColorPalette` were removed). Choices made:
  - One dock button opens the flyout. P/P toggles Pen ⇄ Highlighter, E/E
    toggles Eraser ⇄ Precision.
  - The highlighter colour has its alpha baked in (`#rrggbb59`), so old builds
    also draw it translucent. No multiply blend: on the dark board it would go black.
  - The highlighter sits beneath crossed pen ink and outline-only shapes, and
    above filled things.
  - Smart drawing gives two undo steps (ink, then shape). The shape keeps
    `payload.sourceInk`, and the floating bar has "Back to drawing".
  - Text and connector colour now follow the shape border colour (the pen
    colour moved into presets).
- Checked headless on a copy of the test Bag (dev localStorage backed up and
  restored afterwards):
  - Precision cuts render in place, including on a moved, stretched and
    rotated stroke.
  - The highlighter stacks as intended.
  - All 5 recognised shapes render.
  - The P/P and E/E flyouts and the picker's Border/Fill rows look right.
- **Fixed a regression from 816e3ae:** committed `ellipse` shapes rendered
  nothing (the Konva ellipse fast-path had been dropped).
- Gestures (drawing, erasing, preset clicks) can't be driven headlessly; the
  user must try them. **Check-in: the user reviews section 2 before section 3.**
- 2026-11-12 · session 2 · user feedback round on section 2:
  - Cards (text, notes, tasks, PDFs) let presses through while drawing,
    highlighting, lassoing or painting. The plain eraser still deletes them.
  - New precision-eraser icon: a cut line with a ring over the gap.
  - The dock's menus and the draw flyout are one slot: opening one closes the others.
  - The shape picker is icons only, in one sectioned grid. Arrow thumbnails
    now have both barbs. Its transform animation was removed (blur rule).
  - A single selected line or arrow SHAPE gets end handles plus a middle bend
    handle instead of a box (`selection/lineHandles.js`). Curved lines store
    3 points plus `payload.curved` and render with tension. The line bar has
    − / + thickness.
  - The paint bucket is now a tool (`fill`, `ink/paint.js`): pick a colour,
    click things to paint them. It is separate from the default fill for new
    shapes (shape picker).
  - Verified headless: arrow handles, single menu, picker, icon, Esc.
  - Precision-eraser icon redone again (the ring version read as a "black hole"):
    a smaller lucide eraser whose tip sits in a gap cut in a line. Thickness
    steppers (−  n  +) made compact on every bar.
  - Last round: the floating bar is ONE row (the groups sit side by side, so
    with everything showing it runs ~1300 px and the half-width dock view clips
    it). Font size is − n +. Cards hide their × while selected (the bar's
    trash does it). Next: section 3.
