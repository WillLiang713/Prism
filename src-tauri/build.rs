use std::env;
use std::fs;
use std::path::PathBuf;

fn ensure_dev_sidecar_placeholder() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let env_kind = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_default();

    if target_os != "windows" || target_arch.is_empty() || env_kind.is_empty() {
        return;
    }

    if profile != "debug" {
        return;
    }

    let manifest_dir = match env::var("CARGO_MANIFEST_DIR") {
        Ok(value) => PathBuf::from(value),
        Err(_) => return,
    };

    let sidecar_name = format!("prism-backend-{target_arch}-pc-windows-{env_kind}.exe");
    let sidecar_path = manifest_dir.join("binaries").join(sidecar_name);

    if sidecar_path.exists() {
        return;
    }

    if let Some(parent) = sidecar_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 开发态使用手动启动的 Python 服务，这里只放一个占位文件让 Tauri 通过资源校验。
    let _ = fs::write(sidecar_path, []);
}

fn main() {
    ensure_dev_sidecar_placeholder();
    tauri_build::build()
}
