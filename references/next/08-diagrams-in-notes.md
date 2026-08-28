# Flowcharts and diagrams inside a note

**Area:** Notes · **Size:** large

## What was seen

> The Note Editor should support creating flowcharts and similar diagrams, using
> the functionality that already exists in the Sandbox if possible. […] Port,
> reuse, or create a copy of the Sandbox's flowchart/diagram functionality inside
> the Note Editor.

The point is a note that holds the explanation *and* the picture: a database note
with its schema, a process note with its flowchart. The stated constraint is that
it must not turn the Note Editor into a Sandbox — writing stays primary.

## Decided (user, 2026-08-28)

These three were asked and answered. Do not re-open them without asking.

- **Storage: a fenced block in the `.md`.** ` ```siddran-diagram ` holding compact
  JSON, rendered as a widget so the JSON is not normally visible. The note stays
  one self-contained file — copy or move it and the diagram travels. Rejected:
  referencing a real Sandbox board (deleting the board would break the note, and
  it is "a sandbox shown in a note" rather than the note's own diagram) and a
  PNG-plus-sidecar (two files to keep in sync, and see `exportImage.js` below).
- **Editing: view inline, edit in an overlay.** Clicking the diagram opens the
  real Sandbox canvas and toolbar over the note; closing writes back to the
  fence. Maximum reuse, no new editing UI, and the note page stays a note page.
- **Tools: the flowchart subset** — shapes, connectors, and text-in-shape.
  Freehand, images, PDF and note/task cards stay a reason to open a real Sandbox.

## Verified

Read on 2026-08-28. The Sandbox's diagram engine is real and, more importantly,
already prop-driven — this is mostly assembly, not invention.

- `components/Sandbox/Canvas/GraphicsLayer.jsx:184` —
  `GraphicsLayer({ graphicItems, editingShapeId })`. A pure component over an
  item array.
- `components/Sandbox/Canvas/ConnectorLayer.jsx:54` —
  `ConnectorLayer({ connectorItems, byId, selectedIds })`. Likewise.
- `components/Sandbox/connectors/geometry.js` — connectors bind to a shape's
  **side** and re-resolve from the current item boxes every render
  (`connectorPoints`), so they reroute when a shape moves. This is the hard part
  of a diagram tool and it is done.
- `components/Sandbox/shapes/registry.js` — the shape vocabulary (rect, ellipse,
  rhombus, triangle, hexagon, star…). `renderShape(kind, ctx, w, h, radius)`
  draws a closed path into a **canvas2d ctx**.
- The item model, from `SandboxCanvas.jsx:531` and `GraphicsLayer.jsx:68`:
  `{ id, type: 'shape'|'connector'|…, x, y, w, h, rotation, z_index, payload }`.
  Shape payload: `{ kind, fill, stroke, strokeWidth, radius, text, textAlign,
  textColor }`. Connector payload: `{ from: {itemId, side}|{point}, to: …,
  routing: 'elbow'|'straight', stroke, strokeWidth, head }`.
- `components/Sandbox/Canvas/SandboxCanvas.jsx:44` takes ~20 props, all state and
  callbacks — no hidden coupling to the Sandbox page. The overlay editor's real
  work is supplying a `canvas` object (see `hooks/useSandboxCanvas.js`) over a
  local item array instead of the board store.
- `components/Editor/cm/tables.js:38` — `TableWidget extends WidgetType` with
  `toDOM(view)` is the existing pattern for a rendered block widget in the
  editor. Copy its shape.
- Notes and sandboxes are ALREADY linked: `[[sandbox:7]]` is a typed wikilink
  with autocomplete (`cm/wikilinks.js`), and `EditorDock.jsx:258` opens a
  sandbox as a PiP beside a note. This task is the inline case, not the first
  connection between the two.

## The one real fork: how to DISPLAY a diagram

Editing reuses Konva (the decision above). Display is the open question, and it
is an implementation call, not a user one.

**Recommended: render to SVG, and reuse the shape geometry via a fake ctx.**

`ReadingView.jsx:263` renders notes with `dangerouslySetInnerHTML`, and the file
already carries a warning (`:119`) that React re-applying that innerHTML wipes
DOM mutations made underneath it. Mounting Konva React roots into that subtree
fights the architecture. An SVG string does not: it goes straight into the HTML
from `markdownToHtml.js`, works unchanged in the CodeMirror widget's `toDOM`,
and comes along in `utils/exportPdf.js` for free.

The duplication this seems to imply is avoidable. `registry.js`'s render
functions only ever call `moveTo` / `lineTo` / `arcTo` / `closePath` on the ctx
they are handed. Pass a **recording ctx** that implements those four methods and
emits an SVG path `d` string, and one shape vocabulary serves both backends with
no geometry written twice. `connectorPoints()` already returns flat world points,
which is a `<polyline>`.

## Not decided

- Whether a diagram is **created** from the editor dock, a slash command, or
  both. `components/Editor/editorCommands.js` is where commands are registered.
- What an **empty** diagram block looks like before anything is drawn — a
  placeholder with an "Edit" affordance, or open the overlay immediately.
- Whether the overlay is modal or a pane. `PaneLockContext` and the split
  machinery exist; a pane may be more in keeping, but it is more work.
- Whether the fence should carry a `v:` schema version. Cheap now, painful to
  retrofit — worth deciding before any note contains one.

## Watch out for

- **`exportImage.js` does not capture DOM cards.** Its own header says so: note,
  task and text cards live outside Konva. Any thought of "just rasterize the
  board" silently drops them. It is why the PNG storage option was rejected.
- Konva paints to `<canvas>`, which **cannot resolve CSS variables** —
  `ConnectorLayer.jsx:7` hardcodes the accent for exactly this reason. An SVG
  renderer CAN use variables, so it must not simply copy those literals if the
  diagram is meant to follow the theme.
- The fence is user-editable text. A malformed or hand-mangled JSON payload must
  degrade to showing the raw block, never throw — `tableRender.js:17` has the
  precedent ("show the raw text rather than an empty box").
- Build the SVG with DOM calls or an escaped serializer, never string
  concatenation of note content. `tableRender.js` sets cells via `textContent`
  and says why; shape `text` reaches the same place.
- Notes autosave on a 1.5 s debounce. Writing back from the overlay on every
  canvas change would thrash the file; write back on close, or debounce hard.
