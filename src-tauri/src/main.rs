// Prevent an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::http::{Request, Response, StatusCode};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, UriSchemeContext};
use tauri_plugin_notification::NotificationExt;

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
// Recursive directory copy, for attaching a saved web page together with the
// `<name>_files` folder holding its CSS and images. Returns the number of bytes
// copied so the caller can warn about a large one.
#[tauri::command]
fn bag_copy_dir(from: String, to: String) -> Result<u64, String> {
    fn walk(src: &Path, dst: &Path, total: &mut u64) -> Result<(), String> {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let target = dst.join(entry.file_name());
            // Don't follow links out of the tree we were asked to copy.
            let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                walk(&path, &target, total)?;
            } else {
                fs::copy(&path, &target).map_err(|e| e.to_string())?;
                *total += meta.len();
            }
        }
        Ok(())
    }
    let mut total = 0u64;
    walk(Path::new(&from), Path::new(&to), &mut total)?;
    Ok(total)
}

#[tauri::command]
fn bag_read_bytes(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// ── Handing things to the OS ────────────────────────────────────────
//
// The webview must never navigate away from Siddran — a note's link replacing the
// app takes unsaved editor state with it and offers no way back. So a link is
// opened by the real browser instead, and both of these commands validate before
// handing anything over: the frontend never gets a general "open anything"
// capability, only these two.
//
// Deliberately NOT exposed as plugin permissions in capabilities/default.json.
// tauri_plugin_opener's open_url/reveal_item_in_dir are plain Rust functions, so
// the plugin never has to be registered and `opener:allow-open-url` never has to
// be granted to the frontend. That keeps the grant at nothing, which is the same
// reason the asset scope was narrowed from `$HOME/**` to empty.

// The scheme allowlist is the whole security of open_external_url. Handing an
// arbitrary scheme to the platform opener is how `file://`, a `javascript:` URL, or
// a path to a .desktop launcher turns a note into code execution — so anything that
// is not plain web browsing or mail is refused before it reaches the OS, not after.
// An ALLOWLIST, never a blocklist: an unknown scheme is refused, not permitted.
fn checked_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    let scheme = match trimmed.split_once(':') {
        Some((s, _)) => s.to_ascii_lowercase(),
        None => return Err("not a URL".into()),
    };
    if !matches!(scheme.as_str(), "http" | "https" | "mailto") {
        return Err(format!("refusing to open a {scheme}: link"));
    }
    Ok(trimmed)
}

// Open a URL in the user's browser.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let target = checked_url(&url)?;
    tauri_plugin_opener::open_url(target, None::<&str>).map_err(|e| e.to_string())
}

// Resolve a path the webview handed us and refuse it unless it really is inside
// the Bag.
//
// Canonicalize before comparing, exactly as serve_viewer does: a naive prefix check
// would let `<bag>/../../etc` through. Canonicalizing also resolves symlinks, so a
// link inside the Bag pointing out of it is refused too — and it is what reports a
// note whose file was moved or deleted outside the app.
fn confine_to_bag(path: &str, bag: &Path) -> Result<PathBuf, String> {
    // The raw io error here is "No such file or directory (os error 2)", which tells
    // the user nothing. The realistic cause is that the file was renamed or moved
    // outside Siddran, and the app's picture of the Bag is now stale — so say that,
    // and say what fixes it.
    let resolved = fs::canonicalize(path).map_err(|_| {
        "That file isn't where Siddran expects it. If you renamed or moved it outside          the app, reopen the Bag to pick up the change."
            .to_string()
    })?;
    if !resolved.starts_with(bag) {
        return Err("that file is outside the Bag".into());
    }
    Ok(resolved)
}

// Show a note or notebook in the user's file manager.
//
// Confined to the open Bag using the same canonicalize-then-starts_with check as
// serve_viewer below — the bag_* commands do no confinement at all by design, so
// there is nothing to inherit from them and a shell open needs its own.
#[tauri::command]
fn reveal_in_file_manager(state: tauri::State<ViewerState>, path: String) -> Result<(), String> {
    let bag = match state.bag.lock().unwrap().clone() {
        Some(b) => b,
        None => return Err("no bag".into()),
    };

    let resolved = confine_to_bag(&path, &bag)?;

    // The plugin owns the platform split, so nothing here hard-codes xdg-open. On
    // Linux this is the D-Bus ShowItems call, which pre-selects the file. Where no
    // file manager answers it, fall back to just opening the containing folder.
    if tauri_plugin_opener::reveal_item_in_dir(&resolved).is_ok() {
        return Ok(());
    }
    let parent = resolved.parent().ok_or("no containing folder")?;
    tauri_plugin_opener::open_path(parent, None::<&str>).map_err(|e| e.to_string())
}

