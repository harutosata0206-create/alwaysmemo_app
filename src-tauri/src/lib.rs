use serde::Serialize;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    window
        .is_always_on_top()
        .map_err(|e| format!("is_always_on_top failed: {e}"))
}

#[tauri::command]
fn toggle_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    let current = window
        .is_always_on_top()
        .map_err(|e| format!("is_always_on_top failed: {e}"))?;
    let next = !current;
    window
        .set_always_on_top(next)
        .map_err(|e| format!("set_always_on_top failed: {e}"))?;
    // Bring forward when enabling
    if next {
        let _ = window.set_focus();
        let _ = window.show();
    }
    Ok(next)
}

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, value: bool) -> Result<bool, String> {
    window
        .set_always_on_top(value)
        .map_err(|e| format!("set_always_on_top failed: {e}"))?;
    if value {
        let _ = window.set_focus();
        let _ = window.show();
    }
    let confirmed = window
        .is_always_on_top()
        .map_err(|e| format!("is_always_on_top failed: {e}"))?;
    Ok(confirmed)
}

#[tauri::command]
fn snap_left(window: tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("current_monitor failed: {e}"))?
        .ok_or_else(|| "monitor unavailable".to_string())?;
    let pos = monitor.position();

    window
        .set_position(tauri::PhysicalPosition {
            x: pos.x,
            y: pos.y,
        })
        .map_err(|e| format!("set_position failed: {e}"))
}

#[tauri::command]
fn snap_right(window: tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("current_monitor failed: {e}"))?
        .ok_or_else(|| "monitor unavailable".to_string())?;
    let pos = monitor.position();
    let size_monitor = monitor.size();
    let size = window
        .outer_size()
        .map_err(|e| format!("outer_size failed: {e}"))?;
    let offset = size_monitor.width.saturating_sub(size.width) as i32;
    let x = pos.x + offset;
    window
        .set_position(tauri::PhysicalPosition { x, y: pos.y })
        .map_err(|e| format!("set_position failed: {e}"))
}

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    contents: String,
}

#[tauri::command]
fn open_text_file_dialog() -> Result<Option<OpenedFile>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Text", &["txt"])
        .pick_file();
    let Some(path) = file else {
        return Ok(None);
    };
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
    Ok(Some(OpenedFile {
        path: path.to_string_lossy().into_owned(),
        contents,
    }))
}

#[tauri::command]
fn open_text_file_by_path(path: String) -> Result<Option<OpenedFile>, String> {
    let file_path = std::path::PathBuf::from(path);
    if !file_path.exists() {
        return Ok(None);
    }
    let contents =
        std::fs::read_to_string(&file_path).map_err(|e| format!("read failed: {e}"))?;
    Ok(Some(OpenedFile {
        path: file_path.to_string_lossy().into_owned(),
        contents,
    }))
}

#[tauri::command]
fn save_text_file_dialog(
    window: tauri::WebviewWindow,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let was_on_top = window
        .is_always_on_top()
        .map_err(|e| format!("is_always_on_top failed: {e}"))?;
    let window_clone = window.clone();
    window.run_on_main_thread(move || {
        if was_on_top {
            let _ = window_clone.set_always_on_top(false);
        }
        let _ = window_clone.set_focus();
        let _ = window_clone.show();
        let mut dialog = rfd::FileDialog::new();
        if let Some(name) = default_name {
            dialog = dialog.set_file_name(&name);
        }
        let result = dialog
            .save_file()
            .map(|path| path.to_string_lossy().into_owned());
        if was_on_top {
            let _ = window_clone.set_always_on_top(true);
        }
        let _ = tx.send(result);
    })
    .map_err(|e| format!("dialog failed: {e}"))?;
    rx.recv().map_err(|e| format!("dialog recv failed: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("write failed ({path}): {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_always_on_top,
            set_always_on_top,
            toggle_always_on_top,
            snap_left,
            snap_right,
            open_text_file_dialog,
            open_text_file_by_path,
            save_text_file_dialog,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
