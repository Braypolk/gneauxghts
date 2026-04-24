use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=GNEAUXGHTS_LLAMA_SERVER_BIN");
    println!("cargo:rerun-if-changed=build.rs");

    if should_stage_bundled_runtime() {
        cleanup_staged_runtime_artifacts();
        if let Err(error) = bundle_llama_server() {
            println!("cargo:warning=failed to stage bundled llama-server: {error}");
        }
    }

    tauri_build::build()
}

fn bundle_llama_server() -> Result<(), String> {
    let Some(source_binary) = resolve_llama_server_binary() else {
        println!(
            "cargo:warning=llama-server not found while building; the app will rely on runtime fallback resolution"
        );
        return Ok(());
    };

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|err| err.to_string())?);
    let resources_bin_dir = manifest_dir.join("resources").join("bin");
    let resources_lib_dir = manifest_dir.join("resources").join("lib");
    fs::create_dir_all(&resources_bin_dir)
        .map_err(|err| format!("create {}: {err}", resources_bin_dir.display()))?;
    fs::create_dir_all(&resources_lib_dir)
        .map_err(|err| format!("create {}: {err}", resources_lib_dir.display()))?;

    let target_name = executable_name_for_target();
    let destination = resources_bin_dir.join(target_name);
    // Homebrew ships llama-server as 555; a previously staged copy is also 555, so
    // `fs::copy` cannot overwrite it and `install_name_tool` cannot edit it (EACCES).
    let _ = fs::remove_file(&destination);
    fs::copy(&source_binary, &destination).map_err(|err| {
        format!(
            "copy {} to {}: {err}",
            source_binary.display(),
            destination.display()
        )
    })?;
    #[cfg(unix)]
    unix_chmod(&destination, 0o755)
        .map_err(|err| format!("chmod 755 {}: {err}", destination.display()))?;
    copy_runtime_libraries(&resources_lib_dir)?;
    copy_backend_plugins_to_executable_dir(&resources_bin_dir, &resources_lib_dir)?;

    #[cfg(target_os = "macos")]
    if std::env::consts::OS == "macos" {
        let bin_dir = resources_bin_dir.clone();
        if let Err(error) = relink_macos_bundle(&destination, &bin_dir, &resources_lib_dir) {
            return Err(format!(
                "failed to rewrite llama-server dylib paths for bundling: {error}"
            ));
        }
        if let Err(error) = ad_hoc_codesign_bundled_llama_server(&destination, &resources_lib_dir) {
            return Err(format!(
                "failed to codesign bundled llama-server for macOS (unsigned helpers are often killed with no log output): {error}"
            ));
        }
    }

    println!("cargo:rerun-if-changed={}", source_binary.display());
    Ok(())
}

fn copy_backend_plugins_to_executable_dir(
    resources_bin_dir: &Path,
    resources_lib_dir: &Path,
) -> Result<(), String> {
    for file_name in legacy_backend_dylib_file_names() {
        let source = resources_lib_dir.join(file_name);
        let destination = resources_bin_dir.join(file_name);
        let _ = fs::remove_file(&destination);
        if !source.is_file() {
            continue;
        }
        fs::copy(&source, &destination).map_err(|err| {
            format!(
                "copy backend plugin {} to {}: {err}",
                source.display(),
                destination.display()
            )
        })?;
        #[cfg(unix)]
        unix_chmod(&destination, 0o644)
            .map_err(|err| format!("chmod 644 {}: {err}", destination.display()))?;
    }
    Ok(())
}

fn cleanup_staged_runtime_artifacts() {
    let Ok(profile_dir) = cargo_profile_dir() else {
        return;
    };

    let bundled_binary = profile_dir.join("bin").join(executable_name_for_target());
    let _ = fs::remove_file(&bundled_binary);

    for file_name in runtime_library_file_names() {
        let _ = fs::remove_file(profile_dir.join("lib").join(file_name));
    }
}

