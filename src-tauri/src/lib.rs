use std::env;
use std::net::TcpListener;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const WINDOW_LABEL: &str = "main";
const DEV_API_BASE_ENV: &str = "PRISM_DESKTOP_API_BASE";
const DEFAULT_DEV_API_BASE: &str = "http://127.0.0.1:33100";
const SIDECAR_NAME: &str = "prism-backend";

#[derive(Default)]
struct SidecarState(Mutex<Option<CommandChild>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntime {
    platform: &'static str,
    api_base: String,
    backend_managed_by_desktop: bool,
    startup_error: String,
}

struct PreparedRuntime {
    config: DesktopRuntime,
    child: Option<CommandChild>,
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

fn spawn_release_sidecar(app: &tauri::AppHandle) -> Result<PreparedRuntime, String> {
    let port = pick_available_port()?;
    let api_base = format!("http://127.0.0.1:{port}");
    let args = [
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--desktop-mode".to_string(),
    ];

    let (_rx, child) = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|error| format!("创建 sidecar 命令失败: {error}"))?
        .args(args)
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败: {error}"))?;

    Ok(PreparedRuntime {
        config: DesktopRuntime {
            platform: "desktop",
            api_base,
            backend_managed_by_desktop: true,
            startup_error: String::new(),
        },
        child: Some(child),
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
            child: None,
        };
    }

    match spawn_release_sidecar(app) {
        Ok(runtime) => runtime,
        Err(error) => PreparedRuntime {
            config: DesktopRuntime {
                platform: "desktop",
                api_base: String::new(),
                backend_managed_by_desktop: true,
                startup_error: error,
            },
            child: None,
        },
    }
}

fn shutdown_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<SidecarState>();
    if let Some(child) = state.0.lock().ok().and_then(|mut guard| guard.take()) {
        let _ = child.kill();
    }
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
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                shutdown_sidecar(&window.app_handle());
            }
        })
        .setup(|app| {
            let runtime = prepare_runtime(app.handle());

            if let Some(child) = runtime.child {
                {
                    let state = app.state::<SidecarState>();
                    let mut guard = state
                        .0
                        .lock()
                        .map_err(|error| std::io::Error::other(error.to_string()))?;
                    *guard = Some(child);
                }
            }

            let init_script = build_runtime_script(&runtime.config)
                .map_err(std::io::Error::other)?;
            WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
                .title("Prism")
                .inner_size(1280.0, 800.0)
                .min_inner_size(1100.0, 760.0)
                .decorations(false)
                .center()
                .initialization_script(init_script)
                .build()
                .map_err(std::io::Error::other)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Prism desktop app");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            shutdown_sidecar(app_handle);
        }
    });
}
