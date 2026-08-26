# Clicking a link navigates the whole app away — no way back

**Area:** Misc · **Size:** medium · **Priority: highest of these**

## What was seen

> For some reason I am able to open a link within the app, like the app changes
> from Siddran to another app and I can't go back. This needs to be fixed,
> clicking on a link should either open the link in split view or in another
> panel (maybe leveraging off of the existing view html in side panel or side
> view), or open in browser like in another browser, just like the warning or
> prompt modal windows that show up when clicking on a link in discord.

Reproduced by the user two ways: a link inside an imported markdown note, and a
link inserted by hand — both in **read mode**. Write mode is unaffected, because
a click there is placing a caret.

**This is data loss waiting to happen.** The webview navigates away from the app
entirely, unsaved editor state included, with no back affordance.

## Verified

This is worse than a missing handler — there is currently **no mechanism at all**
for opening a URL outside the webview:

- `src-tauri/Cargo.toml` has **no** `tauri-plugin-opener` and no `shell` plugin.
- `src-tauri/capabilities/default.json` grants only `core:default` and
  `dialog:default`.

So "open it in the real browser" is not a one-line call today. It needs either
the opener plugin added (plus its capability) or a small Rust command. That is a
`cargo check` change, not just frontend work.

The interception side is separate: read mode renders through
`utils/markdownToHtml.js` into `pages/Notes/NotePane.jsx`. That pipeline already
special-cases internal links (wikilinks, and attachment links that open in the
side pane) — find how those are recognised and routed, because an external link
handler belongs in the same place rather than in a competing one.

## Not decided — ask before building

The user offered three possible behaviours and did not pick one:

1. Open in the side pane, reusing the existing HTML viewer.
2. Open in the system browser.
3. A confirm prompt first, "like Discord".

They are not exclusive — Discord's own behaviour is 3 *then* 2. My read is that
**3 → 2 is the safe default** and 1 is a poor fit: the side-pane viewer serves
local files under a custom URI scheme with a per-request CSP, and pointing it at
the live internet is a different security question entirely, not a reuse. But
this is the user's call, and it changes the size of the task a lot.

Whatever is chosen, the **non-negotiable part is that the app must never navigate
away from itself.**

## Watch out for

- Fix the class, not the instance. Any `<a href="http…">` reaching the webview
  does this — reading view, imported markdown, HTML-to-markdown import, note
  previews, anywhere. A handler bound to one component leaves the others broken.
- The attachment viewer (`siddran-html` scheme) is a **different** surface with
  its own CSP and its own link rules. Do not "fix" both with one change without
  reading `src-tauri/src/main.rs` first — the isolation there is deliberate.
- Adding a plugin means a new permission in `capabilities/default.json`. Grant
  the narrowest thing that works; the asset scope was deliberately narrowed from
  `$HOME/**` to nothing-by-default for exactly this reason.
- Check whether Tauri v2 offers a navigation guard on the window itself. Blocking
  navigation at that level would be a belt-and-braces backstop for links that
  slip past the click handler, and is worth knowing about either way.
