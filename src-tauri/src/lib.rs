use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::{ffi::OsStr, iter, os::windows::ffi::OsStrExt, ptr};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{Emitter, Manager};

const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;
const MAX_SINGLE_INSTANCE_MESSAGE_BYTES: u64 = 65_536;
const MAX_PENDING_OPEN_FILES: usize = 128;
const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:47652";
const SINGLE_INSTANCE_ACK: &str = "alwaysmemo-single-instance-ok";
const PENDING_OPEN_FILES_EVENT: &str = "alwaysmemo:pending-open-files";

const MAX_SETTINGS_FILE_BYTES: usize = 1_048_576;

const STORE_REVIEW_URI: &str = "ms-windows-store://review/?ProductId=9N22TL7M39Q3";

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
    let size_monitor = monitor.size();
    let size = window
        .outer_size()
        .map_err(|e| format!("outer_size failed: {e}"))?;
    let current = window
        .outer_position()
        .map_err(|e| format!("outer_position failed: {e}"))?;
    let max_y = pos.y + size_monitor.height.saturating_sub(size.height) as i32;
    let y = current.y.clamp(pos.y, max_y);

    window
        .set_position(tauri::PhysicalPosition { x: pos.x, y })
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
    let current = window
        .outer_position()
        .map_err(|e| format!("outer_position failed: {e}"))?;
    let offset = size_monitor.width.saturating_sub(size.width) as i32;
    let x = pos.x + offset;
    let max_y = pos.y + size_monitor.height.saturating_sub(size.height) as i32;
    let y = current.y.clamp(pos.y, max_y);
    window
        .set_position(tauri::PhysicalPosition { x, y })
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
struct SettingsFileLock(Mutex<()>);

#[derive(Debug, Deserialize, Serialize)]
struct SingleInstanceMessage {
    paths: Vec<String>,
}

fn collect_launch_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .take(MAX_PENDING_OPEN_FILES)
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
    )
    .take(MAX_SINGLE_INSTANCE_MESSAGE_BYTES + 1);
    let bytes_read = reader
        .read_line(&mut payload)
        .map_err(|e| format!("failed to read single-instance payload: {e}"))?;
    if bytes_read == 0
        || bytes_read as u64 > MAX_SINGLE_INSTANCE_MESSAGE_BYTES
        || !payload.ends_with('\n')
    {
        return Err("invalid single-instance payload size".to_string());
    }
    let message = serde_json::from_str::<SingleInstanceMessage>(payload.trim())
        .map_err(|e| format!("failed to parse single-instance payload: {e}"))?;
    if message.paths.len() > MAX_PENDING_OPEN_FILES {
        return Err("too many single-instance paths".to_string());
    }
    let paths = message
        .paths
        .into_iter()
        .map(|path| {
            validate_read_path(Path::new(&path)).map(|path| path.to_string_lossy().into_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SingleInstanceMessage { paths })
}

fn try_forward_to_running_instance(paths: &[String]) -> bool {
    let Ok(mut stream) = TcpStream::connect(SINGLE_INSTANCE_ADDR) else {
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
        return false;
    }
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
    let remaining = MAX_PENDING_OPEN_FILES.saturating_sub(pending.len());
    pending.extend(paths.iter().take(remaining).cloned());
    Ok(pending.len())
}

fn handle_single_instance_stream(
    mut stream: TcpStream,
    pending_open_files: &Arc<Mutex<Vec<String>>>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let message = read_single_instance_message(&stream)?;
    if !message.paths.is_empty() {
        queue_pending_open_files(pending_open_files, &message.paths)?;
        let _ = app_handle.emit_to("main", PENDING_OPEN_FILES_EVENT, ());
    }

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
    app_handle: tauri::AppHandle,
) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            let _ = handle_single_instance_stream(stream, &pending_open_files, &app_handle);
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
        return Ok(None);
    }
    read_validated_text_file(&file_path).map(Some)
}

#[tauri::command]
fn take_pending_open_files(
    pending_open_files: tauri::State<'_, PendingOpenFiles>,
) -> Result<Vec<String>, String> {
    let mut pending = pending_open_files
        .0
        .lock()
        .map_err(|_| "failed to lock pending open files".to_string())?;
    Ok(std::mem::take(&mut *pending))
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
    if contents.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("file is too large".to_string());
    }
    let validated_path = validate_write_path(Path::new(&path))?;
    fs::write(validated_path, contents).map_err(|_| "failed to write text file".to_string())
}

fn settings_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve settings directory: {e}"))?;
    Ok((
        directory.join("settings.json"),
        directory.join("settings.json.tmp"),
        directory.join("settings.json.bak"),
    ))
}

fn read_settings_value(path: &Path) -> Option<serde_json::Value> {
    let contents = fs::read(path).ok()?;
    if contents.len() > MAX_SETTINGS_FILE_BYTES {
        return None;
    }
    serde_json::from_slice(&contents).ok()
}

