// Prevent an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::Path;

// A Bag is a user-picked folder anywhere on disk, so we use std::fs directly
// (via these commands) rather than tauri-plugin-fs, whose path scoping would
// block an arbitrary location. The frontend's tauriFs adapter calls these.

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

#[tauri::command]
fn bag_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn bag_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in rd {
        let entry = entry.map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_dir: entry.path().is_dir(),
        });
    }
    Ok(out)
}

#[tauri::command]
fn bag_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn bag_write_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn bag_mkdirp(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn bag_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn bag_rename(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

// Write binary content (e.g. a pasted image attachment). `contents` is base64.
#[tauri::command]
fn bag_write_bytes(path: String, contents: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

// Read binary content (e.g. an image dragged in from outside the Bag) as base64.
#[tauri::command]
fn bag_read_bytes(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            bag_exists,
            bag_read_dir,
            bag_read_text,
            bag_write_text,
            bag_mkdirp,
            bag_remove,
            bag_rename,
            bag_write_bytes,
            bag_read_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Siddran desktop app");
}
