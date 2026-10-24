// Sharing a Bag with other writers — Siddran-CLI, its TUI, an AI going through
// `siddran mcp`, a sync tool, a text editor.
//
// Three pieces, each the smallest thing that closes one hole:
//
// 1. Atomic writes. `fs::write` truncates and then writes, so anyone reading in
//    between sees a half-written tasks file. Write a sibling temp file and rename
//    it over: a reader gets the old file or the new one, never a torn one. The
//    temp name matches Siddran-CLI's (`.siddran-tmp-…`) so the watcher can skip
//    both apps' temp files with one rule.
//
// 2. The Bag lock, `.siddran-lock`, the same O_EXCL file Siddran-CLI uses — so a
//    write from here and a write from there can never interleave. It is held
//    only for the read-merge-write of one flush, never for a whole session: a
//    lock held while the app sits open would lock every other writer out of the
//    Bag for as long as the window exists.
//
// 3. A watcher. Without it, a change made elsewhere is invisible until a manual
//    reload, and the app's next flush is merging against a picture that is stale
//    by minutes instead of milliseconds.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub const LOCK_NAME: &str = ".siddran-lock";
pub const TMP_PREFIX: &str = ".siddran-tmp-";

// ── atomic write ────────────────────────────────────────────────────

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!("{TMP_PREFIX}{}-{nanos}", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// ── lock ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct Holder {
    pid: u32,
    host: String,
    started_at: String,
    mode: String,
}

fn hostname() -> String {
    fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_owned())
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "unknown".into())
}

fn pid_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

fn now_iso() -> String {
    // Seconds are enough for a human reading the lockfile; no chrono for this.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

// One attempt. Ok(true) = ours now, Ok(false) = someone alive holds it.
fn try_lock(root: &Path) -> Result<bool, String> {
    let path = root.join(LOCK_NAME);
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            let holder = Holder {
                pid: std::process::id(),
                host: hostname(),
                started_at: now_iso(),
                mode: "desktop".into(),
            };
            let body = serde_json::to_string_pretty(&holder).unwrap_or_default();
            f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let holder: Option<Holder> = fs::read_to_string(&path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok());
            match holder {
                // Same rule as Siddran-CLI: a lock from this host whose process
                // is gone is stale and reclaimable; anything else is respected.
                Some(h) if h.host == hostname() && !pid_alive(h.pid) => {
                    let _ = fs::remove_file(&path);
                    try_lock(root)
                }
                _ => Ok(false),
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

// Wait up to `wait_ms` for the lock. Returns false on timeout rather than an
// error: the caller decides whether to retry later or write anyway.
#[tauri::command]
pub async fn bag_lock(root: String, wait_ms: u64) -> Result<bool, String> {
    let root = PathBuf::from(root);
    let deadline = std::time::Instant::now() + Duration::from_millis(wait_ms);
    loop {
        if try_lock(&root)? {
            return Ok(true);
        }
        if std::time::Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

// Release only a lock we hold — never someone else's.
#[tauri::command]
pub fn bag_unlock(root: String) {
    let path = Path::new(&root).join(LOCK_NAME);
    let ours = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Holder>(&t).ok())
        .is_some_and(|h| h.pid == std::process::id());
    if ours {
        let _ = fs::remove_file(&path);
    }
}

// ── watcher ─────────────────────────────────────────────────────────

#[derive(Default)]
pub struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

#[derive(Clone, serde::Serialize)]
struct BagChanged {
    paths: Vec<String>,
}

// Noise the frontend never needs to hear about: our own and the CLI's temp
// files (the rename that follows them is the real event), the lock, the trash.
fn ignored(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s.starts_with(TMP_PREFIX) || s == LOCK_NAME || s == ".siddran-trash" || s == ".git"
    })
}

#[tauri::command]
pub fn bag_watch(app: AppHandle, state: tauri::State<WatchState>, root: String) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};

    let (tx, rx) = std::sync::mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            for p in ev.paths {
                if !ignored(&p) {
                    let _ = tx.send(p);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&root), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Coalesce: one write is several inotify events (create, modify, rename), and
    // a burst of writes from an AI is many. Gather until the folder has been quiet
    // for a beat, then send the set once. The thread ends when the watcher (and
    // with it `tx`) is dropped.
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut paths = vec![first];
            while let Ok(p) = rx.recv_timeout(Duration::from_millis(120)) {
                paths.push(p);
            }
            paths.sort();
            paths.dedup();
            let paths = paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
            let _ = app.emit("bag-changed", BagChanged { paths });
        }
    });

    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn bag_unwatch(state: tauri::State<WatchState>) {
    *state.0.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("siddran-bagsync-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let d = tmpdir("atomic");
        let f = d.join("tasks.siddran");
        write_atomic(&f, b"one").unwrap();
        write_atomic(&f, b"two").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        let left: Vec<_> = fs::read_dir(&d).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(left.len(), 1, "temp file left behind: {left:?}");
    }

    #[test]
    fn lock_is_exclusive_and_reclaims_a_dead_holder() {
        let d = tmpdir("lock");
        assert!(try_lock(&d).unwrap());
        assert!(!try_lock(&d).unwrap(), "second take must fail while held by a live pid");
        // A holder whose pid is gone is stale.
        let stale = Holder { pid: u32::MAX - 1, host: hostname(), started_at: now_iso(), mode: "cli".into() };
        fs::write(d.join(LOCK_NAME), serde_json::to_string(&stale).unwrap()).unwrap();
        assert!(try_lock(&d).unwrap());
    }

    #[test]
    fn unlock_leaves_someone_elses_lock_alone() {
        let d = tmpdir("unlock");
        let other = Holder { pid: 1, host: hostname(), started_at: now_iso(), mode: "cli".into() };
        fs::write(d.join(LOCK_NAME), serde_json::to_string(&other).unwrap()).unwrap();
        bag_unlock(d.to_string_lossy().into_owned());
        assert!(d.join(LOCK_NAME).exists());
    }

    #[test]
    fn ignores_temp_lock_and_trash() {
        assert!(ignored(Path::new("/b/.siddran-tmp-12-34")));
        assert!(ignored(Path::new("/b/.siddran-lock")));
        assert!(ignored(Path::new("/b/.siddran-trash/x.md")));
        assert!(!ignored(Path::new("/b/notes/Ideas.md")));
    }
}
