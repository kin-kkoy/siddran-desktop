//! Sandbox slides (app/src/components/Sandbox/slides/): the displays a slide
//! can be sized for, and the deck's PDF export.
//!
//! PDF export takes a picture of what the webview shows (WebKitGTK's own
//! snapshot, so DOM cards and widgets come out exactly as presented) for each
//! slide while the presentation steps through them, crops it to the slide,
//! and writes one PDF page per slide with cairo.

use serde::Serialize;
use std::sync::Mutex;

#[derive(Serialize)]
pub struct Display {
    /// Connector, e.g. "eDP-1" or "HDMI-A-1" (or the monitor's model off Linux DRM).
    name: String,
    /// "laptop", "HDMI", "DisplayPort", … or "" when unknown.
    kind: String,
    width: u32,
    height: u32,
}

fn kind_of(connector: &str) -> &'static str {
    let c = connector.to_ascii_uppercase();
    if c.starts_with("EDP") || c.starts_with("LVDS") || c.starts_with("DSI") {
        "laptop"
    } else if c.starts_with("HDMI") {
        "HDMI"
    } else if c.starts_with("DP") {
        "DisplayPort"
    } else if c.starts_with("DVI") {
        "DVI"
    } else if c.starts_with("VGA") {
        "VGA"
    } else {
        ""
    }
}

/// Connected displays from DRM (`/sys/class/drm/card*-<connector>`): its name
/// says which one is the laptop panel, and `modes` starts with the native
/// resolution.
#[cfg(target_os = "linux")]
fn drm_displays() -> Vec<Display> {
    let mut out = Vec::new();
    let Ok(dir) = std::fs::read_dir("/sys/class/drm") else { return out };
    let mut entries: Vec<_> = dir.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let file = e.file_name().to_string_lossy().to_string();
        let Some((card, connector)) = file.split_once('-') else { continue };
        if !card.starts_with("card") || connector.starts_with("Writeback") {
            continue;
        }
        let p = e.path();
        if std::fs::read_to_string(p.join("status")).map(|s| s.trim() != "connected").unwrap_or(true) {
            continue;
        }
        let modes = std::fs::read_to_string(p.join("modes")).unwrap_or_default();
        let Some((w, h)) = modes.lines().next().and_then(|m| m.split_once('x')) else { continue };
        let (Ok(width), Ok(height)) = (w.trim().parse::<u32>(), h.trim().trim_end_matches(|c: char| !c.is_ascii_digit()).parse::<u32>()) else { continue };
        out.push(Display { kind: kind_of(connector).into(), name: connector.into(), width, height });
    }
    out
}

#[cfg(not(target_os = "linux"))]
fn drm_displays() -> Vec<Display> {
    Vec::new()
}

/// The displays, laptop panel first ("Display 1"). Falls back to the
/// windowing system's monitors when DRM can't be read.
#[tauri::command]
pub fn list_displays(window: tauri::Window) -> Vec<Display> {
    let mut v = drm_displays();
    if v.is_empty() {
        v = window
            .available_monitors()
            .unwrap_or_default()
            .into_iter()
            .map(|m| {
                let name = m.name().cloned().unwrap_or_default();
                Display { kind: kind_of(&name).into(), name, width: m.size().width, height: m.size().height }
            })
            .collect();
    }
    v.sort_by_key(|d| if d.kind == "laptop" { 0 } else { 1 });
    v
}

/// One captured page: BGRA (cairo ARGB32) pixels.
struct Page {
    width: i32,
    height: i32,
    stride: i32,
    data: Vec<u8>,
}

static PAGES: Mutex<Vec<Page>> = Mutex::new(Vec::new());

#[tauri::command]
pub fn slides_pdf_begin() {
    PAGES.lock().unwrap().clear();
}

