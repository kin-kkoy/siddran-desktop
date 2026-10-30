// Opening a .md from the file manager.
//
// `siddran-desktop notes.md` — or double-clicking a .md once Siddran is the
// default app for it — opens the file as a STAGED note: shown and editable, but
// not part of the Bag until the user presses "Add to Bag". Edits are saved back to
// the file where it lives, like any other editor would.
//
// These are the only commands that read or write outside the Bag on purpose, so
// they accept only paths the OS handed us on a command line — never a path the
// webview makes up. Every path is canonicalized when it arrives, which also
// resolves a symlink to the real file, so a write lands on the file itself rather
// than replacing the link.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::bagsync;

#[derive(Default)]
pub struct OpenedFiles {
    // Opened but not yet picked up by the frontend. It drains these once a Bag is
    // open — a file passed at launch has to wait for the Bag picker.
    pending: Mutex<Vec<PathBuf>>,
    // Every file opened during this run: the allowlist for read and write.
    allowed: Mutex<HashSet<PathBuf>>,
}

impl OpenedFiles {
    pub fn from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Self {
        let state = Self::default();
        state.add(markdown_args(args, cwd));
        state
    }

    // Returns whether anything was added, so the caller only signals real news.
    fn add(&self, paths: Vec<PathBuf>) -> bool {
        if paths.is_empty() {
            return false;
        }
        self.allowed.lock().unwrap().extend(paths.iter().cloned());
        self.pending.lock().unwrap().extend(paths);
        true
    }

    fn check(&self, path: &str) -> Result<PathBuf, String> {
        let resolved = fs::canonicalize(path)
            .map_err(|_| "That file isn't there anymore — it was moved or deleted.".to_string())?;
        if !self.allowed.lock().unwrap().contains(&resolved) {
            return Err("Siddran didn't open that file".into());
        }
        Ok(resolved)
    }
}

// The .md / .markdown files among command-line arguments, as absolute, canonical
// paths. Relative paths resolve against `cwd`: the launching shell's directory,
// which for a second launch is not ours. Flags and anything that isn't an
// existing file are dropped.
fn markdown_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a)) // join keeps an absolute path as it is
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        })
        .filter_map(|p| fs::canonicalize(p).ok())
        .filter(|p| p.is_file())
        .collect()
}

// A second launch (Siddran already running) hands its arguments here instead of
// starting another window on the same Bag.
pub fn on_second_launch(app: &tauri::AppHandle, argv: Vec<String>, cwd: String) {
    let paths = markdown_args(argv.into_iter().skip(1), Path::new(&cwd));
    if app.state::<OpenedFiles>().add(paths) {
        let _ = app.emit("siddran:open-files", ());
    }
}

#[tauri::command]
pub fn opened_files_take(state: tauri::State<OpenedFiles>) -> Vec<String> {
    state
        .pending
        .lock()
        .unwrap()
        .drain(..)
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
pub fn opened_read(state: tauri::State<OpenedFiles>, path: String) -> Result<String, String> {
    let p = state.check(&path)?;
    fs::read_to_string(p).map_err(|e| e.to_string())
}

// Atomic like every Bag write, but the file is the user's, not ours: keep its
// permissions rather than whatever the temp file was created with.
#[tauri::command]
pub fn opened_write(state: tauri::State<OpenedFiles>, path: String, contents: String) -> Result<(), String> {
    let p = state.check(&path)?;
    let perms = fs::metadata(&p).map_err(|e| e.to_string())?.permissions();
    bagsync::write_atomic(&p, contents.as_bytes())?;
    fs::set_permissions(&p, perms).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Per-test directory: cargo runs tests in parallel.
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("siddran-opened-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a.md"), "a").unwrap();
        fs::write(root.join("B.MARKDOWN"), "b").unwrap();
        fs::write(root.join("c.txt"), "c").unwrap();
        fs::write(root.join("sub/d.md"), "d").unwrap();
        fs::canonicalize(root).unwrap()
    }

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keeps_only_existing_markdown_files() {
        let root = fixture("filter");
        let got = markdown_args(args(&["a.md", "B.MARKDOWN", "c.txt", "missing.md", "--flag", "sub"]), &root);
        assert_eq!(got, vec![root.join("a.md"), root.join("B.MARKDOWN")]);
    }

    #[test]
    fn resolves_relative_paths_against_the_launching_directory() {
        let root = fixture("relative");
        let abs = root.join("a.md").to_string_lossy().to_string();
        let got = markdown_args(args(&["sub/d.md", "sub/../a.md", &abs]), &root.join("sub/.."));
        assert_eq!(got, vec![root.join("sub/d.md"), root.join("a.md"), root.join("a.md")]);
    }

    #[test]
    fn only_opened_files_pass_the_check() {
        let root = fixture("allow");
        let state = OpenedFiles::from_args(args(&["a.md"]), &root);
        assert!(state.check(root.join("a.md").to_str().unwrap()).is_ok());
        // Same file by another spelling still matches once canonicalized.
        assert!(state.check(root.join("sub/../a.md").to_str().unwrap()).is_ok());
        assert!(state.check(root.join("sub/d.md").to_str().unwrap()).is_err());
        assert!(state.check(root.join("gone.md").to_str().unwrap()).is_err());
    }

    #[test]
    fn launch_files_wait_until_taken() {
        let root = fixture("pending");
        let state = OpenedFiles::from_args(args(&["a.md", "sub/d.md"]), &root);
        assert_eq!(state.pending.lock().unwrap().len(), 2);
        assert!(!state.add(Vec::new()), "nothing new means no event");
    }
}
