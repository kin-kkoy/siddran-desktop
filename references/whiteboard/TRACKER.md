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

5. **Where a widget's own records live (section 5): inside the board file**
   (decided 2026-11-13). One file: the CLI carries it, undo works as for
   everything else, and a copied board keeps its data. No sibling file.

6. **A widget doesn't carry what's underneath it** (2026-11-13). Board shapes
   paint beneath widgets, so any under one stay put when it moves.

7. **Sticky attachment on frames AND widgets, with a crop ⇄ hang toggle
   per container; hang is the default** (2026-11-13). It began as a trial on
   widgets only; the user kept it and asked for frames too.

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

## Section 3 — Diagram from nodes (node editor)  ✅ done (session 3) — checked by the user, committed

The user loves "Diagram from text" (Mermaid) but wants a **human, node-based**
way to build the same thing. Keep the text mode for AI and paste.

- [x] A node-editor panel/mode: add nodes, drag from a node's port to another
      to link, label edges, pick a node's kind (box/decision/start-end/
      data/database). Live preview using `flow/flowText.js` layout, then insert.
- [x] Two-way: open an existing diagram selection in the node editor, and
      round-trip with `itemsToFlow`.
- [x] Build it as a **pop-up window** (decided), with Nodes and Text tabs.
- [x] Give it its own dock icon. The user asked for a new look; it's now
      `LuWaypoints` as a stopgap. Pick one that reads as "node graph" once
      the node editor exists.
- [x] `flowText.js` mirrors the CLI's `core::diagram`. Change one and you must
      change both.

## Section 4 — CLI follow-ups (repo `../Siddran-CLI`)  ✅ done (session 4) — checked headless, committed

- [x] `sandbox_read`: list frames as frames (title plus contents), not as empty
      boxes. Stickies read as sticky notes.
- [x] `sandbox_edit`/`sandbox_diagram`: accept the new shape kinds, `headStart`,
      `lineStyle` and `routing: "curved"`.
