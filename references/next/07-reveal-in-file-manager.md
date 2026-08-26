# Show a note in the file manager

**Area:** Misc · **Size:** small–medium

## What was seen

> I should be able to open file in file explorer when right clicking on a note
> in sidebar or through the kebab menu on NotesHub.

Two entry points for one action: a context menu in the sidebar, and the existing
kebab menu on a note card.

## Verified

- Same blocker as `06-external-links.md`: **no opener or shell plugin exists**
  (`src-tauri/Cargo.toml`), and `capabilities/default.json` grants only
  `core:default` and `dialog:default`. Revealing a file in the file manager needs
  Rust work. If 06 is done first, this likely rides on the same plugin — worth
  sequencing them together.
- Notes are real files in the Bag — `.md` on disk — so there is a genuine path to
  reveal. `src-tauri/src/main.rs` already has the Bag commands
  (`bag_read_dir`, `bag_write_bytes`, …); a reveal command belongs beside them
  and can reuse whatever path confinement they already do. **Read that first** —
  handing an arbitrary path to a shell open is exactly the sort of thing the
  asset-scope narrowing was done to avoid.
- The card kebab menu exists in `components/Notes/Card.jsx`. The sidebar has no
  context menu at all yet, so that half is new UI.

## Not decided

- **Reveal-and-select, or just open the containing folder?** They are different
  calls and different levels of support across file managers. `xdg-open` on the
  directory is the portable floor; selecting the file needs per-manager handling
  (Nautilus, Dolphin and Thunar all differ) or a D-Bus call.
- Whether this appears for notebooks too — a notebook is a directory, which makes
  it the easier case, and arguably the more useful one.
- Right-click vs. a kebab in the sidebar row. Right-click is what was asked for;
  a row that is also a drag source (see `04`) may want care so the two do not
  interfere.

## Watch out for

- Linux only in practice. There is no macOS or Windows build today, but do not
  hard-code `xdg-open` in a way that pretends otherwise — Tauri's opener plugin
  handles the platform split if it is used.
- A note whose file has been moved or deleted outside the app will fail. Fail
  visibly (a toast) rather than silently.
- The Bag can live outside `$HOME`, which has broken assumptions before — a Bag
  on `/mnt` or `/srv` was silently losing all its attachments until the asset
  scope was fixed. Do not assume the path is under home.