/// Snapshot the webview and keep the CSS-pixel rectangle `x,y,w,h` (the
/// slide on screen) as the next page. `view_width` is the page's CSS width,
/// which gives the device-pixel scale of the snapshot.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn slides_pdf_capture(window: tauri::WebviewWindow, x: f64, y: f64, w: f64, h: f64, view_width: f64) -> Result<usize, String> {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    let (tx, rx) = std::sync::mpsc::channel::<Result<Page, String>>();
    window
        .with_webview(move |wv| {
            let view = wv.inner();
            let tx2 = tx.clone();
            view.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&gio_cancellable::Cancellable>, move |res| {
                let page = res.map_err(|e| e.to_string()).and_then(|surface| crop(&surface, x, y, w, h, view_width));
                let _ = tx2.send(page);
            });
        })
        .map_err(|e| e.to_string())?;
    let page = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(10)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "the snapshot never came back".to_string())??;
    let mut pages = PAGES.lock().unwrap();
    pages.push(page);
    Ok(pages.len())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn slides_pdf_capture(x: f64, y: f64, w: f64, h: f64, view_width: f64) -> Result<usize, String> {
    let _ = (x, y, w, h, view_width);
    Err("PDF export needs the Linux build".into())
}

// The `Cancellable` type webkit2gtk's snapshot takes, by its re-exported path.
#[cfg(target_os = "linux")]
mod gio_cancellable {
    pub use webkit2gtk::gio::Cancellable;
}

#[cfg(target_os = "linux")]
fn crop(surface: &cairo::Surface, x: f64, y: f64, w: f64, h: f64, view_width: f64) -> Result<Page, String> {
    let src = cairo::ImageSurface::try_from(surface.clone()).map_err(|_| "the snapshot isn't an image".to_string())?;
    let scale = if view_width > 0.0 { src.width() as f64 / view_width } else { 1.0 };
    let (pw, ph) = ((w * scale).round().max(1.0) as i32, (h * scale).round().max(1.0) as i32);
    let mut out = cairo::ImageSurface::create(cairo::Format::ARgb32, pw, ph).map_err(|e| e.to_string())?;
    {
        let cr = cairo::Context::new(&out).map_err(|e| e.to_string())?;
        cr.set_source_rgb(0.0, 0.0, 0.0);
        cr.paint().map_err(|e| e.to_string())?;
        cr.set_source_surface(&src, -(x * scale), -(y * scale)).map_err(|e| e.to_string())?;
        cr.paint().map_err(|e| e.to_string())?;
    }
    out.flush();
    let stride = out.stride();
    let data = out.data().map_err(|e| e.to_string())?.to_vec();
    Ok(Page { width: pw, height: ph, stride, data })
}

/// Write the captured pages to `path` as a PDF, one page per slide, each page
/// sized to its slide at 96 dpi (1 px = 0.75 pt). Clears the pages.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn slides_pdf_finish(path: String) -> Result<usize, String> {
    let pages = std::mem::take(&mut *PAGES.lock().unwrap());
    if pages.is_empty() {
        return Err("no slides were captured".into());
    }
    let pt = |px: i32| px as f64 * 0.75;
    let pdf = cairo::PdfSurface::new(pt(pages[0].width), pt(pages[0].height), &path).map_err(|e| e.to_string())?;
    let cr = cairo::Context::new(&pdf).map_err(|e| e.to_string())?;
    for p in &pages {
        pdf.set_size(pt(p.width), pt(p.height)).map_err(|e| e.to_string())?;
        let img = cairo::ImageSurface::create_for_data(p.data.clone(), cairo::Format::ARgb32, p.width, p.height, p.stride).map_err(|e| e.to_string())?;
        cr.save().map_err(|e| e.to_string())?;
        cr.scale(0.75, 0.75);
        cr.set_source_surface(&img, 0.0, 0.0).map_err(|e| e.to_string())?;
        cr.paint().map_err(|e| e.to_string())?;
        cr.restore().map_err(|e| e.to_string())?;
        cr.show_page().map_err(|e| e.to_string())?;
    }
    drop(cr);
    pdf.finish();
    Ok(pages.len())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn slides_pdf_finish(path: String) -> Result<usize, String> {
    let _ = path;
    Err("PDF export needs the Linux build".into())
}

#[cfg(test)]
mod tests {
    use super::kind_of;

    #[test]
    fn connectors_get_a_plain_name() {
        assert_eq!(kind_of("eDP-1"), "laptop");
        assert_eq!(kind_of("HDMI-A-1"), "HDMI");
        assert_eq!(kind_of("DP-2"), "DisplayPort");
        assert_eq!(kind_of("0x1429"), "");
    }
}
