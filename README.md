# Siddran — Desktop

The desktop build of **Siddran** (a local-first notes, tasks & planning app). A
[Tauri](https://tauri.app) shell (Rust + the OS WebKit view) wrapping the Cinder
React frontend. Chosen over Electron for a small binary and low RAM.

> Status: **scaffold.** The window boots the app; it currently runs in the same
> ephemeral **guest/demo mode** as the web (nothing persists). Next milestone is
> the local-vault `LocalProvider` (files on disk in a user-chosen folder) so it
> becomes a real local-first app. See "Roadmap" below.

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

## Prerequisites (Linux Mint / Ubuntu)

You already have Rust and Node. You still need the Tauri system libraries
(WebKitGTK etc.) — install them once:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

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
`deb/…deb`).

## Roadmap

1. **This scaffold** — Tauri window boots the app. ✅
2. **Local vault** — a `LocalProvider` behind the app's data hooks that reads/writes
   a user-chosen folder: notes as `.md` (folder-style notebooks), sandboxes as
   per-board `.siddran` JSON, and tasks/dailies/projects/calendar/schedules as a
   few collection `.siddran` JSON files. Filesystem access via Tauri commands.
3. **Vault picker** — native folder dialog on first launch; remember recent vaults.
4. **Desktop polish** — file-save dialogs for PDF/markdown export (replacing the
   browser `<a download>`), bundle fonts offline, clipboard-paste parity check.
5. **(Later / optional)** cloud sync as a premium add-on — the web's Ember+Neon
   backend, opt-in. Deferred.

## Relationship to the other repos

`Cinder` (web frontend) and `Ember` (backend) live in sibling repos and power the
**frozen web demo** (a portfolio piece). `app/` here started as a copy of Cinder
and now evolves independently for the desktop. There is intentionally no shared
build coupling between them.