fn copy_runtime_libraries(resources_lib_dir: &Path) -> Result<(), String> {
    for library_path in runtime_library_paths()? {
        let file_name = library_path
            .file_name()
            .ok_or_else(|| format!("invalid library path: {}", library_path.display()))?;
        let destination = resources_lib_dir.join(file_name);
        let _ = fs::remove_file(&destination);
        fs::copy(&library_path, &destination).map_err(|err| {
            format!(
                "copy {} to {}: {err}",
                library_path.display(),
                destination.display()
            )
        })?;
        #[cfg(unix)]
        unix_chmod(&destination, 0o644)
            .map_err(|err| format!("chmod 644 {}: {err}", destination.display()))?;
        println!("cargo:rerun-if-changed={}", library_path.display());
    }

    copy_backend_plugins(resources_lib_dir)?;
    Ok(())
}

fn copy_backend_plugins(resources_lib_dir: &Path) -> Result<(), String> {
    for plugin_path in backend_plugin_paths()? {
        let file_name = plugin_path
            .file_name()
            .ok_or_else(|| format!("invalid backend plugin path: {}", plugin_path.display()))?;
        let destination = resources_lib_dir.join(file_name);
        let _ = fs::remove_file(&destination);
        fs::copy(&plugin_path, &destination).map_err(|err| {
            format!(
                "copy backend plugin {} to {}: {err}",
                plugin_path.display(),
                destination.display()
            )
        })?;
        #[cfg(unix)]
        unix_chmod(&destination, 0o644)
            .map_err(|err| format!("chmod 644 {}: {err}", destination.display()))?;
        println!("cargo:rerun-if-changed={}", plugin_path.display());
    }
    Ok(())
}

#[cfg(unix)]
fn unix_chmod(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(mode);
    fs::set_permissions(path, permissions)
}

fn resolve_llama_server_binary() -> Option<PathBuf> {
    let env_candidate = env::var_os("GNEAUXGHTS_LLAMA_SERVER_BIN")
        .map(PathBuf::from)
        .filter(|path| path.is_file());
    if env_candidate.is_some() {
        return env_candidate;
    }

    let path_candidate = env::var_os("PATH").and_then(|raw_path| {
        env::split_paths(&raw_path)
            .map(|directory| directory.join(executable_name_for_target()))
            .find(|candidate| candidate.is_file())
    });
    if path_candidate.is_some() {
        return path_candidate;
    }

    fallback_binary_locations()
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn fallback_binary_locations() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin").join(executable_name_for_target()),
        PathBuf::from("/usr/local/bin").join(executable_name_for_target()),
    ]
}

fn runtime_library_paths() -> Result<Vec<PathBuf>, String> {
    let llama_prefix = PathBuf::from(
        env::var("HOMEBREW_PREFIX_LLAMA_CPP")
            .unwrap_or_else(|_| "/opt/homebrew/opt/llama.cpp".to_string()),
    );
    let ggml_prefix = resolve_ggml_prefix();
    let openssl_prefix = PathBuf::from(
        env::var("HOMEBREW_PREFIX_OPENSSL_3")
            .unwrap_or_else(|_| "/opt/homebrew/opt/openssl@3".to_string()),
    );
    let libomp_prefix = resolve_libomp_prefix();

    let mut paths = Vec::new();
    let mut missing = Vec::new();

    for file_name in runtime_library_file_names() {
        if is_optional_bundled_dylib(file_name) {
            if let Some(found) = resolve_runtime_library_file(
                file_name,
                &llama_prefix,
                &ggml_prefix,
                &openssl_prefix,
                &libomp_prefix,
            ) {
                paths.push(found);
            }
            continue;
        }
        match resolve_runtime_library_file(
            file_name,
            &llama_prefix,
            &ggml_prefix,
            &openssl_prefix,
            &libomp_prefix,
        ) {
            Some(found) => paths.push(found),
            None => missing.push(file_name.to_string()),
        }
    }

    if missing.is_empty() {
        Ok(paths)
    } else {
        Err(format!(
            "missing runtime libraries (install llama.cpp / openssl via Homebrew or set HOMEBREW_PREFIX_*): {}",
            missing.join(", ")
        ))
    }
}

fn backend_plugin_paths() -> Result<Vec<PathBuf>, String> {
    let ggml_prefix = resolve_ggml_prefix();
    let libexec_dir = ggml_prefix.join("libexec");
    let mut paths = Vec::new();
    let mut missing = Vec::new();

    for file_name in backend_plugin_file_names() {
        let candidate = libexec_dir.join(file_name);
        if candidate.is_file() {
            paths.push(candidate);
        } else {
            missing.push(file_name.to_string());
        }
    }

    if missing.is_empty() {
        Ok(paths)
    } else {
        Err(format!(
            "missing GGML backend plugins in {}: {}",
            libexec_dir.display(),
            missing.join(", ")
        ))
    }
}