// ── HTML attachment viewer protocol ─────────────────────────────────
//
// Attached HTML pages are served over their own URI scheme rather than the asset
// protocol, for two reasons:
//
//  1. A Content-Security-Policy can only be attached as a RESPONSE HEADER. The
//     asset protocol gives us no way to set one, and Tauri's own `csp` config is
//     static and app-wide — turning it on would newly restrict CodeMirror,
//     highlight.js and Vite's inline styles. Owning the response means the policy
//     is per-request, so the web-fonts toggle applies with no restart.
//  2. A page served here has a real origin of its own. That is what lets a TRUSTED
//     page be granted `allow-same-origin` safely: it gets its own identity rather
//     than the app's. Rendering the source via `srcdoc` instead would make a
//     trusted page same-origin with Siddran itself, handing it the Tauri IPC.
//
// Reads are confined to the currently open Bag, enforced here rather than trusted
// to the caller.
pub const VIEWER_SCHEME: &str = "siddran-html";

#[derive(Default)]
struct ViewerState {
    bag: Mutex<Option<PathBuf>>,
    allow_fonts: AtomicBool,
    // Bag-relative path -> hosts this page is allowed to load from. Per file, so
    // letting one saved page fetch its CDN stylesheet says nothing about any other.
    allowed_hosts: Mutex<std::collections::HashMap<String, Vec<String>>>,
}

// Which Bag the viewer may read from. Set on every Bag open; clearing it closes
// the protocol entirely. reveal_in_file_manager confines against this same root —
// it is the app's canonical Bag path, not the viewer's alone.
#[tauri::command]
fn viewer_set_bag(state: tauri::State<ViewerState>, path: String) {
    let mut bag = state.bag.lock().unwrap();
    *bag = if path.is_empty() {
        None
    } else {
        // Resolve once here so every later request compares against a real path.
        Some(fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(path)))
    };
}

// Grant the asset protocol access to one Bag at runtime.
//
// The static scope in tauri.conf.json is empty, because a Bag is a folder the user
// picks and cannot be known at build time. It used to be `$HOME/**`, which was both
// far wider than needed AND wrong: a Bag stored outside the home directory loaded
// its notes (those go through the bag_* commands) while every image and PDF
// silently failed, since only the asset protocol is scoped.
//
// Note this is additive and process-global: opening Bag A then Bag B leaves both
// readable for the rest of the session. The honest guarantee is "Bags opened this
// session", not "the current Bag". `forbid_directory` exists but takes precedence
// permanently, which would break reopening the same Bag later.
#[tauri::command]
fn bag_allow_asset(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("empty path".into());
    }
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn viewer_set_fonts(state: tauri::State<ViewerState>, allow: bool) {
    state.allow_fonts.store(allow, Ordering::Relaxed);
}

// Hosts one page may load from. Validated here rather than trusted to the caller:
// a stray entry would otherwise widen the policy for everything.
#[tauri::command]
fn viewer_set_allowed_hosts(state: tauri::State<ViewerState>, key: String, hosts: Vec<String>) {
    let clean: Vec<String> = hosts
        .into_iter()
        .filter(|h| {
            !h.is_empty()
                && h.len() < 254
                && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        })
        .take(32)
        .collect();
    let mut map = state.allowed_hosts.lock().unwrap();
    if clean.is_empty() { map.remove(&key); } else { map.insert(key, clean); }
}

// `'self'` is useless here: an untrusted page runs sandboxed WITHOUT
// allow-same-origin, so its origin is opaque and matches nothing. The scheme has
// to be named explicitly. Both spellings are listed because Tauri maps custom
// schemes to `scheme://localhost` on Linux/macOS and `http://scheme.localhost`
// on Windows/Android.
fn viewer_sources() -> String {
    format!("{s}: http://{s}.localhost https://{s}.localhost", s = VIEWER_SCHEME)
}

