use std::{
    fs::OpenOptions,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};

const BACKEND_PORT: u16 = 42817;
const BACKEND_URL: &str = "http://127.0.0.1:42817";
const SIDECAR_PREFIX: &str = "pillar-brief-backend";

struct BackendProcess(Mutex<Option<Child>>);

fn project_root() -> PathBuf {
    if let Ok(root) = std::env::var("PILLAR_PROJECT_ROOT") {
        return PathBuf::from(root);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn target_triples() -> Vec<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        vec!["aarch64-apple-darwin"]
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        vec!["x86_64-apple-darwin"]
    }
    #[cfg(not(target_os = "macos"))]
    {
        vec![]
    }
}

fn find_sidecar_in(dir: &Path) -> Option<PathBuf> {
    for triple in target_triples() {
        let candidate = dir.join(format!("{SIDECAR_PREFIX}-{triple}"));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy();
        if name.starts_with(SIDECAR_PREFIX) {
            return Some(path);
        }
    }
    None
}

fn find_sidecar(app: &tauri::App) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("../Resources"));
        }
    }
    dirs.into_iter().find_map(|dir| find_sidecar_in(&dir))
}

fn wait_for_backend(port: u16, timeout: Duration) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let started = Instant::now();
    while started.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("Backend did not become ready on port {port}"))
}

fn spawn_backend(app: &tauri::App) -> Result<Child, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|error| {
        format!(
            "Could not create app data directory {}: {error}",
            data_dir.display()
        )
    })?;

    let resource_dir = app.path().resource_dir().ok();
    let bundled_backend = resource_dir.as_ref().and_then(|dir| {
        [dir.join("backend"), dir.join("resources/backend")]
            .into_iter()
            .find(|candidate| candidate.join("server/index.js").exists())
    });
    let sidecar = find_sidecar(app);

    let (program, cwd, backend_dir, args): (PathBuf, PathBuf, PathBuf, Vec<String>) =
        if let (Some(sidecar), Some(backend_dir)) = (sidecar, bundled_backend) {
            let server = backend_dir.join("server").join("index.js");
            (
                sidecar,
                backend_dir.clone(),
                backend_dir,
                vec![server.display().to_string()],
            )
        } else {
            let root = project_root();
            let server = root.join("server").join("index.js");
            if !server.exists() {
                return Err(format!(
                    "Could not find backend entrypoint at {}",
                    server.display()
                ));
            }
            (
                PathBuf::from("node"),
                root.clone(),
                root,
                vec![server.display().to_string()],
            )
        };

    let log_path = data_dir.join("backend.log");
    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Could not open backend log {}: {error}", log_path.display()))?;
    let _ = writeln!(
        log_file,
        "\n--- Pillar Brief backend launch {} ---",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|_| "unknown-time".to_string())
    );
    let stderr_log = log_file
        .try_clone()
        .map_err(|error| format!("Could not prepare backend stderr log: {error}"))?;

    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        .env("NODE_ENV", "production")
        .env("NODE_OPTIONS", "--no-warnings")
        .env("PILLAR_APP_MODE", "desktop")
        .env("PILLAR_DESKTOP", "1")
        .env("PILLAR_BACKEND_DIR", backend_dir)
        .env("PILLAR_DATA_DIR", data_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", BACKEND_PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_log));
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: keep the Node backend from opening a console window.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map_err(|error| {
            format!(
                "Could not start the local backend sidecar. Install Node.js 24 or later, then try again. Details: {error}"
            )
        })
}

