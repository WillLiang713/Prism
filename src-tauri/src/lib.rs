use std::env;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    path::BaseDirectory,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, Theme, WebviewUrl, WebviewWindowBuilder,
};
use tauri::webview::Color;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const WINDOW_LABEL: &str = "main";
const DEV_API_BASE_ENV: &str = "PRISM_DESKTOP_API_BASE";
const DEFAULT_DEV_API_BASE: &str = "http://127.0.0.1:33100";
const BACKEND_RESOURCE_DIR: &str = "runtime";
const BACKEND_EXECUTABLE_NAME: &str = "prism-runtime.exe";
const TRAY_ID: &str = "main-tray";
const TRAY_MENU_SHOW_ID: &str = "tray-show";
const TRAY_MENU_QUIT_ID: &str = "tray-quit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
struct BackendState(Mutex<Option<ManagedBackendProcess>>);

#[derive(Default)]
struct DesktopPreferencesState(Mutex<DesktopPreferences>);

#[derive(Default)]
struct ExitIntentState(Mutex<bool>);

struct DesktopPreferences {
    close_to_tray: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntime {
    platform: &'static str,
    api_base: String,
    backend_managed_by_desktop: bool,
    startup_error: String,
}

struct ManagedBackendProcess {
    pid: u32,
    child: Child,
}

struct PreparedRuntime {
    config: DesktopRuntime,
    backend_process: Option<ManagedBackendProcess>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferencesPayload {
    close_to_tray: bool,
}

fn dev_api_base() -> String {
    env::var(DEV_API_BASE_ENV).unwrap_or_else(|_| DEFAULT_DEV_API_BASE.to_string())
}

fn pick_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("分配本地端口失败: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取本地端口失败: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn build_runtime_script(config: &DesktopRuntime) -> Result<String, String> {
    let runtime_json = serde_json::to_string(config)
        .map_err(|error| format!("序列化桌面运行时失败: {error}"))?;

    Ok(format!(
        r#"
window.__PRISM_RUNTIME__ = {runtime_json};
if (window.__PRISM_RUNTIME__ && window.__PRISM_RUNTIME__.apiBase) {{
  try {{
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("apiBase", window.__PRISM_RUNTIME__.apiBase);
    window.history.replaceState(window.history.state, "", nextUrl.toString());
  }} catch (_error) {{
    // ignore history update failure and keep runtime injection only
  }}
}}
"#
    ))
}

fn background_color_for_theme(theme: Theme) -> Color {
    match theme {
        Theme::Light => Color(245, 245, 247, 255),
        Theme::Dark => Color(0, 0, 0, 255),
        _ => Color(0, 0, 0, 255),
    }
}

fn backend_resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BACKEND_RESOURCE_DIR, BaseDirectory::Resource)
        .map_err(|error| format!("解析后端资源目录失败: {error}"))
}

fn backend_executable_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(backend_resource_dir(app)?.join(BACKEND_EXECUTABLE_NAME))
}

fn spawn_release_backend(app: &tauri::AppHandle) -> Result<PreparedRuntime, String> {
    let port = pick_available_port()?;
    let api_base = format!("http://127.0.0.1:{port}");
    let backend_dir = backend_resource_dir(app)?;
    let backend_executable = backend_executable_path(app)?;

    if !backend_executable.exists() {
        return Err(format!(
            "后端可执行文件不存在: {}",
            backend_executable.display()
        ));
    }

    let args = [
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--desktop-mode".to_string(),
    ];

    let mut command = Command::new(&backend_executable);
    command
        .current_dir(&backend_dir)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command
        .spawn()
        .map_err(|error| format!("启动桌面后端失败: {error}"))?;
    let pid = child.id();

    Ok(PreparedRuntime {
        config: DesktopRuntime {
            platform: "desktop",
            api_base,
            backend_managed_by_desktop: true,
            startup_error: String::new(),
        },
        backend_process: Some(ManagedBackendProcess { pid, child }),
    })
}

