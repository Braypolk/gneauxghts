use std::{env, fs, path::PathBuf};

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
    fs::create_dir_all(&resources_bin_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&resources_lib_dir).map_err(|err| err.to_string())?;

    let target_name = executable_name_for_target();
    let destination = resources_bin_dir.join(target_name);
    fs::copy(&source_binary, &destination).map_err(|err| err.to_string())?;
    copy_runtime_libraries(&resources_lib_dir)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(&destination)
            .map_err(|err| err.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&destination, permissions).map_err(|err| err.to_string())?;
    }

    println!("cargo:rerun-if-changed={}", source_binary.display());
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

fn copy_runtime_libraries(resources_lib_dir: &PathBuf) -> Result<(), String> {
    for library_path in runtime_library_paths()? {
        let file_name = library_path
            .file_name()
            .ok_or_else(|| format!("invalid library path: {}", library_path.display()))?;
        let destination = resources_lib_dir.join(file_name);
        fs::copy(&library_path, &destination).map_err(|err| err.to_string())?;
        println!("cargo:rerun-if-changed={}", library_path.display());
    }

    Ok(())
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
    let openssl_prefix = PathBuf::from(
        env::var("HOMEBREW_PREFIX_OPENSSL_3")
            .unwrap_or_else(|_| "/opt/homebrew/opt/openssl@3".to_string()),
    );

    let candidates = runtime_library_file_names().map(|file_name| {
        if file_name.starts_with("libssl") || file_name.starts_with("libcrypto") {
            openssl_prefix.join("lib").join(file_name)
        } else {
            llama_prefix.join("lib").join(file_name)
        }
    });

    let mut missing = Vec::new();
    let mut paths = Vec::new();

    for candidate in candidates {
        if candidate.is_file() {
            paths.push(candidate);
        } else {
            missing.push(candidate);
        }
    }

    if missing.is_empty() {
        Ok(paths)
    } else {
        Err(format!(
            "missing runtime libraries: {}",
            missing
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

fn runtime_library_file_names() -> [&'static str; 9] {
    [
        "libmtmd.0.dylib",
        "libllama.0.dylib",
        "libggml.0.dylib",
        "libggml-cpu.0.dylib",
        "libggml-blas.0.dylib",
        "libggml-metal.0.dylib",
        "libggml-base.0.dylib",
        "libssl.3.dylib",
        "libcrypto.3.dylib",
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
