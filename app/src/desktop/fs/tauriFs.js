// Real filesystem adapter for the desktop shell. Uses custom Rust commands
// (bag_* in src-tauri/src/main.rs) via core `invoke` rather than tauri-plugin-fs,
// because a Bag is a user-picked folder anywhere on disk — the plugin's path
// scoping would block it, whereas the Rust commands use std::fs directly.
//
// Same async interface as memFs: exists, mkdirp, readDir, readText, writeText,
// remove, rename.

function invoker() {
  const inv = (typeof window !== 'undefined')
    && (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke)
  if (!inv) throw new Error('Tauri invoke unavailable (not running in the desktop shell)')
  return inv
}

export function createTauriFs() {
  const inv = invoker()
  return {
    exists: (path) => inv('bag_exists', { path }),
    mkdirp: (path) => inv('bag_mkdirp', { path }),
    // Rust returns [{ name, is_dir }] → normalise to { name, isDir }.
    readDir: async (path) => (await inv('bag_read_dir', { path })).map((e) => ({ name: e.name, isDir: e.is_dir })),
    readText: (path) => inv('bag_read_text', { path }),
    writeText: (path, contents) => inv('bag_write_text', { path, contents }),
    // `contents` is base64 (decoded to bytes on the Rust side).
    writeBytes: (path, contents) => inv('bag_write_bytes', { path, contents }),
    // Returns base64 of the file's bytes.
    readBytes: (path) => inv('bag_read_bytes', { path }),
    remove: (path) => inv('bag_remove', { path }),
    rename: (from, to) => inv('bag_rename', { from, to }),
  }
}