- [x] Also from section 3: a connector's `avoid` (go around boxes) and
      `body: "tapered"`, and a shape's `flowDrop` (the node editor's lowered
      level). The CLI only needs to keep them when round-tripping; it doesn't
      have to lay them out. Layout stays CLI-mirror only: the families and
      lowering are desktop-only (user's decision).
- [x] Keep the parity tests between `flowText.js` and `diagram.rs` green.

## Section 5 — Format shell + shared record model (prerequisite for 6–11)  ✅ built (session 5) — **check-in: awaiting the user's hands-on check**

- [x] **First, before any Format work: measure drag smoothness.** The user
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

- [x] Window chrome on the canvas: a title bar, resize, and focus mode
      (fullscreen) as an overlay.
- [x] Shared dataset model. Records and fields live in the board file
      (decided: inside the board, not a sibling file). Table, Timeline, Kanban and Matrix
      are views of one dataset.
- [x] Undo, merge (`mergeRows` is per item; a dataset may need per-record
      merging) and CLI round-trip.
- [x] Data source per widget, **linked tasks or own records** (decided: both).
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

## Deferred (do near the end, around section 11)

- [ ] **Connection outlines on the board** (agreed 2026-11-13; the node editor
      already dims). Select a box (or several) and its links, plus the boxes
      at their other ends, get a thick, semi-transparent cyan/teal glow:
      just outside each box's edge, and as a halo under each link. Select a
      link and its two end boxes get it. Rules:
      - No dimming and no toggle.
      - The glow keeps a constant width on screen at any zoom.
      - Deeper teal on a light theme.
      - Hidden while dragging.
      - Nothing shows when the selection has no connections.
      - The clicked item keeps its normal selection handles.
      Build it as ONE overlay drawn from item bounds and connector points, not
      by touching each layer. Share the "what's connected" logic with
      NodeEditor's `focus`.

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
- 2026-11-12 · session 3 · section 3 built. "Diagram from text" is now the
  **Diagram** pop-up (`flow/DiagramModal.jsx`), with Nodes and Text tabs.
  FlowTextModal is gone.
  - Nodes tab (`flow/NodeEditor.jsx`): the drawing IS the preview. Positions
    come from `layoutGraph`, so nothing is dragged into place. + / N adds a
    node. Dragging from a node's dot onto another links them; dropping on
    empty space makes a new linked node. Tab adds the next step, Del removes,
    Enter renames. The side panel has the label, 8 kinds (step, rounded,
    start/end, decision, data, database, circle, prep), and per link: label,
    arrowhead, dashed, reverse.
  - Model (`flow/flowGraph.js`, tested): graph edits, `graphToText` ⇄
    `textToGraph` (the Text tab, lossless when the text isn't edited),
    `itemsToGraph` (numbers nodes exactly as `itemsToFlow` / the CLI's
    `describe` do), and `planDiagram`. For a new graph, `planDiagram` gives
    byte-for-byte what `flowToItems` gives (tested), so the CLI parity holds.
    **flowText.js and diagram.rs are unchanged.**
  - Two-way: D (or the floating bar's new Workflow button) on a selected
    diagram opens it as "Edit diagram". Update re-lays it out at the same
    top-left, in place, as ONE undo step. Boxes keep their ids and styles; an
    untouched label keeps its size. Removed boxes take their links (even
    those to outside boxes) with them. Old link bends are dropped. With
    nothing selected, D or the dock button starts a new diagram.
  - Dock icon is now `LuWorkflow`. Shape outlines in the editor come from the
    registry render fns (`flow/svgPath.js` records the ctx calls as SVG).
  - Keys stay in the pop-up: the page ignores keys while it's open, and the
    pop-up stops propagation. A backdrop click only closes it when nothing
    has been changed.
- Checked headless on a copy of the test Bag (localStorage backed up and
  restored): opening a selection, adding nodes with N / typing / Tab,
  Ctrl+Enter Update, a single Ctrl+Z, Ctrl+Y. The preview routes links round
  other boxes the way the board does. Port dragging and clicking kinds can't
  be driven headlessly; the user checks those at the end. Next: section 4.
- 2026-11-12 · session 3 · user feedback round on the node editor:
  - **Nothing jumps any more.** The view no longer re-fits after every
    change. It holds still around the node you're on (the camera shifts by
    that node's move), other nodes glide to their new places in 200 ms
    (new ones grow out of their linked node), and the selected node is
    panned into view if needed.
  - **Zoom and pan:** the wheel zooms at the pointer (as on the board); drag
    empty space or middle-drag to pan; a − n% + ⛶ pill sits bottom-left;
    keys `=`/`-` zoom on the selected node and `1` fits everything.
  - **One "+" handle** on the outgoing side, in place of the four dots:
    click it for the next step, drag it onto a node to link.
  - **Families as rows:** unlinked groups stack top to bottom, 144 px apart.
    (Superseded in the next round: families now sit side by side, desktop only.)
  - **Shapes:** the kind picker is the shape menu's own Basic / Flowchart /
    Callouts sections (`ShapeThumb` is exported from ShapePicker). Kinds
    with no text form are written as `[box]` and kept when that line comes
    back unchanged; `terminator` is written as `([pill])`.
  - **Icons:** a custom `DiagramIcon` (box → diamond → pill) on the dock and
    the floating bar, and a `NextStepIcon` (box → ⊕) for "next step", both
    in `flow/icons.jsx`.
  - **Dock: one item active at a time.** Opening the shapes or media menu
    drops the held tool (text, pen, sticky…) to Select, so a board click
    with the menu up no longer drops text. While a menu is open, its button
    is the only one lit.
  - Esc / Ctrl+Enter work even when focus slips out of the pop-up, and other
    keys pull focus back in (seen headless: Ctrl+A selected the whole page).
  - Verified headless (Bag copy, localStorage restored): the T→S dock fix,
    the new family's row, the camera following, zoom on the selection, the
    shape picker, both icons.
- 2026-11-12 · session 3 · second feedback round: arranging. **Desktop only
  (the user's decision): the CLI/MCP layout is NOT to follow.** `flowText.js`
  is back to the CLI mirror, plus one opt-in hook (below) that diagram.rs
  doesn't need.
  - **Families side by side, across the flow:** in columns when the flow runs
    down, in rows when it runs right, `GAP_FAMILY` (144) apart. This lives in
    `flowGraph.layoutFor` (one `layoutGraph` call per family). Family order is
    node order, so **Arrange → Family ‹ ›** (or Alt + an arrow across the
    flow) swaps whole node blocks (`moveFamily`). On re-open, reading order
    gives back the same order.
  - **Lowering a node** (Arrange → Level, or Alt + an arrow along the flow):
    only a node with no children; never past its family's deepest level; a
    parent always stays directly above its children. Stored on the graph as
    `node.drop` and on the board as the optional `payload.flowDrop` (kept by
    the Text tab by key). `layoutGraph(…, { drop })` applies it, and only
    then adds invisible **lane nodes** on the levels a lowered link skips (the
    classic layered-layout dummy, `LANE` = 48), so the link has a clear
    column. It returns `turns`, and `laneBend` turns them into a connector
    `bend` (jog just past the parent, then straight down the lane), used by
    both the preview and the board. Tested: in both directions the link
    crosses no box and no boxes overlap.
  - "**+ Root node**" is a labelled button. The how-to is a card toggled by a
    ? button (or the `?` key) that stays up while you edit (remembered in
    `siddran_sandbox_diagram_help`). The side panel says what to do when
    nothing is selected.
  - Fixed: the view could open scrolled wrong when the first fit ran while the
    pop-up was still settling its size. It now keeps fitting until you zoom,
    pan or edit.
  - Verified headless: the user's example (the right child lowered beside
    the left branch's deepest leaf, its link down a clear lane), the family
    columns and Alt+← reorder, the Arrange panel, Update matching the
    preview, and the help toggle.
- 2026-11-12 · session 3 · third feedback round:
  - **Camera only follows near the edge** (`flow/camera.js`, tested). No more
    holding the node still. When the layout changes, the view stays put
    unless the node you're on gets into the outer 10% band of the view (or
    out of it). Then it pans, on that axis only, so the node sits halfway
    between the middle and that band. Zoomed out with everything in view,
    nothing moves.
  - **Link styles in the editor**, the same choices as the floating bar's
    connector row (shared constants in `connectors/controls.js`): route
    (straight = separate arrows fanning out to each child, elbow = one
    trunk that splits, curved), start and end heads, solid/dashed/dotted,
    tapered, width, colour, and the label. Per link when one is selected;
    **All links** when nothing is. The preview draws them exactly as
    ConnectorLayer does (trim, heads, dash, taper; selection is a halo, so
    the colour still shows).
  - Model: a link's text-expressible facts stay `head` / `dashed`; the rest
    is an optional `edge.look` (routing, head, headStart, stroke,
    strokeWidth, lineStyle, body). It is read from and written to the
    connector payload, and kept across Text-tab edits by matching ends.
    Lowered-node lanes only bend elbow links.
  - Verified headless: board vs preview with five styled links, the All
    links panel, and the camera (a new root at the edge pans the view;
    moving a family that stays in view doesn't).
- 2026-11-12 · session 3 · fourth feedback round (the user's last for section 3):
  - **Go around boxes** for straight and curved links (`connectors/avoid.js`,
    tested). It is optional `payload.avoid` on a connector, off by default
    (= straight through, as before). When on and the direct path would run
    through a box (its own two included), the link takes the shortest way
    round instead: a visibility graph over the corners of the boxes grown by
    14 px, searched with A*, leaving and arriving square to its sides. Curved
    links take the same path with rounded corners. A box holding either end
    (a frame) is ignored. It lives in `routeConnector`, so the board, the
    editor preview and anything else that routes connectors agree. Toggle:
    Go direct / Go around in the editor's link panel (and All links), and a
    button on the floating bar's connector row (straight/curved only).
  - **Selection focus in the node editor:** select a node and it, its links
    and the nodes at their other ends stay bright while everything else dims
    (opacity 0.22). Select a link: it and its two ends. Nothing selected:
    nothing dims. Editor only; the board is unchanged.
  - Verified headless: a board link set to go around clears the box in its
    way, the editor draws it the same, and dimming works for a new root and
    for a Tab-added child.
- 2026-11-13 · session 3 · fixes from the user's hands-on check:
  - **The editor lays out as a family tree** (`layoutGraph(…, { tidy })`,
    desktop only; text-to-diagram, Tidy and the CLI are unchanged). Each node
    hangs from one parent: the one on the level just above it, else the
    first. Each branch gets its own band. Children sit in the order they were
    added, and a parent is centred over its first and last child. This fixed
    two bugs:
    - A new child landed on the far side of a cousin and its link crossed
      over. Cause: the barycentre up-sweep compared positions from two
      different rows.
    - A parent sat off-centre over its children.
    For a straight chain the result is identical to text-to-diagram (tested);
    for branches only positions differ.
  - **Dimming only on a deliberate click.** A node selected because you just
    added it (Tab, the + handle, Root node, a drag-link) doesn't dim anything.
  - **New links take the diagram's link style.** "All links" also sets
    `graph.look`, which `connect` applies to every new link. Reopened from
    the board, it is the look most links share. The Text tab keeps it.
  - The link palette fills the panel (8 per row, centred).
  - Verified headless: the user's tree is centred all the way down, new
    nodes don't dim, and links added in a curved diagram are saved as curved.
  - Note for the user: "go around" rarely shows in the editor because its
    layout keeps boxes out of the way. It matters on the board once boxes
    are moved by hand.
- 2026-11-13 · session 3 · bug: panning over a card. The bug was in all four
  cards (text, note, task, PDF) through the shared `useCardPointer`.
  Middle-drag panned AND dragged the card. Space-drag only dragged it,
  because the canvas skipped card presses before checking for a pan. Fix,
  in SandboxCanvas's native pointerdown, which runs before the cards' React
  handlers:
  - a middle press, or Space / the pan tool, now takes the press over cards
    too (selection handles excepted);
  - it calls `stopPropagation`, so the card never starts a drag.
  Gestures can't be driven headlessly; the user checks it by hand.
- 2026-11-13 · session 4 · section 4 built. The CLI work is on a new branch
  `whiteboard` in `../Siddran-CLI` (its `master` is untouched), uncommitted
  until the user says so.
  - **The vocabulary lives in `diagram.rs`:** `BOX_KINDS` (all 35 box shapes
    plus `sticky`), `LINE_KINDS`, `HEADS`, `LINE_STYLES`, `ROUTINGS`. A new
    desktop test pins the same lists against the registry and connector
    constants, so a new shape kind fails there until the CLI learns it.
  - **`describe` and `itemsToFlow` both skip frames and line shapes** (the
    rule is `isDiagramShape`, which now lives in flowText.js and is
    re-exported by flowGraph.js). Both have a matching test. Stickies stay
    boxes, so links to them still show, and the node editor numbers keys the
    same way.
  - **`sandbox_read`** adds `shape` to each `box_ids` entry, a
    `sticky_notes` list (key, id, text, colour) and `frames`. Each frame
    lists its title and what is inside it: box keys, text ids, nested frame
    ids and counts of the rest. An item belongs to the smallest frame that
    holds its centre. A frame belongs to another only if it fits wholly
    inside it. Line shapes are counted as `lines`.
  - **`sandbox_edit`:**
    - `add` takes any box kind, `sticky` (192 px, `#FFE45C`, the templates'
      payload), `frame` (`around` boxes with 40 px padding, like "Frame
      selection", z below everything, the `framePayload` fields), `fill`, and
      `w`/`h`.
    - Arrows (from `after`, and in `connect`) take `routing`, `head`,
      `headStart` and `lineStyle`. Setting `lineStyle` removes the old `dash`.
    - `update` takes a connector id (label and style), renames a frame
      through `text`, and refuses an unknown shape. A typo would otherwise
      draw nothing.
    - New boxes can now land inside a frame (frames are no longer obstacles
      for free space).
  - **`sandbox_diagram`:** `shapes` (node key → kind) and `links` (a style
    for every arrow; a `---` or `-.->` in the text wins).
  - `avoid`, `body`, `bend` and `flowDrop` survive an edit (tested). The CLI
    still doesn't lay them out.
  - Checks: CLI `cargo test` passes (6 new tool tests, 1 new core test);
    clippy shows only its 3 old warnings. Desktop `npm test` passes (616),
    lint is at the baseline of 25, build and `cargo check` pass. Checked with
    the real `siddran call` on a copy of the test Bag: a real board with two
    frames reads correctly, and draw → frame `around` → sticky `after` →
    read gives the expected frame contents. Then seen headless in the dev app
    (Bag copy; dev localStorage backed up and restored; opened with the CLI's
    `app_open`): all of it renders as intended. That's the titled frame, the
    sticky, the `document` shape, dotted curved links with circle start
    heads, the dashed `no` loop and the diamond head.
- 2026-11-13 · session 4 · the user had already checked section 3 by hand (see the "fixes from the user's hands-on check" entry), so no review is outstanding. **Next: section 5**, starting with the drag-smoothness measurement.
- 2026-11-13 · session 5 · **drag smoothness measured** (before any Format
  work). The dev app was already closed when the session started, so nothing
  was stopped. A dev-only probe (`app/src/dev/perfProbe.js`, loaded only when
  `VITE_PERF_PROBE=drag:<board>` is set) drives drags with synthetic pointer
  events on the busy test board (164 items, headless, Bag copy) and samples
  per-frame timings. Medians, 3 runs each:

  | | dev build | production bundle |
  |---|---|---|
  | drag one shape | 17 ms, 20–28 of 178 frames over 20 ms | 17 ms, 1–7 over 20 ms |
  | drag all 164 items | 30 ms on every frame (≈33 fps) | 21 ms (≈47 fps) |

  JS work per frame (React render + Konva draw) is only about 4–5 ms + 3–5 ms;
  the rest of a whole-board drag is browser paint. **Conclusion: the lag the
  user felt is mostly the dev build (React dev mode); the app code is not at
  fault for ordinary drags.** On top of that, one cheap paint fix: a
  multi-selection no longer redraws one outline per item while it moves
  (SelectionOverlay). That brought a whole-board drag to 20 ms, with
  17–79 frames over 20 ms instead of ~150. "Production" here means the
  production frontend bundle (`vite build` + `vite preview`, VITE_PERF_PROBE
  baked in) loaded by the debug shell. A real release binary would have used
  the installed app's own localStorage, so it was not run; the Rust side does
  nothing during a drag.
- 2026-11-13 · session 5 · **section 5 built** (Format shell + shared record
  model). New `app/src/components/Sandbox/formats/`:
  - **Model** (`formats.js`, tested): `type:'shape', kind:'format'` with
    `payload.view` (table|kanban|timeline|matrix), `title`, `source`,
    `fields` and `records: [{ id, values, updated_at }]`. Own records live in
    the payload (decision #5). A new widget has Title / Status (To do, Doing,
    Done) / Due.
  - **One adapter** (`dataSource.js`, tested): `{ fields, records, editable,
    canAdd, canRemove, add, update, remove }`.
    - `ownSource` writes the widget (one undo step per change, applied to
      the payload as it is at commit time).
    - `taskSource` reads the Bag's tasks (or one project's) with an
      open/all/done filter. It writes only through the app's tasks store
      (`useTasks` mutators, given to every board mount by the new
      `contexts/TasksApiContext.js`), so it goes through localStore and live
      sync and never touches tasks.siddran. Linked rows can't be deleted from
      a widget (too easy to delete real tasks by accident), and board undo
      doesn't cover task edits; the source menu says so.
    - Tasks have no tags in this app, so "filter by tag" became filter by
      project + open/all/done.
  - **Views**: `views/index.js` maps `payload.view` → component. Only the
    plain list (`ListView`) exists: done check, title edited in place, chips
    for the other fields, × on own records, "+ Add" at the bottom. Every view
    falls back to it until sections 6–7 add theirs. The Insert (media) menu
    has **Table**; other entries come with their views.
  - **Chrome** (`FormatWidget.jsx`): a DOM window drawn with the cards (above
    the Konva layers):
    - title bar = the handle; double-click renames;
    - a source chip with the record count opens the source menu;
    - ⛶ opens **focus mode** (full-window overlay of the same widget; Esc or
      the button goes back). Enter on a selected widget does the same.
    - Resizing uses the normal selection handles; no rotate knob.
    - The floating bar shows Full screen and Rename plus the usual actions.
  - **Moving carries what's on it, like a frame.** The title-bar press goes
    through the overlay's own move (snapping, groups, one undo step). Riders
    are decided at grab time: cards and smaller widgets stacked ABOVE it.
    Board shapes always paint beneath DOM, so any under a widget are hidden
    and are deliberately not carried. A frame carries the widgets in it.
  - **Merge** (`desktop/sync/merge.js` `mergeSandboxItems`, tested; used by
    localStore `absorbSandbox`): ordinary items still merge row by row. A
    widget edited on both sides merges key by key, and its `records` and
    `fields` record by record. Two sides adding or editing different records
    both keep their work. Only a record (or key) changed on both sides is a
    conflict, and the newer change wins.
  - Excluded from flowcharts everywhere: `isDiagramShape` (flowText.js) and
    `is_diagram_shape` (diagram.rs) both skip `kind: 'format'`. No connection
    dots, not a text target. Tab/Alt+arrows don't make "next steps" from it.
  - **CLI** (`../Siddran-CLI`, branch `whiteboard`): `FORMAT_KIND` /
    `is_format` in diagram.rs. `sandbox_read` lists `formats`: id, title,
    view, source; for own records, field names and records with values.
    Inside a frame a widget counts as `other.formats`. `sandbox_edit`
    `update` can rename a widget by id or title (`text`) and refuses
    shape/fill. Records survive any edit byte for byte (tested).
  - Checks: desktop `npm test` 631 pass, lint at the baseline 25, build and
    `cargo check` pass; CLI `cargo test` passes (2 new tests), clippy adds
    nothing. Seen headless in the dev app (Bag copy; dev localStorage backed
    up and restored afterwards; the headless output removed and every
    workspace back on eDP-1/HDMI-A-1), scripted by the probe's `format:`
    scenario. All of these were observed working:
    - insert from the menu; add 3 records; tick one done;
    - drag by the title bar: widget and a text card on it both moved
      (240, 88);
    - resize from the corner (420×320 → 540×420); no rotate knob;
    - Enter → full screen;
    - link to All tasks: 5 open tasks shown, ticking one wrote
      tasks.siddran in the copy;
    - back to own records: still 3;
    - Ctrl+Z / Ctrl+Y over the source change;
    - the board file holds the widget and its records; `siddran call
      sandbox_read` lists them.
  - **Please try (the hand-feel half, which headless can't do):**
    1. Media menu → Table. Drag it by its title bar. Does it feel like a
       frame?
    2. Drop a text box or note card on it, then move the widget.
    3. Resize it from the corners and edges.
    4. ⛶ or Enter for full screen, Esc to come back.
    5. Add and rename records, tick them, delete one; Ctrl+Z each step.
    6. Source chip → All tasks / a project, Open/All/Done. Tick a task, then
       check it on the Tasks page.
    7. Mouse-wheel over a long list scrolls the list; over the board it still
       zooms.
    8. Put a widget in a frame and move the frame.
    9. Say whether a widget should also carry hidden board shapes under it
       (it doesn't now).
  - Not done / for later: field editing beyond title and status (section 6
    Table), per-view settings, record reordering (a merge currently keeps
    base order, then new records). **Stopped at the planned check-in;
    section 6 not started.**
- 2026-11-13 · session 5 · user feedback on section 5: all 9 "please try"
  items work. #9 answered: a widget doesn't carry what's under it (decision
  6). Two follow-ups built:
  - **Sticky attachment + clipping — TRIAL, widgets only** (decision 7;
    `formats/attach.js`, tested).
    - A card or smaller widget DROPPED on a widget (or inserted onto one)
      gets `payload.attachedTo`; dragged off on its own, it detaches. Both
      are part of the same undo step as the move or insert.
    - A widget carries what's attached to it (recursively), wherever it
      hangs. Resizing never detaches. What sticks out past the widget's edge
      is clipped (CSS `clip-path` on a zero-size wrapper round every card,
      so attaching never remounts a card — a PDF iframe would reload). The
      widget shows "+N hidden" while anything is cut off.
    - Duplicating a widget with its riders re-points the copies at the copy.
    - Bug found and fixed on the way: moving a widget re-checked its riders
      on drop, and a card hanging past a shrunk widget's edge (centre
      outside) was detached. Items that moved with their own widget are now
      left alone.
    - **To remove the trial:**
      - delete `formats/attach.js` and its test;
      - in SandBoxPage: `addCard` → `act.addItem`, and drop `onMoveEnd`, the
        clip wrapper and `hiddenOn`;
      - drop the `onMoveEnd` prop in SelectionOverlay, useCardPointer and the
        four cards;
      - in SelectionOverlay startMove, give widgets back positional riders
        (DOM items above the widget whose centre is inside, as in 4eef61f),
        or none;
      - drop the duplicate re-pointing and the `.hiddenBadge` style.

      Old boards keep a harmless `attachedTo` field.
  - **Text size per widget**: `payload.fontSize` (default 15), set with
    − n + on the floating bar (any number of widgets selected) or
    Ctrl+Shift+> / <. The body is sized in em off it; full screen reads 15%
    larger.
  - Checked by the probe's `attach:` scenario (this time in a HIDDEN window on
    an unused workspace, no headless output; frames fall back to 50 ms
    ticks). All observed:
    - placing a text card on a widget attaches it;
    - shrinking past it keeps it attached with "+1 hidden";
    - moving the widget carries it (still attached, still clipped);
    - growing shows it whole (badge gone, still attached);
    - text 15 → 16 → 18;
    - dragging it off detaches;
    - Ctrl+Z re-attaches.
    **What the clipping looks like was NOT seen** (see the next entry); the
    user checks it by hand.
  - **Headless trap, twice this session:** creating the headless output
    moves the user's workspaces 3, 6 and 9 onto it, every time. The app
    once landed on the user's workspace 10 on HDMI. `grim` of the output then
    captured the user's browser instead of the app. Those captures were
    deleted, the output removed and the workspaces checked back. While the
    user is at the computer, run probes in a hidden window instead
    (`[workspace 19 silent]`, data only, no screenshots).

- 2026-11-13 · session 5 · user feedback (bright room): the floating bar's
  outline is now high-contrast. It uses a new theme token
  `--outline-contrast`: white on dark themes, black on light ones (set by
  every palette in SettingsContext). The widget badge now says "N cropped"
  (part of it shows) and/or "N out of view" (none of it shows) instead of
  "+N hidden". Not seen on screen: the user is at the computer, so no
  headless screenshots. The user is weighing a per-widget clip ⇄ hang toggle.
- 2026-11-13 · session 5 · **crop ⇄ hang toggle, per widget** (the user
  uses both): `payload.overflow` = 'clip' (the default; absent means clip)
  or 'hang'. The floating bar's crop button, lit while cropping, sets it for
  every selected widget (one undo step). A widget set to hang adds no crop
  and shows no badge. A rider of a hanging widget nested in a cropping one
  still gets the outer crop (`attach.js` `clipRect`, tested). Attachment is
  the same in both modes. It's on the floating bar rather than the widget's
  title bar: it's an occasional setting, and the title bar is the grab
  handle. If frames adopt sticky attachment, give them the same toggle.
- 2026-11-13 · session 5 · **sticky attachment extended to frames; hang is
  now the default** (decision 7). `formats/attach.js` became
  `selection/attach.js` (tested):
  - **Frames** take anything but connectors (another frame only if it fits
    wholly inside). A widget on top wins over the frame beneath; among frames,
    the smallest wins. Widgets still take only DOM things above them.
  - **Old boards:** things in frames with no `attachedTo` still ride by
    position. The first time a frame on the board is moved or resized, they
    are all stamped as attached (`stampPatches`, inside that gesture's undo
    step), so from then on a shrinking frame keeps them. Things drawn in a
    frame later are stamped the same way at the next frame gesture, or
    attached when dropped.
  - **Crop ⇄ hang** for frames too: the same floating-bar crop button, now
    OFF (= hang) by default for both. `payload.overflow: 'clip'` crops;
    absent or 'hang' hangs. Widgets that never set it now hang.
  - Cropping on the canvas: each cropped graphic is wrapped in a Konva
    `Group` clipped in world coordinates (GraphicsLayer; FrameLayer for
    nested frames). Cards still use the clipped wrapper. A cropping frame's
    title reads "Frame 1 · 1 cropped · 1 out of view".
  - **CLI** `frame_of`: an item attached to a frame belongs to it wherever it
    hangs; otherwise the old positional rule applies (tested). `attachedTo`
    and `overflow` survive edits.
  - Checked in a HIDDEN window (`frames:` probe scenario, live store, no
    screenshots) on the test board's "Frame 1" (a rect and ink, neither
    attached):
    - dragging the frame by its title moved both with it by (57, 40) and
      stamped both;
    - shrinking it to a quarter kept both attached, hanging, with no crop;
    - the crop button was off; turning it on cropped both (2 clipped Konva
      groups) and the title read "Frame 1 · 1 cropped · 1 out of view";
    - 3× Ctrl+Z restored the frame, the overflow setting and the
      attachments exactly.
    Desktop 642 tests pass, lint 25, build and `cargo check` pass. CLI 87
    tests pass, clippy unchanged. How it looks is unseen (the user is at the
    computer).

