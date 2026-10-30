# Siddran — Desktop

The desktop build of **Siddran** (a local-first notes, tasks & planning app). A
[Tauri](https://tauri.app) shell (Rust + the OS WebKit view) wrapping the Siddran
React frontend. Chosen over Electron for a small binary and low RAM.

> Status: **working local-first app.** Notes, tasks, calendar and sandboxes live
> in a **Bag** — a folder you pick — as plain `.md` and JSON on disk. Nothing
> leaves your machine unless you turn sync on.

## Layout

```
siddran-desktop/
├── app/          ← the frontend (a copy of siddran-web; diverges from the web from here on)
├── src-tauri/    ← the Tauri (Rust) desktop shell
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── icons/
└── package.json  ← orchestration scripts (drives vite in app/, and the tauri CLI)
```

## Installing a build

Two artifacts come out of a release build (see "Build an installable" below), and
which one you want depends on your distro.

### Debian, Ubuntu, Linux Mint (Cinnamon), Pop!_OS — use the `.deb`

```bash
sudo apt install ./Siddran_0.1.0_amd64.deb
```

`apt install ./file.deb` rather than `dpkg -i`, so apt pulls the dependencies
instead of leaving you to chase them. It lands in the menu automatically.

To remove it later: `sudo apt remove siddran`.

### Arch, CachyOS, EndeavourOS, Manjaro — use the AppImage or the raw binary

There is no `.deb` path here, and no AUR package yet.

**AppImage** — portable, self-contained, no install step:

```bash
sudo pacman -S --needed fuse2          # AppImages need FUSE 2; fuse3 alone is not enough
chmod +x Siddran_0.1.0_amd64.AppImage
./Siddran_0.1.0_amd64.AppImage
```

**Raw binary** — smaller (about 5 MB against the AppImage's ~100 MB, which carries
its own GTK) and what you want if you already have WebKitGTK, which any Arch
desktop does:

```bash
install -Dm755 src-tauri/target/release/siddran ~/.local/bin/siddran-desktop
```

It installs as `siddran-desktop` because plain `siddran` is the name of the
terminal app, [siddran-cli](https://github.com/kin-kkoy/siddran-cli).

Then a launcher entry so it shows up in your app menu — this works for any
desktop that reads the freedesktop spec, which is all of them (GNOME, KDE,
Cinnamon, and Wayland shells like Hyprland with rofi/wofi/Caelestia):

```bash
cat > ~/.local/share/applications/siddran.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Siddran
GenericName=Notes & Sandbox
Comment=Local-first notes, tasks, calendar & sandbox
Exec=%h/.local/bin/siddran-desktop %F
Icon=siddran
Terminal=false
Categories=Office;
Keywords=notes;tasks;markdown;sandbox;calendar;siddran;
StartupNotify=true
StartupWMClass=siddran
MimeType=text/markdown;text/x-markdown;
EOF
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

`%F` and `MimeType=` let a file manager hand Siddran a `.md` file. To make it the
app that opens them on double-click:

```bash
xdg-mime default siddran.desktop text/markdown
```

A `.md` opened that way is **not** added to your Bag. It opens in a tab (shown in
italics) and edits save back to the file where it lives. **Add to Bag** (top
right) copies it in as a note; closing the tab instead just forgets it. Opening
another file while Siddran is running uses the same window.

`Exec=` needs an absolute path — `~` is not expanded in a desktop entry. Some
launchers accept `%h`; if yours does not, write the full path.

For the icon, either drop a PNG at
`~/.local/share/icons/hicolor/256x256/apps/siddran.png` or point `Icon=` straight
at a file.

## Prerequisites for building

Rust and Node, plus the Tauri system libraries (WebKitGTK and friends).

### Debian / Ubuntu / Mint

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Arch / CachyOS / Manjaro

```bash
sudo pacman -Syu --needed \
  webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
```

`libappindicator-gtk3` is in the AUR, not the official repos — it is only needed
for a tray icon, which this app does not use, so it can be skipped.

(If `rustup`/`cargo` are missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.)

## Setup

```bash
cd siddran-desktop
npm install          # installs @tauri-apps/cli at the root
npm run app:install  # installs the frontend deps in app/
```

## Run it (development)

```bash
npm run tauri:dev
```

This starts Vite (in `app/`) and opens the Siddran window pointed at it, with
hot-reload. First run compiles the Rust shell, so it's slow; later runs are fast.

## Build an installable (AppImage + .deb)

```bash
npm run tauri:build
```

Artifacts land in `src-tauri/target/release/bundle/` (`appimage/…AppImage`,
`deb/…deb`), and the bare executable at `src-tauri/target/release/siddran`.

Building the `.deb` on a non-Debian distro is unsupported by Tauri; on Arch you
will get the AppImage and the binary. To skip the bundling step entirely and just
get the executable:

```bash
npm run tauri:build -- --no-bundle
```

## Roadmap

1. **Tauri scaffold** — the window boots the app. ✅
2. **Local vault ("Bags")** — notes as `.md` on disk, sandboxes as per-board
   `.siddran` JSON, tasks/dailies/calendar as collection JSON. ✅
3. **Bag picker** — native folder dialog, recent Bags remembered. ✅
4. **Desktop polish** — attachment viewer for PDFs and saved HTML pages, session
   restore, offline fonts. ✅
5. **Sync** — opt-in and always manual, against a Cloudflare Worker
   (`sync-worker/`). Never automatic: it must not sit in the path of a keystroke.
   Working, not battle-tested.
6. **Shared Bag** — the app watches the Bag folder and merges outside changes
   (from [siddran-cli](https://github.com/kin-kkoy/siddran-cli), an AI, a text
   editor) instead of overwriting them: rows merge by id, notes by three-way text
   merge, and a note open in the editor takes the change without losing your
   unsaved typing. Writes are atomic and share `.siddran-lock` with the CLI, held
   only for the length of one save. ✅
7. **AI access** — through the CLI (`siddran tools` / `siddran call` for any AI
   with a shell, `siddran mcp` for apps without one). The desktop adds a live
   channel: what is on screen, including selected note text, and "open this"
   requests, via two small files in `$XDG_RUNTIME_DIR/siddran/` (outside the
   Bag, nothing listening on a port). ✅
8. **Sandbox without a pen** — Tab / Shift+Tab / Alt+Arrow for the next box,
   already placed and connected; double-click for a box; C to connect two; ⇧T
   to tidy; D for a diagram from Mermaid-style text. Connectors attach by side,
   route around boxes in the way and carry labels. ✅

Known rough edges:

- **WebKitGTK 2.54.0 and 2.54.1 flicker on Wayland** (seen on Hyprland, AMD).
  On exactly those two releases the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  at startup, which stops the flicker but paints on the CPU, so animations and
  drags are heavier. 2.54.2 fixed it, and from there the app keeps GPU drawing.
  An explicit `WEBKIT_DISABLE_DMABUF_RENDERER` in the environment always wins.
- WebKitGTK's built-in PDF viewer lays out once and never reflows, so the first
  page or two of a PDF can render mis-sized until the window is resized. It
  corrects itself; several fixes have been tried and reverted.

## Related repos

- [siddran-web](https://github.com/kin-kkoy/siddran-web): the React web client (live demo at https://cinder-ebon.vercel.app)
- [siddran-backend](https://github.com/kin-kkoy/siddran-backend): the Node/Express + PostgreSQL API behind the web client
- [siddran-cli](https://github.com/kin-kkoy/siddran-cli): the terminal TUI and CLI. A peer of this app on the same Bag, and the way in for AI (`siddran tools` / `siddran call` / `siddran mcp`)

Together they power the **frozen web demo** (a portfolio piece). `app/` here started
as a copy of siddran-web and now evolves independently for the desktop. There is
intentionally no shared build coupling between them.
