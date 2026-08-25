# Siddran — Desktop

The desktop build of **Siddran** (a local-first notes, tasks & planning app). A
[Tauri](https://tauri.app) shell (Rust + the OS WebKit view) wrapping the Cinder
React frontend. Chosen over Electron for a small binary and low RAM.

> Status: **working local-first app.** Notes, tasks, calendar and sandboxes live
> in a **Bag** — a folder you pick — as plain `.md` and JSON on disk. Nothing
> leaves your machine unless you turn sync on.

## Layout

```
Siddran-Desktop/
├── app/          ← the frontend (a copy of Cinder; diverges from the web from here on)
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
install -Dm755 src-tauri/target/release/siddran ~/.local/bin/siddran
```

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
Exec=%h/.local/bin/siddran
Icon=siddran
Terminal=false
Categories=Office;
Keywords=notes;tasks;markdown;sandbox;calendar;siddran;
StartupNotify=true
StartupWMClass=siddran
EOF
update-desktop-database ~/.local/share/applications 2>/dev/null || true
```

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
cd Siddran-Desktop
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

Known rough edge: WebKitGTK's built-in PDF viewer lays out once and never
reflows, so the first page or two of a PDF can render mis-sized until the window
is resized. It corrects itself; several fixes have been tried and reverted.

## Relationship to the other repos

`Cinder` (web frontend) and `Ember` (backend) live in sibling repos and power the
**frozen web demo** (a portfolio piece). `app/` here started as a copy of Cinder
and now evolves independently for the desktop. There is intentionally no shared
build coupling between them.
