use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;
const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:47652";
const SINGLE_INSTANCE_ACK: &str = "alwaysmemo-single-instance-ok";
const DEBUG_LOG_FILE: &str = "alwaysmemo-debug.log";

fn debug_log_path() -> PathBuf {
    std::env::temp_dir().join(DEBUG_LOG_FILE)
}

fn append_debug_log(message: impl AsRef<str>) {
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(debug_log_path())
    else {
        return;
    };

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
}

fn has_allowed_text_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "txt" | "md" | "markdown"))
        .unwrap_or(false)
}

fn validate_read_path(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "invalid file path".to_string())?;
    let metadata = fs::metadata(&canonical).map_err(|_| "unable to inspect file".to_string())?;
    if !metadata.is_file() {
        return Err("file path must point to a regular file".to_string());
    }
    if !has_allowed_text_extension(&canonical) {
        return Err("unsupported file type".to_string());
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err("file is too large".to_string());
    }
    Ok(canonical)
}

fn validate_write_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("invalid file path".to_string());
    }
    if !has_allowed_text_extension(path) {
        return Err("unsupported file type".to_string());
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| "invalid file path".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid file path".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "invalid file path".to_string())?;
    let parent_metadata =
        fs::metadata(&canonical_parent).map_err(|_| "invalid file path".to_string())?;
    if !parent_metadata.is_dir() {
        return Err("invalid file path".to_string());
    }

    let candidate = canonical_parent.join(file_name);
    if candidate.exists() {
        let canonical = validate_read_path(&candidate)?;
        return Ok(canonical);
    }

    Ok(candidate)
}

fn ensure_text_extension(path: PathBuf) -> PathBuf {
    if has_allowed_text_extension(&path) {
        return path;
    }

    let mut next = path.into_os_string();
    next.push(".txt");
    PathBuf::from(next)
}

fn read_validated_text_file(path: &Path) -> Result<OpenedFile, String> {
    let canonical = validate_read_path(path)?;
    let contents =
        fs::read_to_string(&canonical).map_err(|_| "failed to read text file".to_string())?;
    Ok(OpenedFile {
        path: canonical.to_string_lossy().into_owned(),
        contents,
    })
}

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
        .set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })
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

#[tauri::command]
fn snap_top(window: tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("current_monitor failed: {e}"))?
        .ok_or_else(|| "monitor unavailable".to_string())?;
    let pos = monitor.position();
    let size_monitor = monitor.size();
    let size = window
        .outer_size()
        .map_err(|e| format!("outer_size failed: {e}"))?;
    let current = window
        .outer_position()
        .map_err(|e| format!("outer_position failed: {e}"))?;
    let max_x = pos.x + size_monitor.width.saturating_sub(size.width) as i32;
    let x = current.x.clamp(pos.x, max_x);

    window
        .set_position(tauri::PhysicalPosition { x, y: pos.y })
        .map_err(|e| format!("set_position failed: {e}"))
}

#[tauri::command]
fn snap_bottom(window: tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("current_monitor failed: {e}"))?
        .ok_or_else(|| "monitor unavailable".to_string())?;
    let pos = monitor.position();
    let size_monitor = monitor.size();
    let size = window
        .outer_size()
        .map_err(|e| format!("outer_size failed: {e}"))?;
    let current = window
        .outer_position()
        .map_err(|e| format!("outer_position failed: {e}"))?;
    let max_x = pos.x + size_monitor.width.saturating_sub(size.width) as i32;
    let x = current.x.clamp(pos.x, max_x);
    let y = pos.y + size_monitor.height.saturating_sub(size.height) as i32;

    window
        .set_position(tauri::PhysicalPosition { x, y })
        .map_err(|e| format!("set_position failed: {e}"))
}

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    contents: String,
}

struct PendingOpenFiles(Arc<Mutex<Vec<String>>>);

#[derive(Debug, Deserialize, Serialize)]
struct SingleInstanceMessage {
    paths: Vec<String>,
}