fn startup_error_url(error: &str) -> WebviewUrl {
    fn escape_html(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#39;")
    }

    fn encode_data_url(value: &str) -> String {
        let mut encoded = String::new();
        for byte in value.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char);
                }
                b' ' => encoded.push_str("%20"),
                _ => encoded.push_str(&format!("%{byte:02X}")),
            }
        }
        encoded
    }

    let safe_error = escape_html(error);
    let html = format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pillar Brief Startup Error</title>
  <style>
    body {{ margin: 0; font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8f5ef; color: #272521; }}
    main {{ max-width: 720px; margin: 72px auto; padding: 0 28px; }}
    h1 {{ font-size: 28px; margin: 0 0 14px; }}
    p {{ line-height: 1.55; color: #5f5a52; }}
    pre {{ white-space: pre-wrap; background: #fff; border: 1px solid #ddd5ca; border-radius: 8px; padding: 16px; color: #8f3d2e; }}
  </style>
</head>
<body>
  <main>
    <h1>Pillar Brief could not start its local backend.</h1>
    <p>The desktop shell opened, but the local server did not become ready. Restart the app once. If it keeps happening, send the backend log from <strong>~/Library/Application Support/com.pillarbrief.desktop/backend.log</strong>.</p>
    <pre>{safe_error}</pre>
  </main>
</body>
</html>"#
    );
    WebviewUrl::External(
        format!("data:text/html;charset=utf-8,{}", encode_data_url(&html))
            .parse()
            .unwrap(),
    )
}

fn backend_get_json(path: &str) -> Option<serde_json::Value> {
    use std::io::{Read, Write};
    let addr = SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    // HTTP/1.0 keeps the response unchunked so the body is everything after the headers.
    write!(stream, "GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let body = response.split("\r\n\r\n").nth(1)?;
    serde_json::from_str(body).ok()
}

/// After a notification is delivered, clicking it activates the app but macOS
/// does not tell us about the click directly. Watch for the app becoming
/// active while the main window is hidden and surface the window when it does.
#[cfg(target_os = "macos")]
fn watch_for_notification_activation(app: tauri::AppHandle) {
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(600);
        // Require an inactive reading first so the trigger is the click's
        // inactive -> active transition, not focus the app already had when
        // the notification was posted. Keep watching even while the window is
        // visible: the user may close it and click the notification later.
        let mut was_active = true;
        while Instant::now() < deadline {
            thread::sleep(Duration::from_millis(500));
            let (tx, rx) = std::sync::mpsc::channel();
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let active = objc2::MainThreadMarker::new()
                    .map(|mtm| objc2_app_kit::NSApplication::sharedApplication(mtm).isActive())
                    .unwrap_or(false);
                let visible = handle
                    .get_webview_window("main")
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(false);
                let _ = tx.send((active, visible));
            });
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok((active, visible)) => {
                    if active && !was_active && !visible {
                        open_route(&app, "briefs");
                        break;
                    }
                    was_active = active;
                }
                _ => {}
            }
        }
    });
}

fn notify_brief_ready(app: &tauri::AppHandle, title: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Your brief is ready")
        .body(title)
        .show();
    // Point the (possibly hidden) window at the brief so it is already
    // showing when the user opens the app from the notification or tray.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            if !window.is_visible().unwrap_or(true) {
                let _ = window.eval("window.location.hash = 'briefs';");
            }
        }
    });
    #[cfg(target_os = "macos")]
    watch_for_notification_activation(app.clone());
}