fn write_settings_value(
    settings_path: &Path,
    temp_path: &Path,
    backup_path: &Path,
    settings: &serde_json::Value,
) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("failed to serialize settings: {e}"))?;
    if serialized.len() > MAX_SETTINGS_FILE_BYTES {
        return Err("settings file is too large".to_string());
    }
    let directory = settings_path
        .parent()
        .ok_or_else(|| "invalid settings path".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|e| format!("failed to create settings directory: {e}"))?;

    let mut temp_file = fs::File::create(temp_path)
        .map_err(|e| format!("failed to create temporary settings file: {e}"))?;
    temp_file
        .write_all(&serialized)
        .and_then(|_| temp_file.sync_all())
        .map_err(|e| format!("failed to write temporary settings file: {e}"))?;
    drop(temp_file);

    if settings_path.exists() {
        if read_settings_value(settings_path).is_some() {
            if backup_path.exists() {
                fs::remove_file(backup_path)
                    .map_err(|e| format!("failed to replace settings backup: {e}"))?;
            }
            fs::rename(settings_path, backup_path)
                .map_err(|e| format!("failed to back up settings: {e}"))?;
        } else {
            fs::remove_file(settings_path)
                .map_err(|e| format!("failed to remove invalid settings: {e}"))?;
        }
    }
    if let Err(error) = fs::rename(temp_path, settings_path) {
        if backup_path.exists() {
            let _ = fs::rename(backup_path, settings_path);
        }
        return Err(format!("failed to replace settings file: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn read_settings_file(
    app: tauri::AppHandle,
    lock: tauri::State<'_, SettingsFileLock>,
) -> Result<Option<serde_json::Value>, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "failed to lock settings file".to_string())?;
    let (settings_path, _, backup_path) = settings_paths(&app)?;
    Ok(read_settings_value(&settings_path).or_else(|| read_settings_value(&backup_path)))
}

#[tauri::command]
fn write_settings_file(
    app: tauri::AppHandle,
    lock: tauri::State<'_, SettingsFileLock>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "failed to lock settings file".to_string())?;
    let (settings_path, temp_path, backup_path) = settings_paths(&app)?;
    write_settings_value(&settings_path, &temp_path, &backup_path, &settings)
}

#[cfg(test)]
mod tests {
    use super::{read_settings_value, write_settings_value};
    use std::{fs, time::SystemTime};

    #[test]
    fn settings_file_round_trip_and_backup_recovery() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("alwaysmemo-settings-{unique}"));
        let settings_path = directory.join("settings.json");
        let temp_path = directory.join("settings.json.tmp");
        let backup_path = directory.join("settings.json.bak");
        let first = serde_json::json!({ "schemaVersion": 1, "settings": { "themeMode": "dark" } });
        let second =
            serde_json::json!({ "schemaVersion": 1, "settings": { "themeMode": "light" } });

        write_settings_value(&settings_path, &temp_path, &backup_path, &first).unwrap();
        write_settings_value(&settings_path, &temp_path, &backup_path, &second).unwrap();
        assert_eq!(read_settings_value(&settings_path), Some(second.clone()));

        fs::write(&settings_path, b"invalid json").unwrap();
        assert_eq!(read_settings_value(&settings_path), None);
        assert_eq!(read_settings_value(&backup_path), Some(first.clone()));

        write_settings_value(&settings_path, &temp_path, &backup_path, &second).unwrap();
        assert_eq!(read_settings_value(&settings_path), Some(second));
        assert_eq!(read_settings_value(&backup_path), Some(first));
        fs::remove_dir_all(directory).unwrap();
    }
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn open_store_review() -> Result<(), String> {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> isize;
    }

    let operation: Vec<u16> = OsStr::new("open")
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let uri: Vec<u16> = OsStr::new(STORE_REVIEW_URI)
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            uri.as_ptr(),
            ptr::null(),
            ptr::null(),
            1,
        )
    };
    if result > 32 {
        Ok(())
    } else {
        Err(format!(
            "failed to open Microsoft Store review page: {result}"
        ))
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn open_store_review() -> Result<(), String> {
    Err("Microsoft Store review page is only available on Windows".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths = collect_launch_paths();
    if try_forward_to_running_instance(&startup_paths) {
        std::process::exit(0);
    }

    let single_instance_listener = match TcpListener::bind(SINGLE_INSTANCE_ADDR) {
        Ok(listener) => Some(listener),
        Err(_) => {
            if try_forward_to_running_instance(&startup_paths) {
                std::process::exit(0);
            }
            None
        }
    };

    let pending_open_files = Arc::new(Mutex::new(startup_paths));
    let pending_open_files_for_setup = Arc::clone(&pending_open_files);

    tauri::Builder::default()
        .manage(PendingOpenFiles(pending_open_files))
        .manage(SettingsFileLock(Mutex::new(())))
        .setup(move |app| {
            if let Some(listener) = single_instance_listener {
                start_single_instance_server(
                    Arc::clone(&pending_open_files_for_setup),
                    listener,
                    app.handle().clone(),
                );
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
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
            save_text_file_dialog,
            write_text_file,
            read_settings_file,
            write_settings_file,
            open_store_review
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