fn prepare_runtime(app: &tauri::AppHandle) -> PreparedRuntime {
    if cfg!(debug_assertions) {
        return PreparedRuntime {
            config: DesktopRuntime {
                platform: "desktop",
                api_base: dev_api_base(),
                backend_managed_by_desktop: false,
                startup_error: String::new(),
            },
            backend_process: None,
        };
    }

    match spawn_release_backend(app) {
        Ok(runtime) => runtime,
        Err(error) => PreparedRuntime {
            config: DesktopRuntime {
                platform: "desktop",
                api_base: String::new(),
                backend_managed_by_desktop: true,
                startup_error: error,
            },
            backend_process: None,
        },
    }
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn shutdown_backend(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    if let Some(mut backend_process) = state.0.lock().ok().and_then(|mut guard| guard.take()) {
        kill_process_tree(backend_process.pid);
        let _ = backend_process.child.try_wait();
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn should_close_to_tray(app: &tauri::AppHandle) -> bool {
    app.state::<DesktopPreferencesState>()
        .0
        .lock()
        .map(|guard| guard.close_to_tray)
        .unwrap_or(false)
}

fn is_exit_requested(app: &tauri::AppHandle) -> bool {
    app.state::<ExitIntentState>()
        .0
        .lock()
        .map(|guard| *guard)
        .unwrap_or(false)
}

fn request_exit(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<ExitIntentState>().0.lock() {
        *guard = true;
    }
    app.exit(0);
}

fn create_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, TRAY_MENU_SHOW_ID, "显示窗口", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败: {error}"))?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT_ID, "退出", true, None::<&str>)
        .map_err(|error| format!("创建托盘菜单失败: {error}"))?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])
        .map_err(|error| format!("创建托盘菜单失败: {error}"))?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Prism")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_MENU_SHOW_ID => show_main_window(app),
            TRAY_MENU_QUIT_ID => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(&tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .build(app)
        .map(|_| ())
        .map_err(|error| format!("创建托盘图标失败: {error}"))
}

#[tauri::command]
fn update_desktop_preferences(
    app: tauri::AppHandle,
    payload: DesktopPreferencesPayload,
) -> Result<(), String> {
    let state = app.state::<DesktopPreferencesState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|error| format!("更新桌面配置失败: {error}"))?;
    guard.close_to_tray = payload.close_to_tray;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 已有实例运行时，聚焦到已有窗口
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState::default())
        .manage(DesktopPreferencesState::default())
        .manage(ExitIntentState::default())
        .invoke_handler(tauri::generate_handler![update_desktop_preferences])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if should_close_to_tray(&window.app_handle()) && !is_exit_requested(&window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }

            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                shutdown_backend(&window.app_handle());
            }
        })
        .setup(|app| {
            let runtime = prepare_runtime(app.handle());

            if let Some(backend_process) = runtime.backend_process {
                {
                    let state = app.state::<BackendState>();
                    let mut guard = state
                        .0
                        .lock()
                        .map_err(|error| std::io::Error::other(error.to_string()))?;
                    *guard = Some(backend_process);
                }
            }

            let init_script = build_runtime_script(&runtime.config)
                .map_err(std::io::Error::other)?;
            let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
                .title("Prism")
                .inner_size(1280.0, 820.0)
                .min_inner_size(1100.0, 760.0)
                .background_color(Color(0, 0, 0, 255))
                .visible(false)
                .decorations(false)
                .center()
                .initialization_script(init_script)
                .build()
                .map_err(std::io::Error::other)?;

            let theme = window.theme().unwrap_or(Theme::Dark);
            window
                .set_background_color(Some(background_color_for_theme(theme)))
                .map_err(std::io::Error::other)?;
            window.show().map_err(std::io::Error::other)?;

            create_tray(app.handle()).map_err(std::io::Error::other)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Prism desktop app");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            shutdown_backend(app_handle);
        }
    });
}
