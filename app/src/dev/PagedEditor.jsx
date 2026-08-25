// DEV ONLY — "LibreOffice Writer in the note editor".
//
// A full markdown note editor (the real extension stack: live preview, tables,
// wikilinks, comments, folding, search) with word-processor pages layered on
// top: fixed-height pages, a gap between them, and text that flows from one to
// the next. Lives here rather than in Notes so it can be developed without
// destabilising real note-taking.
//
// Notes itself is deliberately plain scroll editing. The history of why —
// including two rejected designs and the measurements behind them — is in
// references/plan-book-write-mode.md.
//
// The paging engine is ./pagedLayout.js. Its shape mirrors how Writer's layout
// works, because the same constraints apply:
//   • measure once, cache per block, reflow arithmetically  (Writer's frame
//     metrics)
//   • only reformat what an edit invalidated, and STOP when the edited block's
//     height is unchanged                                    (Writer's
//     invalidation + early-out)
//   • format lazily off the critical path                    (Writer's idle
//     formatting)
// What we cannot copy is the part that makes Writer exact: it owns its layout
// engine, so it can measure text without rendering it. We can only measure what
// the browser has rendered, which is why there is a priming pass at all.

import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, drawSelection, tooltips, placeholder as cmPlaceholder } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

import { livePreview } from '../components/Editor/cm/livePreview'
import { liveTables, tableTypingGuard, tableKeymap } from '../components/Editor/cm/tables'
import { collapseTableGap } from '../components/Editor/cm/tableGap'
import { domVerticalMotion } from '../components/Editor/cm/verticalMotion'
import { codeCopy } from '../components/Editor/cm/codeCopy'
import { imageExtensions } from '../components/Editor/cm/imagePaste'
import { wikilinks, wikilinkMarkdownExtension, resolveNote } from '../components/Editor/cm/wikilinks'
import { obsidianSyntax } from '../components/Editor/cm/syntaxNodes'
import { headingFold } from '../components/Editor/cm/fold'
import { commentsExtension } from '../components/Editor/cm/comments'
import { listEditingKeymap, listIndentNormalizer, enterIndent } from '../components/Editor/cm/listEditing'
import { formattingKeymap } from '../components/Editor/cm/formatting'
import { searchExtension } from '../components/Editor/cm/search'
import { cinderHighlightStyle } from '../components/Editor/cm/highlight'
import { cinderTheme } from '../components/Editor/cm/theme'

import { pagedLayout } from './pagedLayout'
import styles from './BookSpike.module.css'

const SAMPLE = `# Paged editor — LibreOffice-style

This is the real note editor with **live preview**, *tables*, \`code\`,
[[wikilinks]] and folding, laid out as word-processor pages.

Type into it. Watch what the page boundary does — it should sit still while you
type inside a paragraph, and move only when a word actually wraps onto a new
row. That early-out is the difference between this feeling like a word processor
and feeling like a lagging one.

## Things worth breaking

- Type in the middle of the paragraph that straddles a page edge.
- Backspace at the very start of a page — text should flow back up.
- Press Enter repeatedly near a boundary.
- Put a table near a page edge; it should move whole, never be sliced.

| Column | Behaviour |
| --- | --- |
| Tables | move whole |
| Paragraphs | split mid-way in Continue mode |

> A page break is a fact about pixels, not about text. Nothing in the markdown
> marks it, so it can only be found by measuring what was rendered.

Keep typing past here to push content onto a second page.
`

export default function PagedEditor() {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const layoutRef = useRef(new Compartment())

  const [pageH, setPageH] = useState(620)
  const [breaks, setBreaks] = useState('continue')
  const [paged, setPaged] = useState(true)

  // Built once; the layout is reconfigured through a Compartment so toggling it
  // never rebuilds the editor (and never loses the document or undo history).
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: SAMPLE,
        extensions: [
          history(),
          tooltips({ parent: document.body }),
          domVerticalMotion,
          keymap.of([...listEditingKeymap, { key: 'Enter', run: enterIndent }, { key: 'Backspace', run: deleteMarkupBackward }]),
          keymap.of(formattingKeymap),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentUnit.of('    '),
          listIndentNormalizer,
          drawSelection(),
          EditorView.lineWrapping,
          headingFold,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, extensions: [wikilinkMarkdownExtension, obsidianSyntax, { remove: ['SetextHeading', 'IndentedCode'] }] }),
          syntaxHighlighting(cinderHighlightStyle),
          livePreview,
          liveTables,
          tableTypingGuard,
          tableKeymap,
          collapseTableGap,
          searchExtension,
          codeCopy,
          imageExtensions(() => ({ authFetch: null, API: null })),
          wikilinks({
            notes: () => [],
            resolve: (t) => resolveNote([], t),
            navigate: () => {}, create: () => {}, openTask: () => {},
            openSandbox: () => {}, openBundle: () => {}, searchTag: () => {},
            openAttachment: () => {},
            tasks: () => [], bundles: () => [], sandboxes: () => [],
          }),
          commentsExtension({ onClickComment: () => {} }),
          cinderTheme,
          cmPlaceholder('Start typing…'),
          layoutRef.current.of(pagedLayout(620, 'continue')),
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: layoutRef.current.reconfigure(paged ? pagedLayout(pageH, breaks) : []),
    })
    view.requestMeasure()
  }, [paged, pageH, breaks])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Paged note editor — LibreOffice-style</h1>
      <p className={styles.sub}>
        Dev only. The real note editor stack with word-processor pages on top.
        Notes itself stays plain scroll editing; see
        <code> references/plan-book-write-mode.md</code> for why.
      </p>

      <div className={styles.controls}>
        <label className={styles.field}>
          <span className={styles.label}>Layout</span>
          <select value={paged ? 'paged' : 'scroll'} onChange={(e) => setPaged(e.target.value === 'paged')}>
            <option value="paged">Pages</option>
            <option value="scroll">Scroll (off)</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Page height</span>
          <input type="number" min={280} max={1200} step={20} value={pageH}
                 onChange={(e) => setPageH(Number(e.target.value) || 620)} />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Page breaks</span>
          <select value={breaks} onChange={(e) => setBreaks(e.target.value)}>
            <option value="continue">Continue (split paragraphs)</option>
            <option value="keep">Keep whole</option>
          </select>
        </label>
      </div>

      <div ref={hostRef} />
    </div>
  )
}