fn collect_launch_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| {
            let candidate = PathBuf::from(arg);
            if candidate.as_os_str().is_empty() || candidate.to_string_lossy().starts_with('-') {
                return None;
            }
            validate_read_path(&candidate)
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

fn read_single_instance_message(stream: &TcpStream) -> Result<SingleInstanceMessage, String> {
    let mut payload = String::new();
    let mut reader = BufReader::new(
        stream
            .try_clone()
            .map_err(|e| format!("failed to clone single-instance stream: {e}"))?,
    );
    reader
        .read_line(&mut payload)
        .map_err(|e| format!("failed to read single-instance payload: {e}"))?;
    serde_json::from_str::<SingleInstanceMessage>(payload.trim())
        .map_err(|e| format!("failed to parse single-instance payload: {e}"))
}

fn try_forward_to_running_instance(paths: &[String]) -> bool {
    let Ok(mut stream) = TcpStream::connect(SINGLE_INSTANCE_ADDR) else {
        append_debug_log("single-instance client: no primary instance listening");
        return false;
    };

    let message = SingleInstanceMessage {
        paths: paths.to_vec(),
    };
    let Ok(mut serialized) = serde_json::to_vec(&message) else {
        return false;
    };
    serialized.push(b'\n');

    if stream.write_all(&serialized).is_err() || stream.flush().is_err() {
        append_debug_log("single-instance client: failed to send payload");
        return false;
    }

    append_debug_log(format!(
        "single-instance client: payload sent, paths={paths:?}"
    ));
    let _ = stream.shutdown(Shutdown::Write);
    true
}

fn queue_pending_open_files(
    pending_open_files: &Arc<Mutex<Vec<String>>>,
    paths: &[String],
) -> Result<usize, String> {
    let mut pending = pending_open_files
        .lock()
        .map_err(|_| "failed to lock pending open files".to_string())?;
    pending.extend(paths.iter().cloned());
    Ok(pending.len())
}

fn handle_single_instance_stream(
    mut stream: TcpStream,
    pending_open_files: &Arc<Mutex<Vec<String>>>,
) -> Result<(), String> {
    let message = read_single_instance_message(&stream)?;
    append_debug_log(format!(
        "single-instance server: received paths={:?}",
        message.paths
    ));
    let pending_count = if message.paths.is_empty() {
        0
    } else {
        queue_pending_open_files(pending_open_files, &message.paths)?
    };
    append_debug_log(format!(
        "single-instance server: pending_count={pending_count}"
    ));

    stream
        .write_all(format!("{SINGLE_INSTANCE_ACK}\n").as_bytes())
        .map_err(|e| format!("failed to acknowledge single-instance message: {e}"))?;
    stream
        .flush()
        .map_err(|e| format!("failed to flush single-instance ack: {e}"))?;
    Ok(())
}

fn start_single_instance_server(
    pending_open_files: Arc<Mutex<Vec<String>>>,
    listener: TcpListener,
) {
    append_debug_log("single-instance server: spawning listener thread");
    thread::spawn(move || {
        append_debug_log("single-instance server: listener thread started");
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                append_debug_log("single-instance server: incoming connection failed");
                continue;
            };
            append_debug_log("single-instance server: accepted connection");
            let _ = handle_single_instance_stream(stream, &pending_open_files);
        }
    });
}

#[tauri::command]
fn open_text_file_dialog() -> Result<Option<OpenedFile>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("Text", &["txt", "md", "markdown"])
        .pick_file();
    let Some(path) = file else {
        return Ok(None);
    };
    read_validated_text_file(&path).map(Some)
}

#[tauri::command]
fn open_text_file_by_path(path: String) -> Result<Option<OpenedFile>, String> {
    let file_path = std::path::PathBuf::from(path);
    if !file_path.exists() {
        append_debug_log(format!(
            "open_text_file_by_path: missing path={}",
            file_path.to_string_lossy()
        ));
        return Ok(None);
    }
    let result = read_validated_text_file(&file_path).map(Some);
    append_debug_log(format!(
        "open_text_file_by_path: path={}, success={}",
        file_path.to_string_lossy(),
        result
            .as_ref()
            .map(|opened| opened.is_some())
            .unwrap_or(false)
    ));
    result
}

#[tauri::command]
fn take_pending_open_files(
    pending_open_files: tauri::State<'_, PendingOpenFiles>,
) -> Result<Vec<String>, String> {
    let mut pending = pending_open_files
        .0
        .lock()
        .map_err(|_| "failed to lock pending open files".to_string())?;
    let drained = std::mem::take(&mut *pending);
    append_debug_log(format!(
        "take_pending_open_files: drained paths={drained:?}"
    ));
    Ok(drained)
}

#[tauri::command]
fn write_debug_log(message: String) -> Result<(), String> {
    append_debug_log(format!("webview: {message}"));
    Ok(())
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
    window
        .run_on_main_thread(move || {
            if was_on_top {
                let _ = window_clone.set_always_on_top(false);
            }
            let _ = window_clone.set_focus();
            let _ = window_clone.show();
            let mut dialog = rfd::FileDialog::new();
            dialog = dialog.add_filter("Text", &["txt", "md", "markdown"]);
            if let Some(name) = default_name {
                dialog = dialog.set_file_name(&name);
            }
            let result = dialog
                .save_file()
                .map(ensure_text_extension)
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
    if contents.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("file is too large".to_string());
    }
    let validated_path = validate_write_path(Path::new(&path))?;
    fs::write(validated_path, contents).map_err(|_| "failed to write text file".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths = collect_launch_paths();
    append_debug_log(format!("run: startup_paths={startup_paths:?}"));
    if try_forward_to_running_instance(&startup_paths) {
        append_debug_log("run: forwarded to existing instance and exiting");
        std::process::exit(0);
    }

    let single_instance_listener = match TcpListener::bind(SINGLE_INSTANCE_ADDR) {
        Ok(listener) => Some(listener),
        Err(_) => {
            append_debug_log("run: failed to bind single-instance listener, retrying forward");
            if try_forward_to_running_instance(&startup_paths) {
                append_debug_log("run: forward retry succeeded, exiting");
                std::process::exit(0);
            }
            append_debug_log("run: continuing without single-instance listener");
            None
        }
    };

    let pending_open_files = Arc::new(Mutex::new(startup_paths));
    if let Some(listener) = single_instance_listener {
        append_debug_log("run: starting single-instance listener immediately");
        start_single_instance_server(Arc::clone(&pending_open_files), listener);
    }

    tauri::Builder::default()
        .manage(PendingOpenFiles(pending_open_files))
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
            snap_top,
            snap_bottom,
            open_text_file_dialog,
            open_text_file_by_path,
            take_pending_open_files,
            write_debug_log,
            save_text_file_dialog,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