fn viewer_csp(allow_fonts: bool, allowed: &[String]) -> String {
    let own = viewer_sources();
    let style_fonts = if allow_fonts { " https://fonts.googleapis.com" } else { "" };
    let file_fonts = if allow_fonts { " https://fonts.gstatic.com" } else { "" };
    // Approved hosts may serve the page's LOOK — styles, images, fonts, scripts.
    // connect-src stays 'none' regardless: a page may fetch what it needs to render
    // itself, but never open a channel it could send your files down.
    let ext = allowed
        .iter()
        .map(|h| format!(" https://{h}"))
        .collect::<String>();
    format!(
        "default-src 'none'; \
         img-src {own} data: blob:{ext}; \
         media-src {own} data: blob:{ext}; \
         style-src {own} 'unsafe-inline' data:{style_fonts}{ext}; \
         script-src {own} 'unsafe-inline' 'unsafe-eval' data:{ext}; \
         font-src {own} data:{file_fonts}{ext}; \
         frame-src 'none'; \
         connect-src 'none'; \
         form-action 'none'; \
         base-uri 'none'"
    )
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

// Each path segment is percent-encoded individually (see desktop/htmlViewer.js), so
// separators survive and a page's relative references resolve against its own folder.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex_nibble(b[i + 1]), hex_nibble(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

// ── viewer storage ──────────────────────────────────────────────────
//
// WebKitGTK does not persist localStorage for a custom URI scheme: a page can
// write during a session and finds it all gone on the next launch. Tauri exposes
// no way to mark a scheme as persistent, so the app owns the storage instead.
//
// A shim is injected ahead of the page's own scripts, replacing window.localStorage
// with one backed by a JSON file in the Bag. That makes saved state survive
// restarts, keeps it scoped per file, and lets it travel with the vault — none of
// which the browser's own storage would have given us here.
const STORAGE_FILE: &str = ".siddran-viewer-storage.json";

fn storage_map(bag: &Path) -> serde_json::Value {
    fs::read_to_string(bag.join(STORAGE_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

// Everything this page previously saved, as a JSON object literal.
fn storage_seed(bag: &Path, key: &str) -> String {
    let entry = storage_map(bag)
        .get(key)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    // `</script>` inside the payload would close the tag we are writing it into.
    serde_json::to_string(&entry)
        .unwrap_or_else(|_| "{}".into())
        .replace("</", r"<\/")
}

#[tauri::command]
fn viewer_save_storage(
    state: tauri::State<ViewerState>,
    key: String,
    data: String,
) -> Result<(), String> {
    let bag = match state.bag.lock().unwrap().clone() {
        Some(b) => b,
        None => return Err("no bag".into()),
    };
    // A runaway page shouldn't be able to grow the vault without bound.
    if data.len() > 512 * 1024 {
        return Err("too large".into());
    }
    let parsed: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let mut map = storage_map(&bag);
    if let Some(obj) = map.as_object_mut() {
        obj.insert(key, parsed);
    }
    fs::write(
        bag.join(STORAGE_FILE),
        serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

// Runs before any of the page's own scripts. `key` identifies the file to the
// parent; the parent ignores it and uses the file it actually has open, so a page
// cannot write into another page's storage.
fn storage_shim(seed: &str) -> String {
    format!(
        r#"<script>(function(){{
var mem={seed};
function flush(){{try{{parent.postMessage({{__siddranStorage:1,data:JSON.stringify(mem)}},'*')}}catch(e){{}}}}
var shim={{
getItem:function(k){{k=String(k);return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null}},
setItem:function(k,v){{mem[String(k)]=String(v);flush()}},
removeItem:function(k){{delete mem[String(k)];flush()}},
clear:function(){{mem={{}};flush()}},
key:function(i){{var ks=Object.keys(mem);return i<ks.length?ks[i]:null}},
get length(){{return Object.keys(mem).length}}
}};
try{{Object.defineProperty(window,'localStorage',{{value:shim,configurable:true}})}}catch(e){{}}
try{{Object.defineProperty(window,'sessionStorage',{{value:shim,configurable:true}})}}catch(e){{}}
window.addEventListener('message',function(e){{
var d=e&&e.data;if(!d||!d.__siddranNav)return;
try{{if(d.__siddranNav==='back')history.back();else if(d.__siddranNav==='forward')history.forward()}}catch(x){{}}
}});
}})();</script>"#
    )
}

// Insert the shim as early as possible — it must beat the page's own scripts.
fn inject_shim(html: &str, shim: &str) -> String {
    let lower = html.to_ascii_lowercase();
    if let Some(i) = lower.find("<head") {
        if let Some(close) = lower[i..].find('>') {
            let at = i + close + 1;
            return format!("{}{}{}", &html[..at], shim, &html[at..]);
        }
    }
    if let Some(i) = lower.find("<html") {
        if let Some(close) = lower[i..].find('>') {
            let at = i + close + 1;
            return format!("{}{}{}", &html[..at], shim, &html[at..]);
        }
    }
    format!("{}{}", shim, html)
}

fn deny(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Cow::Borrowed(&b"blocked"[..]))
        .unwrap()
}

fn serve_viewer(
    ctx: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let state = ctx.app_handle().state::<ViewerState>();

    let bag = match state.bag.lock().unwrap().clone() {
        Some(b) => b,
        None => return deny(StatusCode::FORBIDDEN),
    };

    // The path arrives with real separators and per-segment encoding, so the leading
    // slash is part of the absolute path — trimming it would make this relative and
    // every lookup would fail.
    let requested = PathBuf::from(percent_decode(request.uri().path()));

    // Canonicalize before comparing: without it, `<bag>/../../etc/passwd` would
    // pass a naive string prefix check.
    let resolved = match fs::canonicalize(&requested) {
        Ok(p) => p,
        Err(_) => return deny(StatusCode::NOT_FOUND),
    };
    if !resolved.starts_with(&bag) {
        return deny(StatusCode::FORBIDDEN);
    }

    let mut bytes = match fs::read(&resolved) {
        Ok(b) => b,
        Err(_) => return deny(StatusCode::NOT_FOUND),
    };

    let mime = content_type_for(&resolved);
    // Key storage and per-page policy by the path relative to the Bag, so both
    // survive the Bag being moved and stay readable inside the vault.
    let rel_key = resolved.strip_prefix(&bag).unwrap_or(&resolved).to_string_lossy().to_string();
    if mime.starts_with("text/html") {
        let html = String::from_utf8_lossy(&bytes).into_owned();
        bytes = inject_shim(&html, &storage_shim(&storage_seed(&bag, &rel_key))).into_bytes();
    }

    // Resolve the policy before building the response: holding the lock inside the
    // builder call would outlive the guard's borrow of `state`.
    let csp = {
        let hosts = state.allowed_hosts.lock().unwrap();
        viewer_csp(
            state.allow_fonts.load(Ordering::Relaxed),
            hosts.get(&rel_key).map(|v| v.as_slice()).unwrap_or(&[]),
        )
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Content-Security-Policy", csp)
        .header("Cache-Control", "no-store")
        .body(Cow::Owned(bytes))
        .unwrap()
}

// Closing the window destroys the webview immediately, so anything still sitting
// in the store's write debounce is lost — paste an image and quit within a second
// and the note never records it. Hold the close, let the frontend flush, then go.
#[derive(Default)]
struct Closing(AtomicBool);

#[tauri::command]
fn app_close(window: tauri::Window, state: tauri::State<Closing>) {
    state.0.store(true, Ordering::SeqCst);
    let _ = window.close();
}

// Closing the window normally kills the webview, and with it the deadline
// scheduler — so with close-to-tray on we hide instead and the process lives in
// the tray. `tray_ok` is the interlock: if the tray icon never built (a desktop
// with no StatusNotifier host), hiding would leave the user with no window, no
// tray and no way back, so we fall through to the ordinary close instead.
#[derive(Default)]
struct TrayState {
    close_to_tray: AtomicBool,
    tray_ok: AtomicBool,
}

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: tauri::State<TrayState>) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn tray_available(state: tauri::State<TrayState>) -> bool {
    state.tray_ok.load(Ordering::SeqCst)
}

// The notification plugin is registered so this can call it, but no
// `notification:*` permission is granted to the webview — same stance as
// tauri_plugin_opener above. Titles and bodies are the user's own task text;
// they still get truncated before being handed to the OS, which is not
// obliged to cope with a novel in a bubble.
fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[tauri::command]
fn notify_deadline(app: tauri::AppHandle, title: String, body: String) {
    // A missing org.freedesktop.Notifications is not an error worth surfacing:
    // the in-app alarm modal is the real UI, this is the extra.
    let _ = app
        .notification()
        .builder()
        .title(clip(&title, 120))
        .body(clip(&body, 300))
        .show();
}

#[tauri::command]
fn alarm_show_window(window: tauri::Window) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

// Quit for real, from the tray. Not app.exit(0): that drops whatever is inside
// the store's 1.5s write debounce. Reuse the same handshake the window close
// uses — ask the frontend to flush, and exit anyway if it never answers.
fn quit_with_flush(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        app.exit(0);
        return;
    };
    app.state::<Closing>().0.store(true, Ordering::SeqCst);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        handle.exit(0);
    });
    let _ = window.emit("siddran:flush-and-close", ());
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Closing::default())
        .manage(TrayState::default())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Siddran", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app.default_window_icon().cloned();
            let mut builder = TrayIconBuilder::with_id("siddran")
                .tooltip("Siddran")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => quit_with_flush(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = icon {
                builder = builder.icon(icon);
            }
            let built = builder.build(app).is_ok();
            app.state::<TrayState>().tray_ok.store(built, Ordering::SeqCst);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<Closing>();
                if state.0.load(Ordering::SeqCst) {
                    return; // our own close, let it through
                }
                // Close-to-tray: hide rather than close, so the deadline
                // scheduler in the webview keeps running. Only ever taken when a
                // tray icon actually exists to get the window back from.
                let tray = window.state::<TrayState>();
                if tray.tray_ok.load(Ordering::SeqCst) && tray.close_to_tray.load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                    // Still drain the write debounce — a hidden app can be killed
                    // at any time and the last edit must already be on disk.
                    let _ = window.emit("siddran:flush-only", ());
                    return;
                }
                api.prevent_close();
                // If the frontend never answers (hung renderer), close anyway rather
                // than leaving a window that refuses to shut.
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    let st = w.state::<Closing>();
                    if !st.0.load(Ordering::SeqCst) {
                        st.0.store(true, Ordering::SeqCst);
                        let _ = w.close();
                    }
                });
                let _ = window.emit("siddran:flush-and-close", ());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ViewerState::default())
        .register_uri_scheme_protocol(VIEWER_SCHEME, serve_viewer)
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
            bag_copy_dir,
            open_external_url,
            reveal_in_file_manager,
            app_close,
            set_close_to_tray,
            tray_available,
            notify_deadline,
            alarm_show_window,
            bag_allow_asset,
            viewer_set_bag,
            viewer_set_fonts,
            viewer_save_storage,
            viewer_set_allowed_hosts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Siddran desktop app");
}

