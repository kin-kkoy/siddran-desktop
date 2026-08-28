# LaTeX / mathematical equations in notes

**Area:** Notes · **Size:** medium · **Investigation done — implementation not requested**

## What was seen

> Check whether LaTeX/math equation rendering is already implemented and works
> properly. If it is already working well, report how it works rather than making
> unnecessary changes.

And:

> This is not currently a firm feature request. I'm still undecided about whether
> I actually want LaTeX support.

## The answer: it is not implemented at all

Checked 2026-08-28. There is **no math support of any kind**.

- No `katex`, `mathjax`, `remark-math`, `rehype-katex`, `temml` or `mathlive` in
  `app/package.json`.
- Nothing in `app/src` implements it. The only matches for "LaTeX" in the repo
  are two comments in `src/dev/` (`pagedLayout.js:66`, `BookSpike.jsx:1094`)
  about LaTeX-*style* page breaking — page layout, not math.
- `components/Editor/utils/markdownToHtml.js` runs remark-parse → gfm → breaks →
  rehype-highlight → stringify, with the note's own custom plugins (spoiler,
  underline, highlight, hashtag, wikilinks). No math plugin is in that chain.

So `$E = mc^2$` in a note is plain text today: it renders literally in the
reading view and in the editor's live preview. There is nothing to assess for
rendering quality or ease of entry, because nothing renders.

**This makes it a from-scratch feature, not a check-and-tune.** That is worth
knowing before deciding: the honest estimate is a dependency, a remark plugin in
the reading-view chain, a matching CodeMirror live-preview decoration so the two
views agree (the repo cares about this — see `syntaxConsistency.test.js`), and a
KaTeX stylesheet that has to work in both themes.

## If it is ever wanted, the shape of the work

- `remark-math` + `rehype-katex` slots into `markdownToHtml.js` alongside the
  existing custom plugins.
- The editor half is the larger piece: `cm/livePreview.js` and `cm/widgets.js`
  are where an inline `$…$` would have to render, and `cm/inlineRender.js` is
  the DOM-built, never-innerHTML renderer that table cells use — KaTeX outputs
  an HTML string, so the XSS-safe-by-construction property of that file needs a
  deliberate exception rather than an accident.
- `exportPdf.js` would need the KaTeX CSS inlined or equations print unstyled.

## Not decided

- Whether it is wanted at all. Ask before starting.
- Inline (`$…$`) only, or display blocks (`$$…$$`) too.
- Whether `$` needs escaping for people who write about currency — a real
  problem in a notes app that also has a budget-calculator feature.
