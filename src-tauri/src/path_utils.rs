use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

pub(crate) fn unique_path_in_dir(
    directory: &Path,
    preferred_file_name: &OsStr,
    default_stem: &str,
) -> PathBuf {
    let preferred_path = directory.join(preferred_file_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let preferred_path = Path::new(preferred_file_name);
    let stem = preferred_path
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or(default_stem);
    let extension = preferred_path
        .extension()
        .map(|value| value.to_string_lossy());

    for suffix in 1.. {
        let candidate_name = match extension.as_deref() {
            Some(extension) if !extension.is_empty() => format!("{stem} {suffix}.{extension}"),
            _ => format!("{stem} {suffix}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded path search always returns")
}