// These two guards are the only thing between a note's contents and the OS, so
// they are tested directly rather than through the window.
#[cfg(test)]
mod tests {
    use super::{checked_url, confine_to_bag};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn allows_web_and_mail() {
        assert_eq!(checked_url("https://example.com/a"), Ok("https://example.com/a"));
        assert!(checked_url("http://example.com").is_ok());
        assert!(checked_url("mailto:someone@example.com").is_ok());
        assert!(checked_url("  https://example.com  ").is_ok());
        // Scheme comparison is case-insensitive, or `HTTPS://` would be refused.
        assert!(checked_url("HTTPS://example.com").is_ok());
    }

    #[test]
    fn refuses_everything_else() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>x</script>",
            "smb://host/share",
            "/home/user/notes.desktop",   // no scheme at all
            "",
        ] {
            assert!(checked_url(bad).is_err(), "should have refused {bad:?}");
        }
    }

    // A temp Bag with a note in it, plus a sibling file outside the Bag.
    // Named per test: cargo runs these in parallel, and a shared directory that
    // each one wipes on entry would race.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("siddran-confine-{name}"));
        let _ = fs::remove_dir_all(&root);
        let bag = root.join("bag");
        fs::create_dir_all(bag.join("notes")).unwrap();
        fs::write(bag.join("notes/a.md"), "note").unwrap();
        fs::write(root.join("outside.md"), "not yours").unwrap();
        (fs::canonicalize(&bag).unwrap(), fs::canonicalize(&root).unwrap())
    }

    #[test]
    fn allows_a_file_inside_the_bag() {
        let (bag, _) = fixture("inside");
        let note = bag.join("notes/a.md");
        assert_eq!(confine_to_bag(note.to_str().unwrap(), &bag).unwrap(), note);
    }

    #[test]
    fn refuses_a_traversal_out_of_the_bag() {
        let (bag, root) = fixture("traversal");
        let escape = format!("{}/notes/../../outside.md", bag.display());
        assert!(confine_to_bag(&escape, &bag).is_err());
        assert!(confine_to_bag(root.join("outside.md").to_str().unwrap(), &bag).is_err());
    }

    // starts_with on a PathBuf compares whole components, so a sibling directory
    // whose name merely begins with the Bag's name is not inside it.
    #[test]
    fn refuses_a_sibling_with_the_bags_name_as_a_prefix() {
        let (bag, root) = fixture("sibling");
        let evil = root.join("bag-evil");
        fs::create_dir_all(&evil).unwrap();
        fs::write(evil.join("a.md"), "x").unwrap();
        assert!(confine_to_bag(evil.join("a.md").to_str().unwrap(), &bag).is_err());
    }

    #[test]
    fn reports_a_file_that_is_gone() {
        let (bag, _) = fixture("missing");
        let missing = bag.join("notes/deleted-outside-the-app.md");
        assert!(confine_to_bag(missing.to_str().unwrap(), &bag).is_err());
    }
}
