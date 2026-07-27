# Plan — Command Palette + Live-Preview Tables

Two independent desktop features. Neither touches the sync layer or needs the
Android toolchain. Written 2026-07-21.

---

# 1. Command Palette (`Cmd/Alt+Shift+P`)

## Goal
A keyboard-driven overlay: press the shortcut, type a command name, hit Enter.
Runs editor formatting on the current caret/selection, or navigates the app —
so you never have to reach for the dock or the mouse mid-thought.

## What makes this cheap
The dock is already a **declarative command array** in `EditorDock.jsx`:
```js
{ key: 'bold', title: 'Bold', action: v => wrapSelection(v, '**') }
```
The real logic lives in `cm/formatting.js` (`wrapSelection`, `toggleLinePrefix`,
`insertWikilink`). The palette is a **second front-end over that same array** —
a search list instead of a button row. No new formatting logic.

`wrapSelection` already only wraps when there's a selection, so "bold only if
highlighted" needs zero extra work.

## Architecture

1. **Extract the command list.** Move the `ACTIONS` array out of `EditorDock.jsx`
   into a shared `cm/commands.js` (or `commands/registry.js`) so both the dock and
   the palette import it. Each entry: `{ id, title, keywords, run(view) }`.
   This is a pure refactor — the dock keeps working unchanged.

2. **Two command categories:**
   - **Editor commands** — need a focused CodeMirror view. Sourced from the shared
     array above. Disabled/hidden when no editor is focused.
   - **Navigation commands** — `{ id, title, run(navigate) }` using react-router:
     "Go to Tasks", "Go to Calendar", "Go to Notes", "Open task…", etc. These are
     always available.

3. **Grabbing the focused editor.** Reuse the existing imperative-handle pattern —
   `CodeMirrorEditor.jsx` already exposes `searchApiRef`/`apiRef`. Add a tiny
   "last focused editor view" registry (a module-level ref updated on CM focus).
   The palette dispatches `command.run(lastView)`. CM6 keeps its selection when
   blurred, so opening the overlay doesn't lose the caret — dispatching back in
   after close just works. This is exactly how the in-note search already behaves.

4. **The overlay.** A new `CommandPalette.jsx` mounted once near the app root
   (like `ToastContainer`). Global keydown for `Cmd/Alt+Shift+P`. A text input +
   filtered list. `StarCanvas` already pauses on modal presence via
   `utils/modalPresence` — reuse it so the palette counts as a modal.

5. **Fuzzy matching.** Simple subsequence/rank match over `title + keywords`.
   No dependency needed; ~30 lines. (If it ever needs to be fancier, `fzf`-style
   scoring can drop in behind the same interface.)

## Phases
- **P1** — refactor `ACTIONS` into shared registry; palette overlay; editor
  commands (all current dock actions) + a handful of navigation commands. This is
  the whole "efficiency" win.
- **P2** — richer navigation: "Open task <name>", "Open note <name>" (query the
  stores for a live sub-list), recent commands first, per-command icons.
- **P3** — user-facing: show the keybinding next to each command; make the palette
  the discoverability surface for shortcuts.

## Risk
Low. The one thing to get right is focus management (overlay vs. editor), and the
precedent for it already exists in the search feature.

---

# 2. Live-Preview Tables (Obsidian / Logseq style)

## The actual problem
Insert a table today and you see raw pipes-and-dashes markdown while writing,
which is hard to read. Reading mode renders it fine — the editor just doesn't.
Goal: render the table **in the editor** while the caret is elsewhere, and reveal
the raw markdown to edit when the caret enters it. (Same behavior links already
have in this editor.)

## What makes this realistic (facts checked)
- The editor parser is **GFM-based** (`markdownLanguage`), so `Table` nodes
  already exist in the syntax tree — `livePreview.js` can find them with the same
  `syntaxTree(state)` walk it already does.
- The reading view **already renders tables to HTML** (`markdownToHtml.js` uses
  `remarkGfm`) — that renderer is reusable for the widget's DOM.
- **Block-widget precedent exists**: `livePreview.js` already notes that block
  decorations (HR, etc.) come from a slim StateField, and `widgets.js` has
  `HrWidget`, `ImageWidget`, `CheckWidget` (all `WidgetType` with `eq`/`toDOM`/
  `ignoreEvent`). A `TableWidget` slots in beside them.
- **`atomicRanges`** already makes the caret skip hidden spans — same mechanism a
  replaced table block uses.

## Approach: reveal-on-caret block widget

The "hard" version of live tables is editing inside a rendered grid. We get 90% of
the value without it by matching what this editor already does for links:

- **Caret NOT inside the table** → replace the table's line range with a
  `Decoration.replace({ widget: new TableWidget(md), block: true })`. The widget's
  `toDOM` renders the same `<table>` HTML the reading view produces.
- **Caret inside the table** → no replacement; show the raw markdown source, fully
  editable, exactly as today. Entering the table = clicking it or arrowing in.

This directly fixes the complaint (you see a real table as you write around it),
stays 100% consistent with the link/wikilink behavior already in the editor, and
never has to solve contenteditable-cell round-tripping.

## Phases
- **P1 — render-when-away.** The block above. Detect `Table` nodes in the block
  StateField, render via the shared table renderer, reveal on caret-inside.
  Reuse `markdownToHtml`'s table path (or a slim table-only renderer to avoid
  pulling the full remark pipeline into the hot decoration path — decide during
  build; a dedicated `renderTableHTML(md)` is probably worth it for speed).
  **This alone solves the problem you hit.**
- **P2 — insert-table UX.** "Insert Table" (dock + command palette) drops a
  starter 2×2 GFM table at the caret and puts the caret in the first cell. Because
  P1 renders on caret-leave, it "becomes a table" the moment you click away.
- **P3 (optional, the big one) — interactive cells.** Click a rendered cell to
  edit in place; Tab moves between cells; edits write back to the markdown source.
  This is genuinely large (contenteditable ↔ doc sync, column alignment, add/remove
  row/column controls). Explicitly separate; only if P1/P2 aren't enough.

## Risks / things to watch
- **Performance.** Table detection lives in the block StateField, which re-scans on
  doc change + caret move. Keep the render cheap (dedicated table renderer, `eq()`
  comparing the table's source text so unchanged tables don't re-render).
- **Folding & selection interplay.** The editor has fold persistence and multi-line
  selection painting; a block widget must coexist with both. `atomicRanges` handles
  caret skipping; test drag-select across a rendered table.
- **The drift test.** There's a Vitest drift test guarding editor↔reading-view
  consistency. A live table must render the *same* structure the reading view does —
  reusing the reading-view renderer keeps them in lockstep by construction.

---

## Sequencing recommendation
Command Palette P1 first (fast, high daily value, low risk), then Live Tables P1
(directly fixes a real pain point, medium effort). Insert-Table (Palette + table
P2) ties them together. Interactive cells (table P3) is a maybe-later.