/// Older llama.cpp builds shipped extra `libggml-*` backends; current Homebrew
/// often links only `libggml` + `libggml-base` from the `ggml` formula.
fn is_optional_bundled_dylib(file_name: &str) -> bool {
    matches!(
        file_name,
        "libggml-cpu.0.dylib" | "libggml-blas.0.dylib" | "libggml-metal.0.dylib"
    )
}

fn resolve_runtime_library_file(
    file_name: &str,
    llama_prefix: &Path,
    ggml_prefix: &Path,
    openssl_prefix: &Path,
    libomp_prefix: &Path,
) -> Option<PathBuf> {
    let search_roots: &[PathBuf] =
        if file_name.starts_with("libssl") || file_name.starts_with("libcrypto") {
            &[openssl_prefix.join("lib")]
        } else if file_name.starts_with("libomp") {
            &[libomp_prefix.join("lib")]
        } else if file_name.starts_with("libggml") {
            &[ggml_prefix.join("lib"), llama_prefix.join("lib")]
        } else {
            &[llama_prefix.join("lib")]
        };

    for root in search_roots {
        let candidate = root.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Homebrew often ships `ggml` as its own keg; `llama-server` links against
/// `/opt/homebrew/opt/ggml/lib/...` rather than `llama.cpp`'s lib directory.
fn resolve_ggml_prefix() -> PathBuf {
    if let Ok(custom) = env::var("HOMEBREW_PREFIX_GGML") {
        let path = PathBuf::from(custom);
        if path.join("lib").is_dir() {
            return path;
        }
    }
    for default in ["/opt/homebrew/opt/ggml", "/usr/local/opt/ggml"] {
        let path = PathBuf::from(default);
        if path.join("lib").is_dir() {
            return path;
        }
    }
    PathBuf::from("/opt/homebrew/opt/ggml")
}

fn resolve_libomp_prefix() -> PathBuf {
    if let Ok(custom) = env::var("HOMEBREW_PREFIX_LIBOMP") {
        let path = PathBuf::from(custom);
        if path.join("lib").is_dir() {
            return path;
        }
    }
    for default in ["/opt/homebrew/opt/libomp", "/usr/local/opt/libomp"] {
        let path = PathBuf::from(default);
        if path.join("lib").is_dir() {
            return path;
        }
    }
    PathBuf::from("/opt/homebrew/opt/libomp")
}

/// Ad-hoc sign every bundled Mach-O so Gatekeeper / AMFI allow the helper when the `.app` is
/// signed. Without this, `llama-server` can be SIGKILL'd before it writes stderr.
#[cfg(target_os = "macos")]
fn ad_hoc_codesign_bundled_llama_server(llama_server: &Path, lib_dir: &Path) -> Result<(), String> {
    let mut dylibs = dylibs_in_directory(lib_dir)?;
    if let Some(bin_dir) = llama_server.parent() {
        dylibs.extend(dylibs_in_directory(bin_dir)?);
    }
    dylibs.sort();
    dylibs.dedup();
    for lib in &dylibs {
        ad_hoc_codesign_one(lib)?;
    }
    ad_hoc_codesign_one(llama_server)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn dylibs_in_directory(directory: &Path) -> Result<Vec<PathBuf>, String> {
    Ok(fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|ext| ext == "dylib" || ext == "so")
        })
        .collect())
}

