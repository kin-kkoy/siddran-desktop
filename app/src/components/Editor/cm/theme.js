import { EditorView } from '@codemirror/view'

// Cinder dark-cosmic theme for the CodeMirror live-preview editor. Built on the
// app's existing CSS variables (NOT Obsidian purple — see the sandbox-aesthetic
// feedback). Decoration classes (.cm-strong, .cm-h1, …) are assigned literally
// by buildDeco, so we style them here; EditorView.theme scopes every selector
// under the editor's generated class, keeping them from leaking globally.

export const cinderTheme = EditorView.theme({
  '&': {
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    fontSize: '16px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
  },
  // The editor grows with its content and the page scrolls (one page scrollbar,
  // matching the note layout). CM's caret motion doesn't depend on owning the
  // scroll because Arrow-keys and clicks are resolved via the browser's real
  // hit-testing (see verticalMotion.js), not CM's estimated height model.
  '&.cm-editor': { height: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'inherit',
    // Small bottom padding only — a large value shows as dead space below the
    // last line on long notes (the editor grows with content / page-scrolls).
    padding: '4px 0 40px 0',
    lineHeight: '1.75',
    caretColor: 'var(--text-primary)',
  },
  '.cm-line': { padding: '0' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.75', overflow: 'visible' },
  '.cm-cursor': { borderLeftColor: 'var(--text-primary)', borderLeftWidth: '2px' },
  '.cm-placeholder': { color: 'var(--text-faint)' },

  // Selection (drawSelection)
  '.cm-selectionBackground': { background: 'var(--bg-hover)' },
  '&.cm-focused .cm-selectionBackground': { background: 'var(--bg-hover)' },

  // ── Inline marks ──
  '.cm-strong': { fontWeight: '700', color: 'var(--text-primary)' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through', color: 'var(--text-muted)' },
  '.cm-underline': { textDecoration: 'underline' },
  '.cm-code-inline': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '0.86em',
    background: 'var(--bg-hover)',
    borderRadius: '4px',
    padding: '1px 5px',
    color: 'var(--accent-warning)',
  },

  // ── Headings (line decorations) ──
  '.cm-line.cm-h': { fontWeight: '700', letterSpacing: '-0.01em', color: 'var(--text-primary)' },
  '.cm-line.cm-h1': { fontSize: '1.9em' },
  '.cm-line.cm-h2': { fontSize: '1.55em' },
  '.cm-line.cm-h3': { fontSize: '1.3em' },
  '.cm-line.cm-h4': { fontSize: '1.12em' },
  '.cm-line.cm-h5': { fontSize: '1em' },
  '.cm-line.cm-h6': { fontSize: '0.9em', color: 'var(--text-muted)' },

  // ── Links ──
  '.cm-external-link, .cm-link-active': {
    color: 'var(--accent-blue)',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  '.cm-external-link:hover': { textDecoration: 'underline' },

  // ── Blockquote ──
  '.cm-line.cm-quote': {
    borderLeft: '3px solid var(--border-strong)',
    paddingLeft: '14px',
    color: 'var(--text-secondary)',
  },

  // ── Fenced code (line decorations) ──
  '.cm-line.cm-codeblock': {
    position: 'relative', // anchors the absolutely-positioned copy button
    background: 'var(--bg-surface-alt)',
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '13.5px',
    color: 'var(--text-secondary)',
    paddingLeft: '15px !important',
    paddingRight: '15px !important',
  },

  // Code-block "Copy" button (cm/codeCopy.js): floated top-right, out of flow.
  '.cm-code-copy-btn': {
    position: 'absolute',
    top: '4px',
    right: '8px',
    zIndex: '3',
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '11px',
    lineHeight: '1',
    padding: '3px 8px',
    color: 'var(--text-secondary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    cursor: 'pointer',
    opacity: '0.5',
    transition: 'opacity 120ms ease, color 120ms ease',
  },
  '.cm-code-copy-btn:hover': { opacity: '1', color: 'var(--text-primary)' },

  // Inline images (cm/widgets.js ImageWidget) + drag-resize handle.
  '.cm-img-wrap': { position: 'relative', display: 'inline-block', maxWidth: '100%', margin: '0.2em 0' },
  '.cm-img': { maxWidth: '100%', borderRadius: '6px', display: 'block' },
  '.cm-img-resize': {
    position: 'absolute',
    right: '6px',
    bottom: '8px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: 'var(--accent-blue)',
    border: '2px solid var(--bg-primary)',
    cursor: 'ew-resize',
    opacity: '0',
    transition: 'opacity 120ms ease',
  },
  '.cm-img-wrap:hover .cm-img-resize': { opacity: '1' },
  '.cm-line.cm-codeblock-top': {
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    paddingTop: '9px !important',
  },
  '.cm-line.cm-codeblock-bot': {
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
    paddingBottom: '9px !important',
  },

  // ── Bullets / rules / checkboxes (widgets) ──
  // display:inline (not inline-block) so negative text-indent on the list line lays
  // the bullet out like the ordered-number text — inline-block widgets don't shift
  // with text-indent, which blows out the marker→text gap. marginRight gives the
  // gap the fixed width used to provide (~0.9em footprint total).
  '.cm-bullet': { color: 'var(--accent-blue)', display: 'inline', marginRight: '0.45em' },
  '.cm-ordered-mark': { color: 'var(--accent-blue)' }, // ordered list number, matches bullet + reading view
  '.cm-line.cm-hr-line': {
    lineHeight: '0',
    padding: '0.4em 0',
    background: 'linear-gradient(to bottom, transparent calc(50% - 0.5px), var(--border-strong) calc(50% - 0.5px), var(--border-strong) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
  },
  '.cm-task': { display: 'inline' }, // inline so it shifts with the line's text-indent
  // Completed task: grey the label text (the checkbox keeps its accent colour since
  // that's an accentColor, not a text colour). Matches the reading view.
  '.cm-line.cm-task-checked': { color: 'var(--text-muted)' },
  '.cm-task-check': {
    width: '15px',
    height: '15px',
    verticalAlign: '-2px',
    marginRight: '6px',
    cursor: 'pointer',
    accentColor: 'var(--accent-blue)',
  },
  '.cm-line.cm-list-line': {
    // Hanging indent via padding-left + negative text-indent (NOT a negative margin
    // on the marker). text-indent shifts the WHOLE first visual row — leading
    // spaces, marker and all — left by --hang, so the marker keeps its position but
    // the line's first coordinate moves with it, letting the selection layer paint
    // over the marker (a negative margin leaves the marker in the padding, which the
    // selection never covers). Requires the markers to be display:inline (above) so
    // they shift with text-indent. Wrapped rows ignore text-indent and stay at
    // padding-left, landing under the first content character.
    // The leading 1.25em reserves clean content-space for the inline fold chevron.
    paddingLeft: 'calc(1.25em + var(--nest-pad, 0em) + var(--hang))',
    textIndent: 'calc(-1 * var(--hang))',
    position: 'relative', // anchors the absolutely-positioned inline fold chevron
  },

  // Wikilinks (cm/wikilinks.js): rendered internal link, unresolved variant, and
  // the revealed `[[ ]]` source when the caret is on it.
  '.cm-internal-link': {
    color: 'var(--accent-blue)',
    cursor: 'pointer',
    textDecoration: 'none',
    borderBottom: '1px solid transparent',
  },
  '.cm-internal-link:hover': { textDecoration: 'underline' },
  '.cm-internal-link.is-unresolved': {
    color: 'var(--text-muted)',
    borderBottom: '1px dashed var(--text-faint)',
  },
  '.cm-wikilink-src': { color: 'var(--accent-blue)' },

  // Typed cross-links (cm/wikilinks.js): task = clock glyph + task colour,
  // sandbox = grid glyph + sandbox colour. Both also carry .cm-internal-link.
  '.cm-task-link': { color: 'var(--src-task)' },
  '.cm-task-link::before': { content: "'◷ '", opacity: '0.85' },
  '.cm-sandbox-link': { color: 'var(--src-sandbox)' },
  '.cm-sandbox-link::before': { content: "'▦ '", opacity: '0.85' },
  '.cm-bundle-link': { color: 'var(--src-bundle)' },
  '.cm-bundle-link::before': { content: "'⊞ '", opacity: '0.85' },

  // ==highlight==
  '.cm-highlight': { background: 'rgba(240, 184, 64, 0.22)', borderRadius: '3px', padding: '0 2px' },

  // #hashtags — clickable pill (searches notes).
  '.cm-hashtag': {
    color: '#c084fc',
    background: 'rgba(192, 132, 252, 0.15)',
    borderRadius: '20px',
    padding: '1px 8px',
    fontSize: '0.85em',
    fontWeight: '500',
    cursor: 'pointer',
  },
  '.cm-hashtag:hover': { background: 'rgba(192, 132, 252, 0.28)' },

  // ||spoiler|| — blocked out, hover reveals.
  '.cm-spoiler': {
    color: 'transparent',
    background: 'var(--text-faint)',
    borderRadius: '3px',
    cursor: 'pointer',
    transition: 'color 0.1s ease, background 0.1s ease',
  },
  '.cm-spoiler:hover': { color: 'var(--text-primary)', background: 'var(--bg-hover)' },

  // > [!type] callouts — coloured block by type (line decorations).
  '.cm-line.cm-callout': {
    borderLeft: '3px solid var(--accent-blue)',
    paddingLeft: '14px',
    background: 'rgba(90, 156, 240, 0.06)',
  },
  '.cm-line.cm-callout-warning, .cm-line.cm-callout-question, .cm-line.cm-callout-caution': {
    borderLeftColor: 'var(--accent-warning)',
    background: 'rgba(240, 184, 64, 0.06)',
  },
  '.cm-line.cm-callout-danger, .cm-line.cm-callout-error, .cm-line.cm-callout-bug, .cm-line.cm-callout-failure': {
    borderLeftColor: 'var(--accent-danger)',
    background: 'rgba(224, 92, 92, 0.06)',
  },
  '.cm-line.cm-callout-tip, .cm-line.cm-callout-success, .cm-line.cm-callout-hint, .cm-line.cm-callout-done': {
    borderLeftColor: 'var(--accent-success)',
    background: 'rgba(82, 196, 122, 0.06)',
  },
  '.cm-line.cm-callout-head': { fontWeight: '600' },

  // Fold gutter (heading + list outline fold) — custom chevron on foldable lines.
  // Negative left margin pulls the whole gutter into the surface's left padding so
  // the editor TEXT lines up with the reading view (no gutter), and the chevron
  // sits clear of the text in the margin instead of crowding it.
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--text-faint)', marginLeft: '-22px' },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '0',
    minWidth: '18px',
  },
  '.cm-fold-chevron': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    marginTop: '5px',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    opacity: '0.7',
    cursor: 'pointer',
    transition: 'background 0.12s ease, color 0.12s ease, opacity 0.12s ease',
  },
  '.cm-fold-chevron svg': {
    width: '13px',
    height: '13px',
    display: 'block',
    transform: 'rotate(90deg)', // open: points down
    transformOrigin: '50% 50%',
    transition: 'transform 0.12s ease',
  },
  '.cm-fold-chevron.is-folded svg': { transform: 'rotate(0deg)' }, // folded: points right
  '.cm-fold-chevron.cm-fold-h1': { marginTop: '18px' },
  '.cm-fold-chevron.cm-fold-h2': { marginTop: '13px' },
  '.cm-fold-chevron.cm-fold-h3': { marginTop: '9px' },
  '.cm-fold-chevron.cm-fold-h4': { marginTop: '7px' },
  '.cm-fold-chevron.cm-fold-h6': { marginTop: '4px' },
  '.cm-fold-chevron:hover': {
    color: 'var(--text-primary)',
    background: 'var(--bg-hover)',
    opacity: '1',
  },
  '.cm-foldPlaceholder': {
    background: 'var(--bg-hover)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRadius: '3px',
    margin: '0 4px',
    padding: '0 6px',
  },
  // Inline list fold chevron (livePreview InlineFoldWidget): absolutely positioned
  // within the list line's reserved 1.25em lead, sitting just left of the bullet at
  // every depth (--nest-pad scales it with nesting). It spans the first text row so
  // it stays beside the bullet when the item wraps, and is a real click/hover target
  // with a hover pill. Out of flow → doesn't fight the bullet's negative margin.
  '.cm-fold-inline': {
    position: 'absolute',
    // Anchor to --mark (the marker's own x-offset = depth indent + leading spaces),
    // so the chevron sits a constant ~0.15em left of the marker for every marker
    // type (bullet / checkbox / number) and depth. (1.25em line lead − 0.9em box −
    // 0.15em gap = +0.2em.)
    left: 'calc(var(--mark, 0em) + 0.2em)',
    top: '0',
    width: '0.9em',
    height: '1.75em', // one text row → vertically centres on row 1 even when wrapped
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    opacity: '0.7',
    borderRadius: '4px',
    zIndex: '1',
    transition: 'opacity 0.12s ease, color 0.12s ease, background 0.12s ease',
  },
  '.cm-fold-inline svg': {
    width: '0.72em',
    height: '0.72em',
    display: 'block',
    transform: 'rotate(90deg)', // open: points down
    transformOrigin: '50% 50%',
    transition: 'transform 0.12s ease',
  },
  '.cm-fold-inline.is-folded svg': { transform: 'rotate(0deg)' }, // folded: points right
  '.cm-fold-inline:hover': { opacity: '1', color: 'var(--text-primary)', background: 'var(--bg-hover)' },

  // Autocomplete option detail (the task/bundle/sandbox/note tag).
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '8px',
    fontStyle: 'normal',
    fontSize: '11px',
    color: 'var(--text-faint)',
  },

  // Autocomplete dropdown (wikilink titles), themed for dark.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: '8px',
    boxShadow: '0 6px 18px var(--shadow-color)',
    padding: '4px',
  },
  '.cm-tooltip-autocomplete ul li': {
    fontFamily: 'inherit',
    fontSize: '13.5px',
    padding: '5px 10px',
    borderRadius: '5px',
    color: 'var(--text-primary)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent-blue)', color: '#fff' },
}, { dark: true })
