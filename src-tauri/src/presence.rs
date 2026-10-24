// The live channel to anything else on this machine — `siddran mcp` above all.
//
// - presence-<key>.json: what you are looking at right now (page, open note,
//   selected text, open board). Written here on every change; read by the AI's
//   `app_context` tool so "rewrite the paragraph I selected" means something.
// - request-<key>.json: written by someone else to ask us to show something
//   ("open this note"). We watch for it, emit it to the frontend, delete it.
//
// Both live in $XDG_RUNTIME_DIR/siddran, outside the Bag: the Bag gets synced
// between machines, and what is on THIS screen is nobody else's business.
// Files, not a socket or a localhost port, so nothing here listens and there is
// nothing for another program or a web page to connect to.
//
// <key> is FNV-1a over the Bag's canonical path. Siddran-CLI computes the same
// key (crates/core/src/presence.rs) — change one, change both.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

fn key(bag_root: &Path) -> String {
    let p = std::fs::canonicalize(bag_root).unwrap_or_else(|_| bag_root.to_path_buf());
    let mut h: u64 = 0xcbf29ce484222325;
    for b in p.to_string_lossy().as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("siddran")
}

#[tauri::command]
pub fn presence_write(root: String, state: String) -> Result<(), String> {
    let mut v: serde_json::Value = serde_json::from_str(&state).map_err(|e| e.to_string())?;
    // The reader treats a dead pid as "not running", so a crash cannot leave the
    // AI talking to a window that is not there.
    v["pid"] = serde_json::json!(std::process::id());
    let path = dir().join(format!("presence-{}.json", key(Path::new(&root))));
    crate::bagsync::write_atomic(&path, v.to_string().as_bytes())
}

#[tauri::command]
pub fn presence_clear(root: String) {
    let _ = std::fs::remove_file(dir().join(format!("presence-{}.json", key(Path::new(&root)))));
}

#[derive(Default)]
pub struct RequestWatch(Mutex<Option<notify::RecommendedWatcher>>);

// Take a request file if there is one: read it, delete it, hand it over.
fn take(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    let _ = std::fs::remove_file(path);
    serde_json::from_str(&text).ok()
}

#[tauri::command]
pub fn presence_listen(app: AppHandle, state: tauri::State<RequestWatch>, root: String) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let target = d.join(format!("request-{}.json", key(Path::new(&root))));

    // One sent while we were starting up.
    if let Some(v) = take(&target) {
        let _ = app.emit("siddran-request", v);
    }
    let watch_target = target.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        // Requests arrive by rename (atomic write), so a Create or a Modify of the
        // final name is the signal; the temp file's own events are ignored here.
        if ev.paths.iter().any(|p| p == &watch_target) && watch_target.exists() {
            if let Some(v) = take(&watch_target) {
                let _ = app.emit("siddran-request", v);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&d, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn presence_unlisten(state: tauri::State<RequestWatch>) {
    *state.0.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pinned to the same input as Siddran-CLI's test, so the two keys cannot
    // drift apart without one of the suites noticing.
    #[test]
    fn key_matches_the_cli() {
        assert_eq!(key(Path::new("/nonexistent/bag-a")), "6a15c151c3b63ae2");
        assert_ne!(key(Path::new("/nonexistent/bag-a")), key(Path::new("/nonexistent/bag-b")));
    }
}