#[cfg(target_os = "macos")]
fn ad_hoc_codesign_one(path: &Path) -> Result<(), String> {
    let status = Command::new("codesign")
        .args(["-s", "-", "-f", "--timestamp=none", &path.to_string_lossy()])
        .status()
        .map_err(|err| {
            format!(
                "could not run `codesign` on {}: {err} (install Xcode Command Line Tools)",
                path.display()
            )
        })?;
    if !status.success() {
        return Err(format!(
            "`codesign` failed on {} with status {status}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn relink_macos_bundle(binary: &Path, bin_dir: &Path, lib_dir: &Path) -> Result<(), String> {
    let lib_files = dylibs_in_directory(lib_dir)?;
    let bin_dylibs = dylibs_in_directory(bin_dir)?;

    for lib in &lib_files {
        let base = lib
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("invalid dylib name: {}", lib.display()))?;
        let new_id = format!("@loader_path/{base}");
        run_install_name_tool(&["-id", &new_id, &lib.to_string_lossy()])?;
    }

    let mut macho_files: Vec<PathBuf> = vec![binary.to_path_buf()];
    macho_files.extend(lib_files);
    macho_files.extend(bin_dylibs);

    for macho in &macho_files {
        rewrite_dependency_paths(macho, bin_dir, lib_dir)?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn rewrite_dependency_paths(macho: &Path, bin_dir: &Path, lib_dir: &Path) -> Result<(), String> {
    for old in otool_load_dylibs(macho)? {
        if !old.starts_with('/') && !old.starts_with("@rpath/") {
            continue;
        }
        if old.starts_with("/usr/lib/") || old.starts_with("/System/") {
            continue;
        }
        let Some(file_name) = Path::new(&old).file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let bundled = lib_dir.join(file_name);
        if !bundled.is_file() {
            continue;
        }
        let new_path = if macho.parent().is_some_and(|parent| parent == lib_dir) {
            format!("@loader_path/{file_name}")
        } else if macho.parent().is_some_and(|parent| parent == bin_dir) {
            format!("@loader_path/../lib/{file_name}")
        } else {
            continue;
        };
        if old.starts_with('/') && new_path.len() > old.len() {
            return Err(format!(
                "install_name_tool cannot lengthen load path in {}; old={old} new={new_path}. File an issue or shorten install names.",
                macho.display()
            ));
        }
        run_install_name_tool(&["-change", &old, &new_path, &macho.to_string_lossy()])?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn otool_load_dylibs(macho: &Path) -> Result<Vec<String>, String> {
    let output = Command::new("otool")
        .args(["-L", &macho.to_string_lossy()])
        .output()
        .map_err(|e| format!("otool: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "otool failed on {}: {}",
            macho.display(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut paths = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix('\t') else {
            continue;
        };
        let path = rest.split_whitespace().next().unwrap_or("");
        if !path.is_empty() {
            paths.push(path.to_string());
        }
    }
    Ok(paths)
}

#[cfg(target_os = "macos")]
fn run_install_name_tool(args: &[&str]) -> Result<(), String> {
    let status = Command::new("install_name_tool")
        .args(args)
        .status()
        .map_err(|e| format!("install_name_tool: {e}"))?;
    if !status.success() {
        return Err(format!(
            "install_name_tool {:?} failed with {status}",
            args.join(" ")
        ));
    }
    Ok(())
}

fn runtime_library_file_names() -> [&'static str; 11] {
    [
        "libllama-common.0.dylib",
        "libmtmd.0.dylib",
        "libllama.0.dylib",
        "libggml.0.dylib",
        "libggml-cpu.0.dylib",
        "libggml-blas.0.dylib",
        "libggml-metal.0.dylib",
        "libggml-base.0.dylib",
        "libssl.3.dylib",
        "libcrypto.3.dylib",
        "libomp.dylib",
    ]
}

fn legacy_backend_dylib_file_names() -> [&'static str; 3] {
    [
        "libggml-cpu.0.dylib",
        "libggml-blas.0.dylib",
        "libggml-metal.0.dylib",
    ]
}

fn backend_plugin_file_names() -> [&'static str; 5] {
    [
        "libggml-metal.so",
        "libggml-blas.so",
        "libggml-cpu-apple_m1.so",
        "libggml-cpu-apple_m2_m3.so",
        "libggml-cpu-apple_m4.so",
    ]
}

fn cargo_profile_dir() -> Result<PathBuf, String> {
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|err| err.to_string())?);
    out_dir
        .ancestors()
        .nth(3)
        .map(PathBuf::from)
        .ok_or_else(|| {
            format!(
                "unable to determine cargo profile directory from {}",
                out_dir.display()
            )
        })
}

fn executable_name_for_target() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn should_stage_bundled_runtime() -> bool {
    env::var("PROFILE")
        .map(|profile| profile != "debug")
        .unwrap_or(true)
}