/// Ask for notification authorization at startup so the macOS permission
/// prompt appears on first launch instead of swallowing the first
/// "brief is ready" notification.
#[cfg(target_os = "macos")]
fn request_notification_authorization() {
    use block2::StackBlock;
    use objc2_foundation::{NSBundle, NSError};
    use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

    // UNUserNotificationCenter requires a real app bundle; skip when running
    // the bare binary (e.g. cargo run without a bundle identifier).
    if NSBundle::mainBundle().bundleIdentifier().is_none() {
        return;
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let options =
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge;
    let handler =
        StackBlock::new(|_granted: objc2::runtime::Bool, _error: *mut NSError| {}).copy();
    center.requestAuthorizationWithOptions_completionHandler(options, &handler);
}

/// Enable launch-at-login once so scheduled briefs can generate in the
/// background without the user remembering to open the app. Only the first
/// launch flips it on; if the user later disables it in System Settings the
/// marker file keeps us from re-enabling it.
fn configure_autostart(app: &tauri::App) {
    use tauri_plugin_autostart::ManagerExt;
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = data_dir.join("autostart-initialized");
    if marker.exists() {
        return;
    }
    if app.autolaunch().enable().is_ok() {
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::write(&marker, "1");
    }
}

fn start_brief_notifier(app: tauri::AppHandle) {
    thread::spawn(move || {
        let latest_run_id = || {
            backend_get_json("/api/notifications/latest-brief")
                .and_then(|json| json["run"]["id"].as_str().map(String::from))
        };
        // Baseline before any catch-up run completes so old briefs never notify.
        let mut last_seen = latest_run_id();
        loop {
            thread::sleep(Duration::from_secs(20));
            let Some(json) = backend_get_json("/api/notifications/latest-brief") else {
                continue;
            };
            let Some(run_id) = json["run"]["id"].as_str() else {
                continue;
            };
            if last_seen.as_deref() == Some(run_id) {
                continue;
            }
            let first_baseline = last_seen.is_none();
            last_seen = Some(run_id.to_string());
            if first_baseline {
                continue;
            }
            let title = json["run"]["title"]
                .as_str()
                .unwrap_or("Open Pillar Brief to read it.");
            notify_brief_ready(&app, title);
        }
    });
}

fn kill_backend(app: &tauri::AppHandle) {
    let process = app.state::<BackendProcess>();
    let child = {
        let mut guard = process.0.lock().unwrap();
        guard.take()
    };
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_route(app: &tauri::AppHandle, hash: &str) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(format!("window.location.hash = '{hash}';"));
    }
}

fn tray_template_icon(app: &tauri::App) -> Option<Image<'static>> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("icons/tray-template.png"));
        candidates.push(resource_dir.join("icons/tray-template@1x.png"));
    }
    candidates.push(project_root().join("src-tauri/icons/tray-template.png"));
    candidates.push(project_root().join("src-tauri/icons/tray-template@1x.png"));
    candidates
        .into_iter()
        .find_map(|path| Image::from_path(path).ok())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let view_brief = MenuItem::with_id(app, "view_brief", "View Latest Brief", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit App", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&view_brief, &settings, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Pillar Brief")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "view_brief" => open_route(app, "briefs"),
            "settings" => open_route(app, "settings"),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = tray_template_icon(app) {
        tray = tray.icon(icon);
        #[cfg(target_os = "macos")]
        {
            tray = tray.icon_as_template(true);
        }
    } else if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux convention: left click shows the window, right click opens the menu.
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        tray = tray
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            });
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let backend_result = spawn_backend(app).and_then(|mut child| {
                if let Err(error) = wait_for_backend(BACKEND_PORT, Duration::from_secs(20)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                Ok(child)
            });

            let webview_url = match backend_result {
                Ok(child) => {
                    *app.state::<BackendProcess>().0.lock().unwrap() = Some(child);
                    WebviewUrl::External(BACKEND_URL.parse().unwrap())
                }
                Err(error) => startup_error_url(&error),
            };

            WebviewWindowBuilder::new(app, "main", webview_url)
                .title("Pillar Brief")
                .inner_size(1280.0, 840.0)
                .min_inner_size(960.0, 680.0)
                .build()
                .map_err(|error| error.to_string())?;

            if let Err(error) = build_tray(app) {
                eprintln!("Could not build tray: {error}");
            }
            configure_autostart(app);
            #[cfg(target_os = "macos")]
            request_notification_authorization();
            if app.state::<BackendProcess>().0.lock().unwrap().is_some() {
                start_brief_notifier(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it so the backend keeps generating
            // scheduled briefs; the tray's Quit App actually exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                let _ = window
                    .app_handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Pillar Brief desktop app");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main_window(app),
        // Fires on every quit path (tray Quit App, Cmd+Q, Dock quit, logout),
        // so the Node backend is never orphaned.
        RunEvent::Exit => kill_backend(app),
        _ => {}
    });
}
